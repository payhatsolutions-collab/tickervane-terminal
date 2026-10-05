import React, { useState } from 'react';
import { ArrowUpRight, RefreshCw, Newspaper } from 'lucide-react';
import { useFeed } from './hooks.js';
import './news.css';

export default function News({ symbol, full = false, refresh = 0 }) {
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [publisher, setPublisher] = useState('');
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState('latest');
  const { data, loading, error } = useFeed(`/api/market?op=news&symbol=${encodeURIComponent(symbol)}`, `${refresh}:${retry}`);
  const all = data?.items || [];
  const publishers = [...new Set(all.map(n => n.source))].sort();
  const items = all.filter(n => (!full || ((!publisher || n.source === publisher) && (!kind || n.kind === kind) && n.title.toLowerCase().includes(query.toLowerCase().trim()))));
  if (full && sort === 'latest') items.sort((a,b) => (Date.parse(b.date)||0)-(Date.parse(a.date)||0));
  const reset = () => { setQuery(''); setPublisher(''); setKind(''); };
  return <section className={`panel news-panel ${full ? 'full-news' : ''}`} aria-busy={loading}>
    <div className="panel-title"><div><Newspaper size={17}/><h2>{full ? 'Market newswire' : 'Company news'}</h2><span className="muted">{symbol.replace(/\.NS$/, '')}</span></div>
      <button className="button" onClick={() => setRetry(n => n + 1)} disabled={loading}><RefreshCw size={14}/>{loading ? 'Refreshing…' : 'Refresh news'}</button>
    </div>
    {full && <div className="news-tools">
      <label>Search headlines<input type="search" placeholder="Earnings, RBI, oil…" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <label>Publisher<select value={publisher} onChange={e => setPublisher(e.target.value)}><option value="">All publishers</option>{publishers.map(p => <option key={p}>{p}</option>)}</select></label>
      <label>Story type<select value={kind} onChange={e => setKind(e.target.value)}><option value="">All stories</option><option value="event">Material events</option><option value="filing">Company filings</option><option value="market">Market headlines</option></select></label>
      <label>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="latest">Latest first</option><option value="relevance">Material events first</option></select></label>
    </div>}
    <div className="news-status" role="status">
      {error ? (data ? 'Refresh failed. Showing previously loaded headlines. ' : error) : data?.failedSources?.length ? `Some feeds unavailable (${data.failedSources.join(', ')}). Showing available coverage.` : loading ? 'Checking news sources…' : `${items.length} headlines · ${publishers.length} publishers`}
      {data?.fetchedAt && <span>Last checked {new Date(data.fetchedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>}
    </div>
    {!data && loading ? <div className="loading">Loading headlines…</div> : !items.length ? <div className="empty"><Newspaper size={28}/><h3>{error ? 'News temporarily unavailable' : all.length ? 'No matching headlines' : 'No recent headlines'}</h3><p>{all.length ? 'Try another keyword or clear your filters.' : 'Refresh to try again, or choose another market or company.'}</p>{all.length > 0 && <button className="button" onClick={reset}>Clear filters</button>}</div> : <div className="news-list">
      {items.slice(0,full ? 60 : 5).map(n => <a key={n.url} href={n.url} target="_blank" rel="noopener noreferrer">
        <div className="news-meta"><span>{n.source}</span><time dateTime={Number.isFinite(Date.parse(n.date)) ? new Date(n.date).toISOString() : undefined}>{Number.isFinite(Date.parse(n.date)) ? new Date(n.date).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Date unavailable'}</time></div>
        <h3>{n.title}<ArrowUpRight size={14}/></h3>
        {n.kind !== 'market' && <span className={`news-kind ${n.kind}`}>{n.kind === 'filing' ? 'Company filing' : 'Material event'}</span>}
      </a>)}
    </div>}
    <div className="panel-foot">Headlines link to the original publisher · Coverage may be delayed</div>
  </section>;
}
