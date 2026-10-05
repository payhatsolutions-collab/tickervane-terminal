// Earnings-power DCF used by the Fair value panel. Two finite stages, as in the
// previous Alpha Nova release: a growth stage, then a slower terminal stage, each
// discounted at the same rate. No perpetuity term, so the result stays conservative.
// Pure functions — tested in tests/features.test.js.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Present value per share of `eps` growing at `growth`% for `years`, then `terminal`% for `terminalYears`. */
export function dcf({ eps, growth, years = 10, terminal = 4, terminalYears = 10, discount = 12 }) {
  const vals = [eps, growth, years, terminal, terminalYears, discount].map(Number);
  if (!vals.every(Number.isFinite) || !(vals[0] > 0) || vals[5] <= -100) return null;
  const [e0, g, n, tg, tn, r] = vals;
  let e = e0, growthValue = 0, terminalValue = 0;
  for (let y = 1; y <= n; y++) { e *= 1 + g / 100; growthValue += e / (1 + r / 100) ** y; }
  for (let y = 1; y <= tn; y++) { e *= 1 + tg / 100; terminalValue += e / (1 + r / 100) ** (n + y); }
  const fair = growthValue + terminalValue;
  return Number.isFinite(fair) && fair > 0 ? { fair, growthValue, terminalValue } : null;
}

/** Margin of safety: how far the price sits below (positive) or above (negative) fair value. */
export const marginOfSafety = (fair, price) => fair > 0 && price > 0 ? (fair - price) / fair * 100 : null;

/** Growth-stage rate the market price implies, holding the other inputs fixed (bisection). */
export function impliedGrowth(price, inputs) {
  if (!(price > 0) || !(inputs?.eps > 0)) return null;
  const value = g => dcf({ ...inputs, growth: g })?.fair ?? 0;
  let lo = -50, hi = 100;
  if (value(lo) > price || value(hi) < price) return null;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (value(mid) < price) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Sensible starting inputs from fundamentals; the user can change every one. */
export function defaultInputs(fund, currency) {
  const inr = currency === 'INR';
  const g = Number.isFinite(fund?.earningsGrowth) ? clamp(Math.round(fund.earningsGrowth * 100), 0, 20) : 10;
  return { eps: Number.isFinite(fund?.epsTrailing) ? +fund.epsTrailing.toFixed(2) : '', growth: g, years: 10, terminal: inr ? 5 : 3, terminalYears: 10, discount: inr ? 12 : 9 };
}
