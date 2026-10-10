// NSE's option-chain page uses contract-info followed by option-chain-v3.
// This runs server-side: browser CORS and NSE cookies never reach the client.
import { NSE_HEADERS } from './nse.js';
import { maxPain } from './fno.js';
import { optionFreshness, optionSignal } from '../src/optionSignal.js';
export const OPTION_SOURCE = 'https://www.nseindia.com/option-chain';
const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'NIFTYFPI'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function optionDate(value) {
  const m = /^(\d{2})-([A-Za-z]{3}|\d{2})-(\d{4})$/.exec(value || '');
  if (!m) return null;
  const month = /^\d/.test(m[2]) ? Number(m[2]) : months.findIndex(x => x.toLowerCase() === m[2].toLowerCase()) + 1;
  const iso = `${m[3]}-${String(month).padStart(2, '0')}-${m[1]}`;
  const time = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null;
}
function timestampISO(date, time) {
  if (!date || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time || '')) return null;
  return new Date(`${date}T${time}+05:30`).toISOString();
}
function withSignalFreshness(chain, now) {
  const freshness = optionFreshness(chain.asOf, now);
  return { ...chain, freshness, signal: ['live', 'snapshot'].includes(freshness) ? optionSignal(chain) : {
    label: 'Unavailable', score: null, support: null, resistance: null, reasons: ['NSE timestamp is stale or invalid; signal withheld.'],
  } };
}
const numeric = x => x == null || x === '' || typeof x === 'boolean' ? null : Number.isFinite(Number(x)) ? Number(x) : null;
const positive = x => numeric(x) > 0 ? numeric(x) : null;
const nonnegative = x => numeric(x) >= 0 ? numeric(x) : null;
const sum = (rows, side, key) => rows.reduce((n, r) => n + (r[side]?.[key] || 0), 0);
const top = (rows, side, key) => rows.reduce((b, r) => (r[side]?.[key] || 0) > (b?.[side]?.[key] || 0) ? r : b, null)?.strike ?? null;

export function parseLiveOptions(payload, symbol, expiry, expiries = [], now = Date.now()) {
  const records = payload?.records;
  const [day, time] = String(records?.timestamp || '').split(' ');
  const date = optionDate(day);
  const asOf = timestampISO(date, time);
  const spot = positive(records?.underlyingValue);
  if (!date || !asOf || !spot || !Array.isArray(records?.data)) throw Error('NSE returned an incomplete option chain. Please retry.');
  const leg = s => !s || s.underlying !== symbol ? null : ({
    close: positive(s.lastPrice), chgPct: numeric(s.pChange ?? s.PChange),
    oi: nonnegative(s.openInterest), chg: numeric(s.changeinOpenInterest), vol: nonnegative(s.totalTradedVolume),
    iv: positive(s.impliedVolatility), bid: positive(s.buyPrice1), ask: positive(s.sellPrice1),
  });
  const rows = records.data.flatMap(r => {
    if (optionDate(r.expiryDates || r.expiryDate || r.CE?.expiryDate || r.PE?.expiryDate) !== expiry || !positive(r.strikePrice)) return [];
    const validLeg = s => s && (!s.expiryDate || optionDate(s.expiryDate) === expiry) ? leg(s) : null;
    const CE = validLeg(r.CE), PE = validLeg(r.PE);
    return CE || PE ? [{ strike: Number(r.strikePrice), CE, PE }] : [];
  }).sort((a, b) => a.strike - b.strike);
  if (!rows.length) throw Error('NSE returned no contracts for this expiry. Select another expiry.');
  const atm = rows.reduce((b, r) => Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b).strike;
  const atmRow = rows.find(r => r.strike === atm);
  const ceOI = sum(rows, 'CE', 'oi'), peOI = sum(rows, 'PE', 'oi');
  const ceChg = sum(rows, 'CE', 'chg'), peChg = sum(rows, 'PE', 'chg');
  const straddle = atmRow.CE?.close > 0 && atmRow.PE?.close > 0 ? atmRow.CE.close + atmRow.PE.close : null;
  const chain = {
    symbol, expiry, expiries, rows, spot, atm, date, asOf, exchangeTimestamp: records.timestamp,
    daysToExpiry: Math.max(0, Math.round((Date.parse(expiry) - Date.parse(date)) / 86400000)),
    pcr: ceOI > 0 ? peOI / ceOI : null, pcrChange: ceChg > 0 && peChg >= 0 ? peChg / ceChg : null,
    totals: { ceOI, peOI, ceChg, peChg }, maxPain: ceOI + peOI > 0 ? maxPain(rows) : null,
    callWall: top(rows, 'CE', 'oi'), putWall: top(rows, 'PE', 'oi'), callAdd: top(rows, 'CE', 'chg'), putAdd: top(rows, 'PE', 'chg'),
    straddle, movePct: straddle ? straddle / spot * 100 : null,
    source: 'NSE option chain', sourceUrl: OPTION_SOURCE, fetchedAt: new Date(now).toISOString(),
  };
  return withSignalFreshness(chain, now);
}

