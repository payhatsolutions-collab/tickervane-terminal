import { fmt } from './format.js';
export const ratioPercent = value => Number.isFinite(value) ? `${fmt(value * 100, 1)}%` : '—';
export function companyMoney(value, currency = 'INR') {
  if (!Number.isFinite(value)) return '—';
  return currency === 'INR' ? `₹${fmt(value / 1e7, Math.abs(value) >= 1e10 ? 0 : 1)} Cr` : `${currency} ${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
}
const drivers = [
  [/information technology|software|it services/i, 'For an IT services business, growth depends on client technology budgets, converting signed work into revenue, and utilization. Watch discretionary spending, large-deal execution and wage costs.'],
  [/financial|bank|insurance/i, 'Growth depends on customer acquisition, credit or premium expansion, and the cost of funding. Check asset quality, credit costs, capital adequacy and regulation; operating margins are less comparable for financial firms.'],
  [/healthcare|pharma/i, 'The growth case depends on product launches, demand in served markets and regulatory approvals. Monitor pricing pressure, research spending and inspection outcomes.'],
  [/power|energy|oil|gas/i, 'Expansion depends on capacity additions, utilization and demand. Check project commissioning, fuel costs, tariffs and the funding required for new capacity.'],
  [/consumer|retail|fmcg|automobile/i, 'Growth depends on consumer demand, distribution, new products and pricing. Watch volume growth, market share, input costs and the cash needed for expansion.'],
  [/capital goods|construction|industrial/i, 'Future growth depends on new orders, execution capacity and the investment cycle. Check order conversion, working capital, project delays and cost overruns.'],
  [/metal|chemical|mining/i, 'The growth case depends on demand, capacity utilization and selling prices. Check raw-material costs, commodity cycles, export exposure and expansion spending.'],
];
export function companyResearch(fund, industry = '') {
  const company = fund?.company || {};
  const growth = [];
  for (const [field, label] of [['revenueGrowth', 'Revenue'], ['earningsGrowth', 'Profit']]) {
    const n = company[field];
    if (Number.isFinite(n)) growth.push(`${label} ${n >= 0 ? 'grew' : 'fell'} ${ratioPercent(Math.abs(n))} (${company.growthPeriod || 'provider-reported comparison'}).`);
  }
  if (!growth.length) growth.push('Reported growth comparisons are unavailable. Review the latest results and management outlook before judging the growth case.');
  if (Number.isFinite(company.revenueGrowth) && Number.isFinite(company.earningsGrowth)) growth.push(company.earningsGrowth > company.revenueGrowth ? 'Profit growth outpaced revenue growth. Check whether this reflects sustainable operating leverage, acquisitions or exceptional items before projecting it forward.' : 'Profit growth lagged revenue growth. Sustaining the growth case requires attention to costs, mix and cash conversion.');
  const driver = drivers.find(([pattern]) => pattern.test(industry))?.[1] || 'Future growth depends on demand for the company’s products and services, pricing, execution and capital allocation. Review the latest results for capacity plans, customer concentration and funding needs.';
  const valuation = fund?.peTrailing > 0 ? `The shares trade at ${fmt(fund.peTrailing, 1)}× reported trailing earnings. This multiple is a price paid for current earnings, not a measure of fair value; compare it with sustainable growth, business quality and peers.` : 'A meaningful positive trailing P/E is unavailable. Review earnings quality and the balance sheet before comparing valuation.';
  const forward = fund?.peForward > 0 ? ` The provider’s forward P/E is ${fmt(fund.peForward, 1)}×; it relies on earnings estimates that can change.` : ' Forward earnings estimates are unavailable from the current feed.';
  const history = company.history || [];
  const annual = history.filter(row => row.period !== 'TTM');
  const last = annual.at(-1), previous = annual.at(-2);
  const margin = Number.isFinite(last?.operatingMargin) && Number.isFinite(previous?.operatingMargin)
    ? `Operating margin ${last.operatingMargin >= previous.operatingMargin ? 'expanded' : 'contracted'} from ${ratioPercent(previous.operatingMargin)} (${previous.period}) to ${ratioPercent(last.operatingMargin)} (${last.period}). This indicates ${last.operatingMargin >= previous.operatingMargin ? 'more' : 'less'} operating profit per unit of revenue.`
    : Number.isFinite(company.operatingMargin) ? `The reported operating margin is ${ratioPercent(company.operatingMargin)}. Watch whether revenue growth translates into operating profit.` : 'Operating margin is unavailable from the current financial statement.';
  return { growth, driver, valuation: valuation + forward, margin };
}
