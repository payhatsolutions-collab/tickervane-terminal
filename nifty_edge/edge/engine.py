"""Live engine: NSE snapshot -> chain analytics -> measured edges -> one call.

Decision rule (every input is measured in lab.py; nothing here is tuned):

  vol edge   = pre-committed gate  (implied var / HAR-forecast var >= 1.0 and
               no +10% VIX day) AND the lab's conditional history for today's
               IV/RV quintile x DTE bucket is positive.
  direction  = composite of signals that survived split-half testing AND whose
               selection procedure held up out-of-sample. Otherwise neutral.

  vol edge + neutral   -> iron condor        vol edge + bull -> bull put spread
  vol edge + bear      -> bear call spread   no vol edge + trusted dir -> debit spread
  anything else        -> NO TRADE (a first-class answer)

Defined-risk structures only. Size = risk budget / max loss, rounded down to lots.
"""
from __future__ import annotations

import json
import math
import time
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
from nifty_edge.storage import read_frame

from . import history, lab
from .nse import NSE
from .options import (Smile, b76, delta, forward_from_parity, gamma, implied_vol,
                      max_pain, strike_for_delta, theta_day)
from .vol import daily_variance, har_now, realized_vol

IST = timezone(timedelta(hours=5, minutes=30))
OPEN_T = (9, 15)
CLOSE_T = (15, 30)
HOLIDAY_FILE = history.DATA / "holidays.json"


def now_ist() -> datetime:
    return datetime.now(IST)


# ================================================================= calendar
class Calendar:
    def __init__(self, nse: NSE):
        self.nse = nse
        self.holidays: set[date] = set()
        self._load()

    def _load(self):
        cached = None
        try:
            cached = json.loads(HOLIDAY_FILE.read_text())
            if time.time() - cached.get("_ts", 0) < 7 * 86400:
                self.holidays = {date.fromisoformat(d) for d in cached["days"]}
                return
        except (OSError, ValueError, KeyError):
            pass
        try:
            j = self.nse.get("/api/holiday-master?type=trading")
            key = "FO" if "FO" in j else "CBM"
            days = [datetime.strptime(r["tradingDate"], "%d-%b-%Y").date()
                    for r in j.get(key, [])]
            self.holidays = set(days)
            HOLIDAY_FILE.write_text(json.dumps(
                {"_ts": time.time(), "days": [d.isoformat() for d in days]}))
        except Exception:
            if cached:
                self.holidays = {date.fromisoformat(d) for d in cached.get("days", [])}

    def is_session(self, d: date) -> bool:
        return d.weekday() < 5 and d not in self.holidays

    def sessions_until(self, t_ref: datetime, expiry: date) -> float:
        """Trading sessions whose close falls after t_ref, up to expiry close.
        The current session counts fractionally when t_ref is inside it."""
        d = t_ref.date()
        h = 0.0
        if self.is_session(d) and d <= expiry:
            o = t_ref.replace(hour=OPEN_T[0], minute=OPEN_T[1], second=0, microsecond=0)
            c = t_ref.replace(hour=CLOSE_T[0], minute=CLOSE_T[1], second=0, microsecond=0)
            if t_ref < o:
                h += 1
            elif t_ref < c:
                h += (c - t_ref).total_seconds() / (c - o).total_seconds()
        d += timedelta(days=1)
        while d <= expiry:
            if self.is_session(d):
                h += 1
            d += timedelta(days=1)
        return h

    def market_open(self, t: datetime) -> bool:
        if not self.is_session(t.date()):
            return False
        return (t.hour, t.minute) >= OPEN_T and (t.hour, t.minute) < CLOSE_T


