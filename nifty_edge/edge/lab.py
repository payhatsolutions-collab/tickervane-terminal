"""Evidence lab -- measures, on real history, everything the engine may use.

Three studies, all rebuilt daily from the local store:

1. VOLATILITY  (real NIFTY option closes from the F&O bhavcopy, 2021+)
   For every session and the front two expiries, price the structures the
   engine can recommend (strikes picked by delta, exactly as live), hold to
   expiry, settle against the NIFTY close, charge costs. Then condition the
   P&L on what the engine sees at entry: implied/forecast variance ratio,
   days to expiry, VIX regime.

2. DIRECTION  (participant OI 2015+, NIFTY/VIX 2008+, chain stats 2021+)
   Each candidate signal vs the forward return from the NEXT open (EOD data
   is only tradable tomorrow). Rank IC, Newey-West t, split-half stability.
   A signal is usable only if it passes in both halves. The composite is
   additionally tested out-of-sample (select on half 1, score on half 2).

3. FOLKLORE  (max pain, OI walls, PCR) -- do they add anything beyond what
   option prices already imply?

No thresholds here are optimised. Gates are pre-committed; tables show the
gradient so the reader can see whether the gate is doing anything.
"""
from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from nifty_edge.storage import read_frame, write_frame

from . import history
from .options import (Smile, delta, forward_from_parity, implied_vol, max_pain,
                      strike_for_delta)
from .vol import daily_variance, har_forecast_table

LAB_JSON = history.DATA / "lab.json"
LAB_TRADES = history.DATA / "lab_trades.json.gz"
LAB_SIGNALS = history.DATA / "lab_signals.json.gz"

# ---- costs (points per leg) -------------------------------------------------
COST_FIXED = 0.75       # ~half-spread on liquid NIFTY weeklies + ₹20 brokerage/lot
COST_PROP = 0.002       # STT 0.1% (sell) + exchange + GST + stamp, on premium
EXERCISE_STT = 0.00125  # on intrinsic of long legs that finish in the money

# ---- structures: (right, qty, target delta) ----------------------------------
STRUCTS = {
    "iron_condor":     [("C", -1, 0.20), ("C", 1, 0.05), ("P", -1, -0.20), ("P", 1, -0.05)],
    "bull_put":        [("P", -1, -0.30), ("P", 1, -0.10)],
    "bear_call":       [("C", -1, 0.30), ("C", 1, 0.10)],
    "bull_call_debit": [("C", 1, 0.50), ("C", -1, 0.25)],
    "bear_put_debit":  [("P", 1, -0.50), ("P", -1, -0.25)],
}
STRUCT_LABEL = {
    "iron_condor": "Iron condor (sell 20Δ / buy 5Δ wings)",
    "bull_put": "Bull put spread (sell 30Δ / buy 10Δ)",
    "bear_call": "Bear call spread (sell 30Δ / buy 10Δ)",
    "bull_call_debit": "Bull call spread (buy 50Δ / sell 25Δ)",
    "bear_put_debit": "Bear put spread (buy 50Δ / sell 25Δ)",
    "short_straddle": "Short ATM straddle (VRP benchmark, undefined risk)",
}
SHORT_VOL = ("iron_condor", "bull_put", "bear_call", "short_straddle")
GATE_IVRV = 1.0          # pre-committed: implied variance must exceed forecast
GATE_VIX_SPIKE = 0.10    # pre-committed: no new short vol on a +10% VIX day


# =============================================================== structures
def leg_strikes(legs, K, dC, dP, liqC, liqP):
    """Pick strikes by delta; enforce wing ordering. None if unbuildable."""
    out = []
    for right, q, tgt in legs:
        k = strike_for_delta(K, dC if right == "C" else dP, tgt,
                             liqC if right == "C" else liqP)
        if k is None:
            return None
        out.append((right, q, k))
    # ordering checks: each long wing must be strictly further OTM than its short
    by = {}
    for right, q, k in out:
        by.setdefault(right, []).append((q, k))
    for right, lst in by.items():
        if len(lst) == 2:
            (q1, k1), (q2, k2) = lst
            if k1 == k2:
                return None
    return out


def structure_pnl(legs, prem, S_E):
    """legs: [(right, qty, K)], prem: matching premiums. Returns dict."""
    pnl = cost = credit = 0.0
    for (right, q, k), p in zip(legs, prem):
        pay = max(S_E - k, 0.0) if right == "C" else max(k - S_E, 0.0)
        pnl += q * (pay - p)
        credit -= q * p
        cost += COST_FIXED + COST_PROP * p
        if q > 0:
            cost += EXERCISE_STT * pay
    return pnl - cost, credit, cost


def _width(legs):
    by = {}
    for right, q, k in legs:
        by.setdefault(right, []).append(k)
    return max((max(v) - min(v)) for v in by.values() if len(v) == 2) if by else 0