export function createNseOptionsClient({ fetcher = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const cache = new Map(), pending = new Map();
  let cookie = '', session = null;
  const headers = { ...NSE_HEADERS, Accept: 'application/json', Referer: OPTION_SOURCE };
  async function request(path) {
    const get = () => fetcher(`https://www.nseindia.com/api/${path}`, { headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(6000) });
    let r = await get();
    if ([401, 403].includes(r.status)) {
      session ||= (async () => {
        const home = await fetcher(OPTION_SOURCE, { headers: { ...headers, Accept: 'text/html' }, signal: AbortSignal.timeout(6000) });
        if (!home.ok) throw Error('NSE is refusing live data from this server. Please retry later.');
        cookie = (home.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
        await home.arrayBuffer();
      })().finally(() => { session = null; });
      await session;
      r = await get();
    }
    if (!r.ok) throw Error(`NSE live data unavailable (${r.status}). Please retry shortly.`);
    try { return await r.json(); } catch { throw Error('NSE returned an invalid live response. Please retry.'); }
  }
  function cached(key, ttl, build) {
    const old = cache.get(key);
    if (old && now() - old.at < ttl) return Promise.resolve(old.data);
    if (pending.has(key)) return pending.get(key);
    const p = build().then(data => {
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, { at: now(), data });
      return data;
    }).finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  }
  const getOptions = async (symbol, expiry = '') => {
    if (!/^[A-Z0-9&-]{1,20}$/.test(symbol) || (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry))) throw Error('Invalid symbol or expiry');
    const contracts = await cached(`contracts:${symbol}`, 300000, () => request(`option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`));
    const pairs = (contracts?.expiryDates || []).map(raw => [optionDate(raw), raw]).filter(([iso]) => iso).sort(([a], [b]) => a.localeCompare(b));
    const selected = expiry ? pairs.find(([iso]) => iso === expiry) : pairs[0];
    if (!selected) throw Error('This expiry is not listed by NSE. Choose a current expiry.');
    const chain = await cached(`chain:${symbol}:${selected[0]}`, 15000, async () => {
      const type = INDICES.includes(symbol) ? 'Indices' : 'Equity';
      const payload = await request(`option-chain-v3?type=${type}&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(selected[1])}`);
      return parseLiveOptions(payload, symbol, selected[0], pairs.map(([iso]) => iso), now());
    });
    const symbols = await cached('symbols', 3600000, () => request('master-quote')).catch(() => []);
    return { ...withSignalFreshness(chain, now()), symbols: [...new Set([...INDICES, symbol, ...(Array.isArray(symbols) ? symbols.filter(s => typeof s === 'string' && /^[A-Z0-9&-]{1,20}$/.test(s)).sort() : [])])] };
  };
  getOptions.futures = group => {
    if (!FUTURES_GROUPS.includes(group)) throw Error('Invalid futures group');
    return cached(`futures:${group}`, 15000, async () => parseLiveFutures(await request(`liveEquity-derivatives?index=${group}`), now()));
  };
  return getOptions;
}
export const liveOptions = createNseOptionsClient();
export const liveFutures = (...args) => liveOptions.futures(...args);


export const FUTURES_GROUPS = ['nse50_fut', 'nifty_bank_fut', 'finnifty_fut', 'niftymidcap_fut', 'niftynxt50_fut', 'niftyfpi_fut', 'stock_fut'];
export function parseLiveFutures(payload, now = Date.now()) {
  const [day, time] = String(payload?.timestamp || '').split(' ');
  const date = optionDate(day);
  if (!timestampISO(date, time) || !Array.isArray(payload?.data)) throw Error('NSE futures data is incomplete.');
  const asOf = new Date(`${date}T${time}+05:30`).toISOString();
  const rows = payload.data.flatMap(r => {
    const expiry = optionDate(r.expiryDate), price = positive(r.lastPrice), spot = positive(r.underlyingValue);
    if (!expiry || !price || !['FUTIDX', 'FUTSTK'].includes(r.instrumentType)) return [];
    return [{ symbol: r.underlying, expiry, price, change: numeric(r.pChange), oi: nonnegative(r.openInterest), spot,
      basis: spot ? (price / spot - 1) * 100 : null, high: positive(r.highPrice), low: positive(r.lowPrice) }];
  }).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.expiry.localeCompare(b.expiry));
  if (!rows.length) throw Error('NSE returned no futures contracts.');
  return { rows, asOf, exchangeTimestamp: payload.timestamp, sourceUrl: 'https://www.nseindia.com/market-data/equity-derivatives-watch', fetchedAt: new Date(now).toISOString() };
}
