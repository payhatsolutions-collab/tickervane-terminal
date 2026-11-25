import { trendDriftPerDay } from './forecastModel.js';

// "What if the recent trend continued?" The slope of the last 30 sessions of log prices, carried
// forward over the forecast horizon. This is a scenario shown beside the forecast and never part of
// it: in the October 2026 assessment, forecasts that carried this trend were less accurate than an
// unchanged price (docs/FORECAST-ACCURACY-2026-10-27.md). The slope is capped at 1% a session.
export const TREND_SESSIONS = 30;

export function trendScenario(bars, horizon = 10) {
  if (!Array.isArray(bars) || bars.length < TREND_SESSIONS + 1) return null;
  const closes = bars.slice(-(TREND_SESSIONS + 1)).map(bar => bar?.close);
  if (closes.some(close => !Number.isFinite(close) || close <= 0)) return null;
  const drift = trendDriftPerDay(closes.slice(1).map((close, i) => Math.log(close / closes[i])));
  const last = closes.at(-1), close = last * Math.exp(drift * horizon);
  return { close, change: (close / last - 1) * 100, sessions: TREND_SESSIONS, capped: Math.abs(drift) >= 0.01 };
}