def sane_quotes(legs, credit) -> bool:
    """Reject arbitrage-violating combos: a vertical/condor can't be worth more
    than its width (or a debit spread less than zero)."""
    w = _width(legs)
    if credit > 0:
        return credit < 0.95 * w
    return 0 < -credit < 0.98 * w


def max_loss(legs, credit):
    widths = {}
    for right, q, k in legs:
        widths.setdefault(right, []).append(k)
    w = max((max(v) - min(v)) for v in widths.values() if len(v) == 2) if widths else 0
    if credit > 0:                       # credit spread / condor
        return max(w - credit, 1e-6)
    return max(-credit, 1e-6)            # debit spread


# =========================================================== chain snapshots
def _chain_metrics(K, C, P, Coi, Poi, Cv, Pv, S, T):
    liqC = np.isfinite(C) & (C > 0) & (Cv > 0)
    liqP = np.isfinite(P) & (P > 0) & (Pv > 0)
    F = forward_from_parity(K, np.where(liqC, C, np.nan), np.where(liqP, P, np.nan), S)
    ivC = implied_vol(np.where(liqC, C, np.nan), F, K, T, True)
    ivP = implied_vol(np.where(liqP, P, np.nan), F, K, T, False)
    dC = delta(F, K, T, ivC, True)
    dP = delta(F, K, T, ivP, False)
    both = liqC & liqP
    if not both.any():
        return None
    i0 = int(np.argmin(np.where(both, np.abs(K - F), np.inf)))
    atm_iv = np.nanmean([ivC[i0], ivP[i0]])
    otm = np.where(K >= F, ivC, ivP)
    sm = Smile(K, otm, F, T)

    def iv_at_delta(d, iv, tgt):
        m = np.isfinite(d) & np.isfinite(iv)
        if m.sum() < 2:
            return np.nan
        o = np.argsort(d[m])
        return float(np.interp(tgt, d[m][o], iv[m][o]))

    rr25 = iv_at_delta(dP, ivP, -0.25) - iv_at_delta(dC, ivC, 0.25)
    above = K > S
    below = K < S
    cw = float(K[above][np.argmax(Coi[above])]) if above.any() and Coi[above].max() > 0 else np.nan
    pw = float(K[below][np.argmax(Poi[below])]) if below.any() and Poi[below].max() > 0 else np.nan
    return {
        "F": F, "ivC": ivC, "ivP": ivP, "dC": dC, "dP": dP,
        "liqC": liqC & np.isfinite(dC), "liqP": liqP & np.isfinite(dP),
        "atm_k": float(K[i0]), "atm_iv": float(atm_iv),
        "straddle": float(C[i0] + P[i0]), "rr25": rr25, "smile": sm,
        "pcr_oi": float(Poi.sum() / Coi.sum()) if Coi.sum() else np.nan,
        "max_pain": max_pain(K, Coi, Poi), "call_wall": cw, "put_wall": pw,
        "p_above_cw": float(sm.prob_above(cw)) if np.isfinite(cw) else np.nan,
        "p_below_pw": float(1 - sm.prob_above(pw)) if np.isfinite(pw) else np.nan,
    }


