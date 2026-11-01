import { useMemo, useState } from 'react';
import { useFeed } from './hooks.js';
import { completedDailyBars } from './tradeMath.js';
import { historyAnalytics, screenAnalytics } from './researchAnalytics.js';
import { fmt, pct, short } from './data.js';
import { Empty, PanelTitle, exportCSV } from './ui.jsx';

export function AnalyticsSummary({ rows = [] }) {
  const stats = useMemo(() => screenAnalytics(rows), [rows]);
  return <div className="analytics-stats">
    {[[stats.total, 'Stocks in view'], [pct(stats.trendPercent), `Above 200 DMA · ${stats.trendKnown} known`], [Number.isFinite(stats.medianRS) ? `${fmt(stats.medianRS)} pts` : '—', 'Median relative strength · 3M'], [Number.isFinite(stats.medianVolume) ? `${fmt(stats.medianVolume)}×` : '—', 'Median volume vs 20 sessions']].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
  </div>;
}

export function StockAnalytics({ symbol, refresh }) {
  const [range, setRange] = useState('1y');
  const stock = useFeed(`/api/market?op=chart&symbol=${encodeURIComponent(symbol)}&range=${range}&adjusted=1`, refresh);
  const benchmark = useFeed(`/api/market?op=chart&symbol=%5ENSEI&range=${range}&adjusted=1`, refresh);
  const stats = useMemo(() => historyAnalytics(
    stock.data?.adjusted ? completedDailyBars(stock.data.bars, stock.data.timezone || 'Asia/Kolkata') : [],
    benchmark.data?.adjusted ? completedDailyBars(benchmark.data.bars, benchmark.data.timezone || 'Asia/Kolkata') : [],
  ), [stock.data, benchmark.data]);
  const metrics = [[pct(stats.totalReturn), 'Period return'], [pct(stats.maxDrawdown), 'Maximum drawdown'], [pct(stats.volatility), 'Annualized volatility'], [fmt(stats.sharpe), 'Sharpe · 0% risk-free'], [fmt(stats.beta), 'Beta vs Nifty 50'], [fmt(stats.correlation), 'Correlation vs Nifty 50']];
  return <section className="panel research-tools">
    <PanelTitle title={`${short(symbol)} · advanced analytics`} tag="RISK"><select aria-label="Analytics period" value={range} onChange={e => setRange(e.target.value)}><option value="3mo">3 months</option><option value="6mo">6 months</option><option value="1y">1 year</option></select><button className="button" disabled={!stats.sessions} onClick={() => exportCSV([['Symbol', 'From', 'To', 'Sessions', ...metrics.map(m => m[1])], [symbol, stats.from, stats.to, stats.sessions, stats.totalReturn, stats.maxDrawdown, stats.volatility, stats.sharpe, stats.beta, stats.correlation]], `alphanova-analytics-${short(symbol)}.csv`)}>Export analytics</button></PanelTitle>
    {stock.loading && !stock.data ? <p role="status">Loading adjusted daily history…</p> : !stats.sessions ? <Empty title="Analytics unavailable" description={stock.error || 'Adjusted price history is unavailable for this stock.'} /> : <>
      {stock.error && <p className="negative">Refresh failed; showing cached history. {stock.error}</p>}
      <div className="analytics-stats">{metrics.map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <p className="muted">{stats.from} – {stats.to} · {stats.sessions} completed sessions · {stats.pairs} aligned return observations with Nifty 50.</p>
      {benchmark.error && <p className="muted">Benchmark could not refresh. {benchmark.data ? 'Comparison uses cached history.' : 'Beta and correlation are unavailable.'}</p>}
      <details><summary>How these metrics are calculated</summary><p>Yahoo Finance adjusted daily closes, excluding the current exchange date. Return compares first and last close. Drawdown measures the largest fall from a running peak. Volatility and Sharpe use daily simple returns and 252 sessions per year; Sharpe assumes a 0% risk-free rate. Beta and correlation use matching date pairs against Nifty 50. Risk metrics need at least 20 daily returns. Missing data appears as —. These describe the selected history, not expected future returns.</p></details>
    </>}
  </section>;
}

export default function AdvancedAnalytics({ symbol, refresh, onRefresh, onSelect, watch }) {
  const feed = useFeed('/api/market?op=screen', refresh);
  const [scope, setScope] = useState('all');
  const rows = (feed.data?.rows || []).filter(row => scope === 'all' || watch.includes(`${row.symbol}.NS`));
  const stats = screenAnalytics(rows);
  return <div className="research-stack"><section className="panel research-tools">
    <PanelTitle title="Market participation & sector concentration" tag="ANALYTICS"><button className="button" onClick={onRefresh}>Refresh</button></PanelTitle>
    <div className="insight-actions"><label>Universe <select value={scope} onChange={e => setScope(e.target.value)}><option value="all">Nifty 500</option><option value="watchlist">My NSE watchlist</option></select></label><label>Stock <select value={symbol} onChange={e => onSelect(e.target.value)}>{!(feed.data?.rows || []).some(r => `${r.symbol}.NS` === symbol) && <option value={symbol}>{short(symbol)}</option>}{(feed.data?.rows || []).map(row => <option value={`${row.symbol}.NS`} key={row.symbol}>{row.symbol} · {row.name}</option>)}</select></label></div>
    {feed.loading && !feed.data ? <p role="status">Loading market analytics…</p> : !feed.data ? <Empty title="Market analytics unavailable" description={feed.error} /> : <>
      <p className="muted">Session snapshot {feed.data.date || 'date unavailable'} · {feed.data.source || 'Yahoo Finance + NSE'}{feed.error ? ' · Cached data; refresh failed' : ''}</p>
      {!rows.length ? <p>No covered stocks in this selection. Add NSE stocks to your watchlist.</p> : <><AnalyticsSummary rows={rows} /><h3>Industry participation</h3><div className="table-wrap"><table><thead><tr><th>Industry</th><th>Stocks</th><th>Share of selection</th><th>Median 3M return</th></tr></thead><tbody>{stats.sectors.map(sector => <tr key={sector.industry}><td>{sector.industry}</td><td>{sector.count}</td><td>{fmt(sector.count / stats.total * 100, 1)}%</td><td>{pct(sector.return3m)} <small className="muted">({sector.coverage} known)</small></td></tr>)}</tbody></table></div><p className="muted">Equal stock counts, not market-cap weights or portfolio allocations. Medians exclude missing values.</p></>}
    </>}
  </section><StockAnalytics key={symbol} symbol={symbol} refresh={refresh} /></div>;
}
