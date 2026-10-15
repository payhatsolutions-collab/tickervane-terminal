import { useMemo, useState } from 'react';
import { BellRing, ChevronRight, Download, Info, RefreshCw, Star } from 'lucide-react';
import { useFeed, useQuotes } from './hooks';
import './delivery.css';
import LatestQuote from './LatestQuote.jsx';
import { growthEvent } from './growth.js';
import { fmt, pct, compact } from './data';
import { Empty, PanelTitle, SortTh, MiniBars, exportCSV, sortRows, tone } from './ui';

const SIGNALS = [
  ['Spikes', r => r.delivRatio >= 1.8, 'Delivered quantity at least 1.8× the 20-session average'],
  ['Accumulation', r => r.signal === 'Accumulation', 'Delivery spike into an up close near the day’s high'],
  ['Distribution', r => r.signal === 'Distribution', 'Delivery spike into a down close near the day’s low'],
  ['High conviction', r => r.signal === 'High conviction', 'Delivery % above 60 and 25%+ above its own average'],
  ['All liquid', () => true, 'Every liquid EQ stock with a full baseline'],
];
const TURNOVER = [1, 5, 25, 100];
const SORTS = [['delivRatio', 'Delivery quantity'], ['delivPct', 'Delivery %'], ['change', 'Price change'], ['turnoverCr', 'Turnover'], ['symbol', 'Stock name']];
const signalClass = s => s === 'Accumulation' ? 'positive' : s === 'Distribution' ? 'negative' : s === 'High conviction' ? 'accent' : 'muted';
const dateLabel = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function DeliveryRadar({ onOpen, watch, toggleWatch, refresh, onRefresh, pushOn, digestOn, setDigest, goAlerts }) {
  const { data, loading, error } = useFeed('/api/market?op=delivery', refresh);
  const [signal, setSignal] = useState('Spikes');
  const [minTurnover, setMinTurnover] = useState(5);
  const [scope, setScope] = useState('All NSE');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(['delivRatio', -1]);
  const [limit, setLimit] = useState(50);
  const watchSet = useMemo(() => new Set((watch || []).filter(s => s.endsWith('.NS')).map(s => s.slice(0, -3))), [watch]);
  const base = useMemo(() => (data?.rows || []).filter(r => r.turnoverCr >= minTurnover && (scope === 'All NSE' || (scope === 'Nifty 500' ? r.n500 : watchSet.has(r.symbol)))), [data, minTurnover, scope, watchSet]);
  const counts = useMemo(() => Object.fromEntries(SIGNALS.map(([k, f]) => [k, base.filter(f).length])), [base]);
  const rows = useMemo(() => {
    const f = SIGNALS.find(s => s[0] === signal)?.[1] || (() => true);
    const needle = q.trim().toUpperCase();
    return sortRows(base.filter(r => f(r) && (!needle || r.symbol.includes(needle) || r.name.toUpperCase().includes(needle) || (r.industry || '').toUpperCase().includes(needle))), sort);
  }, [base, signal, q, sort]);
  const top = rows.slice(0, limit);
  const latest = useQuotes(rows.slice(0, limit).map(r => r.symbol + '.NS'), refresh);
  const watchHits = (data?.rows || []).filter(r => watchSet.has(r.symbol) && r.delivRatio >= 1.5);

  const openChart = (symbol) => {
    growthEvent('research_chart_opened', { source: 'Delivery' });
    onOpen(symbol + '.NS');
  };
  return <>
    <section className="panel radar-panel">
      <PanelTitle title="Delivery radar" tag="DLV">
        <span className="muted small radar-date">Session {dateLabel(data?.date)}</span>
        <button className="icon-button" aria-label="Refresh delivery data" title="Refresh" onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
        <button className="button" disabled={!rows.length} onClick={() => exportCSV([['Symbol', 'Name', 'Industry', 'Close', 'Change %', 'Delivery %', 'Delivery % 20D avg', 'Delivered qty', 'Delivered qty 20D avg', 'Delivery ×', 'Volume ×', 'Turnover ₹ Cr', 'Close location', 'Signal'], ...rows.map(r => [r.symbol, r.name, r.industry, r.close, r.change, r.delivPct, r.delivPctAvg, r.delivQty, r.delivQtyAvg, r.delivRatio, r.volRatio, r.turnoverCr, r.clv, r.signal])], `delivery-radar-${data?.date || 'latest'}.csv`)}><Download size={14} /> Export</button>
      </PanelTitle>
      <div className="radar-summary">
        {SIGNALS.slice(0, 4).map(([k, , note]) => <button key={k} className={`radar-card ${signal === k ? 'active' : ''} ${signalClass(k === 'Spikes' ? '' : k)}`} onClick={() => { setSignal(k); setLimit(50); }} title={note}>
          <span>{k}</span><strong>{loading && !data ? '…' : counts[k] ?? 0}</strong>
        </button>)}
      </div>
      {watchHits.length > 0 && <div className="radar-watch"><Star size={13} /> <strong>Your watchlist:</strong> {watchHits.slice(0, 6).map(r => <button key={r.symbol} className="link" onClick={() => openChart(r.symbol)}>{r.symbol} {r.delivRatio.toFixed(1)}×</button>)}</div>}
      <p className="radar-intro">Find unusual delivery activity, then open a stock’s chart.</p>
      <div className="screen-filters radar-filters">
        {SIGNALS.map(([k, , note]) => <button key={k} title={note} aria-pressed={signal === k} className={signal === k ? 'active' : ''} onClick={() => { setSignal(k); setLimit(50); }}>{k} <em>{counts[k] ?? 0}</em></button>)}
        <input aria-label="Filter stocks" placeholder="Find a stock in these results…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <details className="radar-options">
        <summary>Filters & sort · {scope} · ≥ ₹{minTurnover} Cr</summary>
        <div className="radar-option-fields">
          <label>Universe<select aria-label="Universe" value={scope} onChange={e => { setScope(e.target.value); setLimit(50); }}>{['All NSE', 'Nifty 500', 'Watchlist'].map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Minimum turnover<select aria-label="Minimum turnover" value={minTurnover} onChange={e => { setMinTurnover(Number(e.target.value)); setLimit(50); }}>{TURNOVER.map(t => <option key={t} value={t}>≥ ₹{t} Cr</option>)}</select></label>
          <label>Sort by<select aria-label="Sort delivery results" value={sort[0]} onChange={e => setSort([e.target.value, e.target.value === 'symbol' ? 1 : -1])}>{SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}{!SORTS.some(([key]) => key === sort[0]) && <option value={sort[0]}>{sort[0]}</option>}</select></label>
          <label>Order<select aria-label="Sort direction" value={sort[1]} onChange={e => setSort([sort[0], Number(e.target.value)])}><option value={-1}>Descending</option><option value={1}>Ascending</option></select></label>
        </div>
      </details>
      {data && <p className="radar-result-note" role="status">{rows.length} matching stocks · {SIGNALS.find(([key]) => key === signal)?.[2]}</p>}
      {error && data && <div className="notice" role="status">Showing cached session data. {error} <button className="link" onClick={onRefresh}>Retry</button></div>}
      {loading && !data ? <div className="loading">Loading NSE delivery bhavcopy · 21 sessions…</div>
        : error && !data ? <Empty title="Delivery data unavailable" description={error}><button className="button" onClick={onRefresh}>Retry</button></Empty>
        : !rows.length ? <Empty title="Nothing matches" description="Loosen the turnover filter or pick another signal."><button className="button" onClick={() => { setSignal('All liquid'); setMinTurnover(1); setScope('All NSE'); setQ(''); }}>Reset filters</button></Empty>
        : <>
        <div className="radar-mobile-results" aria-label="Delivery stock results">
          {top.map(r => {
            const symbol = r.symbol + '.NS', saved = (watch || []).includes(symbol);
            return <article className="delivery-result" key={symbol}>
              <div className="delivery-result-heading"><div><h3>{r.symbol}</h3><p>{r.name}</p></div><span className={`signal-chip ${signalClass(r.signal)}`}>{r.signal}</span></div>
              <dl className="delivery-result-metrics">
                <div><dt>Delivery quantity</dt><dd>{fmt(r.delivRatio, 1)}× <small>20-day avg</small></dd></div>
                <div><dt>Delivery share</dt><dd>{fmt(r.delivPct, 1)}% <small>avg {fmt(r.delivPctAvg, 0)}%</small></dd></div>
                <div><dt>Session close</dt><dd>₹{fmt(r.close)} <small className={tone(r.change)}>{pct(r.change)}</small></dd></div>
                <div><dt>Latest price · delayed</dt><dd><LatestQuote quote={latest.quotes[symbol]} /></dd></div>
              </dl>
              <div className="delivery-result-actions">
                <a className="button primary" aria-label={`View ${r.symbol} chart`} href={`/charts?symbol=${encodeURIComponent(symbol)}`} onClick={event => {
                  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault(); openChart(r.symbol);
                }}>View chart <ChevronRight size={15} /></a>
                <button className={`button ${saved ? 'starred' : ''}`} aria-label={`${saved ? 'Remove' : 'Save'} ${r.symbol} ${saved ? 'from' : 'to'} watchlist`} aria-pressed={saved} onClick={() => toggleWatch(symbol)}><Star size={15} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save stock'}</button>
              </div>
            </article>;
          })}
        </div>
        <div className="table-wrap radar-desktop-results"><table className="radar-table"><thead><tr>
          <SortTh k="symbol" sort={sort} setSort={setSort}>Stock</SortTh>
          <th>Latest price / 1D</th>
          <SortTh k="close" sort={sort} setSort={setSort}>Close</SortTh>
          <SortTh k="change" sort={sort} setSort={setSort}>Chg %</SortTh>
          <SortTh k="delivPct" sort={sort} setSort={setSort} title="Delivery % today versus 20-session average">Delivery %</SortTh>
          <SortTh k="delivRatio" sort={sort} setSort={setSort} title="Delivered quantity versus 20-session average">Deliv. qty ×</SortTh>
          <SortTh k="volRatio" sort={sort} setSort={setSort} className="hide-sm">Volume ×</SortTh>
          <SortTh k="turnoverCr" sort={sort} setSort={setSort} className="hide-sm">Turnover</SortTh>
          <th className="hide-sm" title="Where the close sits in the day’s range: −1 at the low, +1 at the high">Close loc.</th>
          <th className="hide-sm">10-session delivery %</th>
          <SortTh k="signal" sort={sort} setSort={setSort}>Signal</SortTh>
          <th><Star size={13} /></th>
        </tr></thead><tbody>
          {top.map(r => { const w = (watch || []).includes(r.symbol + '.NS'); return <tr key={r.symbol}>
            <td><button className="instrument" onClick={() => openChart(r.symbol)}><strong>{r.symbol}</strong><span>{r.name}{r.industry ? ` · ${r.industry}` : ''}</span></button></td>
            <td className="number"><LatestQuote quote={latest.quotes[r.symbol + '.NS']} /></td>
            <td className="number">{fmt(r.close)}</td>
            <td className={`number ${tone(r.change)}`}>{pct(r.change)}</td>
            <td className="number">{fmt(r.delivPct, 1)}<small className="muted"> / {fmt(r.delivPctAvg, 0)}</small></td>
            <td className="number"><span className="ratio"><i style={{ width: Math.min(100, (r.delivRatio / 5) * 100) + '%' }} />{fmt(r.delivRatio, 1)}×</span><small className="muted">{compact(r.delivQty)}</small></td>
            <td className="number hide-sm">{fmt(r.volRatio, 1)}×</td>
            <td className="number hide-sm">₹{compact(r.turnoverCr)} Cr</td>
            <td className={`number hide-sm ${tone(r.clv)}`}>{fmt(r.clv, 2)}</td>
            <td className="hide-sm"><MiniBars values={r.history} avg={r.delivPctAvg} /></td>
            <td><span className={`signal-chip ${signalClass(r.signal)}`}>{r.signal}</span></td>
            <td><button className={`icon-button ${w ? 'starred' : ''}`} aria-label={`${w ? 'Remove' : 'Add'} ${r.symbol} ${w ? 'from' : 'to'} watchlist`} onClick={() => toggleWatch(r.symbol + '.NS')}><Star size={14} fill={w ? 'currentColor' : 'none'} /></button></td>
          </tr>; })}
        </tbody></table></div>
        {rows.length > limit && <div className="more-row"><button className="button" onClick={() => setLimit(l => l + 100)}>Show more ({rows.length - limit} left)</button></div>}
        </>}
      <p className="radar-result-note">Latest prices refresh every 30 seconds while open · Yahoo Finance may be delayed. Screen metrics and exports use session data.{latest.error ? ` ${latest.error}` : ''}</p>
      <div className="panel-foot">{data ? <>{data.coverage.liquid.toLocaleString('en-IN')} liquid of {data.coverage.eq.toLocaleString('en-IN')} EQ stocks · baseline {data.baseline} sessions · source: <a href={data.sourceUrl} target="_blank" rel="noreferrer">NSE delivery bhavcopy</a> · published after ~18:00 IST</> : 'Source: NSE security-wise delivery bhavcopy'}</div>
    </section>
    <section className="panel radar-side">
      <PanelTitle title="Daily delivery digest" tag="PUSH"><BellRing size={15} /></PanelTitle>
      <div className="radar-digest">
        <p>Watchlist spikes + top accumulation · evening digest.</p>
        {pushOn ? <label className="check"><input type="checkbox" checked={!!digestOn} onChange={e => setDigest(e.target.checked)} /> Send me the delivery digest</label>
          : <button className="button primary" onClick={goAlerts}>Turn on push notifications <ChevronRight size={14} /></button>}
      </div>
      <details className="signal-explainer radar-help"><summary><Info size={14} /> How the radar works <ChevronRight size={14} /></summary><div>
        <p>Patterns do not identify institutional buyers or prove accumulation.</p><p><strong>Delivery quantity</strong> is the part of the day’s volume that settled into demat accounts rather than being squared off intraday. A jump versus the stock’s own 20-session average means positions were actually taken or given up.</p>
        <p><strong>Accumulation</strong>: delivery ≥1.8× average, price up, close in the upper part of the range (close location ≥ +0.25). <strong>Distribution</strong>: the mirror image. <strong>High conviction</strong>: delivery % above 60 and at least 25% above its norm.</p>
        <p>Only listed companies with at least ₹1 Cr turnover and a 15+ session baseline are ranked; ETFs are excluded. End-of-day data, not a trading signal — research only.</p>
      </div></details>
    </section>
  </>;
}
