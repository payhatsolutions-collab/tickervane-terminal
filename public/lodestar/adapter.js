const num = value => Number.isFinite(value) ? value : null;
const pct = value => Number.isFinite(value) ? value * 100 : null;
const metric = (label, value, unit = 'pct') => ({ label, value: num(value), unit, score: null, weight: null, text: '' });

// Statement-only companies retain Lodestar's report shape, without invented scores.
export function statementReport(fund, history = {}, listing = {}) {
  const c = fund.company || {}, rows = c.history || [];
  const currency = c.currency || history.currency || (fund.symbol.endsWith('.NS') ? 'INR' : 'USD');
  const definitions = [
    ['sales', 'Sales', 15, [metric('Revenue growth · provider reported', pct(c.revenueGrowth ?? fund.revenueGrowth), 'spct')]],
    ['margins', 'Margins', 15, [metric(`${c.period || 'Reported'} operating margin`, pct(c.operatingMargin)), metric(`${c.period || 'Reported'} net margin`, pct(c.netMargin ?? fund.profitMargin))]],
    ['eps', 'Earnings per share', 20, [metric('Trailing EPS', fund.epsTrailing, 'num'), metric('Profit growth · provider reported', pct(c.earningsGrowth ?? fund.earningsGrowth), 'spct')]],
    ['returns', 'Return on equity', 15, [metric('ROE · reported period', pct(c.roe ?? fund.roe))]],
    ['forward', 'Forward estimates', 20, [metric('Forward EPS · provider reported', fund.epsForward, 'num'), metric('Forward P/E · provider reported', fund.peForward, 'x1')]],
    ['valuation', 'Valuation', 15, [metric('Trailing P/E', fund.peTrailing, 'x1')]],
  ];
  const annual = rows.filter(row => row.period !== 'TTM').map(row => ({ fy: row.period, revenue: num(row.revenue), ni: num(row.netIncome), eps: num(row.eps), opMargin: pct(row.operatingMargin), netMargin: pct(row.netMargin), revGrowth: null, epsGrowth: null, grossMargin: null, roe: null, roce: null }));
  const quarterly = (c.quarterlyHistory || []).map(row => ({ label: row.period, revenue: num(row.revenue), ni: num(row.netIncome), eps: num(row.eps), opMargin: pct(row.operatingMargin), netMargin: pct(row.netMargin), revYoY: null, epsYoY: null }));
  const source = c.source || fund.source || 'Provider';
  const at = fund.fetchedAt ? new Date(fund.fetchedAt) : null;
  const asOf = at && Number.isFinite(at.getTime()) ? at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : 'Date unavailable';
  return {
    extended: true, source,
    meta: { symbol: fund.symbol, name: listing.name || history.name || fund.symbol, short: listing.name || history.name || fund.symbol, exchange: listing.exchange || history.exchange || 'NSE', sector: listing.sector || fund.sector || '', industry: fund.industry || '', currency: history.currency || currency, finCurrency: currency,
      price: num(history.price), changePct: num(history.change), marketCap: num(fund.marketCap), low52: num(history.yearLow), high52: num(history.yearHigh), lastFY: annual.at(-1)?.fy || c.period || 'Unavailable', asOf, analysts: null, isLender: false },
    verdict: { action: 'NO CALL', score: null, coverage: 0, coverageText: 'FINANCIAL STATEMENTS · NOT SCORED', buyAt: 65, sellBelow: 45, caps: ['Full six-pillar scoring is not available for this company.'], summary: `${c.basis || 'Provider-reported'} financial statements${c.period ? ` · ${c.period}` : ''}${c.end ? ` ended ${c.end}` : ''}. Available metrics are shown below; no buy, hold or sell call has been generated.` },
    pillars: definitions.map(([key, name, weight, metrics]) => ({ key, name, weight, metrics, score: null, grade: 'Not scored', coverage: 0, headline: '', blurb: '' })),
    annual, quarterly, ttm: { revenue: num(c.revenue), ni: num(c.netIncome), eps: num(fund.epsTrailing), opMargin: pct(c.operatingMargin), netMargin: pct(c.netMargin) },
    bull: [], bear: [], flags: [], notes: [`Source: ${source}. ${c.basis || 'Provider reported'}; statement period ${c.period || 'unavailable'}${c.end ? ` ended ${c.end}` : ''}. Missing fields are unavailable, not zero.`, 'The scoring weights and hurdles below describe the full Lodestar model. They have not been applied to this statement-only report.'],
    forward: { eps: [], revenue: [], revisions: {}, trend: {}, target: {}, rating: {}, estCurrency: currency, epsBase: null },
    valuation: { pe: num(fund.peTrailing), fwdPE: num(fund.peForward), band: null, peg: null, pb: null, evEbitda: null, fcfYield: null, divYield: null, de: null },
    dupont: null, surprises: [], price: (history.bars || []).filter(row => typeof row.time === 'string' && Number.isFinite(row.close)).map(row => [row.time, row.close]),
  };
}

export function createMarketBridge(request = (...args) => fetch(...args)) {
  let directory;
  async function read(path, timeout = 30000) {
    const response = await request(path, { cache: 'no-cache', signal: AbortSignal.timeout(timeout) });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Company data is temporarily unavailable. Please retry.');
    return data;
  }
  async function index() {
    if (directory) return directory;
    directory = (async () => {
      const [snapshots, stocks] = await Promise.allSettled([read('/api/market?op=lodestar'), read('/api/market?op=directory')]);
      const items = new Map();
      for (const row of stocks.value?.stocks || []) items.set(row.symbol + '.NS', { symbol: row.symbol + '.NS', name: row.name, sector: row.sector, exchange: 'NSE', full: false });
      for (const row of snapshots.value?.items || []) items.set(row.symbol, { ...items.get(row.symbol), ...row, full: true });
      if (!items.size) throw new Error('Company search is temporarily unavailable. Please retry.');
      return { items: [...items.values()], builtAt: snapshots.value?.builtAt || '', fullCount: snapshots.value?.items?.length || 0 };
    })().catch(error => { directory = null; throw error; });
    return directory;
  }
  async function analyze(listing) {
    if (!/^[A-Z0-9][A-Z0-9.&_-]{0,24}$/.test(listing.symbol)) throw new Error('Invalid company symbol');
    const symbol = encodeURIComponent(listing.symbol);
    if (listing.full) {
      try {
        const report = await read('/api/market?op=lodestar&symbol=' + symbol);
        if (report.available && report.meta?.symbol === listing.symbol) return report;
      } catch { /* Try the original engine if its published snapshot is unavailable. */ }
    }
    // Directory membership is not a scoring limit: run the original model on demand.
    try {
      const report = await read('/api/lodestar?symbol=' + symbol, 110000);
      if (report.available && report.meta?.symbol === listing.symbol) return report;
    } catch { /* Retain available statements if the model's upstream data is unavailable. */ }
    const [fund, history] = await Promise.allSettled([read('/api/market?op=fundamentals&symbol=' + symbol), read('/api/market?op=chart&symbol=' + symbol + '&range=5y')]);
    if (fund.status !== 'fulfilled') throw fund.reason;
    if (fund.value.symbol !== listing.symbol) throw new Error('Company data did not match the selected ticker. Please retry.');
    return statementReport(fund.value, history.value, listing);
  }
  return { index, analyze };
}
