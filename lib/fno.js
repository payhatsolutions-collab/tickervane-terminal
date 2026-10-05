// NSE derivatives and institutional-flow data from public end-of-day archives.
// - F&O bhavcopy (one zip per session): EOD option chains, max pain, PCR and
//   futures OI build-up for every F&O underlying.
// - Participant-wise OI: FII / DII / Pro / Client positioning in derivatives.
// - Bulk and block deal files for the latest session.
// - FII/DII cash-market flows come from NSE's JSON API, which can refuse
//   datacenter IPs; that part is best-effort and reported as unavailable, never guessed.
// Everything is cached per instance; the API layer adds CDN caching for Hobby quotas.
import { inflateRawSync } from 'node:zlib';
import { NSE_HEADERS, istDate, isoDay, ddmmyyyy, num } from './nse.js';

const pad = n => String(n).padStart(2, '0');
const yyyymmdd = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
export const FO_URL = d => `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${yyyymmdd(d)}_F_0000.csv.zip`;
const POI_URL = d => `https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${ddmmyyyy(d)}.csv`;
const DEAL_URL = kind => `https://nsearchives.nseindia.com/content/equities/${kind}.csv`;
const r2 = v => Number.isFinite(v) && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v;
const sum = xs => xs.reduce((a, b) => a + (b || 0), 0);

/** Weekdays from today (IST) backwards. NSE holidays are discovered by 404s. */
function* weekdaysBack(max = 10) {
  const cursor = istDate();
  cursor.setUTCHours(12, 0, 0, 0);
  for (let i = 0; i < max; i++) {
    const d = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) yield d;
  }
}

/** Extract the first file of a zip archive (stored or deflated) without dependencies. */
export function unzipFirst(input) {
  const b = Buffer.from(input);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip archive');
  const cd = b.readUInt32LE(eocd + 16);
  if (b.readUInt32LE(cd) !== 0x02014b50) throw new Error('Corrupt zip directory');
  const method = b.readUInt16LE(cd + 10), size = b.readUInt32LE(cd + 20), local = b.readUInt32LE(cd + 42);
  if (b.readUInt32LE(local) !== 0x04034b50) throw new Error('Corrupt zip entry');
  const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
  const data = b.subarray(start, start + size);
  if (method === 0) return data.toString('utf8');
  if (method === 8) return inflateRawSync(data).toString('utf8');
  throw new Error('Unsupported zip compression');
}

// ---------- F&O bhavcopy ----------
/** Parse NSE's UDiFF F&O bhavcopy. OI and volume are converted from shares to contracts. */
export function parseFo(text) {
  const lines = String(text || '').split(/\r?\n/);
  const head = (lines.shift() || '').split(',').map(h => h.trim());
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const need = ['TradDt', 'FinInstrmTp', 'TckrSymb', 'XpryDt', 'StrkPric', 'OptnTp', 'ClsPric', 'PrvsClsgPric', 'UndrlygPric', 'OpnIntrst', 'ChngInOpnIntrst', 'TtlTradgVol', 'NewBrdLotQty'];
  if (!need.every(k => k in col)) return null;
  const options = new Map(), futures = new Map(), spot = new Map(), lots = new Map();
  let date = null;
  for (const line of lines) {
    if (!line) continue;
    const c = line.split(',');
    const tp = c[col.FinInstrmTp], sym = c[col.TckrSymb]?.trim(), exp = c[col.XpryDt];
    if (!sym || !/^\d{4}-\d{2}-\d{2}$/.test(exp || '')) continue;
    date ||= c[col.TradDt];
    const lot = num(c[col.NewBrdLotQty]) || 1;
    const close = num(c[col.ClsPric]), prev = num(c[col.PrvsClsgPric]), und = num(c[col.UndrlygPric]);
    const oi = (num(c[col.OpnIntrst]) ?? 0) / lot, chg = (num(c[col.ChngInOpnIntrst]) ?? 0) / lot, vol = (num(c[col.TtlTradgVol]) ?? 0) / lot;
    if (und > 0 && !spot.has(sym)) spot.set(sym, und);
    if (!lots.has(sym)) lots.set(sym, lot);
    if (tp === 'IDO' || tp === 'STO') {
      const strike = num(c[col.StrkPric]), type = c[col.OptnTp];
      if (!(strike > 0) || (type !== 'CE' && type !== 'PE')) continue;
      let byExp = options.get(sym); if (!byExp) options.set(sym, byExp = new Map());
      let chain = byExp.get(exp); if (!chain) byExp.set(exp, chain = new Map());
      let row = chain.get(strike); if (!row) chain.set(strike, row = { strike });
      row[type] = { close, prev, oi, chg, vol };
    } else if (tp === 'IDF' || tp === 'STF') {
      let list = futures.get(sym); if (!list) futures.set(sym, list = []);
      list.push({ expiry: exp, close, prev, oi, chg, vol, index: tp === 'IDF' });
    }
  }
  return { date, options, futures, spot, lots };
}

