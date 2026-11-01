"""Realized-variance estimators and a causal HAR forecaster.

The forecast target is close-to-close variance, because that is what an
option held to expiry actually settles against. Features use the more
efficient overnight-gap + Garman-Klass range estimator.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

LN2 = np.log(2.0)


def daily_variance(df: pd.DataFrame) -> pd.DataFrame:
    """Per-day variance proxies from OHLC. Returns cc (close-to-close squared
    log return) and rng (gap^2 + Garman-Klass), the latter falling back to cc
    on bars with no usable intraday range."""
    c = df["close"]
    prev = c.shift(1)
    r = np.log(c / prev)
    gap = np.log(df["open"] / prev)
    hl = np.log(df["high"] / df["low"])
    oc = np.log(c / df["open"])
    gk = 0.5 * hl ** 2 - (2 * LN2 - 1) * oc ** 2
    rng = gap ** 2 + gk
    bad = (df["high"] <= df["low"]) | ~np.isfinite(rng) | (rng <= 0)
    rng = rng.where(~bad, r ** 2)
    return pd.DataFrame({"ret": r, "cc": r ** 2, "rng": rng}).iloc[1:]


def _har_X(rng: pd.Series) -> pd.DataFrame:
    return pd.DataFrame({
        "d": rng,
        "w": rng.rolling(5).mean(),
        "m": rng.rolling(22).mean(),
        "q": rng.rolling(66).mean(),
    })


def _har_y(cc: pd.Series, h: int) -> pd.Series:
    # mean close-to-close variance over the NEXT h sessions
    return cc[::-1].rolling(h).mean()[::-1].shift(-1)


def har_fit(v: pd.DataFrame, h: int, end=None):
    X = _har_X(v["rng"])
    y = _har_y(v["cc"], h)
    d = pd.concat([X, y.rename("y")], axis=1).dropna()
    if end is not None:
        # labels must be fully realized before `end` (no look-ahead)
        d = d.loc[d.index < end]
        d = d.iloc[:-h] if len(d) > h else d.iloc[:0]
    if len(d) < 250:
        return None
    A = np.column_stack([np.ones(len(d)), d[["d", "w", "m", "q"]].to_numpy()])
    coef, *_ = np.linalg.lstsq(A, d["y"].to_numpy(), rcond=None)
    return coef


def har_predict(coef, v: pd.DataFrame) -> pd.Series:
    X = _har_X(v["rng"])
    A = np.column_stack([np.ones(len(X)), X[["d", "w", "m", "q"]].to_numpy()])
    p = A @ coef
    floor = v["cc"].rolling(250, min_periods=60).quantile(0.05)
    return pd.Series(np.maximum(p, floor.to_numpy()), index=v.index)


def har_forecast_table(v: pd.DataFrame, horizons=range(1, 26), refit_every=63,
                       min_train=750) -> pd.DataFrame:
    """Causal forecasts of mean daily close-to-close variance for each horizon,
    refit on an expanding window every `refit_every` sessions."""
    idx = v.index
    out = pd.DataFrame(index=idx, columns=list(horizons), dtype=float)
    starts = list(range(min_train, len(idx), refit_every))
    for h in horizons:
        for i, s in enumerate(starts):
            coef = har_fit(v, h, end=idx[s])
            if coef is None:
                continue
            e = starts[i + 1] if i + 1 < len(starts) else len(idx)
            seg = har_predict(coef, v.iloc[max(0, s - 70):e]).iloc[-(e - s):]
            out.loc[seg.index, h] = seg.to_numpy()
    return out


def har_now(v: pd.DataFrame, h: float) -> float:
    """Forecast of mean daily variance over the next h sessions, fit on all
    data (live use). Fractional h interpolates between integer fits."""
    lo = max(1, int(np.floor(h)))
    hi = max(lo, int(np.ceil(h)))
    vals = []
    for hh in {lo, hi}:
        coef = har_fit(v, hh)
        vals.append((hh, float(har_predict(coef, v).iloc[-1])))
    vals = dict(vals)
    if lo == hi:
        return vals[lo]
    w = h - lo
    return (1 - w) * vals[lo] + w * vals[hi]


def realized_vol(v: pd.DataFrame, n: int) -> float:
    """Annualized close-to-close vol over the last n sessions."""
    return float(np.sqrt(v["cc"].iloc[-n:].mean() * 252))