def build_snapshots(bhav: pd.DataFrame, daily: pd.DataFrame, har: pd.DataFrame) -> pd.DataFrame:
    close = daily["close"]
    dates = daily.index
    pos = {d: i for i, d in enumerate(dates)}
    v = daily_variance(daily)
    cc = v["cc"].reindex(dates)
    vix = daily["vix"]
    vix_pct = vix.rolling(252, min_periods=120).rank(pct=True)
    vix_chg1 = vix.pct_change()
    sma50 = close.rolling(50).mean()
    sma200 = close.rolling(200).mean()

    opt = bhav[bhav["type"].isin(["CE", "PE"])]
    wide = opt.pivot_table(index=["date", "expiry", "strike"], columns="type",
                           values=["close", "oi", "volume"], aggfunc="first")
    wide.columns = [f"{a}_{b}" for a, b in wide.columns]
    wide = wide.reset_index()

    # front / next expiry per date
    by_date: dict = {}
    for (D, E), g in wide.groupby(["date", "expiry"], sort=True):
        if D in pos and E > D:
            by_date.setdefault(D, []).append((E, g))

    recs = []
    for D, lst in by_date.items():
        lst.sort(key=lambda t: t[0])
        S = float(close.loc[D])
        for k, (E, g) in enumerate(lst[:2]):
            g = g.sort_values("strike")
            K = g["strike"].to_numpy(float)
            C = g.get("close_CE", pd.Series(np.nan, index=g.index)).to_numpy(float)
            P = g.get("close_PE", pd.Series(np.nan, index=g.index)).to_numpy(float)
            Coi = g.get("oi_CE", pd.Series(0, index=g.index)).fillna(0).to_numpy(float)
            Poi = g.get("oi_PE", pd.Series(0, index=g.index)).fillna(0).to_numpy(float)
            Cv = g.get("volume_CE", pd.Series(0, index=g.index)).fillna(0).to_numpy(float)
            Pv = g.get("volume_PE", pd.Series(0, index=g.index)).fillna(0).to_numpy(float)
            T = (E - D).days / 365.0
            m = _chain_metrics(K, C, P, Coi, Poi, Cv, Pv, S, T)
            if m is None or not np.isfinite(m["atm_iv"]):
                continue
            iE = int(np.searchsorted(dates, E, side="right")) - 1
            dte_td = iE - pos[D]
            settled = E in pos
            S_E = float(close.loc[E]) if settled else np.nan
            h = int(min(max(dte_td, 1), 25))
            hv = har.at[D, h] if D in har.index else np.nan
            iv_rv = (m["atm_iv"] ** 2 * T) / (hv * dte_td) if (np.isfinite(hv) and dte_td > 0) else np.nan
            real_var = float(cc.iloc[pos[D] + 1: pos[D] + 1 + dte_td].sum()) if settled else np.nan
            rec = {
                "date": D, "expiry": E, "k": k, "dte_cal": (E - D).days, "dte_td": dte_td,
                "S": S, "F": m["F"], "atm_iv": m["atm_iv"], "straddle": m["straddle"],
                "straddle_pct": m["straddle"] / S, "rr25": m["rr25"], "pcr_oi": m["pcr_oi"],
                "max_pain": m["max_pain"], "mp_gap": m["max_pain"] / S - 1,
                "call_wall": m["call_wall"], "put_wall": m["put_wall"],
                "p_above_cw": m["p_above_cw"], "p_below_pw": m["p_below_pw"],
                "iv_rv": iv_rv, "imp_var": m["atm_iv"] ** 2 * T, "fc_var": hv * dte_td if np.isfinite(hv) else np.nan,
                "real_var": real_var, "S_E": S_E, "move": S_E / S - 1 if settled else np.nan,
                "vix": float(vix.loc[D]), "vix_pct": float(vix_pct.loc[D]) if np.isfinite(vix_pct.loc[D]) else np.nan,
                "vix_chg1": float(vix_chg1.loc[D]) if np.isfinite(vix_chg1.loc[D]) else 0.0,
                "trend50": S / sma50.loc[D] - 1 if np.isfinite(sma50.loc[D]) else np.nan,
                "trend200": S / sma200.loc[D] - 1 if np.isfinite(sma200.loc[D]) else np.nan,
            }
            # straddle benchmark
            if settled:
                ks = m["atm_k"]
                i0 = int(np.argmin(np.abs(K - ks)))
                legs = [("C", -1, ks), ("P", -1, ks)]
                pnl, cr, cost = structure_pnl(legs, [C[i0], P[i0]], S_E)
                rec["short_straddle_pnl"] = pnl
                rec["short_straddle_R"] = pnl / max(cr, 1e-6)
                rec["short_straddle_credit"] = cr
            for name, legdef in STRUCTS.items():
                legs = leg_strikes(legdef, K, m["dC"], m["dP"], m["liqC"], m["liqP"])
                if legs is None:
                    continue
                prem = []
                for right, q, kk in legs:
                    i = int(np.argmin(np.abs(K - kk)))
                    prem.append(C[i] if right == "C" else P[i])
                if not all(np.isfinite(prem)):
                    continue
                credit = -sum(q * p for (_, q, _), p in zip(legs, prem))
                if not sane_quotes(legs, credit):
                    continue        # stale closes that imply free money
                ml = max_loss(legs, credit)
                rec[f"{name}_credit"] = credit
                rec[f"{name}_maxloss"] = ml
                rec[f"{name}_legs"] = json.dumps([[r, q, kk] for r, q, kk in legs])
                if settled:
                    pnl, _, _ = structure_pnl(legs, prem, S_E)
                    rec[f"{name}_pnl"] = pnl
                    rec[f"{name}_R"] = pnl / ml
            recs.append(rec)
    snaps = pd.DataFrame(recs).sort_values(["date", "k"]).reset_index(drop=True)
    # term-structure slope (front minus next ATM IV) on each date
    piv = snaps.pivot_table(index="date", columns="k", values="atm_iv")
    if 1 in piv.columns:
        slope = (piv[0] - piv[1]).rename("term_slope")
        snaps = snaps.merge(slope, left_on="date", right_index=True, how="left")
    else:
        snaps["term_slope"] = np.nan
    return snaps