# ============================================================ chain parsing
def _f(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else np.nan
    except (TypeError, ValueError):
        return np.nan


def parse_chain(records: dict) -> pd.DataFrame:
    rows = []
    for r in records.get("data", []):
        ce, pe = r.get("CE") or {}, r.get("PE") or {}
        rows.append({
            "strike": _f(r.get("strikePrice")),
            "ce_ltp": _f(ce.get("lastPrice")), "ce_bid": _f(ce.get("buyPrice1")),
            "ce_ask": _f(ce.get("sellPrice1")), "ce_oi": _f(ce.get("openInterest")),
            "ce_doi": _f(ce.get("changeinOpenInterest")), "ce_vol": _f(ce.get("totalTradedVolume")),
            "pe_ltp": _f(pe.get("lastPrice")), "pe_bid": _f(pe.get("buyPrice1")),
            "pe_ask": _f(pe.get("sellPrice1")), "pe_oi": _f(pe.get("openInterest")),
            "pe_doi": _f(pe.get("changeinOpenInterest")), "pe_vol": _f(pe.get("totalTradedVolume")),
        })
    df = pd.DataFrame(rows).dropna(subset=["strike"]).sort_values("strike")
    for c in df.columns:
        if c.endswith(("_oi", "_doi", "_vol")):
            df[c] = df[c].fillna(0)
    return df.reset_index(drop=True)


def _mid(ltp, bid, ask):
    ok = (bid > 0) & (ask > 0) & (ask >= bid)
    mid = (bid + ask) / 2
    tight = ok & ((ask - bid) <= np.maximum(1.0, 0.3 * mid))
    return np.where(tight, mid, np.where(ltp > 0, ltp, np.nan))


def expiry_close(exp_str: str) -> datetime:
    d = datetime.strptime(exp_str, "%d-%b-%Y")
    return d.replace(hour=CLOSE_T[0], minute=CLOSE_T[1], tzinfo=IST)


def analyse_expiry(df: pd.DataFrame, spot: float, exp_str: str, t_ref: datetime,
                   h_sessions: float) -> dict:
    K = df["strike"].to_numpy(float)
    C = _mid(df["ce_ltp"].to_numpy(float), df["ce_bid"].to_numpy(float), df["ce_ask"].to_numpy(float))
    P = _mid(df["pe_ltp"].to_numpy(float), df["pe_bid"].to_numpy(float), df["pe_ask"].to_numpy(float))
    Coi, Poi = df["ce_oi"].to_numpy(float), df["pe_oi"].to_numpy(float)
    T = max((expiry_close(exp_str) - t_ref).total_seconds(), 900) / (365 * 86400)
    liqC = np.isfinite(C) & (C > 0) & ((Coi > 0) | (df["ce_vol"].to_numpy() > 0))
    liqP = np.isfinite(P) & (P > 0) & ((Poi > 0) | (df["pe_vol"].to_numpy() > 0))
    F = forward_from_parity(K, np.where(liqC, C, np.nan), np.where(liqP, P, np.nan), spot)
    ivC = implied_vol(np.where(liqC, C, np.nan), F, K, T, True)
    ivP = implied_vol(np.where(liqP, P, np.nan), F, K, T, False)
    otm = np.where(K >= F, ivC, ivP)
    sm = Smile(K, otm, F, T)
    sigC = np.where(np.isfinite(ivC), ivC, sm(K))
    sigP = np.where(np.isfinite(ivP), ivP, sm(K))
    dC = delta(F, K, T, sigC, True)
    dP = delta(F, K, T, sigP, False)
    both = liqC & liqP
    i0 = int(np.argmin(np.where(both, np.abs(K - F), np.inf))) if both.any() else int(np.argmin(np.abs(K - F)))
    atm_iv = float(np.nanmean([ivC[i0], ivP[i0]]))
    if not np.isfinite(atm_iv):
        atm_iv = float(sm(F))
    straddle = float(C[i0] + P[i0])

    def iv_at_delta(d, iv, tgt):
        m = np.isfinite(d) & np.isfinite(iv)
        if m.sum() < 2:
            return np.nan
        o = np.argsort(d[m])
        return float(np.interp(tgt, d[m][o], iv[m][o]))

    rr25 = iv_at_delta(dP, ivP, -0.25) - iv_at_delta(dC, ivC, 0.25)
    band = np.abs(K - spot) <= 0.05 * spot
    above, below = K > spot, K < spot
    order_c = np.argsort(-np.where(above, Coi, -1))[:3]
    order_p = np.argsort(-np.where(below, Poi, -1))[:3]
    win = np.abs(K / spot - 1) <= 0.045
    swin = (np.abs(K / spot - 1) <= 0.07)
    sd_move = F * atm_iv * math.sqrt(T)
    return {
        "expiry": exp_str, "T": T, "h": h_sessions, "F": F, "spot": spot,
        "atm_strike": float(K[i0]), "atm_iv": atm_iv, "straddle": straddle,
        "straddle_pct": straddle / spot, "sd_move": sd_move, "rr25": rr25,
        "pcr_oi": float(Poi.sum() / Coi.sum()) if Coi.sum() else None,
        "pcr_band": float(Poi[band].sum() / Coi[band].sum()) if Coi[band].sum() else None,
        "pcr_doi": float(df["pe_doi"].sum() / df["ce_doi"].sum()) if df["ce_doi"].sum() else None,
        "max_pain": max_pain(K, Coi, Poi),
        "call_walls": [{"strike": float(K[i]), "oi": float(Coi[i])} for i in order_c if above[i]],
        "put_walls": [{"strike": float(K[i]), "oi": float(Poi[i])} for i in order_p if below[i]],
        "ce_doi": float(df["ce_doi"].sum()), "pe_doi": float(df["pe_doi"].sum()),
        "oi_profile": {"strike": K[win].tolist(), "ce_oi": Coi[win].tolist(), "pe_oi": Poi[win].tolist(),
                       "ce_doi": df["ce_doi"].to_numpy()[win].tolist(),
                       "pe_doi": df["pe_doi"].to_numpy()[win].tolist()},
        "smile": {"strike": K[swin].tolist(),
                  "iv": [None if not np.isfinite(x) else round(x * 100, 2) for x in otm[swin]],
                  "fit": [round(float(x) * 100, 2) for x in sm(K[swin])]},
        # private arrays for the recommender
        "_K": K, "_C": C, "_P": P, "_dC": dC, "_dP": dP, "_sigC": sigC, "_sigP": sigP,
        "_liqC": liqC, "_liqP": liqP, "_smile": sm, "_df": df,
    }


# ============================================================ distributions
def fhs_terminal(daily: pd.DataFrame, h: float, sig_daily: float, F: float, n_max=4000):
    """Filtered historical simulation of log(S_T/F): historical h-session
    returns, each rescaled from the vol prevailing then to today's forecast.
    Keeps the fat tails and skew that a lognormal would hide."""
    c = np.log(daily["close"])
    hi = max(1, int(round(h)))
    rh = (c.shift(-hi) - c)
    v = daily_variance(daily)["cc"]
    vol_then = np.sqrt(v.rolling(22).mean()).reindex(c.index)
    z = (rh / (vol_then * math.sqrt(hi))).dropna()
    z = z.loc[z.index >= z.index[-1] - pd.Timedelta(days=365 * 12)]
    z = z.to_numpy()[-n_max:]
    sim = z * sig_daily * math.sqrt(max(h, 0.25))
    sim = sim - np.log(np.mean(np.exp(sim)))
    return F * np.exp(sim)


def legs_pnl(legs, S_T):
    """P&L at expiry for an array of terminal prices (points, before costs)."""
    S_T = np.asarray(S_T, float)
    pnl = np.zeros_like(S_T)
    for lg in legs:
        pay = np.maximum(S_T - lg["strike"], 0) if lg["right"] == "CE" else np.maximum(lg["strike"] - S_T, 0)
        pnl += lg["qty"] * (pay - lg["price"])
    return pnl


def legs_cost(legs, S_T=None):
    c = sum(lab.COST_FIXED + lab.COST_PROP * lg["price"] for lg in legs)
    if S_T is None:
        return c
    ex = 0.0
    for lg in legs:
        if lg["qty"] > 0:
            pay = np.maximum(S_T - lg["strike"], 0) if lg["right"] == "CE" else np.maximum(lg["strike"] - S_T, 0)
            ex = ex + lab.EXERCISE_STT * pay
    return c + ex


# ============================================================= recommender
def build_legs(struct: str, ex: dict) -> list[dict] | None:
    K = ex["_K"]
    df = ex["_df"]
    legs = []
    for right, q, tgt in lab.STRUCTS[struct]:
        d = ex["_dC"] if right == "C" else ex["_dP"]
        liq = ex["_liqC"] if right == "C" else ex["_liqP"]
        k = strike_for_delta(K, d, tgt, liq)
        if k is None:
            return None
        i = int(np.argmin(np.abs(K - k)))
        side = "ce" if right == "C" else "pe"
        legs.append({
            "right": "CE" if right == "C" else "PE", "qty": q, "side": "BUY" if q > 0 else "SELL",
            "strike": float(k), "price": float((ex["_C"] if right == "C" else ex["_P"])[i]),
            "bid": float(df[f"{side}_bid"].iloc[i]), "ask": float(df[f"{side}_ask"].iloc[i]),
            "ltp": float(df[f"{side}_ltp"].iloc[i]),
            "oi": float(df[f"{side}_oi"].iloc[i]), "delta": float(d[i]),
            "iv": float((ex["_sigC"] if right == "C" else ex["_sigP"])[i]),
            "target_delta": tgt,
        })
    by = {}
    for lg in legs:
        by.setdefault(lg["right"], set()).add(lg["strike"])
    if any(len(s) < 2 for s in by.values()):
        return None
    return legs


def structure_metrics(legs, ex, daily, sig_daily, lot):
    credit = -sum(lg["qty"] * lg["price"] for lg in legs)
    widths = {}
    for lg in legs:
        widths.setdefault(lg["right"], []).append(lg["strike"])
    width = max(max(v) - min(v) for v in widths.values())
    max_loss = (width - credit) if credit > 0 else -credit
    max_profit = credit if credit > 0 else width + credit
    F, sm = ex["F"], ex["_smile"]
    grid = np.linspace(F * 0.85, F * 1.15, 1201)
    pay = legs_pnl(legs, grid)
    # breakevens
    sgn = np.sign(pay)
    bes = [float(grid[i] + (grid[i + 1] - grid[i]) * (-pay[i]) / (pay[i + 1] - pay[i]))
           for i in range(len(grid) - 1) if sgn[i] != sgn[i + 1] and sgn[i] != 0]
    # market (risk-neutral, skew-aware) probability of profit and density
    p_above = sm.prob_above(grid)
    pdf_mkt = -np.gradient(p_above, grid)
    pdf_mkt = np.clip(pdf_mkt, 0, None)
    pdf_mkt /= np.trapezoid(pdf_mkt, grid) or 1
    pop_mkt = float(np.trapezoid(np.where(pay > 0, pdf_mkt, 0), grid))
    # model (FHS at forecast vol)
    S_T = fhs_terminal(daily, ex["h"], sig_daily, F)
    pnl_sim = legs_pnl(legs, S_T) - legs_cost(legs, S_T)
    pop_mod = float((pnl_sim > 0).mean())
    ev_mod = float(pnl_sim.mean())
    hist, edges = np.histogram(S_T, bins=80, range=(grid[0], grid[-1]), density=True)
    ctr = (edges[:-1] + edges[1:]) / 2
    # sparse payoff curve for the chart
    sel = np.linspace(0, len(grid) - 1, 241).astype(int)
    agg = {
        "delta": sum(lg["qty"] * lg["delta"] for lg in legs),
        "gamma": float(sum(lg["qty"] * gamma(F, lg["strike"], ex["T"], lg["iv"]) for lg in legs)),
        "theta": float(sum(lg["qty"] * theta_day(F, lg["strike"], ex["T"], lg["iv"]) for lg in legs)),
    }
    natural = -sum(lg["qty"] * (lg["bid"] if lg["qty"] < 0 else lg["ask"])
                   for lg in legs if lg["bid"] > 0 and lg["ask"] > 0)
    return {
        "credit": credit, "natural_credit": natural if natural else None, "width": width,
        "max_loss": max_loss, "max_profit": max_profit, "breakevens": bes,
        "cost_pts": legs_cost(legs), "pop_market": pop_mkt, "pop_model": pop_mod,
        "ev_model_pts": ev_mod, "ev_model_rupees": ev_mod * lot,
        "max_loss_rupees": max_loss * lot, "max_profit_rupees": max_profit * lot,
        "greeks": agg,
        "payoff": {"x": grid[sel].round(1).tolist(), "y": pay[sel].round(2).tolist(),
                   "pdf_market": pdf_mkt[sel].tolist()},
        "model_hist": {"x": ctr.round(1).tolist(), "y": hist.tolist()},
    }


def conditional_edge(trades: pd.DataFrame, struct: str, iv_rv: float, h: float,
                     edges: list[float], shrink_k: float = 15.0) -> dict:
    """Historical P&L of `struct` on days that looked like today: same IV/RV
    quintile and DTE bucket, clustered by expiry, shrunk toward the
    same-quintile all-DTE mean when the cell is thin."""
    col = f"{struct}_pnl"
    if trades is None or col not in trades:
        return {}
    q = int(np.searchsorted(edges, iv_rv, side="right")) if np.isfinite(iv_rv) else -1
    dte_b = int(min(max(round(h), 1), 6))
    same_q = trades[trades["ivrv_q"] == q]
    cell = same_q[same_q["dte_b"] == dte_b]
    st_cell = lab.clustered(cell, col)
    st_q = lab.clustered(same_q, col)
    if not st_q.get("n"):
        return {"quintile": q, "dte_bucket": dte_b}
    n = st_cell.get("n_clusters") or 0
    m_cell = st_cell.get("mean") if n else 0.0
    est = (n * (m_cell or 0) + shrink_k * st_q["mean"]) / (n + shrink_k)
    return {"quintile": q, "dte_bucket": dte_b, "cell": st_cell, "quintile_all_dte": st_q,
            "estimate_pts": est}


def recommend(ctx: dict, labj: dict | None, trades: pd.DataFrame | None,
              comp_now: dict, settings: dict) -> dict:
    exps = ctx["expiries"]
    lot = ctx["lot"]
    daily = ctx["daily"]
    capital = float(settings.get("capital", 1_000_000))
    risk_pct = float(settings.get("risk_pct", 1.0))
    max_lots = int(settings.get("max_lots", 10))

    # trade expiry: front unless fewer than 2 sessions remain (gamma week-end risk)
    pick = next((e for e in exps if e["h"] >= 2), exps[-1] if exps else None)
    if pick is None:
        return {"action": "NO DATA", "headline": "Option chain unavailable"}
    h = pick["h"]
    v = ctx["v"]
    fc_var_daily = har_now(v, h)
    sig_daily = math.sqrt(fc_var_daily)
    imp_var = pick["atm_iv"] ** 2 * pick["T"]
    iv_rv = imp_var / (fc_var_daily * h)
    gate_cfg = (labj or {}).get("vol", {}).get("gate", {"iv_rv_min": 1.0, "vix_spike_max": 0.10})
    edges = (labj or {}).get("vol", {}).get("ivrv_edges", [0.57, 0.68, 0.8, 0.97])
    vix_chg = ctx.get("vix_chg1") or 0.0
    term_slope = (exps[0]["atm_iv"] - exps[1]["atm_iv"]) if len(exps) > 1 else None

    checks = [
        {"name": "Implied variance ≥ forecast (IV/RV)", "pass": iv_rv >= gate_cfg["iv_rv_min"],
         "value": f"{iv_rv:.2f} vs ≥ {gate_cfg['iv_rv_min']:.2f}", "measured": True},
        {"name": "No volatility shock today", "pass": vix_chg < gate_cfg["vix_spike_max"],
         "value": f"VIX {vix_chg * 100:+.1f}% vs < +{gate_cfg['vix_spike_max'] * 100:.0f}%",
         "measured": True},
        {"name": "≥ 2 sessions to expiry", "pass": h >= 2, "value": f"{h:.1f} sessions",
         "measured": False},
    ]
    gate = all(c["pass"] for c in checks)

    # measured direction
    d5 = (labj or {}).get("direction", {}).get("5", {})
    trusted = bool(d5.get("trusted"))
    cval = comp_now.get("value")
    direction = 0
    if trusted and cval is not None and abs(cval) >= 0.75:
        direction = 1 if cval > 0 else -1

    cond = {s: conditional_edge(trades, s, iv_rv, h, edges)
            for s in ("iron_condor", "bull_put", "bear_call", "short_straddle",
                      "bull_call_debit", "bear_put_debit")}
    ic_est = cond["iron_condor"].get("estimate_pts")
    vol_edge = gate and ic_est is not None and ic_est > 0

    if vol_edge:
        struct = {0: "iron_condor", 1: "bull_put", -1: "bear_call"}[direction]
    elif direction != 0:
        struct = "bull_call_debit" if direction > 0 else "bear_put_debit"
    else:
        struct = None

    # always compute the condor so a NO TRADE still shows the shadow trade
    shadow_struct = struct or "iron_condor"
    legs = build_legs(shadow_struct, pick)
    met = structure_metrics(legs, pick, daily, sig_daily, lot) if legs else None

    # what would open the gate: straddle scales ~ sqrt(variance)
    need_straddle = pick["straddle"] * math.sqrt(gate_cfg["iv_rv_min"] / iv_rv) if iv_rv > 0 else None

    rationale, warnings = [], []
    q_lbl = ["bottom", "2nd", "middle", "4th", "top"]
    qi = cond["iron_condor"].get("quintile", -1)
    ql = q_lbl[qi] if 0 <= qi < 5 else "?"
    rationale.append(
        f"Weekly ATM IV {pick['atm_iv'] * 100:.1f}% prices a {pick['straddle']:.0f}-pt straddle; "
        f"the HAR model forecasts {math.sqrt(fc_var_daily * 252) * 100:.1f}% realised vol → "
        f"IV/RV {iv_rv:.2f} ({ql} quintile of 2021-26 history).")
    ce = cond["iron_condor"].get("cell") or {}
    if ce.get("n"):
        rationale.append(
            f"On {ce['n_clusters']} past expiries that looked like this (same IV/RV quintile, "
            f"{cond['iron_condor']['dte_bucket']} sessions out) the condor averaged "
            f"{ce['mean']:+.1f} pts, win {ce['win'] * 100:.0f}%; shrunk estimate {ic_est:+.1f} pts.")
    if not trusted:
        rationale.append("No directional signal (FII/retail positioning, PCR, max pain, trend, VIX) "
                         "has survived out-of-sample testing → the book stays delta-neutral.")
    elif direction:
        rationale.append(f"Direction composite {cval:+.2f}σ (tested OOS) → lean "
                         f"{'long' if direction > 0 else 'short'}.")
    if term_slope is not None and term_slope > 0.03:
        warnings.append(f"Front IV is {term_slope * 100:.1f} vol pts above next expiry "
                        "(inverted term structure = stress). Consider half size.")
    if ctx.get("event_note"):
        warnings.append(ctx["event_note"])
    if pick["h"] < 1:
        warnings.append("Expiry-day gamma: do not open new positions.")

    out = {
        "expiry": pick["expiry"], "h": h, "iv_rv": iv_rv, "fc_vol": math.sqrt(fc_var_daily * 252),
        "atm_iv": pick["atm_iv"], "straddle": pick["straddle"], "need_straddle": need_straddle,
        "checks": checks, "gate": gate, "direction": direction, "direction_trusted": trusted,
        "composite": comp_now, "conditional": cond, "term_slope": term_slope,
        "rationale": rationale, "warnings": warnings, "lot": lot,
    }
    if struct and legs and met:
        budget = capital * risk_pct / 100
        lots = int(budget // (met["max_loss"] * lot)) if met["max_loss"] > 0 else 0
        lots = min(lots, max_lots)
        if lots == 0:
            warnings.append(f"One lot risks ₹{met['max_loss'] * lot:,.0f} — more than your "
                            f"risk budget (₹{budget:,.0f}). Size: 0 lots.")
        out.update({
            "action": "TRADE", "structure": struct, "label": lab.STRUCT_LABEL[struct],
            "headline": {"iron_condor": "SELL IRON CONDOR", "bull_put": "SELL BULL PUT SPREAD",
                         "bear_call": "SELL BEAR CALL SPREAD", "bull_call_debit": "BUY BULL CALL SPREAD",
                         "bear_put_debit": "BUY BEAR PUT SPREAD"}[struct],
            "legs": legs, "metrics": met, "lots": lots,
            "plan": [
                "Enter as one multi-leg order at mid or better; never leg into a condor.",
                "Hold to expiry — that is exactly what the lab measured. Max loss is fixed by the wings.",
                "Optional (unmeasured): close at 50–60% of max profit to free capital.",
                "One position per expiry. Skip if fills are worse than the natural credit shown.",
            ],
        })
    else:
        out.update({
            "action": "NO TRADE", "structure": None, "headline": "NO TRADE",
            "label": "Stand aside — no measured edge today",
            "shadow": {"structure": shadow_struct, "label": lab.STRUCT_LABEL[shadow_struct],
                       "legs": legs, "metrics": met} if legs and met else None,
        })
        if need_straddle and not checks[0]["pass"]:
            rationale.append(f"Gate opens if the {pick['atm_strike']:.0f} straddle reprices to "
                             f"≥ {need_straddle:.0f} pts (now {pick['straddle']:.0f}), or realised "
                             "vol falls.")
    out["alternatives"] = [
        {"structure": s, "label": lab.STRUCT_LABEL[s],
         "estimate_pts": c.get("estimate_pts"), "cell": c.get("cell")}
        for s, c in cond.items() if c]
    return out


# ================================================================ snapshot
class Engine:
    def __init__(self):
        self.nse = NSE()
        self.cal = Calendar(self.nse)
        self._lab = None
        self._lab_mtime = 0
        self._trades = None
        self._signals = None

    def lab_data(self):
        m = lab.LAB_JSON.stat().st_mtime if lab.LAB_JSON.exists() else 0
        if m != self._lab_mtime:
            self._lab = lab.load()
            self._trades = read_frame(lab.LAB_TRADES) if lab.LAB_TRADES.exists() else None
            self._signals = read_frame(lab.LAB_SIGNALS) if lab.LAB_SIGNALS.exists() else None
            self._lab_mtime = m
        return self._lab, self._trades, self._signals

    def live_bar(self, idx: dict, t_data: datetime) -> dict | None:
        n, vx = idx.get("NIFTY 50"), idx.get("INDIA VIX")
        if not n:
            return None
        closed = not self.cal.market_open(now_ist())
        return {"date": t_data.date().isoformat(), "open": _f(n.get("open")), "high": _f(n.get("high")),
                "low": _f(n.get("low")), "close": _f(n.get("last")),
                "vix": _f((vx or {}).get("last")), "vix_high": _f((vx or {}).get("high")),
                "final": closed}

    def snapshot(self, settings: dict) -> dict:
        t0 = time.time()
        now = now_ist()
        idx = self.nse.indices()
        mstat = {}
        try:
            mstat = self.nse.market_status()
        except Exception:
            pass
        expiries = self.nse.expiries("NIFTY")[:3]
        chains = []
        t_data = None
        for e in expiries:
            rec = self.nse.chain(e)
            if not rec.get("data"):
                continue
            ts = rec.get("timestamp")
            try:
                td = datetime.strptime(ts, "%d-%b-%Y %H:%M:%S").replace(tzinfo=IST)
            except (TypeError, ValueError):
                raise RuntimeError("NSE did not provide a valid option-chain timestamp")
            t_data = t_data or td
            chains.append((e, rec))
        if not chains:
            raise RuntimeError("no option-chain data from NSE")
        # price as of the data timestamp, never after the close
        t_ref = min(t_data, t_data.replace(hour=CLOSE_T[0], minute=CLOSE_T[1], second=0))
        spot = _f(chains[0][1].get("underlyingValue")) or _f(idx["NIFTY 50"]["last"])

        daily = history.update_daily(self.live_bar(idx, t_ref))
        daily = daily.loc[daily.index <= pd.Timestamp(t_ref.date())]
        # A fresh quote must never conceal missing daily bars in the HAR forecast.
        completed = t_ref.date() if (t_ref.hour, t_ref.minute) >= CLOSE_T else t_ref.date() - timedelta(days=1)
        while not self.cal.is_session(completed):
            completed -= timedelta(days=1)
        recent = pd.date_range(completed - timedelta(days=10), completed)
        missing = [d for d in recent if self.cal.is_session(d.date()) and d not in daily.index]
        if missing:
            raise RuntimeError("Daily history is incomplete; refresh the history before using the live model")
        v = daily_variance(daily)
        if self.cal.market_open(now) and daily.index[-1].date() == now.date():
            v = v.iloc[:-1]    # today's bar is partial -- keep it out of vol fits

        exps = []
        for e, rec in chains:
            df = parse_chain(rec)
            h = self.cal.sessions_until(t_ref, expiry_close(e).date())
            exps.append(analyse_expiry(df, spot, e, t_ref, h))

        labj, trades, sigs = self.lab_data()
        comp_now = {"value": None, "date": None}
        if sigs is not None and "composite5" in sigs:
            c = sigs["composite5"].dropna()
            if len(c):
                comp_now = {"value": float(c.iloc[-1]), "date": c.index[-1].strftime("%Y-%m-%d")}

        bh = history.load_bhav()
        lot = 65
        if len(bh):
            lots = bh.loc[bh["date"] == bh["date"].max(), "lot"].dropna()
            if len(lots):
                lot = int(lots.mode().iloc[0])

        lot_verified = False
        chosen = next((e for e in exps if e["h"] >= 2), exps[-1])
        try:
            lot = self.nse.lot_size(chosen["expiry"])
            lot_verified = True
        except Exception:
            pass

        vx = idx.get("INDIA VIX") or {}
        ctx = {"expiries": exps, "lot": lot, "daily": daily, "v": v,
               "vix_chg1": (_f(vx.get("percentChange")) or 0) / 100,
               "event_note": settings.get("event_note")}
        # Frozen evidence is valid historical research; frozen directional signals are not live.
        if comp_now.get("date") != daily.index[-1].strftime("%Y-%m-%d"):
            comp_now["value"] = None
        rec = recommend(ctx, labj, trades, comp_now, settings)
        rec["warnings"].append("Evidence and participant history are versioned; check the displayed dates.")

        n50 = idx.get("NIFTY 50") or {}
        close = daily["close"]
        lvl = {
            "spot": spot, "chg": _f(n50.get("variation")), "pchg": _f(n50.get("percentChange")),
            "open": _f(n50.get("open")), "high": _f(n50.get("high")), "low": _f(n50.get("low")),
            "prev_close": _f(n50.get("previousClose")),
            "year_high": _f(n50.get("yearHigh")), "year_low": _f(n50.get("yearLow")),
            "adv": n50.get("advances"), "dec": n50.get("declines"),
            "sma20": float(close.rolling(20).mean().iloc[-1]),
            "sma50": float(close.rolling(50).mean().iloc[-1]),
            "sma200": float(close.rolling(200).mean().iloc[-1]),
            "ret5": float(close.iloc[-1] / close.iloc[-6] - 1),
            "ret20": float(close.iloc[-1] / close.iloc[-21] - 1),
            "rv10": realized_vol(v, 10), "rv21": realized_vol(v, 21), "rv63": realized_vol(v, 63),
            "vix": _f(vx.get("last")), "vix_pchg": _f(vx.get("percentChange")),
            "vix_pct_1y": float((daily["vix"].iloc[-252:] <= daily["vix"].iloc[-1]).mean()),
            "pe": n50.get("pe"),
        }
        spark = daily.iloc[-200:]
        lvl["spark"] = {"dates": spark.index.strftime("%Y-%m-%d").tolist(),
                        "close": spark["close"].round(4).tolist(),
                        "vix": spark["vix"].round(2).tolist()}

        flows = {}
        try:
            for r in self.nse.fii_dii_cash():
                flows[r["category"]] = {"date": r["date"], "buy": _f(r["buyValue"]),
                                        "sell": _f(r["sellValue"]), "net": _f(r["netValue"])}
        except Exception:
            pass

        positioning = participant_view(history.load_participant())
        sig_now = {}
        if sigs is not None:
            last = sigs.drop(columns=["composite5"], errors="ignore").ffill().iloc[-1]
            sig_now = {k: (None if not np.isfinite(v_) else float(v_)) for k, v_ in last.items()}

        for e in exps:
            for k in [k for k in e if k.startswith("_")]:
                e.pop(k)
        fresh = 0 <= (now - t_data).total_seconds() <= 180 and self.cal.market_open(now) and lot_verified
        if not fresh:
            if rec.get("action") == "TRADE":
                rec["shadow"] = {"structure": rec.get("structure"), "label": rec.get("label"),
                                 "legs": rec.pop("legs", None), "metrics": rec.pop("metrics", None)}
            rec.update(action="NO TRADE", headline="NO TRADE", lots=0, structure=None,
                       label="Market closed or live inputs unverified — research snapshot only")
            rec["warnings"].append("Fresh market-session quotes and a verified current lot size are required for an actionable call.")
        return {
            "quotes_fresh": fresh,
            "lot_verified": lot_verified,
            "history_date": daily.index[-1].strftime("%Y-%m-%d"),
            "generated": now.isoformat(timespec="seconds"),
            "data_time": t_ref.isoformat(timespec="minutes"),
            "market_open": self.cal.market_open(now),
            "market_status": mstat.get("marketStatusMessage"),
            "levels": lvl, "expiries": exps, "rec": rec, "flows": flows,
            "positioning": positioning, "signals_now": sig_now,
            "lab_built": (labj or {}).get("built_at"),
            "latency_ms": int((time.time() - t0) * 1000),
        }


def participant_view(poi: pd.DataFrame) -> dict:
    if poi is None or poi.empty:
        return {}
    poi = poi.copy()
    poi["date"] = pd.to_datetime(poi["date"])
    dates = sorted(poi["date"].unique())
    last, prev = dates[-1], dates[-2] if len(dates) > 1 else dates[-1]
    out = {"date": pd.Timestamp(last).strftime("%d-%b-%Y"), "rows": []}
    hist = poi[poi["date"] >= pd.Timestamp(last) - pd.Timedelta(days=365)]
    for who in ("FII", "Pro", "Client", "DII"):
        a = poi[(poi["date"] == last) & (poi["participant"] == who)].iloc[0]
        b = poi[(poi["date"] == prev) & (poi["participant"] == who)].iloc[0]
        h = hist[hist["participant"] == who]
        ratio_h = h["fut_idx_long"] / (h["fut_idx_long"] + h["fut_idx_short"])
        ratio = a["fut_idx_long"] / (a["fut_idx_long"] + a["fut_idx_short"])
        net_fut = a["fut_idx_long"] - a["fut_idx_short"]
        net_fut_prev = b["fut_idx_long"] - b["fut_idx_short"]
        call_net = a["opt_idx_call_long"] - a["opt_idx_call_short"]
        put_net = a["opt_idx_put_long"] - a["opt_idx_put_short"]
        call_net_p = b["opt_idx_call_long"] - b["opt_idx_call_short"]
        put_net_p = b["opt_idx_put_long"] - b["opt_idx_put_short"]
        out["rows"].append({
            "who": who, "fut_long": int(a["fut_idx_long"]), "fut_short": int(a["fut_idx_short"]),
            "fut_net": int(net_fut), "fut_net_chg": int(net_fut - net_fut_prev),
            "long_ratio": float(ratio), "ratio_pct_1y": float((ratio_h <= ratio).mean()),
            "call_net": int(call_net), "put_net": int(put_net),
            "call_net_chg": int(call_net - call_net_p), "put_net_chg": int(put_net - put_net_p),
        })
    return out
