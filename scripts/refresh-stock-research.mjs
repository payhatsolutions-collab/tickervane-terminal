import { readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { recentSessions, equitySeries, NSE_HEADERS } from '../lib/nse.js';
import { csvLine, deals, futuresBuildup, latestFo, unzipFirst } from '../lib/fno.js';
import { parseStockCSV, publicStockSymbols, stockSources } from '../src/stockCatalog.js';
import { stockDirectory } from '../src/stocks.js';

const file = 'content/stock-research.json';
const reportRoot = 'https://nsearchives.nseindia.com';
const dayCodes = date => {
  const [year, month, day] = date.split('-');
  return { short: day + month + year.slice(2), long: day + month + year };
};

async function report(url) {
  const response = await fetch(url, { headers: NSE_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`NSE report returned ${response.status}`);
  return response;
}

function table(text, columns) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const names = csvLine(header);
  const indices = columns.map(name => names.indexOf(name));
  if (indices.includes(-1)) throw Error('NSE report columns have changed');
  return lines.map(csvLine).map(row => indices.map(i => row[i]));
}

async function valuations(date, symbols, kind) {
  const { short, long } = dayCodes(date);
  const pe = kind === 'pe';
  const url = pe ? `${reportRoot}/content/equities/peDetail/PE_${short}.csv`
    : `${reportRoot}/archives/equities/bhavcopy/pr/PR${short}.zip`;
  const response = await report(url);
  const rows = pe ? table(await response.text(), ['SYMBOL', 'SYMBOL P/E'])
    : table(unzipFirst(await response.arrayBuffer(), `mcap${long}.csv`), ['Symbol', 'Market Cap(Rs.)', 'Series']);
  const values = Object.fromEntries(rows.filter(([symbol, value, series]) =>
    symbols.has(symbol) && Number.isFinite(Number(value)) && Number(value) > 0 && (pe || equitySeries.has(series))
  ).map(([symbol, value]) => [symbol, Number(value)]));
  if (!Object.keys(values).length) throw Error('Empty NSE valuation report');
  return { date, url, values };
}

export async function refreshStockResearch() {
  const previous = await readFile(file, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  async function retain(key, get) {
    try {
      const result = await get();
      return previous[key]?.date > result.date ? previous[key] : result;
    } catch (error) {
      console.log(`Stock research ${key}: ${error.message}. Retaining available snapshot.`);
      return previous[key] ?? null;
    }
  }
  let listings = previous.listings || {};
  try {
    const directories = await Promise.all(stockSources.map(async source => {
      const rows = parseStockCSV(await (await report(source.url)).text(), { listingDetails: true });
      if (rows.length < source.minRows) throw Error('Incomplete exchange directory');
      return rows.map(({ symbol, name, isin, listed, series }) => [symbol, { name, isin, listed, series, board: source.id }]);
    }));
    listings = Object.fromEntries(directories.flat());
  } catch (error) {
    console.log(`Stock directory: ${error.message}. Retaining available listings.`);
  }
  const names = { ...Object.fromEntries(stockDirectory.map(s => [s.symbol, s.name])), ...previous.names,
    ...Object.fromEntries(Object.entries(listings).map(([symbol, listing]) => [symbol, listing.name])) };
  const symbols = new Set(Object.keys(names));
  const cashWork = retain('cash', async () => {
    const sessions = await recentSessions(10, true);
    if (sessions.length < 10 || sessions.some(s => s.rows.size < 1000)) throw Error('Incomplete cash-market history');
    const history = {};
    for (const session of sessions.toReversed()) {
      for (const [symbol, row] of session.rows) {
        if (!symbols.has(symbol)) continue;
        (history[symbol] ??= []).push([session.date, row.close, row.dp, row.dq, row.qty, row.prev]);
      }
    }
    return { date: sessions[0].date, history };
  });
  const [cash, pe, cap, futures, trades] = await Promise.all([
    cashWork, ...['pe', 'cap'].map(key => retain(key, async () => {
      const cash = await cashWork;
      if (!cash) throw Error('Missing session date');
      return valuations(cash.date, symbols, key);
    })),
    retain('futures', async () => {
      const { date, rows, sourceUrl } = futuresBuildup(await latestFo());
      if (!date || !rows.length) throw Error('Missing futures report');
      return { date, url: sourceUrl, rows: rows.filter(r => !r.index).map(({ symbol, oi, oiChg, oiPct }) => ({ symbol, oi, oiChg, oiPct })) };
    }),
    retain('trades', async () => {
      const { rows, partial } = await deals();
      if (!rows.length) throw Error('Undated deals report');
      const dates = [...new Set(rows.map(r => r.date))].sort();
      return { date: dates.at(-1), dates, partial, rows };
    }),
  ]);
  if (!cash) throw Error('No verified cash-market snapshot available');
  const snapshot = { names, listings, cash, pe, cap, futures, trades };
  const temp = file + '.' + process.pid + '.tmp';
  await writeFile(temp, JSON.stringify(snapshot));
  await rename(temp, file);
  const { screen, delivery } = JSON.parse(await readFile('content/stock-snapshot.json', 'utf8'));
  const publicSymbols = publicStockSymbols(names, screen.rows, delivery.rows);
  await writeFile('content/stock-symbols.json', JSON.stringify(publicSymbols));
  console.log(`Stock research covers ${symbols.size} directory symbols, cash session ${cash.date}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await refreshStockResearch();
