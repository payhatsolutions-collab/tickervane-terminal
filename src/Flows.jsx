import { useMemo, useState } from 'react';
import { Download, Info, ChevronRight, RefreshCw, Star } from 'lucide-react';
import { useFeed } from './hooks';
import { fmt, compact } from './data';
import { Empty, PanelTitle, SortTh, exportCSV, sortRows, tone } from './ui';

// Institutional flows: FII/DII cash (NSE API, best-effort), participant-wise
// derivatives positioning and bulk/block deals (NSE archives).
const dateLabel = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const cr = v => Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}₹${fmt(Math.abs(v), 0)} Cr` : '—';
const signed = v => Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${compact(Math.abs(v))}` : '—';

function CashFlows({ data, loading, error }) {
  const cash = data?.cash;
  const total = cash ? cash.fii.net + cash.dii.net : null;
  const card = (label, x) => <div className={`radar-card ${tone(x?.net)}`}><span>{label}</span><strong>{cr(x?.net)}</strong><small>{x ? `Buy ₹${fmt(x.buy, 0)} Cr · Sell ₹${fmt(x.sell, 0)} Cr` : ''}</small></div>;
  return <div className="flow-block">
    <h3>Cash market <small className="muted">{cash?.date ? `provisional · ${dateLabel(cash.date)}` : ''}</small></h3>
    {loading && !data ? <div className="loading">Loading FII/DII flows…</div>
      : !cash ? <p className="notice">{data?.cashError || error || 'FII/DII cash data is unavailable.'} NSE publishes it at <a href="https://www.nseindia.com/reports/fii-dii" target="_blank" rel="noreferrer">nseindia.com/reports/fii-dii</a>. Derivatives positioning below comes from the NSE archive.</p>
      : <div className="radar-summary flow-cards">{card('FII / FPI net', cash.fii)}{card('DII net', cash.dii)}<div className={`radar-card ${tone(total)}`}><span>Combined</span><strong>{cr(total)}</strong><small>{Math.sign(cash.fii.net) !== Math.sign(cash.dii.net) ? 'FIIs and DIIs on opposite sides' : 'Both on the same side'}</small></div></div>}
  </div>;
}

