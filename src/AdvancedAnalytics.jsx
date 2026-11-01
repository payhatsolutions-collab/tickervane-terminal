import { useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ChartNoAxesCombined, Layers3, RefreshCw, TrendingUp } from 'lucide-react';
import { useFeed } from './hooks.js';
import { completedDailyBars } from './tradeMath.js';
import { historyAnalytics, historySeries, screenAnalytics } from './researchAnalytics.js';
import { fmt, pct, short } from './data.js';
import { Empty, PanelTitle, SortTh, exportCSV, sortRows, tone } from './ui.jsx';
import { BreadthChart, HistoryChart, IndustryMomentum } from './AnalyticsCharts.jsx';
import './analytics.css';

export function AnalyticsSummary({ rows = [] }) {
  const stats = useMemo(() => screenAnalytics(rows), [rows]);
  const metrics = [
    { value: stats.total, label: 'Stocks in view', detail: `${stats.sectors.length} industries`, Icon: Layers3 },
    { value: Number.isFinite(stats.trendPercent) ? `${fmt(stats.trendPercent, 1)}%` : '—', label: 'Above 200 DMA', detail: `${stats.trendKnown} stocks covered`, Icon: TrendingUp },
    { value: Number.isFinite(stats.medianRS) ? `${fmt(stats.medianRS)} pts` : '—', label: 'Median relative strength', detail: '3M vs Nifty 50', Icon: ChartNoAxesCombined },
    { value: Number.isFinite(stats.medianVolume) ? `${fmt(stats.medianVolume)}×` : '—', label: 'Median volume', detail: 'vs 20-session average', Icon: Activity },
  ];
  return <div className="analytics-stats analytics-summary">{metrics.map(({ value, label, detail, Icon }) => <div key={label}><span className="analytics-metric-label">{label}<Icon size={16} aria-hidden="true" /></span><strong>{value}</strong><span>{detail}</span></div>)}</div>;
}

