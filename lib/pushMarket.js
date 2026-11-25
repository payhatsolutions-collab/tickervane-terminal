// Market-hours push rules. Pure functions, so the cron in api/push.js and the
// tests share them. The cron runs roughly hourly from 09:30 to 15:30 IST (Vercel
// Hobby triggers each daily job somewhere inside its hour).
import { istDate } from './nse.js';

export const MARKET_INDEXES = ['^NSEI', '^NSEBANK', '^INDIAVIX'];
export const NIFTY_STEPS = [1, 2, 3];
export const MOVE_STEPS = [3, 6, 10];
export const MAX_MARKET_SYMBOLS = 150;

const day = ms => istDate(ms).toISOString().slice(0, 10);
const minutesIST = ms => { const t = istDate(ms); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const indian = symbol => /\.(NS|BO)$/.test(symbol);
const short = symbol => String(symbol).replace(/\.(NS|BO)$/, '');
const pct = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const money = v => v.toLocaleString('en-IN', { maximumFractionDigits: v >= 1000 ? 0 : 2 });

/** 'market' from 09:15 to 15:40 IST on weekdays. Exchange holidays are caught by liveToday(). */
export function marketPhase(now = Date.now()) {
  const weekday = istDate(now).getUTCDay();
  const minutes = minutesIST(now);
  return weekday >= 1 && weekday <= 5 && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 40 ? 'market' : 'closed';
}

/** A quote counts only when the exchange stamped it today (IST); holidays and stale feeds fail. */
export function liveToday(quote, now = Date.now()) {
  return Number.isFinite(quote?.price) && Number.isFinite(quote?.change) && Number.isFinite(quote?.marketTime) &&
    day(quote.marketTime * 1000) === day(now);
}

const stepFor = (change, steps) => steps.reduce((reached, step) => Math.abs(change) >= step ? step : reached, 0);

/** Symbols one market-hours run needs: the indices plus every subscriber's Indian watchlist. */
export function marketSymbols(subs) {
  const wanted = subs.filter(sub => sub.prefs?.market !== false || sub.prefs?.movers !== false);
  if (!wanted.length) return [];
  const watch = wanted.flatMap(sub => (sub.watch || []).filter(indian));
  return [...new Set([...MARKET_INDEXES, ...watch])].slice(0, MAX_MARKET_SYMBOLS);
}

/** Today's state for one device; a new IST date starts clean. */
export function marketState(state, now = Date.now()) {
  const date = day(now);
  return state?.date === date
    ? { date, opened: !!state.opened, nifty: { ...state.nifty }, moves: { ...state.moves } }
    : { date, opened: false, nifty: {}, moves: {} };
}

/**
 * Notifications for one device in one market-hours run, and its next state.
 * - First run of the day: a market update (Nifty, Bank Nifty, VIX, watchlist breadth).
 * - Later runs: Nifty crossing ±1/2/3% for the first time today.
 * - Watchlist stocks crossing ±3/6/10% for the first time today, grouped in one push.
 * Nothing is sent when the Nifty quote is not from today (holiday or outage).
 */
export function marketNotifications({ prefs = {}, watch = [], state, quotes = {}, now = Date.now() }) {
  const nifty = quotes['^NSEI'];
  if (!liveToday(nifty, now)) return { notes: [], state };
  const next = marketState(state, now);
  const notes = [];
  const mine = watch.filter(indian);

  if (prefs.market !== false) {
    const direction = nifty.change >= 0 ? 'up' : 'down';
    const step = stepFor(nifty.change, NIFTY_STEPS);
    const context = () => {
      const parts = [];
      const bank = quotes['^NSEBANK'], vix = quotes['^INDIAVIX'];
      if (liveToday(bank, now)) parts.push(`Bank Nifty ${pct(bank.change)}`);
      if (liveToday(vix, now)) parts.push(`VIX ${vix.price.toFixed(1)} (${pct(vix.change)})`);
      const live = mine.map(symbol => quotes[symbol]).filter(quote => liveToday(quote, now));
      if (live.length) parts.push(`Your watchlist: ${live.filter(q => q.change > 0).length} up, ${live.filter(q => q.change < 0).length} down`);
      return parts.join(' · ') || 'Quotes may be delayed.';
    };
    if (!next.opened) {
      const label = minutesIST(now) < 11 * 60 ? 'Market open' : 'Market update';
      notes.push({ title: `${label} · Nifty 50 ${money(nifty.price)} (${pct(nifty.change)})`, body: context(),
        tag: 'market-update', url: '/markets', log: { kind: 'market' } });
      next.opened = true;
      if (step) next.nifty[direction] = step; // already in this update
    } else if (step > (next.nifty[direction] || 0)) {
      notes.push({ title: `Nifty 50 ${direction} ${Math.abs(nifty.change).toFixed(1)}% · ${money(nifty.price)}`, body: context(),
        tag: 'nifty-move', url: '/markets', log: { kind: 'market' } });
      next.nifty[direction] = step;
    }
  }

  if (prefs.movers !== false) {
    const moved = [];
    for (const symbol of mine) {
      const quote = quotes[symbol];
      if (!liveToday(quote, now)) continue;
      const step = stepFor(quote.change, MOVE_STEPS);
      const key = `${symbol}:${quote.change >= 0 ? 'up' : 'down'}`;
      if (step > (next.moves[key] || 0)) { moved.push({ symbol, ...quote, step }); next.moves[key] = step; }
    }
    if (moved.length) {
      moved.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      const [lead] = moved;
      notes.push(moved.length === 1
        ? { title: `${short(lead.symbol)} ${pct(lead.change)} · ₹${money(lead.price)}`, body: `Moved more than ${lead.step}% today · on your watchlist`,
          tag: 'watchlist-moves', url: `/charts?symbol=${encodeURIComponent(lead.symbol)}`, log: { kind: 'movers', symbol: lead.symbol } }
        : { title: `${moved.length} watchlist stocks are moving`, body: moved.slice(0, 5).map(m => `${short(m.symbol)} ${pct(m.change)}`).join(' · ') + (moved.length > 5 ? ` · +${moved.length - 5} more` : ''),
          tag: 'watchlist-moves', url: '/watchlist', log: { kind: 'movers' } });
    }
  }
  return { notes, state: next };
}
