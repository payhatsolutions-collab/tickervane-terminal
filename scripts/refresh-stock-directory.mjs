import { readFile, writeFile } from 'node:fs/promises';
import { stockDirectory } from '../src/stocks.js';
import { stockSources, parseStockCSV, mergeStockLists } from '../src/stockCatalog.js';
import { NSE_HEADERS } from '../lib/nse.js';
import { stockDirectorySource } from './stock-directory-source.mjs';

// Optional local CSV paths make a downloaded exchange snapshot reproducible.
const files = process.argv.slice(2);
if (files.length !== 0 && files.length !== stockSources.length) {
  throw new Error('Usage: npm run stocks:refresh -- [mainboard.csv sme.csv]');
}
const lists = await Promise.all(stockSources.map(async (source, i) => {
  let text;
  if (files.length) text = await readFile(files[i], 'utf8');
  else {
    const response = await fetch(source.url, { headers: NSE_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`NSE ${source.id} directory unavailable (${response.status})`);
    text = await response.text();
  }
  const stocks = parseStockCSV(text);
  if (stocks.length < source.minRows) throw new Error(`Incomplete NSE ${source.id} directory; existing snapshot preserved`);
  return stocks;
}));
const stocks = mergeStockLists(stockDirectory, ...lists);
const content = stockDirectorySource(stocks, new Date().toISOString());
await writeFile(new URL('../src/stocks.js', import.meta.url), content);
console.log(`NSE directory: ${stocks.length} stocks (${stocks.length - stockDirectory.length} added); mainboard ${lists[0].length}, SME ${lists[1].length}`);