# ================================================================ statistics
def clustered(df: pd.DataFrame, col: str, by: str = "expiry") -> dict:
    """Mean/t with trades clustered by expiry (overlapping entries on the
    same expiry share one outcome, so they are not independent)."""
    d = df[[by, col]].dropna()
    if len(d) == 0:
        return {"n": 0, "n_clusters": 0, "mean": None, "t": None, "win": None}
    g = d.groupby(by)[col].mean()
    n = len(g)
    mean = float(d[col].mean())
    se = float(g.std(ddof=1) / math.sqrt(n)) if n > 1 else float("nan")
    return {"n": int(len(d)), "n_clusters": int(n), "mean": mean,
            "t": float(g.mean() / se) if se and np.isfinite(se) and se > 0 else None,
            "win": float((d[col] > 0).mean()),
            "p05": float(d[col].quantile(0.05)), "worst": float(d[col].min())}


def nw_tstat(y: np.ndarray, x: np.ndarray, lags: int) -> tuple[float, float]:
    """OLS slope of y on x with Newey-West (Bartlett) standard error."""
    X = np.column_stack([np.ones_like(x), x])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    e = y - X @ beta
    n = len(y)
    XtX_inv = np.linalg.inv(X.T @ X)
    Xe = X * e[:, None]
    S = Xe.T @ Xe
    for L in range(1, lags + 1):
        w = 1 - L / (lags + 1)
        G = Xe[L:].T @ Xe[:-L]
        S += w * (G + G.T)
    V = XtX_inv @ S @ XtX_inv
    se = math.sqrt(max(V[1, 1], 1e-30))
    return float(beta[1]), float(beta[1] / se)


def _ic(a, b):
    return float(pd.Series(a).rank().corr(pd.Series(b).rank()))


def measure_signal(sig: pd.Series, fwd: pd.Series, h: int) -> dict:
    d = pd.concat([sig.rename("s"), fwd.rename("f")], axis=1).dropna()
    if len(d) < 250:
        return {"n": int(len(d)), "verdict": "INSUFFICIENT"}
    z = (d["s"] - d["s"].mean()) / (d["s"].std() or 1)
    _, t = nw_tstat(d["f"].to_numpy(), z.to_numpy(), lags=max(h, 1) + 2)
    mid = len(d) // 2
    h1, h2 = d.iloc[:mid], d.iloc[mid:]
    z1 = (h1["s"] - h1["s"].mean()) / (h1["s"].std() or 1)
    z2 = (h2["s"] - h2["s"].mean()) / (h2["s"].std() or 1)
    _, t1 = nw_tstat(h1["f"].to_numpy(), z1.to_numpy(), lags=max(h, 1) + 2)
    _, t2 = nw_tstat(h2["f"].to_numpy(), z2.to_numpy(), lags=max(h, 1) + 2)
    q = pd.qcut(d["s"].rank(method="first"), 5, labels=False)
    qs = d.groupby(q)["f"].mean()
    stable = np.sign(t1) == np.sign(t2)
    if abs(t) >= 2 and stable and min(abs(t1), abs(t2)) >= 1.0:
        verdict = "EDGE"
    elif abs(t) >= 1.5 and stable:
        verdict = "WEAK"
    else:
        verdict = "NOISE"
    return {"n": int(len(d)), "ic": _ic(d["s"], d["f"]), "t": t, "t1": t1, "t2": t2,
            "ic1": _ic(h1["s"], h1["f"]), "ic2": _ic(h2["s"], h2["f"]),
            "q_spread_pct": float((qs.iloc[-1] - qs.iloc[0]) * 100),
            "q_means_pct": [float(x * 100) for x in qs.to_numpy()],
            "start": d.index[0].strftime("%Y-%m-%d"), "split": d.index[mid].strftime("%Y-%m-%d"),
            "verdict": verdict}


# ================================================================== signals
def _z(s: pd.Series, n=252) -> pd.Series:
    m = s.rolling(n, min_periods=120).mean()
    sd = s.rolling(n, min_periods=120).std()
    return (s - m) / sd


SIGNAL_INFO = {
    "fii_fut_ratio": ("FII index-futures long %", "FII long / (long+short) in index futures, z vs 1y"),
    "fii_fut_chg5": ("FII futures net, 5d change", "change in FII net index-futures contracts over 5 sessions, scaled"),
    "fii_opt_net": ("FII index-options net (calls−puts)", "(call long−short) − (put long−short), z vs 1y"),
    "client_fut_ratio": ("Retail index-futures long %", "Client long / (long+short) in index futures, z vs 1y"),
    "pro_opt_net": ("Prop index-options net", "Pro (call long−short) − (put long−short), z vs 1y"),
    "trend200": ("Trend: distance from 200-DMA", "NIFTY / 200-day average − 1"),
    "mom20": ("Momentum 20d", "NIFTY 20-session return"),
    "rev5": ("Last 5 sessions return", "NIFTY 5-session return (negative IC = mean reversion)"),
    "vix_pct": ("VIX percentile (1y)", "India VIX rank within the trailing year"),
    "vix_chg5": ("VIX 5d change", "India VIX 5-session % change"),
    "pcr_oi": ("Put-call OI ratio (front expiry)", "total put OI / call OI, nearest expiry"),
    "mp_gap": ("Max-pain distance", "(max pain − spot) / spot, nearest expiry"),
}


