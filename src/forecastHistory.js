import { completedDailyBars } from './tradeMath.js';

const dateInZone = (time, timezone) => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(time));

// Only Forecast opts into same-day history. Require exchange-provided session
// times, a recent closing quote and a fetch after a 15-minute settlement margin.
// Missing metadata retains the conservative previous-session behavior.
export function completedForecastBars(data, now = new Date()) {
  const timezone = data?.timezone || 'Asia/Kolkata';
  const bars = completedDailyBars(data?.bars, timezone, now);
  const { start, end } = data?.regularSession || {};
  const fetched = Date.parse(data?.fetchedAt), current = now.getTime(), quote = data?.marketTime * 1000;
  if (![start, end, fetched, current, quote].every(Number.isFinite) || !(end > start) || end - start > 86400) return bars;
  const open = start * 1000, close = end * 1000;
  if (fetched < close + 15 * 60000 || current < close + 15 * 60000 || fetched > current + 60000 || quote < close - 5 * 60000 || quote > fetched) return bars;
  try {
    const today = dateInZone(current, timezone);
    if (dateInZone(open, timezone) !== today || dateInZone(close, timezone) !== today) return bars;
    const final = data.bars?.findLast(b => b.time === today);
    return final ? [...bars, final] : bars;
  } catch { return bars; }
}
