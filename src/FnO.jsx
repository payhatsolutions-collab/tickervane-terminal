import { useEffect, useMemo, useState } from 'react';
import { Download, Info, ChevronRight, RefreshCw, TrendingUp, TrendingDown, ArrowLeftRight } from 'lucide-react';
import { useFeed, useSaved, useQuotes } from './hooks';
import LatestQuote from './LatestQuote.jsx';
import { fmt, pct, compact } from './data';
import { Empty, PanelTitle, SortTh, exportCSV, sortRows, tone } from './ui';

import { optionFreshness } from './optionSignal.js';
import './fno.css';

// Live NSE option chain; the broad futures scanner is explicitly end-of-day.
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

function useDerivativeRefresh() {
  const [tick, setTick] = useState(0);
  const [auto, setAuto] = useState(true);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 10000);
    const poll = setInterval(() => { if (auto && document.visibilityState === 'visible') setTick(n => n + 1); }, 30000);
    const resume = () => { setNow(Date.now()); if (auto && document.visibilityState === 'visible') setTick(n => n + 1); };
    document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(clock); clearInterval(poll); document.removeEventListener('visibilitychange', resume); };
  }, [auto]);
  return { tick, setTick, auto, setAuto, now };
}

function OptionChain({ symbol, onOpen, refresh, onRefresh }) {
  const [u, setU] = useSaved('an2-fno-symbol', 'NIFTY');
  const [expiry, setExpiry] = useState('');
  const [width, setWidth] = useState(12);
  const [known, setKnown] = useState([]);
  const { tick, setTick, auto, setAuto, now } = useDerivativeRefresh();
  const { data, loading, error } = useFeed(`/api/market?op=options&symbol=${encodeURIComponent(u)}${expiry ? `&expiry=${expiry}` : ''}`, `${refresh}:${tick}`);
  useEffect(() => { if (data?.symbols?.length) setKnown(data.symbols); }, [data]);
  const pick = s => { setU(s); setExpiry(''); };
  const current = fromTerminal(symbol);
  const d = data && data.symbol === u && (!expiry || data.expiry === expiry) ? data : null;
  const freshness = error ? 'unavailable' : optionFreshness(d?.asOf, now);
  const usable = d && ['live', 'snapshot'].includes(freshness);
  const signal = usable ? d.signal : null;
  const direction = signal?.label || 'Unavailable';
  const directionTone = direction === 'Bullish' ? 'positive' : direction === 'Bearish' ? 'negative' : direction === 'Range' ? 'accent' : 'muted';
  const SignalIcon = direction === 'Bullish' ? TrendingUp : direction === 'Bearish' ? TrendingDown : ArrowLeftRight;
  const retry = () => { setTick(n => n + 1); onRefresh?.(); };
  const rows = useMemo(() => {
    const all = d?.rows || [];
    const i = all.findIndex(r => r.strike === d?.atm);
    return i < 0 || width === 0 ? all : all.slice(Math.max(0, i - width), i + width + 1);
  }, [d, width]);
  const max = Math.max(1, ...rows.flatMap(r => [r.CE?.oi || 0, r.PE?.oi || 0]));
  const maxChg = Math.max(1, ...rows.flatMap(r => [Math.abs(r.CE?.chg || 0), Math.abs(r.PE?.chg || 0)]));
  const cell = (s, k) => s ? s[k] : null;

  return <section className="panel chain-panel">

    <PanelTitle title="NSE option chain" tag="OPT">
      <span className={`fno-feed-status ${freshness === 'live' ? 'positive' : 'muted'}`}>{loading && !d ? 'Connecting to NSE' : freshness === 'live' ? '● Live NSE' : freshness === 'snapshot' ? 'Session snapshot' : freshness === 'stale' ? 'Stale data' : 'Feed unavailable'}</span>
      <button className="icon-button" aria-label="Refresh option chain" title="Refresh" onClick={retry}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
      <button className="button" disabled={!d} onClick={() => exportCSV([['Symbol', 'Expiry', 'NSE timestamp IST', 'Strike', 'CE OI', 'CE OI chg', 'CE LTP', 'CE volume', 'PE LTP', 'PE OI chg', 'PE OI', 'PE volume'], ...(d?.rows || []).map(r => [u, d.expiry, d.exchangeTimestamp, r.strike, cell(r.CE, 'oi'), cell(r.CE, 'chg'), cell(r.CE, 'close'), cell(r.CE, 'vol'), cell(r.PE, 'close'), cell(r.PE, 'chg'), cell(r.PE, 'oi'), cell(r.PE, 'vol')])], `option-chain-${u}-${d?.expiry || ''}.csv`)}><Download size={14} /> Export</button>
    </PanelTitle>
    <div className="screen-filters chain-filters">
      {['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].map(s => <button key={s} className={u === s ? 'active' : ''} onClick={() => pick(s)}>{s}</button>)}
      <select aria-label="Underlying" value={u} onChange={e => pick(e.target.value)}>{([...new Set([u, ...known])]).map(s => <option key={s}>{s}</option>)}</select>
      <select aria-label="Expiry" disabled={!d} value={d?.expiry || expiry} onChange={e => setExpiry(e.target.value)}>{(d?.expiries || []).map(x => <option key={x} value={x}>{dateLabel(x)}</option>)}</select>
      <select aria-label="Strikes shown" value={width} onChange={e => setWidth(Number(e.target.value))}>{[[8, '±8 strikes'], [12, '±12 strikes'], [20, '±20 strikes'], [0, 'All strikes']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <button className={auto ? 'active' : ''} aria-pressed={auto} onClick={() => setAuto(v => !v)}>Auto-refresh {auto ? '30s' : 'off'}</button>
      {current && current !== u && known.includes(current) && <button onClick={() => pick(current)}>Use {current}</button>}
    </div>
    <div className={`fno-signal ${directionTone}`} aria-live="polite">
      <div className="fno-signal-heading"><span className="fno-eyebrow">{u} · {freshness === 'snapshot' ? 'Last-session positioning' : 'Positioning signal'}</span><h2><SignalIcon size={28} />{loading && !d ? 'Reading the chain…' : direction}</h2><p>{signal?.label === 'Range' ? 'Mixed or balanced positioning. No clear directional edge.' : signal?.label === 'Bullish' ? 'The option-chain factors lean to the upside.' : signal?.label === 'Bearish' ? 'The option-chain factors lean to the downside.' : 'A signal needs fresh, complete NSE data.'}</p></div>
      <div className="fno-signal-evidence">{signal?.reasons?.map(reason => <p key={reason}>{reason}</p>)}{d && <small>Exchange: {d.exchangeTimestamp} IST · expiry {dateLabel(d.expiry)}{freshness === 'snapshot' ? ' · outside regular trading hours; not a live call' : ''}</small>}{!d && <small>NSE prices, open interest and expiry from the same snapshot.</small>}</div>
      <div className="fno-levels"><div><span>Put OI support</span><strong>{fmt(signal?.support, 0)}</strong></div><div><span>Call OI resistance</span><strong>{fmt(signal?.resistance, 0)}</strong></div></div>
    </div>
    {(error || freshness === 'stale') && <div className="fno-notice" role="status">{error || 'The exchange timestamp is older than 3 minutes. Signal paused until NSE updates.'} {d ? 'The table shows the last received snapshot.' : ''} <button className="link" onClick={retry}>Retry NSE</button>{expiry && <button className="link" onClick={() => setExpiry('')}>Use nearest expiry</button>}</div>}
    <details className="signal-explainer radar-help"><summary><Info size={14} /> How the signal works <ChevronRight size={14} /></summary><div><p>Three votes: put/call OI ≥1.15 is bullish and ≤0.85 bearish; the net OI-change balance must exceed ±15% with activity of at least 1% of OI; spot ≥0.2% above max pain is bullish and ≥0.2% below is bearish. A net score of +2 or more is Bullish, −2 or less Bearish; otherwise Range.</p><p>OI votes and support/resistance use strikes within 3% of spot for the selected expiry. Max pain uses the full expiry. OI does not identify buyers or writers; this is an unvalidated positioning heuristic, not a probability or trade recommendation. Levels and premium-based moves are not guaranteed. Signals pause when data is missing or stale during regular hours (09:15–15:30 IST).</p></div></details>
    {d && <div className="radar-summary chain-summary">
      <div className="radar-card"><span>Spot · {d.daysToExpiry}d to expiry</span><strong>{fmt(d.spot)}</strong><small>ATM {fmt(d.atm, 0)} · NSE underlying</small></div>
      <div className={`radar-card ${d.pcr != null && d.pcr >= 1.15 ? 'positive' : d.pcr != null && d.pcr <= 0.85 ? 'negative' : ''}`}><span>Put/call ratio (OI)</span><strong>{fmt(d.pcr)}</strong><small>Net OI change PCR: {d.pcrChange == null ? '—' : fmt(d.pcrChange)}</small></div>
      <div className="radar-card accent"><span>Max pain</span><strong>{fmt(d.maxPain, 0)}</strong><small>{d.spot && d.maxPain ? `${pct((d.maxPain / d.spot - 1) * 100)} from spot` : ''}</small></div>
      <div className="radar-card"><span>Call wall · put wall</span><strong>{fmt(d.callWall, 0)} · {fmt(d.putWall, 0)}</strong><small>Most OI added: {fmt(d.callAdd, 0)} CE · {fmt(d.putAdd, 0)} PE</small></div>
      <div className="radar-card"><span>ATM premium move</span><strong>{d.straddle ? `±${fmt(d.straddle)}` : '—'}</strong><small>{d.movePct ? `±${fmt(d.movePct)}% by expiry` : 'ATM premiums unavailable'}</small></div>
    </div>}
    {loading && !d ? <div className="loading">Loading live NSE option chain…</div>
      : error && !d ? <Empty title="Option chain unavailable" description={error}><button className="button" onClick={retry}>Retry</button> <button className="button" onClick={() => pick('NIFTY')}>Show NIFTY</button></Empty>
      : <div className="table-wrap chain-wrap"><table className="chain-table"><thead><tr>
        <th>Calls OI</th><th>OI Δ</th><th className="hide-sm">Volume</th><th className="hide-sm">IV %</th><th className="hide-sm">Bid / Ask</th><th>Call LTP</th><th className="strike">Strike</th><th>Put LTP</th><th className="hide-sm">Bid / Ask</th><th className="hide-sm">IV %</th><th className="hide-sm">Volume</th><th>OI Δ</th><th>Puts OI</th>
      </tr></thead><tbody>
        {rows.map(r => { const atm = r.strike === d.atm, ceItm = d.spot && r.strike < d.spot, peItm = d.spot && r.strike > d.spot; return <tr key={r.strike} className={atm ? 'atm' : ''}>
          <td className={`number ${ceItm ? 'itm' : ''}`}><OIBar value={r.CE?.oi} max={max} side="ce" /></td>
          <td className={`number ${ceItm ? 'itm' : ''} ${tone(r.CE?.chg)}`}><span className="chg-bar"><i className={(r.CE?.chg || 0) >= 0 ? 'up' : 'down'} style={{ width: `${Math.abs(r.CE?.chg || 0) / maxChg * 100}%` }} />{r.CE ? compact(r.CE.chg) : '—'}</span></td>
          <td className={`number hide-sm ${ceItm ? 'itm' : ''}`}>{compact(r.CE?.vol)}</td>
          <td className="number hide-sm">{fmt(r.CE?.iv)}</td><td className="number hide-sm">{fmt(r.CE?.bid)} / {fmt(r.CE?.ask)}</td>
          <td className={`number ${ceItm ? 'itm' : ''}`}>{fmt(r.CE?.close)}<small className={tone(r.CE?.chgPct)}>{r.CE?.chgPct != null && Math.abs(r.CE.chgPct) < 1000 ? pct(r.CE.chgPct) : ''}</small></td>
          <td className="number strike"><strong>{fmt(r.strike, r.strike % 1 ? 2 : 0)}</strong>{atm && <small>ATM</small>}{r.strike === d.maxPain && <small>max pain</small>}</td>
          <td className={`number ${peItm ? 'itm' : ''}`}>{fmt(r.PE?.close)}<small className={tone(r.PE?.chgPct)}>{r.PE?.chgPct != null && Math.abs(r.PE.chgPct) < 1000 ? pct(r.PE.chgPct) : ''}</small></td>
          <td className="number hide-sm">{fmt(r.PE?.bid)} / {fmt(r.PE?.ask)}</td><td className="number hide-sm">{fmt(r.PE?.iv)}</td>
          <td className={`number hide-sm ${peItm ? 'itm' : ''}`}>{compact(r.PE?.vol)}</td>
          <td className={`number ${peItm ? 'itm' : ''} ${tone(r.PE?.chg)}`}><span className="chg-bar"><i className={(r.PE?.chg || 0) >= 0 ? 'up' : 'down'} style={{ width: `${Math.abs(r.PE?.chg || 0) / maxChg * 100}%` }} />{r.PE ? compact(r.PE.chg) : '—'}</span></td>
          <td className={`number ${peItm ? 'itm' : ''}`}><OIBar value={r.PE?.oi} max={max} side="pe" /></td>
        </tr>; })}
      </tbody></table></div>}
    <div className="panel-foot">{d ? <>OI and volume in contracts · shaded strikes are in the money · {INDEX_YAHOO[d.symbol] || !/NIFTY/.test(d.symbol) ? <><button className="link" onClick={() => onOpen(yahooOf(d.symbol))}>Open {d.symbol} chart</button> · </> : null}source: <a href={d.sourceUrl} target="_blank" rel="noreferrer">NSE option chain</a> · {d.exchangeTimestamp} IST · refresh every 30s</> : 'Source: NSE option chain'}</div>
  </section>;
}

function LiveFutures({ refresh }) {
  const [group, setGroup] = useState('nse50_fut');
  const [query, setQuery] = useState('');
  const { tick, setTick, auto, setAuto, now } = useDerivativeRefresh();
  const { data, loading, error } = useFeed(`/api/market?op=live-futures&group=${group}`, `${refresh}:${tick}`);
  const freshness = error ? 'unavailable' : optionFreshness(data?.asOf, now);
  const rows = (data?.rows || []).filter(r => r.symbol.includes(query.trim().toUpperCase()));
  return <section className="panel live-futures-panel">
    <PanelTitle title="NSE futures contracts" tag="LIVE"><span className="muted small">{data?.exchangeTimestamp ? `${data.exchangeTimestamp} IST · ${freshness === 'live' ? 'Live' : freshness === 'snapshot' ? 'Session snapshot' : 'Stale / unavailable'}` : 'Connecting to NSE'}</span><button className="icon-button" aria-label="Refresh futures contracts" onClick={() => setTick(n => n + 1)}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></PanelTitle>
    <div className="screen-filters"><select aria-label="Futures category" value={group} onChange={e => setGroup(e.target.value)}>{[['nse50_fut', 'NIFTY'], ['nifty_bank_fut', 'BANKNIFTY'], ['finnifty_fut', 'FINNIFTY'], ['niftymidcap_fut', 'MIDCPNIFTY'], ['niftynxt50_fut', 'NIFTYNXT50'], ['niftyfpi_fut', 'NIFTYFPI'], ['stock_fut', 'Stock futures']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input aria-label="Search live futures" placeholder="Search futures symbol…" value={query} onChange={e => setQuery(e.target.value)} /><button aria-pressed={auto} className={auto ? 'active' : ''} onClick={() => setAuto(v => !v)}>Auto-refresh {auto ? '30s' : 'off'}</button></div>
    {error && <div className="fno-notice" role="status">{error} {data ? 'Showing the last received snapshot.' : ''}</div>}
    {loading && !data ? <div className="loading">Loading NSE futures…</div> : !rows.length ? <Empty title={error ? 'Futures feed unavailable' : 'No futures match'} description={error || 'Try another category or symbol.'} /> : <div className="table-wrap fno-futures-wrap"><table><thead><tr><th>Contract</th><th>Expiry</th><th>LTP</th><th>Change %</th><th>Open interest</th><th className="hide-sm">Day low / high</th><th>Basis %</th></tr></thead><tbody>{rows.map(r => <tr key={`${r.symbol}:${r.expiry}`}><td><strong>{r.symbol}</strong></td><td>{dateLabel(r.expiry)}</td><td className="number">{fmt(r.price)}</td><td className={`number ${tone(r.change)}`}>{pct(r.change)}</td><td className="number">{compact(r.oi)}</td><td className="number hide-sm">{fmt(r.low)} / {fmt(r.high)}</td><td className={`number ${tone(r.basis)}`}>{pct(r.basis)}</td></tr>)}</tbody></table></div>}
    <div className="panel-foot">Source: <a href={data?.sourceUrl || 'https://www.nseindia.com/market-data/equity-derivatives-watch'} target="_blank" rel="noreferrer">NSE equity derivatives</a> · OI in contracts · basis compares futures LTP with the underlying in the same feed. OI-change classifications below use the end-of-day archive.</div>
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
    <PanelTitle title="Futures OI build-up · end of day" tag="FUT"><span className="muted small radar-date">{data ? `EOD ${dateLabel(data.date)}` : ''}</span>
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
    <LiveFutures refresh={refresh} />
    <Buildup onOpen={onOpen} refresh={refresh} watch={watch} />
  </>;
}