def signal_panel(daily: pd.DataFrame, poi: pd.DataFrame, snaps: pd.DataFrame) -> pd.DataFrame:
    close = daily["close"]
    out = pd.DataFrame(index=daily.index)
    if len(poi):
        p = poi.copy()
        p["date"] = pd.to_datetime(p["date"])
        pv = p.pivot_table(index="date", columns="participant", aggfunc="first")

        def col(c, who):
            return pv[c][who].reindex(daily.index)

        fl, fs = col("fut_idx_long", "FII"), col("fut_idx_short", "FII")
        out["fii_fut_ratio"] = _z(fl / (fl + fs))
        out["fii_fut_chg5"] = _z(((fl - fs) - (fl - fs).shift(5)) / (fl + fs))
        cl, cs = col("opt_idx_call_long", "FII"), col("opt_idx_call_short", "FII")
        pl, ps = col("opt_idx_put_long", "FII"), col("opt_idx_put_short", "FII")
        out["fii_opt_net"] = _z(((cl - cs) - (pl - ps)) / (cl + cs + pl + ps))
        ul, us = col("fut_idx_long", "Client"), col("fut_idx_short", "Client")
        out["client_fut_ratio"] = _z(ul / (ul + us))
        rl, rs = col("opt_idx_call_long", "Pro"), col("opt_idx_call_short", "Pro")
        ql, qs = col("opt_idx_put_long", "Pro"), col("opt_idx_put_short", "Pro")
        out["pro_opt_net"] = _z(((rl - rs) - (ql - qs)) / (rl + rs + ql + qs))
    out["trend200"] = close / close.rolling(200).mean() - 1
    out["mom20"] = close.pct_change(20)
    out["rev5"] = close.pct_change(5)
    out["vix_pct"] = daily["vix"].rolling(252, min_periods=120).rank(pct=True)
    out["vix_chg5"] = daily["vix"].pct_change(5)
    if len(snaps):
        f = snaps[snaps["k"] == 0].set_index("date")
        out["pcr_oi"] = f["pcr_oi"].reindex(daily.index)
        out["mp_gap"] = f["mp_gap"].reindex(daily.index)
    return out


def forward_returns(daily: pd.DataFrame, h: int) -> pd.Series:
    """log(close[t+h] / open[t+1]): what a signal known at t's close can earn."""
    o1 = daily["open"].shift(-1)
    ch = daily["close"].shift(-h)
    bad = (o1 <= 0) | ~np.isfinite(o1)
    return np.log(ch / o1.where(~bad, daily["close"]))


def composite(sig: pd.DataFrame, stats: dict, keys: list[str]) -> pd.Series:
    if not keys:
        return pd.Series(np.nan, index=sig.index)
    parts, wsum = [], 0.0
    for k in keys:
        s = sig[k]
        z = (s - s.rolling(252, min_periods=120).mean()) / s.rolling(252, min_periods=120).std()
        w = stats[k]["t"]
        parts.append(z * w)
        wsum += abs(w)
    c = sum(parts) / wsum
    return c / c.rolling(252, min_periods=120).std()


