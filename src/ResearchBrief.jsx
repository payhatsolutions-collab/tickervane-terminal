import { ArrowRight, ArrowUpRight, Bell, BookOpen, ChartNoAxesCombined, Star } from 'lucide-react';
import { overviewMetrics } from './overviewMetrics.js';
import { directory, short } from './data.js';

export function WorkspaceSummary({ watch, alerts, journal, onPage }) {
  const triggered = alerts.filter(alert => alert.triggered).length;
  const plans = journal.filter(trade => trade.status === 'planned').length;
  const items = [
    { page: 'Watchlist', icon: Star, value: watch.length, label: 'On your watchlist', note: 'Your research universe' },
    { page: 'Alerts', icon: Bell, value: triggered || alerts.filter(alert => !alert.triggered).length, label: triggered ? 'Triggered alerts' : 'Active price alerts', note: triggered ? 'Ready for your review' : 'Follow your key levels', attention: triggered > 0 },
    { page: 'Journal', icon: BookOpen, value: plans, label: 'Plans to review', note: 'Keep your process consistent' },
  ];
  return <div className="workspace-summary" aria-label="Your research activity">{items.map(({ page, icon: Icon, value, label, note, attention }) => <button key={page} onClick={() => onPage(page)} className={attention ? 'needs-attention' : ''}>
    <span className="summary-icon"><Icon size={18} /></span><span className="summary-copy"><span>{label}</span><small>{note}</small></span><strong>{value}</strong><ArrowUpRight size={15} />
  </button>)}</div>;
}

export default function ResearchBrief({ data, loading, error, onPage, onRefresh, recent = [], onOpen, onSearch }) {
  const metrics = data?.metrics || overviewMetrics(data?.rows);
  const viewed = [...new Set(recent)].filter(symbol => directory.has(symbol)).slice(0, 3);
  const percent = metrics.risingPercent;
  return <div className="research-brief-grid">
    <section className="panel breadth-panel" aria-label="Market breadth">
      <div className="brief-heading"><div><span className="eyebrow">BEYOND THE INDEX</span><h2>How broad is the move?</h2></div><button className="link" onClick={() => onPage('Markets')}>Market pulse <ArrowUpRight size={14} /></button></div>
      {!data || !metrics.known ? <div className="breadth-unavailable" role="status"><ChartNoAxesCombined size={28} /><div><strong>{loading ? 'Reading market breadth…' : 'Market breadth is unavailable'}</strong><p>{loading ? 'Checking participation across the Nifty 500.' : 'Your saved research is still ready to explore.'}</p></div>{!loading && <button className="button" onClick={onRefresh}>Retry</button>}</div> : <>
        <div className="breadth-content">
          <div className="breadth-ring" role="img" aria-label={`${Math.round(percent)}% of ${metrics.known} stocks with session changes are rising`}>
            <svg viewBox="0 0 104 104" aria-hidden="true"><circle className="ring-track" cx="52" cy="52" r="43" /><circle className="ring-value" cx="52" cy="52" r="43" pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 52 52)" /></svg><div><strong>{Math.round(percent)}<small>%</small></strong><span>advancing</span></div>
          </div>
          <div className="breadth-participation"><div className="breadth-counts"><span><i className="positive-dot" /><strong>{metrics.rising}</strong> advancing</span><span><i className="negative-dot" /><strong>{metrics.falling}</strong> declining</span><span><i /><strong>{metrics.flat}</strong> unchanged</span></div><div className="breadth-bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /><i style={{ width: `${metrics.falling / metrics.known * 100}%` }} /></div><p>{metrics.known} of {metrics.total} stocks with a session change</p></div>
          <div className="breadth-trends">{[['Above 50-day average', metrics.medium], ['Above 200-day average', metrics.long]].map(([label, metric]) => <div key={label}><span>{label}<strong>{metric.percent === null ? '—' : `${Math.round(metric.percent)}%`}</strong></span><div className="trend-track"><i style={{ width: `${metric.percent ?? 0}%` }} /></div><small>{metric.known ? `${metric.above} of ${metric.known} stocks` : 'Data unavailable'}</small></div>)}</div>
        </div>
        <div className="brief-source">{error ? 'Cached snapshot' : 'NSE daily snapshot'} · {data.date || 'Session date unavailable'}<span>Participation, not a forecast</span></div>
      </>}
    </section>
    <section className="panel resume-panel"><div className="brief-heading"><div><span className="eyebrow">YOUR RESEARCH</span><h2>{viewed.length ? 'Pick up where you left off' : 'Your next discovery starts here'}</h2></div></div>
      {viewed.length ? <div className="resume-list">{viewed.map(symbol => <button key={symbol} onClick={() => onOpen(symbol)}><span className="stock-monogram">{short(symbol).slice(0, 2)}</span><span><strong>{short(symbol)}</strong><small>{directory.get(symbol)?.name}</small></span><ArrowUpRight size={15} /></button>)}</div> : <div className="resume-empty"><ChartNoAxesCombined size={24} /><p>Explore a company’s chart, understand its trend, and build your thesis.</p></div>}
      <button className="resume-search" onClick={onSearch}>Explore a company <ArrowRight size={15} /></button>
    </section>
  </div>;
}