let fo = { at: 0, data: null, pending: null };
/** Latest published F&O bhavcopy. NSE posts it after the close (~18:00–20:00 IST). */
export function latestFo() {
  if (fo.data && Date.now() - fo.at < 1800e3) return Promise.resolve(fo.data);
  if (fo.pending) return fo.pending;
  fo.pending = (async () => {
    for (const d of weekdaysBack(12)) {
      if (fo.data && fo.data.date >= isoDay(d)) return fo.data;
      const r = await fetch(FO_URL(d), { headers: NSE_HEADERS, signal: AbortSignal.timeout(15000) });
      if (r.status === 404 || r.status === 403) continue;
      if (!r.ok) throw new Error(`NSE F&O archive returned ${r.status}`);
      const parsed = parseFo(unzipFirst(Buffer.from(await r.arrayBuffer())));
      if (parsed?.options.size) return parsed;
    }
    throw new Error('NSE F&O bhavcopy is temporarily unavailable.');
  })().then(
    data => { fo = { at: Date.now(), data, pending: null }; return data; },
    e => { fo.pending = null; if (fo.data) return fo.data; throw e; }
  );
  return fo.pending;
}

/** Strike where option writers lose least at expiry (sum of intrinsic value × OI). */
export function maxPain(rows) {
  let best = null, bestPain = Infinity;
  for (const { strike: k } of rows) {
    let pain = 0;
    for (const r of rows) pain += (r.CE?.oi || 0) * Math.max(0, k - r.strike) + (r.PE?.oi || 0) * Math.max(0, r.strike - k);
    if (pain < bestPain) { bestPain = pain; best = k; }
  }
  return best;
}

const INDEX_ORDER = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50'];
/** Underlyings with listed options: indices first, then stocks alphabetically. */
export function underlyings(data) {
  const all = [...data.options.keys()];
  const idx = INDEX_ORDER.filter(s => data.options.has(s));
  return [...idx, ...all.filter(s => !idx.includes(s) && !data.futures.get(s)?.[0]?.index).sort(), ...all.filter(s => !idx.includes(s) && data.futures.get(s)?.[0]?.index).sort()];
}

/** End-of-day option chain for one underlying and expiry, with PCR, max pain and OI walls. */
export function optionChain(data, symbol, expiry) {
  const byExp = data.options.get(symbol);
  if (!byExp) return null;
  const expiries = [...byExp.keys()].filter(e => e >= data.date).sort();
  if (!expiries.length) return null;
  const exp = expiries.includes(expiry) ? expiry : expiries[0];
  const rows = [...byExp.get(exp).values()].filter(r => (r.CE?.oi || 0) + (r.PE?.oi || 0) + (r.CE?.vol || 0) + (r.PE?.vol || 0) > 0).sort((a, b) => a.strike - b.strike);
  const spot = data.spot.get(symbol) ?? null;
  const atm = spot && rows.length ? rows.reduce((b, r) => Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b).strike : null;
  const ceOI = sum(rows.map(r => r.CE?.oi)), peOI = sum(rows.map(r => r.PE?.oi));
  const ceChg = sum(rows.map(r => r.CE?.chg)), peChg = sum(rows.map(r => r.PE?.chg));
  const top = side => rows.reduce((b, r) => (r[side]?.oi || 0) > (b?.[side]?.oi || 0) ? r : b, null)?.strike ?? null;
  const topChg = side => rows.reduce((b, r) => (r[side]?.chg || 0) > (b?.[side]?.chg || 0) ? r : b, null)?.strike ?? null;
  const atmRow = rows.find(r => r.strike === atm);
  const straddle = atmRow?.CE?.close > 0 && atmRow?.PE?.close > 0 ? atmRow.CE.close + atmRow.PE.close : null;
  const days = Math.max(0, Math.round((Date.parse(exp) - Date.parse(data.date)) / 86400e3));
  const tidy = s => s ? { close: r2(s.close), chgPct: s.prev > 0 && s.close >= 0 ? r2((s.close / s.prev - 1) * 100) : null, oi: Math.round(s.oi), chg: Math.round(s.chg), vol: Math.round(s.vol) } : null;
  return {
    symbol, date: data.date, expiry: exp, expiries, daysToExpiry: days, spot, atm, lot: data.lots.get(symbol) ?? null,
    pcr: ceOI > 0 ? r2(peOI / ceOI) : null, pcrChange: ceChg !== 0 ? r2(peChg / ceChg) : null,
    maxPain: maxPain(rows), callWall: top('CE'), putWall: top('PE'), callAdd: topChg('CE'), putAdd: topChg('PE'),
    totals: { ceOI: Math.round(ceOI), peOI: Math.round(peOI), ceChg: Math.round(ceChg), peChg: Math.round(peChg) },
    straddle: r2(straddle), movePct: straddle && spot ? r2(straddle / spot * 100) : null,
    rows: rows.map(r => ({ strike: r.strike, CE: tidy(r.CE), PE: tidy(r.PE) })),
    source: 'NSE F&O bhavcopy (end of day)', sourceUrl: FO_URL(new Date(data.date + 'T12:00:00Z')),
  };
}

