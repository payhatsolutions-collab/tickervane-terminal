import { useEffect, useMemo, useState } from 'react';
import { Download, Info, ChevronRight, RefreshCw } from 'lucide-react';
import { useFeed, useSaved, useQuotes } from './hooks';
import LatestQuote from './LatestQuote.jsx';
import { fmt, pct, compact } from './data';
import { Empty, PanelTitle, SortTh, exportCSV, sortRows, tone } from './ui';

// End-of-day derivatives from NSE's F&O bhavcopy: option chain per underlying and
// expiry, plus futures OI build-up. Published after the close; never intraday.
const INDEX_YAHOO = { NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK', FINNIFTY: 'NIFTY_FIN_SERVICE.NS' };
const fromTerminal = s => s === '^NSEI' ? 'NIFTY' : s === '^NSEBANK' ? 'BANKNIFTY' : s === 'NIFTY_FIN_SERVICE.NS' ? 'FINNIFTY' : s?.endsWith('.NS') ? s.slice(0, -3) : null;
const yahooOf = s => INDEX_YAHOO[s] || `${s}.NS`;
const dateLabel = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const BUILDUP = [['Long build-up', 'positive', 'Price up, open interest up — fresh longs'], ['Short build-up', 'negative', 'Price down, open interest up — fresh shorts'], ['Short covering', 'accent', 'Price up, open interest down — shorts exiting'], ['Long unwinding', '', 'Price down, open interest down — longs exiting']];
const signalTone = s => BUILDUP.find(b => b[0] === s)?.[1] || 'muted';

function OIBar({ value, max, side }) {
  const w = max > 0 && value > 0 ? Math.min(100, value / max * 100) : 0;
  return <span className={`oi-bar ${side}`}><i style={{ width: `${w}%` }} />{compact(value)}</span>;
}

function OptionChain({ symbol, onOpen, refresh, onRefresh }) {
  const [u, setU] = useSaved('an2-fno-symbol', 'NIFTY');
  const [expiry, setExpiry] = useState('');
  const [width, setWidth] = useState(12);
  const [known, setKnown] = useState([]);
  const { data, loading, error } = useFeed(`/api/market?op=options&symbol=${encodeURIComponent(u)}${expiry ? `&expiry=${expiry}` : ''}`, refresh);
  useEffect(() => { if (data?.symbols?.length) setKnown(data.symbols); }, [data]);
  const pick = s => { setU(s); setExpiry(''); };
  const current = fromTerminal(symbol);
  const latest = useQuotes([yahooOf(u)], refresh);
  const rows = useMemo(() => {
    const all = data?.rows || [];
    const i = all.findIndex(r => r.strike === data?.atm);
    return i < 0 || width === 0 ? all : all.slice(Math.max(0, i - width), i + width + 1);
  }, [data, width]);
  const max = Math.max(1, ...rows.flatMap(r => [r.CE?.oi || 0, r.PE?.oi || 0]));
  const maxChg = Math.max(1, ...rows.flatMap(r => [Math.abs(r.CE?.chg || 0), Math.abs(r.PE?.chg || 0)]));
  const d = data && data.symbol === u ? data : null;
  const cell = (s, k) => s ? s[k] : null;

  return <section className="panel chain-panel">
    <p className="muted small">Latest underlying · {u}: <LatestQuote quote={latest.quotes[yahooOf(u)]} /> · refreshes every 30s, may be delayed. Option premiums below are end-of-day.</p>
    <PanelTitle title="Option chain" tag="OPT">
      <span className="muted small radar-date">{d ? `EOD ${dateLabel(d.date)}` : ''}</span>
      <button className="icon-button" aria-label="Refresh option chain" title="Refresh" onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
      <button className="button" disabled={!d} onClick={() => exportCSV([['Strike', 'CE OI', 'CE OI chg', 'CE close', 'CE volume', 'PE close', 'PE OI chg', 'PE OI', 'PE volume'], ...(d?.rows || []).map(r => [r.strike, cell(r.CE, 'oi'), cell(r.CE, 'chg'), cell(r.CE, 'close'), cell(r.CE, 'vol'), cell(r.PE, 'close'), cell(r.PE, 'chg'), cell(r.PE, 'oi'), cell(r.PE, 'vol')])], `option-chain-${u}-${d?.expiry || ''}.csv`)}><Download size={14} /> Export</button>
    </PanelTitle>
    <div className="screen-filters chain-filters">
      {['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].map(s => <button key={s} className={u === s ? 'active' : ''} onClick={() => pick(s)}>{s}</button>)}
      <select aria-label="Underlying" value={u} onChange={e => pick(e.target.value)}>{(known.length ? known : [u]).map(s => <option key={s}>{s}</option>)}</select>
      <select aria-label="Expiry" value={d?.expiry || expiry} onChange={e => setExpiry(e.target.value)}>{(d?.expiries || []).map(x => <option key={x} value={x}>{dateLabel(x)}</option>)}</select>
      <select aria-label="Strikes shown" value={width} onChange={e => setWidth(Number(e.target.value))}>{[[8, '±8 strikes'], [12, '±12 strikes'], [20, '±20 strikes'], [0, 'All strikes']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {current && current !== u && known.includes(current) && <button onClick={() => pick(current)}>Use {current}</button>}
    </div>
    {d && <div className="radar-summary chain-summary">
      <div className="radar-card"><span>Spot · {d.daysToExpiry}d to expiry</span><strong>{fmt(d.spot)}</strong><small>ATM {fmt(d.atm, 0)} · lot {d.lot ?? '—'}</small></div>
      <div className={`radar-card ${d.pcr >= 1 ? 'positive' : d.pcr < 0.7 ? 'negative' : ''}`}><span>Put/call ratio (OI)</span><strong>{fmt(d.pcr)}</strong><small>Today’s OI added: {d.pcrChange == null ? '—' : fmt(d.pcrChange)}</small></div>
      <div className="radar-card accent"><span>Max pain</span><strong>{fmt(d.maxPain, 0)}</strong><small>{d.spot ? `${pct((d.maxPain / d.spot - 1) * 100)} from spot` : ''}</small></div>
      <div className="radar-card"><span>Call wall · put wall</span><strong>{fmt(d.callWall, 0)} · {fmt(d.putWall, 0)}</strong><small>Most OI added: {fmt(d.callAdd, 0)} CE · {fmt(d.putAdd, 0)} PE</small></div>
      <div className="radar-card"><span>Straddle-implied move</span><strong>{d.straddle ? `±${fmt(d.straddle)}` : '—'}</strong><small>{d.movePct ? `±${fmt(d.movePct)}% by expiry` : 'ATM premiums unavailable'}</small></div>
    </div>}
    {loading && !d ? <div className="loading">Loading NSE F&O bhavcopy…</div>
      : error && !d ? <Empty title="Option chain unavailable" description={error}><button className="button" onClick={() => pick('NIFTY')}>Show NIFTY</button></Empty>
      : <div className="table-wrap chain-wrap"><table className="chain-table"><thead><tr>
        <th>Calls OI</th><th>OI chg</th><th className="hide-sm">Volume</th><th>Close</th><th className="strike">Strike</th><th>Close</th><th className="hide-sm">Volume</th><th>OI chg</th><th>Puts OI</th>
      </tr></thead><tbody>
        {rows.map(r => { const atm = r.strike === d.atm, ceItm = d.spot && r.strike < d.spot, peItm = d.spot && r.strike > d.spot; return <tr key={r.strike} className={atm ? 'atm' : ''}>
          <td className={`number ${ceItm ? 'itm' : ''}`}><OIBar value={r.CE?.oi} max={max} side="ce" /></td>
          <td className={`number ${ceItm ? 'itm' : ''} ${tone(r.CE?.chg)}`}><span className="chg-bar"><i className={(r.CE?.chg || 0) >= 0 ? 'up' : 'down'} style={{ width: `${Math.abs(r.CE?.chg || 0) / maxChg * 100}%` }} />{r.CE ? compact(r.CE.chg) : '—'}</span></td>
          <td className={`number hide-sm ${ceItm ? 'itm' : ''}`}>{compact(r.CE?.vol)}</td>
          <td className={`number ${ceItm ? 'itm' : ''}`}>{fmt(r.CE?.close)}<small className={tone(r.CE?.chgPct)}>{r.CE?.chgPct != null && Math.abs(r.CE.chgPct) < 1000 ? pct(r.CE.chgPct) : ''}</small></td>
          <td className="number strike"><strong>{fmt(r.strike, r.strike % 1 ? 2 : 0)}</strong>{r.strike === d.maxPain && <small>max pain</small>}</td>
          <td className={`number ${peItm ? 'itm' : ''}`}>{fmt(r.PE?.close)}<small className={tone(r.PE?.chgPct)}>{r.PE?.chgPct != null && Math.abs(r.PE.chgPct) < 1000 ? pct(r.PE.chgPct) : ''}</small></td>
          <td className={`number hide-sm ${peItm ? 'itm' : ''}`}>{compact(r.PE?.vol)}</td>
          <td className={`number ${peItm ? 'itm' : ''} ${tone(r.PE?.chg)}`}><span className="chg-bar"><i className={(r.PE?.chg || 0) >= 0 ? 'up' : 'down'} style={{ width: `${Math.abs(r.PE?.chg || 0) / maxChg * 100}%` }} />{r.PE ? compact(r.PE.chg) : '—'}</span></td>
          <td className={`number ${peItm ? 'itm' : ''}`}><OIBar value={r.PE?.oi} max={max} side="pe" /></td>
        </tr>; })}
      </tbody></table></div>}
    <div className="panel-foot">{d ? <>OI and volume in contracts · shaded strikes are in the money · {INDEX_YAHOO[d.symbol] || !/NIFTY/.test(d.symbol) ? <><button className="link" onClick={() => onOpen(yahooOf(d.symbol))}>Open {d.symbol} chart</button> · </> : null}source: <a href={d.sourceUrl} target="_blank" rel="noreferrer">NSE F&O bhavcopy</a> · end of day, published after ~18:00 IST</> : 'Source: NSE F&O bhavcopy'}</div>
  </section>;
}

function Buildup({ onOpen, refresh, watch }) {
  const { data, loading, error } = useFeed('/api/market?op=futures', refresh);
  const [signal, setSignal] = useState('All');
  const [scope, setScope] = useState('Stocks');
  const [minValue, setMinValue] = useState(100);
  const [sort, setSort] = useState(['absOi', -1]);
  const [limit, setLimit] = useState(40);
  const [q, setQ] = useState('');
  const watchSet = useMemo(() => new Set((watch || []).map(s => fromTerminal(s)).filter(Boolean)), [watch]);
  const base = useMemo(() => (data?.rows || []).map(r => ({ ...r, absOi: Math.abs(r.oiPct ?? 0) })).filter(r => (scope === 'Indices' ? r.index : scope === 'Watchlist' ? watchSet.has(r.symbol) : !r.index) && (r.index || (r.oiValueCr ?? 0) >= minValue)), [data, scope, minValue, watchSet]);
  const counts = useMemo(() => Object.fromEntries(BUILDUP.map(([k]) => [k, base.filter(r => r.signal === k).length])), [base]);
  const rows = useMemo(() => { const needle = q.trim().toUpperCase(); return sortRows(base.filter(r => (signal === 'All' || r.signal === signal) && (!needle || r.symbol.includes(needle))), sort); }, [base, signal, sort, q]);
  const latest = useQuotes(rows.slice(0, limit).map(r => yahooOf(r.symbol)), refresh);
  return <section className="panel buildup-panel">
    <PanelTitle title="Futures OI build-up" tag="FUT"><span className="muted small radar-date">{data ? `EOD ${dateLabel(data.date)}` : ''}</span>
      <button className="button" disabled={!rows.length} onClick={() => exportCSV([['Symbol', 'Expiry', 'Close', 'Change %', 'Spot', 'Basis %', 'OI (contracts)', 'OI change', 'OI change %', 'OI value ₹ Cr', 'Signal'], ...rows.map(r => [r.symbol, r.expiry, r.close, r.change, r.spot, r.basisPct, r.oi, r.oiChg, r.oiPct, r.oiValueCr, r.signal])], `futures-buildup-${data?.date || ''}.csv`)}><Download size={14} /> Export</button>
    </PanelTitle>
    <div className="radar-summary">{BUILDUP.map(([k, cls, note]) => <button key={k} className={`radar-card ${cls} ${signal === k ? 'active' : ''}`} title={note} onClick={() => { setSignal(signal === k ? 'All' : k); setLimit(40); }}><span>{k}</span><strong>{loading && !data ? '…' : counts[k] ?? 0}</strong></button>)}</div>
    <div className="screen-filters radar-filters">
      {['Stocks', 'Indices', 'Watchlist'].map(s => <button key={s} className={scope === s ? 'active' : ''} onClick={() => setScope(s)}>{s}</button>)}
      <select aria-label="Minimum OI value" value={minValue} onChange={e => setMinValue(Number(e.target.value))} disabled={scope === 'Indices'}>{[0, 100, 500, 1000].map(v => <option key={v} value={v}>OI value ≥ ₹{v} Cr</option>)}</select>
      <input aria-label="Filter futures" placeholder="Filter symbol…" value={q} onChange={e => setQ(e.target.value)} />
    </div>
    {loading && !data ? <div className="loading">Loading NSE F&O bhavcopy…</div>
      : error && !data ? <Empty title="Futures data unavailable" description={error} />
      : !rows.length ? <Empty title="Nothing matches" description="Loosen the OI value filter or pick another signal." />
      : <div className="table-wrap"><table><thead><tr>
        <SortTh k="symbol" sort={sort} setSort={setSort}>Future</SortTh>
        <SortTh k="close" sort={sort} setSort={setSort}>Close</SortTh>
        <SortTh k="change" sort={sort} setSort={setSort}>Chg %</SortTh>
        <SortTh k="absOi" sort={sort} setSort={setSort} title="Change in open interest across all expiries">OI chg %</SortTh>
        <SortTh k="oi" sort={sort} setSort={setSort} className="hide-sm">OI</SortTh>
        <SortTh k="oiValueCr" sort={sort} setSort={setSort} className="hide-sm">OI value</SortTh>
        <SortTh k="basisPct" sort={sort} setSort={setSort} className="hide-sm" title="Near-month future versus underlying">Basis</SortTh>
        <SortTh k="signal" sort={sort} setSort={setSort}>Read</SortTh>
      </tr></thead><tbody>{rows.slice(0, limit).map(r => <tr key={r.symbol}>
        <td><button className="instrument" disabled={r.index && !INDEX_YAHOO[r.symbol]} onClick={() => onOpen(yahooOf(r.symbol))}><strong>{r.symbol}</strong><span>{dateLabel(r.expiry)} expiry</span></button></td>
        <td className="number">{fmt(r.close)}<small className="muted" style={{ display: 'block' }}>Latest underlying (may be delayed)</small><LatestQuote quote={latest.quotes[yahooOf(r.symbol)]} /></td>
        <td className={`number ${tone(r.change)}`}>{pct(r.change)}</td>
        <td className={`number ${tone(r.oiPct)}`}>{pct(r.oiPct)}<small className="muted"> {compact(r.oiChg)}</small></td>
        <td className="number hide-sm">{compact(r.oi)}</td>
        <td className="number hide-sm">₹{compact(r.oiValueCr)} Cr</td>
        <td className={`number hide-sm ${tone(r.basisPct)}`}>{pct(r.basisPct)}</td>
        <td><span className={`signal-chip ${signalTone(r.signal)}`}>{r.signal}</span></td>
      </tr>)}</tbody></table>
        {rows.length > limit && <div className="more-row"><button className="button" onClick={() => setLimit(l => l + 60)}>Show more ({rows.length - limit} left)</button></div>}
      </div>}
    <details className="signal-explainer radar-help"><summary><Info size={14} /> Reading build-up <ChevronRight size={14} /></summary><div>
      <p>Open interest is summed across all live expiries, so month-end rollover does not look like fresh positions. Price change is the near-month future versus its previous close.</p>
      <p>{BUILDUP.map(b => `${b[0]}: ${b[2].toLowerCase()}.`).join(' ')} These labels describe what changed, not who traded or what happens next.</p>
    </div></details>
    <div className="panel-foot">{data ? <>{data.rows.length} futures underlyings · source: <a href={data.sourceUrl} target="_blank" rel="noreferrer">NSE F&O bhavcopy</a></> : 'Source: NSE F&O bhavcopy'}</div>
  </section>;
}

export default function FnO({ symbol, onOpen, refresh, onRefresh, watch }) {
  return <>
    <OptionChain symbol={symbol} onOpen={onOpen} refresh={refresh} onRefresh={onRefresh} />
    <Buildup onOpen={onOpen} refresh={refresh} watch={watch} />
  </>;
}
