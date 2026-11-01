// Parse public statement tables without running any upstream scripts or markup.
export const plainText = html => String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '').replace(/\s+/g, ' ').trim();
const value = html => {
  let text = plainText(html).replace(/,/g, '').replace(/%/g, '').trim();
  if (/^\([\d.]+\)$/.test(text)) text = `-${text.slice(1, -1)}`;
  return /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
};
function statement(html, id) {
  const section = html.match(new RegExp(`<section\\b[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/section>`, 'i'))?.[1] || '';
  const table = section.match(/<table\b[^>]*class=["'][^"']*data-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)?.[1] || '';
  const heads = [...table.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)].map(m => ({ label: plainText(m[2]), end: m[1].match(/data-date-key=["']([^"']+)/)?.[1] || null })).slice(1);
  const rows = new Map();
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (cells.length === heads.length + 1) rows.set(plainText(cells[0]).replace(/\s*\+$/, '').trim(), cells.slice(1).map(value));
  }
  return { section, heads, rows };
}
export function parseCompanyFinancials(html, symbol, url) {
  const summary = html.match(/<div\b[^>]*class=["'][^"']*\babout\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const profile = html.match(/<div\b[^>]*class=["']company-profile["'][^>]*>([\s\S]*?)<\/section>/i)?.[1] || '';
  const website = [...profile.matchAll(/<a\b[^>]*href=["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].find(m => plainText(m[2]) === 'Website')?.[1] || null;
  const annual = statement(html, 'profit-loss'), quarters = statement(html, 'quarters');
  const sales = annual.rows.get('Sales') || annual.rows.get('Revenue') || [];
  const profits = annual.rows.get('Net Profit') || [];
  const op = annual.rows.get('Operating Profit') || [];
  // Amounts are scaled only when the source explicitly states its units.
  const multiplier = /Figures in Rs\. Crores/i.test(annual.section) ? 1e7 : null;
  const history = annual.heads.map((head, i) => ({ period: head.label, end: head.end === 'TTM' ? quarters.heads.at(-1)?.end || null : head.end,
    revenue: multiplier !== null && Number.isFinite(sales[i]) ? sales[i] * multiplier : null,
    netIncome: multiplier !== null && Number.isFinite(profits[i]) ? profits[i] * multiplier : null,
    operatingProfit: multiplier !== null && Number.isFinite(op[i]) ? op[i] * multiplier : null,
    netMargin: sales[i] > 0 && Number.isFinite(profits[i]) ? profits[i] / sales[i] : null,
    operatingMargin: sales[i] > 0 && Number.isFinite(op[i]) ? op[i] / sales[i] : null,
  })).filter(row => row.revenue !== null || row.netIncome !== null);
  const latest = history.at(-1);
  return { symbol, businessSummary: summary ? plainText(summary).slice(0, 5000) : null, website,
    basis: /\bConsolidated\s+Figures/i.test(plainText(annual.section)) ? 'Consolidated' : /\bStandalone\s+Figures/i.test(plainText(annual.section)) ? 'Standalone' : 'Basis unavailable',
    currency: 'INR', ...latest, history: history.slice(-4), source: 'Screener.in', url };
}