/** Price change × OI change for every futures underlying (OI summed across expiries, so rollover nets out). */
export function buildup(change, oiPct) {
  if (!Number.isFinite(change) || !Number.isFinite(oiPct)) return 'Neutral';
  if (oiPct >= 0) return change >= 0 ? 'Long build-up' : 'Short build-up';
  return change >= 0 ? 'Short covering' : 'Long unwinding';
}
export function futuresBuildup(data) {
  const rows = [];
  for (const [symbol, list] of data.futures) {
    const live = list.filter(f => f.expiry >= data.date).sort((a, b) => a.expiry < b.expiry ? -1 : 1);
    const near = live[0];
    if (!near || !(near.close > 0)) continue;
    const oi = sum(live.map(f => f.oi)), chg = sum(live.map(f => f.chg)), prevOI = oi - chg;
    const change = near.prev > 0 ? (near.close / near.prev - 1) * 100 : null;
    const oiPct = prevOI > 0 ? chg / prevOI * 100 : null;
    const spot = data.spot.get(symbol) ?? null;
    rows.push({
      symbol, index: near.index, expiry: near.expiry, close: r2(near.close), change: r2(change), spot: r2(spot),
      basisPct: spot > 0 ? r2((near.close / spot - 1) * 100) : null, oi: Math.round(oi), oiChg: Math.round(chg), oiPct: r2(oiPct),
      vol: Math.round(sum(live.map(f => f.vol))), oiValueCr: r2(oi * (data.lots.get(symbol) || 1) * near.close / 1e7), signal: buildup(change, oiPct),
    });
  }
  rows.sort((a, b) => Math.abs(b.oiPct ?? 0) - Math.abs(a.oiPct ?? 0));
  const counts = rows.reduce((t, r) => (t[r.signal] = (t[r.signal] || 0) + 1, t), {});
  return { date: data.date, rows, counts, source: 'NSE F&O bhavcopy (end of day)', sourceUrl: FO_URL(new Date(data.date + 'T12:00:00Z')), fetchedAt: new Date().toISOString() };
}