function Positioning({ data }) {
  const p = data?.participants;
  if (!p) return <div className="flow-block"><h3>Derivatives positioning</h3><p className="notice">{data?.participantsError || 'Participant-wise open interest is unavailable.'}</p></div>;
  const cols = [['futIdx', 'Index futures'], ['idxCall', 'Index calls'], ['idxPut', 'Index puts'], ['futStk', 'Stock futures']];
  return <div className="flow-block">
    <h3>Derivatives positioning <small className="muted">net contracts · {dateLabel(p.date)}{p.previousDate ? ` vs ${dateLabel(p.previousDate)}` : ''}</small></h3>
    <div className="table-wrap"><table className="positioning"><thead><tr><th>Participant</th><th title="Share of index-futures OI held long">Index fut. long %</th>{cols.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead><tbody>
      {['FII', 'DII', 'Pro', 'Client'].map(k => { const r = p.rows[k]; return <tr key={k}>
        <td><strong>{k}</strong></td>
        <td className="number"><span className="long-share"><i style={{ width: `${r.futIdxLongPct}%` }} />{fmt(r.futIdxLongPct, 1)}%</span></td>
        {cols.map(([c]) => <td key={c} className={`number ${tone(r[c])}`}>{signed(r[c])}<small className={tone(r.change?.[c])}>{r.change ? ` ${signed(r.change[c])}` : ''}</small></td>)}
      </tr>; })}
    </tbody></table></div>
    <details className="signal-explainer radar-help"><summary><Info size={14} /> Reading participant OI <ChevronRight size={14} /></summary><div>
      <p>Net = long minus short open contracts at the close; the small figure is the change since the previous session. For options, net long calls and net long puts are shown separately because buying puts is bearish exposure while writing puts is bullish.</p>
      <p>Every contract has a long and a short side, so the four groups always sum to zero. A low FII long share in index futures is a positioning fact, not a forecast.</p>
    </div></details>
    <div className="panel-foot">Source: <a href={p.sourceUrl} target="_blank" rel="noreferrer">NSE participant-wise open interest</a> · published after the close</div>
  </div>;
}

function Deals({ onOpen, refresh, watch, toggleWatch }) {
  const { data, loading, error } = useFeed('/api/market?op=deals', refresh);
  const [kind, setKind] = useState('All');
  const [side, setSide] = useState('All');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(['valueCr', -1]);
  const [limit, setLimit] = useState(50);
  const watchSet = useMemo(() => new Set((watch || []).filter(s => s.endsWith('.NS')).map(s => s.slice(0, -3))), [watch]);
  const rows = useMemo(() => { const needle = q.trim().toUpperCase(); return sortRows((data?.rows || []).filter(r => (kind === 'All' || r.kind === kind) && (side === 'All' || r.side === side.toUpperCase()) && (!needle || r.symbol.includes(needle) || r.client.toUpperCase().includes(needle) || r.name.toUpperCase().includes(needle))), sort); }, [data, kind, side, q, sort]);
  const hits = (data?.rows || []).filter(r => watchSet.has(r.symbol));
  const buy = rows.filter(r => r.side === 'BUY').reduce((t, r) => t + r.valueCr, 0), sell = rows.filter(r => r.side === 'SELL').reduce((t, r) => t + r.valueCr, 0);
  return <section className="panel deals-panel">
    <PanelTitle title="Bulk & block deals" tag="DEAL"><span className="muted small radar-date">{data?.date ? dateLabel(data.date) : ''}</span>
      <button className="button" disabled={!rows.length} onClick={() => exportCSV([['Date', 'Type', 'Symbol', 'Security', 'Client', 'Side', 'Quantity', 'Price', 'Value ₹ Cr'], ...rows.map(r => [r.date, r.kind, r.symbol, r.name, r.client, r.side, r.qty, r.price, r.valueCr])], `nse-deals-${data?.date || ''}.csv`)}><Download size={14} /> Export</button>
    </PanelTitle>
    {hits.length > 0 && <div className="radar-watch"><Star size={13} /> <strong>Your watchlist:</strong> {[...new Set(hits.map(r => r.symbol))].slice(0, 8).map(s => <button key={s} className="link" onClick={() => onOpen(s + '.NS')}>{s}</button>)}</div>}
    <div className="screen-filters radar-filters">
      {['All', 'Block', 'Bulk'].map(k => <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{k}</button>)}
      <select aria-label="Side" value={side} onChange={e => setSide(e.target.value)}>{['All', 'Buy', 'Sell'].map(s => <option key={s}>{s}</option>)}</select>
      <input aria-label="Filter deals" placeholder="Filter symbol or client…" value={q} onChange={e => setQ(e.target.value)} />
      <span className="muted small">{rows.length ? `Buys ₹${fmt(buy, 0)} Cr · sells ₹${fmt(sell, 0)} Cr` : ''}</span>
    </div>
    {loading && !data ? <div className="loading">Loading NSE deal files…</div>
      : error && !data ? <Empty title="Deals unavailable" description={error} />
      : !rows.length ? <Empty title="No deals match" description={data?.rows?.length ? 'Clear the filters to see every deal.' : 'NSE has not published deals for the latest session yet.'} />
      : <div className="table-wrap"><table><thead><tr>
        <SortTh k="symbol" sort={sort} setSort={setSort}>Stock</SortTh>
        <SortTh k="client" sort={sort} setSort={setSort}>Client</SortTh>
        <SortTh k="side" sort={sort} setSort={setSort}>Side</SortTh>
        <SortTh k="qty" sort={sort} setSort={setSort} className="hide-sm">Quantity</SortTh>
        <SortTh k="price" sort={sort} setSort={setSort} className="hide-sm">Price</SortTh>
        <SortTh k="valueCr" sort={sort} setSort={setSort}>Value</SortTh>
        <th><Star size={13} /></th>
      </tr></thead><tbody>{rows.slice(0, limit).map((r, i) => { const w = watchSet.has(r.symbol); return <tr key={`${r.kind}-${r.symbol}-${r.client}-${r.side}-${i}`}>
        <td><button className="instrument" onClick={() => onOpen(r.symbol + '.NS')}><strong>{r.symbol}</strong><span>{r.kind} · {r.name}</span></button></td>
        <td className="deal-client">{r.client}</td>
        <td><span className={`signal-chip ${r.side === 'BUY' ? 'positive' : 'negative'}`}>{r.side === 'BUY' ? 'Buy' : 'Sell'}</span></td>
        <td className="number hide-sm">{compact(r.qty)}</td>
        <td className="number hide-sm">{fmt(r.price)}</td>
        <td className="number">₹{fmt(r.valueCr, r.valueCr < 10 ? 2 : 0)} Cr</td>
        <td><button className={`icon-button ${w ? 'starred' : ''}`} aria-label={`${w ? 'Remove' : 'Add'} ${r.symbol} ${w ? 'from' : 'to'} watchlist`} onClick={() => toggleWatch(r.symbol + '.NS')}><Star size={14} fill={w ? 'currentColor' : 'none'} /></button></td>
      </tr>; })}</tbody></table>
        {rows.length > limit && <div className="more-row"><button className="button" onClick={() => setLimit(l => l + 100)}>Show more ({rows.length - limit} left)</button></div>}
      </div>}
    <div className="panel-foot">Bulk deals: one client trading over 0.5% of a company’s shares in a session. Block deals: single trades of ₹10 Cr+ in the block window. {data?.partial ? 'One deal file failed to load. ' : ''}Source: NSE bulk & block deal files, latest session only.</div>
  </section>;
}

export default function Flows({ onOpen, refresh, onRefresh, watch, toggleWatch }) {
  const flows = useFeed('/api/market?op=flows', refresh);
  return <>
    <section className="panel flows-panel">
      <PanelTitle title="Institutional flows" tag="FLOW"><button className="icon-button" aria-label="Refresh flows" title="Refresh" onClick={onRefresh}><RefreshCw size={14} className={flows.loading ? 'spin' : ''} /></button></PanelTitle>
      {flows.loading && !flows.data ? <div className="loading">Loading FII/DII flows and participant OI…</div> : flows.error && !flows.data ? <Empty title="Flow data unavailable" description={flows.error}><button className="button" onClick={onRefresh}>Retry</button></Empty> : <>
        <CashFlows data={flows.data} loading={flows.loading} error={flows.error} />
        <Positioning data={flows.data} />
      </>}
    </section>
    <Deals onOpen={onOpen} refresh={refresh} watch={watch} toggleWatch={toggleWatch} />
  </>;
}
