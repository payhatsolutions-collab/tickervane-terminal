import { useEffect, useRef, useState } from 'react';
import { useFeed } from './hooks.js';
import { PRESETS, runScreen } from './screens.js';
import { breakoutInsight } from './researchAnalytics.js';
import { StockAnalytics } from './AdvancedAnalytics.jsx';
import CompanyBrief from './CompanyBrief.jsx';
import { Empty } from './ui.jsx';
import { fmt, pct } from './data.js';
import { rankedBreakouts } from './proExample.js';
import { ProPill } from './ProExample.jsx';

// `preview`: the reader has no Pro access, so `symbol` is the free example and every other company opens the paywall.
export default function BreakoutInsights({ symbol, refresh, onRefresh, onSelect, onOpen, onAlert, watch, toggleWatch, preview = false }) {
  const feed = useFeed('/api/market?op=screen', refresh);
  const [query, setQuery] = useState('');
  const [riskOpen, setRiskOpen] = useState(false);
  const article = useRef(null);
  const [readRequested, setReadRequested] = useState(false);
  // The preview lists companies in the home page's order, so the free example comes first.
  const matches = preview ? rankedBreakouts(feed.data?.rows) : runScreen(feed.data?.rows, PRESETS.find(p => p.id === 'breakout20'));
  const locked = row => preview && `${row.symbol}.NS` !== symbol;
  const rows = matches.filter(row => `${row.symbol} ${row.name}`.toLowerCase().includes(query.toLowerCase().trim()));
  const selected = feed.data?.rows?.find(row => `${row.symbol}.NS` === symbol);
  const insight = selected ? breakoutInsight(selected) : null;
  useEffect(() => {
    if (readRequested && selected) {
      article.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
      article.current?.focus({ preventScroll: true });
      setReadRequested(false);
    }
  }, [symbol, selected, readRequested]);
  const select = value => { setReadRequested(true); onSelect(value); };
  return <div className="breakout-research-layout">
    <aside className="panel breakout-directory" aria-label="Breakout companies">
      <div className="breakout-directory-heading"><div><span className="eyebrow">DISCOVER</span><h2>Breakouts <small>{matches.length}</small></h2></div><button className="button" onClick={onRefresh}>Refresh</button></div>
      <p className="company-data-note">20-day high · volume ≥ 1.3× · Session {feed.data?.date || 'unavailable'}{feed.error && feed.data ? ' · cached snapshot' : ''}</p>
      <div className="breakout-desktop-list"><input aria-label="Find a breakout stock" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a company…" /></div>
      {feed.loading && !feed.data ? <p role="status">Finding confirmed breakouts…</p> : !feed.data ? <Empty title="Breakout data unavailable" description={feed.error} /> : !rows.length ? <p className="muted">{matches.length ? 'No matching companies.' : 'No confirmed breakouts in this snapshot.'}</p> : <>
        <label className="breakout-mobile-picker">Choose company<select value={matches.some(row => `${row.symbol}.NS` === symbol) ? symbol : ''} onChange={e => select(e.target.value)}><option value="" disabled>Select a breakout company</option>{matches.map(row => <option key={row.symbol} value={`${row.symbol}.NS`}>{row.symbol} · {row.name}{locked(row) ? ' · Pro' : ''}</option>)}</select></label>
        <div className="breakout-compact-list breakout-desktop-list">{rows.map(row => <button key={row.symbol} className={symbol === `${row.symbol}.NS` ? 'selected' : ''} aria-pressed={symbol === `${row.symbol}.NS`} onClick={() => select(`${row.symbol}.NS`)}><span><strong>{row.symbol}{locked(row) && <ProPill />}</strong><b>{pct(row.change)}</b></span><small>{row.name}</small><span className="muted"><small>{fmt(row.price)} INR</small><small>{fmt(row.volRatio, 1)}× vol</small></span></button>)}</div>
      </>}
    </aside>
    <div className="breakout-company-column">
      {selected ? <article ref={article} tabIndex={-1} className="panel research-tools stock-insight company-article" aria-label={`${selected.symbol} stock insight`}>
        <header className="company-article-heading"><div><span className="eyebrow">COMPANY RESEARCH · {selected.symbol}</span><h2>{selected.name}</h2><p>{selected.industry} <span className={insight.confirmed ? 'positive' : 'muted'}>· {insight.confirmed ? 'Confirmed breakout' : 'Not currently confirmed'}</span></p></div><div className="company-session-price"><strong>{fmt(selected.price)} <small>INR</small></strong><span>{pct(selected.change)} · session close</span></div></header>
        <div className="company-toolbar"><button className="button primary" onClick={() => onOpen(symbol)}>Open chart & plan</button><button className="button" onClick={() => onAlert(symbol)}>Set price alert</button><button className="button" onClick={() => toggleWatch(symbol)}>{watch.includes(symbol) ? 'Remove from watchlist' : 'Add to watchlist'}</button></div>
        <CompanyBrief key={symbol} symbol={symbol} industry={selected.industry} refresh={refresh} />
        <details className="company-technical"><summary>Breakout evidence & risks · session {feed.data.date}</summary><h3>What the data shows</h3>{insight.observations.map(text => <p key={text}>{text}</p>)}<h3>What could weaken the setup</h3><ul>{insight.cautions.map(text => <li key={text}>{text}</li>)}</ul><p className="company-data-note">{feed.data.source} · <a href="/screens/20-day-breakout.html">Breakout methodology</a>. Research, not a recommendation.</p></details>
      </article> : <section className="panel research-tools"><h2>Company research</h2><p>{feed.data ? 'Choose a breakout company to explore its business, financial performance, valuation and growth prospects.' : 'Loading the research universe…'}</p>{feed.error && <p className="negative">{feed.error}</p>}</section>}
      {selected && <details className="panel company-risk-details" onToggle={event => setRiskOpen(event.currentTarget.open)}><summary>Historical risk analytics · drawdown, volatility & Nifty comparison</summary>{riskOpen && <StockAnalytics key={symbol} symbol={symbol} refresh={refresh} />}</details>}
    </div>
  </div>;
}
