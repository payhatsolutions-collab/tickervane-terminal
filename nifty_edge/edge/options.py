"""Black-76 pricing, a vectorised implied-vol solver, greeks, smile fitting and
option-chain analytics. Everything works on numpy arrays.

Conventions: F = forward (from put-call parity), T = calendar years to expiry
(15:30 IST), r ignored (weekly/monthly discounting is < 1 point).
"""
from __future__ import annotations

import numpy as np
from scipy.special import ndtr

SQ2PI = np.sqrt(2 * np.pi)


def _npdf(x):
    return np.exp(-0.5 * x * x) / SQ2PI


def b76(F, K, T, sig, is_call):
    F, K, T, sig, is_call = np.broadcast_arrays(
        np.asarray(F, float), np.asarray(K, float), np.asarray(T, float),
        np.asarray(sig, float), np.asarray(is_call, bool))
    with np.errstate(divide="ignore", invalid="ignore"):
        sT = sig * np.sqrt(T)
        d1 = (np.log(F / K) + 0.5 * sT * sT) / sT
        d2 = d1 - sT
        call = F * ndtr(d1) - K * ndtr(d2)
        put = K * ndtr(-d2) - F * ndtr(-d1)
    out = np.where(is_call, call, put)
    intrinsic = np.where(is_call, np.maximum(F - K, 0), np.maximum(K - F, 0))
    return np.where((T <= 0) | (sig <= 0), intrinsic, out)


def implied_vol(price, F, K, T, is_call, lo=0.01, hi=2.5, iters=70):
    """Bisection -- slow-ish but never diverges. NaN where price is outside
    the no-arbitrage band (below intrinsic or above the hi-vol price)."""
    price, F, K, T, is_call = np.broadcast_arrays(
        np.asarray(price, float), np.asarray(F, float), np.asarray(K, float),
        np.asarray(T, float), np.asarray(is_call, bool))
    a = np.full(price.shape, lo)
    b = np.full(price.shape, hi)
    pa = b76(F, K, T, a, is_call)
    pb = b76(F, K, T, b, is_call)
    ok = (price > pa + 1e-6) & (price < pb) & (T > 0) & np.isfinite(price)
    for _ in range(iters):
        m = 0.5 * (a + b)
        pm = b76(F, K, T, m, is_call)
        hiside = pm > price
        b = np.where(hiside, m, b)
        a = np.where(hiside, a, m)
    iv = 0.5 * (a + b)
    return np.where(ok, iv, np.nan)


def d1d2(F, K, T, sig):
    with np.errstate(divide="ignore", invalid="ignore"):
        sT = sig * np.sqrt(T)
        d1 = (np.log(F / K) + 0.5 * sT * sT) / sT
    return d1, d1 - sT


def delta(F, K, T, sig, is_call):
    d1, _ = d1d2(F, K, T, sig)
    return np.where(is_call, ndtr(d1), ndtr(d1) - 1)


def gamma(F, K, T, sig):
    d1, _ = d1d2(F, K, T, sig)
    with np.errstate(divide="ignore", invalid="ignore"):
        return _npdf(d1) / (F * sig * np.sqrt(T))


def vega(F, K, T, sig):
    d1, _ = d1d2(F, K, T, sig)
    return F * _npdf(d1) * np.sqrt(T) / 100.0   # per vol point


def theta_day(F, K, T, sig):
    """Calendar-day theta (points/day) of a long option, r=0."""
    d1, _ = d1d2(F, K, T, sig)
    with np.errstate(divide="ignore", invalid="ignore"):
        return -(F * _npdf(d1) * sig / (2 * np.sqrt(T))) / 365.0


class Smile:
    """Quadratic fit of OTM implied vol in standardised log-moneyness
    x = ln(K/F)/sqrt(T), weighted toward the money. Used for probabilities
    and for pricing strikes whose own quote is unusable."""

    def __init__(self, K, iv, F, T):
        K, iv = np.asarray(K, float), np.asarray(iv, float)
        m = np.isfinite(iv) & (iv > 0.01) & (iv < 2.0)
        self.F, self.T = F, T
        x = np.log(K[m] / F) / np.sqrt(T)
        y = iv[m]
        keep = np.abs(x) < 0.6   # roughly +-3 sd for typical vols
        x, y = x[keep], y[keep]
        if len(x) < 4:
            self.coef = np.array([0.0, 0.0, np.nanmedian(iv[m]) if m.any() else 0.15])
            return
        w = np.exp(-(x / 0.25) ** 2) + 0.15
        A = np.vstack([x * x, x, np.ones_like(x)]).T
        W = np.sqrt(w)[:, None]
        self.coef, *_ = np.linalg.lstsq(A * W, y * W[:, 0], rcond=None)

    def __call__(self, K):
        x = np.log(np.asarray(K, float) / self.F) / np.sqrt(self.T)
        x = np.clip(x, -0.8, 0.8)
        return np.maximum(np.polyval(self.coef, x), 0.02)

    def prob_above(self, K, h=None):
        """Risk-neutral P(S_T > K) = -dC/dK under the fitted smile (captures skew,
        unlike N(d2) at a single vol)."""
        K = np.asarray(K, float)
        h = h if h is not None else max(self.F * 0.0005, 1.0)
        c_up = b76(self.F, K + h, self.T, self(K + h), True)
        c_dn = b76(self.F, K - h, self.T, self(K - h), True)
        return np.clip((c_dn - c_up) / (2 * h), 0.0, 1.0)


def forward_from_parity(K, C, P, spot, n=5):
    """Median of K + C - P over the n strikes closest to spot with both legs
    priced. Falls back to spot."""
    K, C, P = map(lambda a: np.asarray(a, float), (K, C, P))
    m = np.isfinite(C) & np.isfinite(P) & (C > 0) & (P > 0)
    if m.sum() == 0:
        return float(spot)
    idx = np.argsort(np.abs(K[m] - spot))[:n]
    return float(np.median(K[m][idx] + C[m][idx] - P[m][idx]))


def max_pain(K, ce_oi, pe_oi):
    K = np.asarray(K, float)
    ce_oi, pe_oi = np.asarray(ce_oi, float), np.asarray(pe_oi, float)
    S = K[:, None]
    pain = (ce_oi[None, :] * np.maximum(S - K[None, :], 0)
            + pe_oi[None, :] * np.maximum(K[None, :] - S, 0)).sum(1)
    return float(K[int(np.argmin(pain))])


def strike_for_delta(K, deltas, target, valid=None):
    """Strike whose delta is closest to target (deltas signed: puts < 0)."""
    K, deltas = np.asarray(K, float), np.asarray(deltas, float)
    m = np.isfinite(deltas)
    if valid is not None:
        m &= np.asarray(valid, bool)
    if not m.any():
        return None
    i = np.argmin(np.where(m, np.abs(deltas - target), np.inf))
    return float(K[i])