def direction_study(sig: pd.DataFrame, daily: pd.DataFrame, h: int = 5) -> dict:
    fwd = forward_returns(daily, h)
    stats = {k: measure_signal(sig[k], fwd, h) for k in sig.columns}
    usable = [k for k, s in stats.items() if s.get("verdict") == "EDGE"]
    # honest OOS check of the *procedure*: select on first half, score second
    valid = sig.dropna(how="all")
    mid = valid.index[len(valid) // 2]
    first = {k: measure_signal(sig[k].loc[:mid], fwd.loc[:mid], h) for k in sig.columns}
    sel1 = [k for k, s in first.items() if s.get("verdict") in ("EDGE", "WEAK")]
    comp_oos = composite(sig, first, sel1).loc[mid:] if sel1 else None
    oos = {"selected_on_first_half": sel1, "split": mid.strftime("%Y-%m-%d")}
    if comp_oos is not None:
        d = pd.concat([comp_oos.rename("c"), fwd.rename("f")], axis=1).dropna()
        if len(d) > 100:
            _, t = nw_tstat(d["f"].to_numpy(), d["c"].to_numpy(), lags=h + 2)
            strong = d[d["c"].abs() >= 0.75]
            oos.update({"n": int(len(d)), "ic": _ic(d["c"], d["f"]), "t": t,
                        "hit_when_strong": float((np.sign(strong["c"]) == np.sign(strong["f"])).mean())
                        if len(strong) else None, "n_strong": int(len(strong))})
    comp = composite(sig, stats, usable)
    oos_t = oos.get("t")
    trusted = bool(usable) and oos_t is not None and oos_t >= 1.5
    return {"horizon": h, "signals": stats, "usable": usable, "oos": oos,
            "trusted": trusted, "composite": comp}


# ================================================================== folklore
def folklore_study(snaps: pd.DataFrame) -> list[dict]:
    f = snaps[(snaps["k"] == 0) & snaps["S_E"].notna() & snaps["dte_td"].between(1, 5)].copy()
    # one observation per expiry: the entry closest to 2 sessions out
    f["d2"] = (f["dte_td"] - 2).abs()
    one = f.sort_values(["expiry", "d2"]).groupby("expiry").head(1)
    out = []
    n = len(one)
    if n < 30:
        return out
    # max-pain magnet
    y = (one["S_E"] / one["S"] - 1).to_numpy()
    x = one["mp_gap"].to_numpy()
    b, t = nw_tstat(y, x, lags=0)
    out.append({
        "name": "Max pain is a magnet",
        "claim": "Expiry settles toward the max-pain strike",
        "test": "regress spot→expiry move on (max pain − spot); slope>0 = magnet",
        "stat": f"slope {b:+.2f}, t={t:+.2f}, n={n} expiries",
        "verdict": "EDGE" if (t >= 2 and b > 0) else "NOISE",
        "detail": {"slope": b, "t": t, "n": n},
    })
    for wall, pcol, side in (("call_wall", "p_above_cw", "above"), ("put_wall", "p_below_pw", "below")):
        g = one.dropna(subset=[wall, pcol])
        if len(g) < 30:
            continue
        if side == "above":
            real = (g["S_E"] > g[wall]).mean()
        else:
            real = (g["S_E"] < g[wall]).mean()
        impl = g[pcol].mean()
        se = math.sqrt(max(impl * (1 - impl), 1e-6) / len(g))
        z = (real - impl) / se
        out.append({
            "name": "Highest call OI is a ceiling" if side == "above" else "Highest put OI is a floor",
            "claim": f"Expiry rarely closes {side} the {'max call-OI' if side == 'above' else 'max put-OI'} strike",
            "test": f"realised P(close {side} wall) vs option-implied P at entry",
            "stat": f"realised {real:.1%} vs implied {impl:.1%} (z={z:+.2f}, n={len(g)})",
            "verdict": "EDGE" if z <= -2 else "PRICED IN",
            "detail": {"realised": real, "implied": impl, "z": z, "n": int(len(g))},
        })
    g = one.dropna(subset=["pcr_oi"])
    y = (g["S_E"] / g["S"] - 1).to_numpy()
    zz = ((g["pcr_oi"] - g["pcr_oi"].mean()) / g["pcr_oi"].std()).to_numpy()
    b, t = nw_tstat(y, zz, lags=0)
    out.append({
        "name": "High PCR is bullish",
        "claim": "Heavy put writing (high PCR) precedes up-moves into expiry",
        "test": "regress spot→expiry move on z(PCR)",
        "stat": f"slope {b * 100:+.2f}%/σ, t={t:+.2f}, n={len(g)}",
        "verdict": "EDGE" if abs(t) >= 2 else "NOISE",
        "detail": {"slope": b, "t": t, "n": int(len(g))},
    })
    return out


# ================================================================ vol study
def ivrv_edges(snaps: pd.DataFrame) -> list[float]:
    x = snaps["iv_rv"].replace([np.inf, -np.inf], np.nan).dropna()
    return [float(q) for q in x.quantile([0.2, 0.4, 0.6, 0.8]).to_numpy()]


def _bucket(x, edges):
    return int(np.searchsorted(edges, x, side="right"))


def gate_mask(df: pd.DataFrame) -> pd.Series:
    return (df["iv_rv"] >= GATE_IVRV) & (df["vix_chg1"] < GATE_VIX_SPIKE)


def vol_study(snaps: pd.DataFrame) -> dict:
    s = snaps[snaps["S_E"].notna() & (snaps["dte_td"] >= 1) & (snaps["dte_td"] <= 10)].copy()
    edges = ivrv_edges(s)
    s["ivrv_q"] = s["iv_rv"].apply(lambda x: _bucket(x, edges) if np.isfinite(x) else -1)
    s["vix_band"] = pd.cut(s["vix_pct"], [-0.01, 1 / 3, 2 / 3, 1.01], labels=["low", "mid", "high"])
    s["dte_b"] = s["dte_td"].clip(upper=6)
    out = {"ivrv_edges": edges, "strategies": {}, "by_ivrv": {}, "by_dte": {}, "by_vix": {},
           "gate": {"iv_rv_min": GATE_IVRV, "vix_spike_max": GATE_VIX_SPIKE}}
    names = list(STRUCTS) + ["short_straddle"]
    g = gate_mask(s)
    for nm in names:
        col = f"{nm}_pnl"
        if col not in s:
            continue
        out["strategies"][nm] = {
            "label": STRUCT_LABEL[nm],
            "all": clustered(s, col),
            "gated": clustered(s[g], col),
            "ungated_complement": clustered(s[~g], col),
            "R_all": clustered(s, f"{nm}_R") if f"{nm}_R" in s else None,
            "R_gated": clustered(s[g], f"{nm}_R") if f"{nm}_R" in s else None,
        }
        out["by_ivrv"][nm] = [dict(q=q, **clustered(s[s["ivrv_q"] == q], col)) for q in range(5)]
        out["by_dte"][nm] = [dict(dte=int(d), **clustered(s[s["dte_b"] == d], col))
                             for d in sorted(s["dte_b"].unique())]
        out["by_vix"][nm] = [dict(band=b, **clustered(s[s["vix_band"] == b], col))
                             for b in ("low", "mid", "high")]
        yrs = sorted(s["date"].dt.year.unique())
        out.setdefault("by_year", {})[nm] = [
            {"year": int(y), "gated": clustered(s[g & (s["date"].dt.year == y)], col),
             "all": clustered(s[s["date"].dt.year == y], col),
             "gate_rate": float(g[s["date"].dt.year == y].mean())} for y in yrs]
    # VRP realised on real prices: implied vs realised total variance to expiry
    f = s[s["k"] == 0].dropna(subset=["imp_var", "real_var", "fc_var"])
    out["vrp"] = {
        "imp_over_real_median": float((f["imp_var"] / f["real_var"].clip(lower=1e-8)).median()),
        "pct_imp_gt_real": float((f["imp_var"] > f["real_var"]).mean()),
        "fc_bias": float(np.log(f["fc_var"] / f["real_var"].clip(lower=1e-8)).median()),
        "n": int(len(f)),
    }
    # non-overlapping equity curves, one entry per expiry at a fixed DTE
    curves = {}
    for dte in (1, 2, 3, 4, 5):
        e = s[(s["k"] == 0) & (s["dte_td"] == dte)].sort_values("date")
        if len(e) < 20:
            continue
        cur = {"dates": e["date"].dt.strftime("%Y-%m-%d").tolist()}
        for nm in ("iron_condor", "short_straddle"):
            col = f"{nm}_pnl"
            if col in e:
                pnl = e[col].fillna(0)
                cur[nm] = pnl.cumsum().round(1).tolist()
                cur[f"{nm}_gated"] = pnl.where(gate_mask(e), 0).cumsum().round(1).tolist()
        curves[str(dte)] = cur
    out["curves"] = curves
    return out, s


def directional_overlay(s: pd.DataFrame, comp: pd.Series, thresh: float = 0.75) -> dict:
    """When the direction composite is strong, does trading its direction
    with options beat the neutral condor? Composite is lagged one session so
    it is known before the entry close."""
    if comp is None or comp.dropna().empty:
        return {"available": False}
    c = comp.shift(1).rename("comp")
    d = s.merge(c, left_on="date", right_index=True, how="left")
    d = d[d["comp"].abs() >= thresh].copy()
    if len(d) < 30:
        return {"available": False, "n": int(len(d))}
    up = d["comp"] > 0
    d["dir_debit_pnl"] = np.where(up, d.get("bull_call_debit_pnl"), d.get("bear_put_debit_pnl"))
    d["dir_credit_pnl"] = np.where(up, d.get("bull_put_pnl"), d.get("bear_call_pnl"))
    d["dir_hit"] = np.where(up, d["move"] > 0, d["move"] < 0).astype(float)
    return {"available": True, "threshold": thresh,
            "debit_in_direction": clustered(d, "dir_debit_pnl"),
            "credit_in_direction": clustered(d, "dir_credit_pnl"),
            "condor_same_days": clustered(d, "iron_condor_pnl"),
            "direction_hit": float(d["dir_hit"].mean()), "n": int(len(d))}


def har_quality(v: pd.DataFrame, har: pd.DataFrame) -> dict:
    """Out-of-sample R^2 of the HAR 5-session forecast vs a naive 22d mean."""
    from .vol import _har_y
    y = _har_y(v["cc"], 5)
    f = har[5]
    naive = v["cc"].rolling(22).mean()
    d = pd.concat([y.rename("y"), f.rename("f"), naive.rename("n")], axis=1).dropna()
    if len(d) < 200:
        return {}
    sse_f = ((d["y"] - d["f"]) ** 2).sum()
    sse_n = ((d["y"] - d["n"]) ** 2).sum()
    sst = ((d["y"] - d["y"].mean()) ** 2).sum()
    return {"r2_har": float(1 - sse_f / sst), "r2_naive": float(1 - sse_n / sst),
            "n": int(len(d))}


# ==================================================================== build
def _clean(o):
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else round(float(o), 6)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.strftime("%Y-%m-%d")
    return o


def build(progress=None) -> dict:
    daily = history.load_daily()
    bhav = history.load_bhav()
    poi = history.load_participant()
    if daily.empty or bhav.empty:
        raise RuntimeError("history not built yet")
    if progress:
        progress.set(stage="lab: HAR forecasts", msg="fitting causal vol model")
    v = daily_variance(daily)
    har = har_forecast_table(v)
    if progress:
        progress.set(stage="lab: option history", msg="pricing structures on real closes")
    snaps = build_snapshots(bhav, daily, har)
    if progress:
        progress.set(stage="lab: statistics", msg="measuring signals")
    vol, s = vol_study(snaps)
    sig = signal_panel(daily, poi, snaps)
    dir5 = direction_study(sig, daily, 5)
    dir1 = direction_study(sig, daily, 1)
    folk = folklore_study(snaps)

    # chart series: implied (front ATM, ~constant-maturity via VIX) vs realised
    rv21 = np.sqrt(v["cc"].rolling(21).mean() * 252) * 100
    fwd_rv21 = rv21.shift(-21)
    series = pd.DataFrame({"vix": daily["vix"], "rv21": rv21, "fwd_rv21": fwd_rv21,
                           "close": daily["close"]}).loc["2015":]
    vrp_series = {
        "dates": series.index.strftime("%Y-%m-%d").tolist(),
        "vix": series["vix"].round(2).tolist(),
        "rv21": series["rv21"].round(2).tolist(),
        "fwd_rv21": series["fwd_rv21"].round(2).tolist(),
        "close": series["close"].round(1).tolist(),
    }
    fii = pd.DataFrame()
    if len(poi):
        p = poi[poi["participant"] == "FII"].set_index("date")
        fii = pd.DataFrame({"ratio": p["fut_idx_long"] / (p["fut_idx_long"] + p["fut_idx_short"]) * 100})
        fii = fii.join(daily["close"], how="left").dropna().loc["2018":]
    lab = {
        "built_at": datetime.now().isoformat(timespec="seconds"),
        "ranges": {
            "options": [snaps["date"].min(), snaps["date"].max()],
            "participant": [poi["date"].min(), poi["date"].max()] if len(poi) else None,
            "daily": [daily.index[0], daily.index[-1]],
            "n_snapshots": int(len(snaps)),
            "n_expiries": int(snaps.loc[snaps["S_E"].notna(), "expiry"].nunique()),
        },
        "costs": {"fixed_pts_per_leg": COST_FIXED, "prop_of_premium": COST_PROP,
                  "exercise_stt": EXERCISE_STT},
        "vol": vol,
        "har": har_quality(v, har),
        "direction": {
            str(d["horizon"]): {
                "signals": [dict(key=k, name=SIGNAL_INFO[k][0], desc=SIGNAL_INFO[k][1], **st)
                            for k, st in d["signals"].items()],
                "usable": d["usable"], "oos": d["oos"], "trusted": d["trusted"],
            } for d in (dir5, dir1)
        },
        "folklore": folk,
        "overlay": directional_overlay(s, dir5["composite"]),
        "series": {"vrp": vrp_series,
                   "fii": {"dates": fii.index.strftime("%Y-%m-%d").tolist(),
                           "ratio": fii["ratio"].round(2).tolist() if len(fii) else [],
                           "close": fii["close"].round(1).tolist() if len(fii) else []}},
    }
    lab = _clean(lab)
    # data files first: the engine reloads when lab.json's mtime changes
    keep = [c for c in s.columns if not c.endswith("_legs")]
    write_frame(s[keep], LAB_TRADES)
    sig_out = sig.copy()
    sig_out["composite5"] = dir5["composite"]
    write_frame(sig_out, LAB_SIGNALS)
    tmp = LAB_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(lab))
    tmp.replace(LAB_JSON)
    if progress:
        progress.set(stage="ready", msg="lab rebuilt")
    return lab


def load() -> dict | None:
    try:
        return json.loads(LAB_JSON.read_text())
    except (OSError, ValueError):
        return None


def needs_rebuild() -> bool:
    if not LAB_JSON.exists():
        return True
    src = max((p.stat().st_mtime for p in (history.BHAV_ALL, history.POI_FILE, history.DAILY_FILE)
               if p.exists()), default=0)
    return src > LAB_JSON.stat().st_mtime


if __name__ == "__main__":
    import time
    t0 = time.time()
    lab = build()
    print(f"lab built in {time.time() - t0:.0f}s")
    print(json.dumps(lab["vol"]["strategies"], indent=1)[:3000])