// ---------- Participant-wise open interest ----------
const POI_KEYS = ['futIdxLong', 'futIdxShort', 'futStkLong', 'futStkShort', 'optIdxCallLong', 'optIdxPutLong', 'optIdxCallShort', 'optIdxPutShort', 'optStkCallLong', 'optStkPutLong', 'optStkCallShort', 'optStkPutShort', 'totalLong', 'totalShort'];
export function parseParticipants(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const c = line.split(',').map(x => x.replace(/"/g, '').trim());
    if (!['Client', 'DII', 'FII', 'Pro'].includes(c[0])) continue;
    const vals = c.slice(1, 15).map(num);
    if (vals.length < 14 || !vals.every(Number.isFinite)) continue;
    out[c[0]] = Object.fromEntries(POI_KEYS.map((k, i) => [k, vals[i]]));
  }
  return Object.keys(out).length === 4 ? out : null;
}
const poiCache = new Map();
async function fetchParticipants(d) {
  const key = isoDay(d), hit = poiCache.get(key), today = key === isoDay(istDate());
  if (hit && (hit.data || Date.now() - hit.at < (today ? 1800e3 : 7 * 86400e3))) return hit.data;
  const r = await fetch(POI_URL(d), { headers: NSE_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!r.ok && r.status !== 404 && r.status !== 403) throw new Error(`NSE participant OI returned ${r.status}`);
  const data = r.ok ? parseParticipants(await r.text()) : null;
  if (poiCache.size > 30) poiCache.delete(poiCache.keys().next().value);
  poiCache.set(key, { at: Date.now(), data });
  return data;
}
/** Net positions per participant for the latest two sessions. */
export function participantView(latest, previous) {
  const view = (p, q) => {
    const net = x => x ? { futIdx: x.futIdxLong - x.futIdxShort, futStk: x.futStkLong - x.futStkShort, idxCall: x.optIdxCallLong - x.optIdxCallShort, idxPut: x.optIdxPutLong - x.optIdxPutShort } : null;
    const a = net(p), b = net(q);
    return { ...a, futIdxLongPct: r2(p.futIdxLong / (p.futIdxLong + p.futIdxShort) * 100), change: b ? Object.fromEntries(Object.keys(a).map(k => [k, a[k] - b[k]])) : null, raw: p };
  };
  return Object.fromEntries(['FII', 'DII', 'Pro', 'Client'].map(k => [k, view(latest[k], previous?.[k])]));
}
export async function participants() {
  const found = [];
  for (const d of weekdaysBack(14)) {
    const data = await fetchParticipants(d).catch(() => null);
    if (data) found.push({ date: isoDay(d), data });
    if (found.length === 2) break;
  }
  if (!found.length) throw new Error('NSE participant OI is temporarily unavailable.');
  return { date: found[0].date, previousDate: found[1]?.date ?? null, rows: participantView(found[0].data, found[1]?.data), source: 'NSE participant-wise OI', sourceUrl: POI_URL(new Date(found[0].date + 'T12:00:00Z')) };
}

// ---------- FII / DII cash flows (best-effort) ----------
export function parseFiiDii(list) {
  if (!Array.isArray(list)) return null;
  const pick = re => list.find(x => re.test(String(x?.category || '')));
  const row = x => x ? { buy: num(x.buyValue), sell: num(x.sellValue), net: num(x.netValue) } : null;
  const fii = row(pick(/FII|FPI/i)), dii = row(pick(/DII/i));
  if (!fii || !dii || ![fii.net, dii.net].every(Number.isFinite)) return null;
  const t = Date.parse((pick(/FII|FPI/i).date || '') + ' UTC');
  return { date: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null, fii, dii };
}
let flowCache = { at: 0, data: null };
export async function fiiDii() {
  if (flowCache.data && Date.now() - flowCache.at < 1800e3) return flowCache.data;
  const headers = { 'User-Agent': NSE_HEADERS['User-Agent'], Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nseindia.com/reports/fii-dii' };
  const api = 'https://www.nseindia.com/api/fiidiiTradeReact';
  try {
    let r = await fetch(api, { headers, signal: AbortSignal.timeout(6000) });
    if (!r.ok) {
      // NSE often wants its session cookies first.
      const home = await fetch('https://www.nseindia.com/reports/fii-dii', { headers: { ...headers, Accept: 'text/html' }, signal: AbortSignal.timeout(6000) });
      const cookie = (home.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
      r = await fetch(api, { headers: { ...headers, Cookie: cookie }, signal: AbortSignal.timeout(6000) });
    }
    if (!r.ok) throw new Error(`NSE returned ${r.status}`);
    const data = parseFiiDii(await r.json());
    if (!data) throw new Error('Unexpected FII/DII response');
    flowCache = { at: Date.now(), data };
    return data;
  } catch (e) {
    if (flowCache.data) return flowCache.data;
    throw e;
  }
}

// ---------- Bulk & block deals ----------
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const nseDate = s => { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s || '').trim()); return m && MONTHS[m[2].toUpperCase()] ? `${m[3]}-${pad(MONTHS[m[2].toUpperCase()])}-${pad(+m[1])}` : null; };
/** Split one CSV line, honouring quoted fields (client names can contain commas). */
export function csvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
export function parseDeals(text, kind) {
  return String(text || '').split(/\r?\n/).slice(1).map(csvLine).flatMap(c => {
    const date = nseDate(c[0]), qty = num(c[5]), price = num(c[6]), side = String(c[4] || '').toUpperCase();
    if (!date || !c[1] || !(qty > 0) || !(price > 0) || !['BUY', 'SELL'].includes(side)) return [];
    return [{ kind, date, symbol: c[1].toUpperCase(), name: c[2], client: c[3], side, qty, price, valueCr: r2(qty * price / 1e7) }];
  });
}
let dealCache = { at: 0, data: null };
export async function deals() {
  if (dealCache.data && Date.now() - dealCache.at < 1800e3) return dealCache.data;
  const get = async kind => { const r = await fetch(DEAL_URL(kind), { headers: NSE_HEADERS, signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(`NSE ${kind} deals returned ${r.status}`); return parseDeals(await r.text(), kind === 'bulk' ? 'Bulk' : 'Block'); };
  const [bulk, block] = await Promise.allSettled([get('bulk'), get('block')]);
  if (bulk.status === 'rejected' && block.status === 'rejected') { if (dealCache.data) return dealCache.data; throw new Error('NSE deal files are temporarily unavailable.'); }
  const rows = [...(block.value || []), ...(bulk.value || [])].sort((a, b) => b.valueCr - a.valueCr);
  const data = { date: rows[0]?.date ?? null, rows, partial: bulk.status === 'rejected' || block.status === 'rejected', source: 'NSE bulk & block deal files', fetchedAt: new Date().toISOString() };
  dealCache = { at: Date.now(), data };
  return data;
}