export function StockAnalytics({ symbol, refresh }) {
  const [range, setRange] = useState('1y');
  const stock = useFeed(`/api/market?op=chart&symbol=${encodeURIComponent(symbol)}&range=${range}&adjusted=1`, refresh);
  const benchmark = useFeed(`/api/market?op=chart&symbol=%5ENSEI&range=${range}&adjusted=1`, refresh);
  const { stats, series } = useMemo(() => {
    const bars = stock.data?.adjusted ? completedDailyBars(stock.data.bars, stock.data.timezone || 'Asia/Kolkata') : [];
    const reference = benchmark.data?.adjusted ? completedDailyBars(benchmark.data.bars, benchmark.data.timezone || 'Asia/Kolkata') : [];
    return { stats: historyAnalytics(bars, reference), series: historySeries(bars, reference) };
  }, [stock.data, benchmark.data]);
  const metrics = [[pct(stats.totalReturn), 'Period return', tone(stats.totalReturn)], [pct(stats.maxDrawdown), 'Maximum drawdown', 'negative'], [pct(stats.volatility), 'Annualized volatility'], [fmt(stats.sharpe), 'Sharpe · 0% risk-free'], [fmt(stats.beta), 'Beta vs Nifty 50'], [fmt(stats.correlation), 'Correlation vs Nifty 50']];
  return <section className="panel research-tools analytics-stock-panel">
    <PanelTitle title={`${short(symbol)} · performance & risk`}><select aria-label="Analytics period" value={range} onChange={e => setRange(e.target.value)}><option value="3mo">3 months</option><option value="6mo">6 months</option><option value="1y">1 year</option></select><button className="button" disabled={!stats.sessions} onClick={() => exportCSV([['Symbol', 'From', 'To', 'Sessions', ...metrics.map(m => m[1])], [symbol, stats.from, stats.to, stats.sessions, stats.totalReturn, stats.maxDrawdown, stats.volatility, stats.sharpe, stats.beta, stats.correlation]], `alphanova-analytics-${short(symbol)}.csv`)}><ArrowDownToLine size={14} aria-hidden="true" />Export analytics</button></PanelTitle>
    {stock.loading && !stock.data ? <p role="status">Loading adjusted daily history…</p> : !stats.sessions ? <Empty title="Analytics unavailable" description={stock.error || 'Adjusted price history is unavailable for this stock.'} /> : <>
      {stock.error && <p className="negative">Refresh failed; showing cached history. {stock.error}</p>}
      <div className="analytics-history-grid">
        <article className="analytics-chart-card"><div className="analytics-chart-heading"><div><span className="analytics-eyebrow">CUMULATIVE RETURN</span><h3>Performance vs Nifty 50</h3></div><span className="analytics-chart-unit">%</span></div>
          <HistoryChart key={`${symbol}-${range}-performance`} points={series.performance} label="Cumulative return chart" stockLabel={short(symbol)} benchmark={series.benchmarkAligned} />
          <div className="analytics-chart-note">{series.benchmarkAligned ? `Both start at 0% · matched dates ${series.performance[0].time} – ${series.performance.at(-1).time}` : benchmark.loading ? 'Loading Nifty 50 comparison…' : 'Nifty 50 comparison unavailable for this period.'}</div>
        </article>
        <article className="analytics-chart-card"><div className="analytics-chart-heading"><div><span className="analytics-eyebrow">DECLINE FROM RUNNING PEAK</span><h3>Drawdown</h3></div><span className="analytics-drawdown-badge">{pct(stats.maxDrawdown)} max</span></div>
          <HistoryChart key={`${symbol}-${range}-drawdown`} points={series.drawdown} label="Historical drawdown chart" stockLabel={short(symbol)} drawdown />
          <div className="analytics-chart-note">0% marks a new or recovered high.</div>
        </article>
      </div>
      <div className="analytics-risk-metrics">{metrics.map(([value, label, color]) => <div key={label}><span>{label}</span><strong className={color || ''}>{value}</strong></div>)}</div>
      <div className="analytics-data-note">{stats.from} – {stats.to} · {stats.sessions} completed sessions · adjusted daily closes</div>
      {benchmark.error && <p className="muted">Benchmark could not refresh. {benchmark.data ? 'Comparison uses cached history.' : 'Beta and correlation are unavailable.'}</p>}
      <details className="analytics-method"><summary>About these metrics</summary><p>Yahoo Finance adjusted daily closes, excluding the current exchange date. Return compares first and last close. The comparison chart rebases both instruments to 0% on their first shared date and uses matching dates only; the period return metric uses the stock’s full selected history. Drawdown measures the fall from a running peak. Volatility and Sharpe use daily simple returns and 252 sessions per year; Sharpe assumes a 0% risk-free rate. Beta and correlation use {stats.pairs} matching date pairs against Nifty 50. Risk metrics need at least 20 daily returns. Missing data appears as —. These describe the selected history, not expected future returns.</p></details>
    </>}
  </section>;
}

