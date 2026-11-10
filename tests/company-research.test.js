import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCompanyFinancials } from '../lib/companyFundamentals.js';
import { normalizeScreener, normalizeFundamentals } from '../api/market.js';
import { companyResearch, companyMoney } from '../src/companyResearch.js';

const table = `<section id="profit-loss"><p>Consolidated Figures in Rs. Crores</p><table class="data-table"><thead><tr><th></th><th data-date-key="2025-03-31">Mar 2025</th><th data-date-key="2026-03-31">Mar 2026</th><th data-date-key="TTM">TTM</th></tr></thead><tbody>
<tr><td>Sales <span>+</span></td><td>1,000</td><td>1,200</td><td>1,500</td></tr>
<tr><td>Net Profit +</td><td>100</td><td>90</td><td>(30)</td></tr>
<tr><td>Operating Profit</td><td>200</td><td>180</td><td></td></tr></tbody></table></section>
<section id="quarters"><table class="data-table"><tr><th></th><th data-date-key="2026-09-30">Sep 2026</th></tr></table></section>`;
const html = `<div class="company-profile"><div class="sub about"><p>Makes software &amp; services.</p><script>bad()</script></div><a href="https://example.com">Website</a></div>${table}`;
test('company statement parsing aligns periods, crore units, losses, margins and TTM end date', () => {
  const company = parseCompanyFinancials(html, 'X.NS', 'https://www.screener.in/company/X/consolidated/');
  assert.equal(company.basis, 'Consolidated');
  assert.equal(company.revenue, 1500e7); assert.equal(company.netIncome, -30e7);
  assert.equal(company.netMargin, -0.02); assert.equal(company.operatingMargin, null);
  assert.equal(company.end, '2026-09-30'); assert.equal(company.period, 'TTM');
  assert.equal(company.history[0].netMargin, 0.1);
  assert.equal(company.businessSummary, 'Makes software & services.');
  assert.equal(company.website, 'https://example.com');
});
test('missing units, dates or financials do not become invented figures or zero', () => {
  const company = parseCompanyFinancials(html.replace('Figures in Rs. Crores', ''), 'X.NS', '');
  assert.equal(company.revenue, undefined); assert.equal(company.netIncome, undefined);
  const blank = parseCompanyFinancials('', 'X.NS', '');
  assert.equal(blank.businessSummary, null); assert.deepEqual(blank.history, []);
  assert.equal(blank.period, undefined);
  assert.equal(companyMoney(null), '—'); assert.equal(companyMoney(0), '₹0.0 Cr');
});
test('quarterly charts preserve rupee EPS, crore amounts and missing values', () => {
  const quarters = `<section id="quarters"><p>Consolidated Figures in Rs. Crores</p><table class="data-table"><tr><th></th><th data-date-key="2026-06-30">Jun 2026</th><th data-date-key="2026-09-30">Sep 2026</th></tr><tr><td>Sales</td><td>100</td><td>120</td></tr><tr><td>Net Profit</td><td>(5)</td><td>12</td></tr><tr><td>Operating Profit</td><td>10</td><td></td></tr><tr><td>EPS in Rs</td><td>(0.5)</td><td>1.2</td></tr></table></section>`;
  const company = parseCompanyFinancials(table.replace(/<section id="quarters">[\s\S]*$/, quarters).replace('</tbody>', '<tr><td>EPS in Rs</td><td>10</td><td>9</td><td>(3)</td></tr></tbody>'), 'X.NS', '');
  assert.equal(company.history[0].eps, 10);
  assert.equal(company.quarterlyHistory[0].revenue, 100e7);
  assert.equal(company.quarterlyHistory[0].eps, -0.5);
  assert.equal(company.quarterlyHistory[0].netMargin, -0.05);
  assert.equal(company.quarterlyHistory[1].operatingMargin, null);
  assert.equal(company.quarterlyHistory[1].end, '2026-09-30');
  assert.deepEqual(parseCompanyFinancials(quarters.replace('Figures in Rs. Crores', ''), 'X.NS', '').quarterlyHistory, []);
});
test('fundamentals expose coherent statement data and keep TTM amounts separate from market value', () => {
  const ratios = `<div id="top-ratios"><li><span class="name">Market Cap</span><span class="number">20,000</span> Cr.</li><li><span class="name">ROE</span><span class="number">15</span>%</li></div>`;
  const fund = normalizeScreener(ratios + html, 'X.NS');
  assert.equal(fund.marketCap, 20000e7); assert.equal(fund.company.netIncome, -30e7);
  assert.equal(fund.company.roe, 0.15); assert.equal(fund.profitMargin, -0.02);
  const yahoo = normalizeFundamentals({ quoteSummary: { result: [{ price: { currency: 'USD' }, defaultKeyStatistics: { netIncomeToCommon: { raw: 200 } }, financialData: { totalRevenue: { raw: 1000 }, operatingMargins: { raw: 0.3 } } }] } }, 'X');
  assert.equal(yahoo.company.netIncome, 200); assert.equal(yahoo.company.revenue, 1000);
  assert.equal(yahoo.company.operatingMargin, 0.3); assert.equal(yahoo.company.currency, 'USD');
});
test('company commentary distinguishes historical growth, valuation, sector drivers and unavailable forecasts', () => {
  const research = companyResearch({ peTrailing: 40, company: { revenueGrowth: 0.2, earningsGrowth: -0.1, growthPeriod: 'TTM year over year', history: [{ period: 'Mar 2025', operatingMargin: 0.2 }, { period: 'Mar 2026', operatingMargin: 0.15 }] } }, 'Information Technology');
  assert.match(research.growth[0], /grew 20.0%/); assert.match(research.growth[1], /fell 10.0%/);
  assert.match(research.driver, /client technology budgets/);
  assert.match(research.margin, /contracted/); assert.match(research.valuation, /40.0×/);
  assert.match(research.valuation, /estimates are unavailable/);
  assert.doesNotMatch(research.valuation, /undervalued|overvalued|buy/);
});
