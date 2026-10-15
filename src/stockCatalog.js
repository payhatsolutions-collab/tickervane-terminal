// Shared by the exchange loader and the bundled-directory refresh script.
export const stockSources = [
  { id: 'mainboard', url: 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', minRows: 1000 },
  { id: 'sme', url: 'https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv', minRows: 100 },
];

const symbolPattern = /^[A-Z0-9][A-Z0-9&-]{0,24}$/;
export function validStock(stock) {
  return stock && typeof stock.symbol === 'string' && symbolPattern.test(stock.symbol)
    && !/-RE\d*$/.test(stock.symbol)
    && typeof stock.name === 'string' && stock.name.trim().length > 0 && stock.name.length <= 200;
}

// NSE's two headers use spaces and underscores respectively. Quoted company
// names may contain commas, so splitting a line on commas loses columns.
function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.trim()); field = '';
      if (char === '\n') { rows.push(row); row = []; }
    } else if (char !== '\r' || quoted) field += char;
  }
  if (quoted) throw new Error('Incomplete NSE stock directory');
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

export function parseStockCSV(text) {
  const [header = [], ...rows] = csvRows(text);
  const columns = Object.fromEntries(header.map((name, i) => [name.toUpperCase().replaceAll('_', ' ').trim(), i]));
  if (!['SYMBOL', 'NAME OF COMPANY', 'SERIES'].every(key => key in columns)) {
    throw new Error('Invalid NSE stock directory');
  }
  const stocks = rows.map(row => ({
    symbol: row[columns.SYMBOL]?.toUpperCase(),
    name: row[columns['NAME OF COMPANY']]?.replace(/\s+(Limited|Ltd\.?)$/i, '').trim(),
    sector: 'Others',
    series: row[columns.SERIES],
  })).filter(stock => ['EQ', 'BE', 'BZ', 'SM', 'ST', 'SZ'].includes(stock.series) && validStock(stock));
  return [...new Map(stocks.map(({ series, ...stock }) => [stock.symbol, stock])).values()];
}

export function mergeStockLists(existing, ...lists) {
  // Preserve curated sectors/names and legacy symbols used by saved watchlists.
  const stocks = new Map();
  for (const stock of [...existing, ...lists.flat()]) {
    if (validStock(stock) && !stocks.has(stock.symbol)) {
      stocks.set(stock.symbol, { symbol: stock.symbol, name: stock.name.trim(), sector: stock.sector || 'Others' });
    }
  }
  return [...stocks.values()].sort((a, b) => a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
}
