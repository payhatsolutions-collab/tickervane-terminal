// Transparent positioning heuristic, not a calibrated price forecast.
export const LIVE_MAX_AGE_MS = 180000;
export function optionFreshness(asOf, now = Date.now()) {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp) || timestamp > now + 60000) return 'unavailable';
  const ist = new Date(now + 19800000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const regularHours = ist.getUTCDay() > 0 && ist.getUTCDay() < 6 && minutes >= 555 && minutes <= 930;
  if (now - timestamp <= LIVE_MAX_AGE_MS) return regularHours ? 'live' : 'snapshot';
  // After hours, retain the last session's read as a clearly dated snapshot.
  if (!regularHours && now - timestamp <= 4 * 86400000) return 'snapshot';
  return 'stale';
}

export function optionSignal(chain) {
  const unavailable = { label: 'Unavailable', score: null, reasons: ['Insufficient two-sided open-interest data.'], support: null, resistance: null };
  if (!(chain?.spot > 0) || !Array.isArray(chain.rows)) return unavailable;
  const near = chain.rows.filter(r => Math.abs(r.strike / chain.spot - 1) <= 0.03);
  if (near.some(r => (r.CE && !Number.isFinite(r.CE.oi)) || (r.PE && !Number.isFinite(r.PE.oi)))) return unavailable;
  if (near.filter(r => r.CE?.oi > 0 && r.PE?.oi > 0).length < 3) return unavailable;
  const total = (side, key) => near.reduce((n, r) => n + (r[side]?.[key] ?? 0), 0);
  const ce = total('CE', 'oi'), pe = total('PE', 'oi');
  if (!(ce > 0 && pe > 0)) return unavailable;
  const pcr = pe / ce;
  const callChange = total('CE', 'chg'), putChange = total('PE', 'chg');
  const changesComplete = near.every(r => (!r.CE || Number.isFinite(r.CE.chg)) && (!r.PE || Number.isFinite(r.PE.chg)));
  const activity = Math.abs(callChange) + Math.abs(putChange);
  const balance = changesComplete && activity >= (ce + pe) * 0.01 ? (putChange - callChange) / activity : 0;
  const painGap = chain.maxPain > 0 ? (chain.spot / chain.maxPain - 1) * 100 : 0;
  const votes = [pcr >= 1.15 ? 1 : pcr <= 0.85 ? -1 : 0, balance >= 0.15 ? 1 : balance <= -0.15 ? -1 : 0, painGap >= 0.2 ? 1 : painGap <= -0.2 ? -1 : 0];
  const score = votes.reduce((a, b) => a + b, 0);
  const strongest = (side, rows) => rows.reduce((best, r) => (r[side]?.oi || 0) > (best?.[side]?.oi || 0) ? r : best, null)?.strike ?? null;
  return {
    label: score >= 2 ? 'Bullish' : score <= -2 ? 'Bearish' : 'Range', score,
    support: strongest('PE', near.filter(r => r.strike <= chain.spot)),
    resistance: strongest('CE', near.filter(r => r.strike >= chain.spot)),
    reasons: [
      `Near-spot put/call OI ${pcr.toFixed(2)}: ${votes[0] > 0 ? 'put-heavy positioning' : votes[0] < 0 ? 'call-heavy positioning' : 'balanced positioning'}.`,
      !changesComplete ? 'OI changes incomplete; change vote withheld.' : `Net OI change: ${votes[1] > 0 ? 'puts stronger than calls' : votes[1] < 0 ? 'calls stronger than puts' : 'no material imbalance'}.`,
      `Spot ${Math.abs(painGap).toFixed(2)}% ${painGap >= 0 ? 'above' : 'below'} max pain${votes[2] === 0 ? '; within the neutral band' : ''}.`,
    ],
  };
}