function IndustryParticipation({ stats }) {
  const [sort, setSort] = useState(['count', -1]);
  const sectors = useMemo(() => sortRows(stats.sectors, sort), [stats.sectors, sort]);
  const maxReturn = Math.max(1, ...stats.sectors.map(sector => Math.abs(sector.return3m || 0)));
  return <section className="panel research-tools analytics-industry-panel">
    <PanelTitle title="Industry participation"><span className="analytics-count">{stats.sectors.length} industries</span></PanelTitle>
    <div className="analytics-table-hint">Click a column to sort <span>{sort[0] === 'return3m' ? `Returns: ${sort[1] < 0 ? 'highest' : 'lowest'} first` : 'Equal stock counts · not portfolio weights'}</span></div>
    <div className="table-wrap analytics-industry-table" tabIndex="0" role="region" aria-label="Industry participation table"><table><thead><tr>
      <SortTh k="industry" sort={sort} setSort={setSort}>Industry</SortTh>
      <SortTh k="count" sort={sort} setSort={setSort} className="number">Stocks</SortTh>
      <th>Share of selection</th>
      <SortTh k="return3m" sort={sort} setSort={setSort} className="number" title="Sort median 3-month return; missing returns stay last">Median 3M return</SortTh>
    </tr></thead><tbody>{sectors.map(sector => <tr key={sector.industry}>
      <td><strong>{sector.industry}</strong></td><td className="number">{sector.count}</td>
      <td><div className="analytics-share"><span>{fmt(sector.count / stats.total * 100, 1)}%</span><div aria-hidden="true"><i style={{ width: `${sector.count / stats.total * 100}%` }} /></div></div></td>
      <td className="number"><div className="analytics-table-return"><div className="analytics-diverging-track" aria-hidden="true">{Number.isFinite(sector.return3m) && <i className={tone(sector.return3m)} style={{ left: `${sector.return3m < 0 ? 50 - Math.abs(sector.return3m) / maxReturn * 50 : 50}%`, width: `${Math.abs(sector.return3m) / maxReturn * 50}%` }} />}</div><div><strong className={tone(sector.return3m)}>{pct(sector.return3m)}</strong><small>{sector.coverage}/{sector.count} known</small></div></div></td>
    </tr>)}</tbody></table></div>
    <details className="analytics-method"><summary>Coverage & methodology</summary><p>Shares count stocks in this selection, not market-cap weights or portfolio allocations. Returns are the median 3-month stock return within each industry. Medians exclude missing values; industries without known returns stay last in either sort direction.</p></details>
  </section>;
}

export default function AdvancedAnalytics({ symbol, refresh, onRefresh, onSelect, watch = [] }) {
  const feed = useFeed('/api/market?op=screen', refresh);
  const [scope, setScope] = useState('all');
  const rows = useMemo(() => (feed.data?.rows || []).filter(row => scope === 'all' || watch.includes(`${row.symbol}.NS`)), [feed.data, scope, watch]);
  const stats = useMemo(() => screenAnalytics(rows), [rows]);
  return <div className="research-stack advanced-analytics"><section className="panel research-tools analytics-market-panel">
    <PanelTitle title="The market, at a glance"><button className="button" onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" />Refresh</button></PanelTitle>
    <div className="analytics-toolbar"><div className="insight-actions"><label>Universe <select value={scope} onChange={e => setScope(e.target.value)}><option value="all">Nifty 500</option><option value="watchlist">My NSE watchlist</option></select></label><label>Stock <select value={symbol} onChange={e => onSelect(e.target.value)}>{!(feed.data?.rows || []).some(r => `${r.symbol}.NS` === symbol) && <option value={symbol}>{short(symbol)}</option>}{(feed.data?.rows || []).map(row => <option value={`${row.symbol}.NS`} key={row.symbol}>{row.symbol} · {row.name}</option>)}</select></label></div>{feed.data && <span className="analytics-session">{feed.loading ? 'Updating · ' : ''}Session {feed.data.date || 'date unavailable'}</span>}</div>
    {feed.loading && !feed.data ? <p role="status">Loading market analytics…</p> : !feed.data ? <Empty title="Market analytics unavailable" description={feed.error} /> : <>
      {!rows.length ? <Empty title="No covered stocks in this selection" description="Add NSE stocks to your watchlist to see their market participation." /> : <><AnalyticsSummary rows={rows} /><div className="analytics-market-grid"><BreadthChart rows={rows} stats={stats} /><IndustryMomentum sectors={stats.sectors} /></div></>}
      <div className="analytics-data-note">{feed.data.source || 'Yahoo Finance + NSE'}{feed.error ? ' · Cached data; refresh failed' : ''}</div>
    </>}
  </section><StockAnalytics key={symbol} symbol={symbol} refresh={refresh} />{rows.length > 0 && <IndustryParticipation stats={stats} />}</div>;
}
