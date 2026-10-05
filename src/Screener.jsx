import { useMemo } from 'react';
import { BellRing, ChevronRight, Download, Info, Plus, RefreshCw, Save, Star, Trash2, X } from 'lucide-react';
import { useFeed, useQuotes } from './hooks';
import LatestQuote from './LatestQuote.jsx';
import { fmt, pct, compact } from './data';
import { Empty, PanelTitle, SortTh, exportCSV, sortRows, tone } from './ui';
import { FIELDS, FLAGS, PRESETS, describe, runScreen } from './screens';
import ScreenChart from './ScreenChart.jsx';
import { SCREEN_CHART_RANGES } from './screenerChartMath.js';

const COLUMNS = [
  ['price', 'Session close', r => fmt(r.price)],
  ['change', 'Session 1D', r => pct(r.change), true],
  ['r1m', '1M', r => pct(r.r1m), true],
  ['r3m', '3M', r => pct(r.r3m), true],
  ['rs3m', 'RS 3M', r => Number.isFinite(r.rs3m) ? `${r.rs3m >= 0 ? '+' : ''}${r.rs3m.toFixed(1)}` : '—', true, 'Return minus Nifty 50 over 3 months, in points'],
  ['rsi', 'RSI', r => fmt(r.rsi, 0)],
  ['fromHigh', 'From high', r => pct(r.fromHigh), false, 'Distance from the 52-week high'],
  ['volRatio', 'Vol ×', r => Number.isFinite(r.volRatio) ? `${r.volRatio.toFixed(1)}×` : '—', false, 'Latest session volume versus 20-session average'],
  ['delivPct', 'Deliv %', r => fmt(r.delivPct, 0)],
];
const blank = { id: 'custom', name: 'Custom screen', when: [['score', 'min', 60]], industry: '' };

export default function Screener({ view, setView, onOpen, watch, toggleWatch, refresh, onRefresh, saved, setSaved, pushOn, notify, goAlerts }) {
  const { data, loading, error } = useFeed('/api/market?op=screen', refresh);
  // Keep screen controls in the app so returning from research preserves the results.
  const { active = PRESETS[0].id, custom = blank, industry = '', q = '', sort = ['score', -1], limit = 60, chartRange = '3M' } = view;
  const update = (key, fallback) => value => setView(current => ({
    ...current, [key]: typeof value === 'function' ? value(current[key] ?? fallback) : value,
  }));
  const setActive = update('active', PRESETS[0].id), setCustom = update('custom', blank);
  const setIndustry = update('industry', ''), setQ = update('q', '');
  const setSort = update('sort', ['score', -1]), setLimit = update('limit', 60);
  const setChartRange = update('chartRange', '3M');
  const all = data?.rows || [];
  const industries = useMemo(() => [...new Set(all.map(r => r.industry).filter(Boolean))].sort(), [all]);
  const screen = active === 'custom' ? { ...custom, industry } : { ...PRESETS.find(p => p.id === active), industry };
  const counts = useMemo(() => Object.fromEntries(PRESETS.map(p => [p.id, runScreen(all, { ...p, industry }).length])), [all, industry]);
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return sortRows(runScreen(all, screen).filter(r => !needle || r.symbol.includes(needle) || r.name.toUpperCase().includes(needle)), sort);
  }, [all, JSON.stringify(screen), q, sort]);
  const latest = useQuotes(rows.slice(0, limit).map(r => r.symbol + '.NS'), refresh);
  const setCond = (i, patch) => setCustom(c => ({ ...c, when: c.when.map((w, j) => j === i ? patch : w) }));
  const editPreset = () => { const p = PRESETS.find(x => x.id === active); if (p) setCustom({ id: 'custom', name: `${p.name} (edited)`, when: p.when.map(w => [...w]), industry: '' }); setActive('custom'); };
  const saveScreen = () => {
    const entry = { id: active === 'custom' ? `c-${Date.now().toString(36)}` : active, name: screen.name, when: screen.when, industry };
    if (saved.some(s => s.id === entry.id && s.industry === industry)) { notify('This screen is already saved.'); return; }
    if (saved.length >= 5) { notify('Up to 5 saved screens — remove one first.'); return; }
    setSaved([...saved, entry]);
    notify(pushOn ? `Saved “${entry.name}” · new matches will be pushed after the close` : `Saved “${entry.name}” · turn on push in Alerts to get new matches`);
  };

  return <>
    <section className="panel screener-panel">
      <PanelTitle title={`Screen the ${data?.universe || 'Nifty 500'}`} tag="EQS">
        <button className="icon-button" aria-label="Refresh screener data" title="Refresh" onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
        <button className="button" disabled={!rows.length} onClick={() => exportCSV([['Symbol', 'Name', 'Industry', 'Score', 'Price', '1D %', '1W %', '1M %', '3M %', '6M %', '1Y %', 'RS 3M', 'RSI', 'From 52W high %', 'Volatility %', 'Volume ×', 'Delivery %', 'Delivery ×', 'Avg turnover ₹ Cr', 'Above 50 DMA', 'Above 200 DMA'], ...rows.map(r => [r.symbol, r.name, r.industry, r.score, r.price, r.change, r.r1w, r.r1m, r.r3m, r.r6m, r.r1y, r.rs3m, r.rsi, r.fromHigh, r.volatility, r.volRatio, r.delivPct, r.delivRatio, r.turnoverCr, r.above50, r.above200])], `alphanova-screen-${screen.id}.csv`)}><Download size={14} /> Export</button>
      </PanelTitle>
      <div className="preset-grid">
        {PRESETS.map(p => <button key={p.id} className={active === p.id ? 'active' : ''} onClick={() => { setActive(p.id); setLimit(60); }} title={p.note}>
          <span>{p.name}</span><strong>{loading && !data ? '…' : counts[p.id]}</strong>
        </button>)}
        <button className={active === 'custom' ? 'active custom' : 'custom'} onClick={() => setActive('custom')}><span><Plus size={12} /> Custom</span><strong>{active === 'custom' ? rows.length : ''}</strong></button>
      </div>
      <p className="screener-guide-link"><a href="/screens.html">Screen rules and worked examples</a> · <a href="/methodology.html">Data methodology</a></p>
      <div className="screen-builder">
        <div className="screen-head">
          <div><strong>{screen.name}</strong><p className="muted small">{active === 'custom' ? describe(screen.when) || 'Add a condition' : describe(screen.when)}</p></div>
          <div className="screen-actions">
            {active !== 'custom' && <button className="button" onClick={editPreset}>Edit rules</button>}
            <button className="button" onClick={saveScreen}><Save size={14} /> Save screen</button>
          </div>
        </div>
        {active === 'custom' && <div className="conditions">
          {custom.when.map((w, i) => <div className="condition" key={i}>
            <select aria-label="Metric" value={w[0]} onChange={e => { const k = e.target.value; setCond(i, k in FLAGS ? [k, 'is', true] : [k, w[1] === 'is' ? 'min' : w[1], typeof w[2] === 'number' ? w[2] : 0]); }}>
              <optgroup label="Metrics">{Object.entries(FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</optgroup>
              <optgroup label="Conditions">{Object.entries(FLAGS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
            </select>
            {w[1] === 'is' ? <select aria-label="Is" value={String(w[2])} onChange={e => setCond(i, [w[0], 'is', e.target.value === 'true'])}><option value="true">Yes</option><option value="false">No</option></select>
              : <><select aria-label="Operator" value={w[1]} onChange={e => setCond(i, [w[0], e.target.value, w[2]])}><option value="min">≥</option><option value="max">≤</option></select>
                <input aria-label="Value" type="number" step={FIELDS[w[0]]?.step || 1} value={w[2]} onChange={e => setCond(i, [w[0], w[1], e.target.value === '' ? 0 : Number(e.target.value)])} /><span className="muted small">{FIELDS[w[0]]?.unit}</span></>}
            <button className="icon-button" aria-label="Remove condition" onClick={() => setCustom(c => ({ ...c, when: c.when.filter((_, j) => j !== i) }))}><X size={14} /></button>
          </div>)}
          <div className="condition-add">
            <button className="button" disabled={custom.when.length >= 12} onClick={() => setCustom(c => ({ ...c, when: [...c.when, ['r3m', 'min', 0]] }))}><Plus size={14} /> Add condition</button>
            <input aria-label="Screen name" value={custom.name} maxLength={60} onChange={e => setCustom(c => ({ ...c, name: e.target.value }))} />
          </div>
        </div>}
      </div>
      <p className="muted small">Latest prices refresh every 30 seconds while open · Yahoo Finance may be delayed. Screen metrics and exports use session data.{latest.error ? ` ${latest.error}` : ''}</p>
      <div className="screen-filters">
        <select aria-label="Industry" value={industry} onChange={e => setIndustry(e.target.value)}><option value="">All industries</option>{industries.map(s => <option key={s}>{s}</option>)}</select>
        <input aria-label="Filter results" placeholder="Filter results…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="muted">{rows.length} / {all.length} stocks{data?.date ? ` · delivery as of ${new Date(data.date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}</span>
      </div>
      <div className="screen-chart-toolbar">
        <div><strong>Candlestick snapshots</strong><span>Click a chart to enlarge · {chartRange === '1Y' ? 'up to 1 year' : chartRange === '1M' ? 'last month' : 'last 3 months'}</span></div>
        <div className="segments" role="group" aria-label="Chart snapshot period">{Object.keys(SCREEN_CHART_RANGES).map(range => <button key={range} className={chartRange === range ? 'active' : ''} aria-pressed={chartRange === range} onClick={() => setChartRange(range)}>{range}</button>)}</div>
      </div>
      {loading && !data ? <div className="loading">Scanning {`500`} stocks · 1-year history + NSE delivery…</div>
        : error && !data ? <Empty title="Screener data unavailable" description={error}><button className="button" onClick={onRefresh}>Retry</button></Empty>
        : !rows.length ? <Empty title="No stocks pass this screen" description="Relax a condition or choose another preset." />
        : <div className="table-wrap"><table className="screen-table"><thead><tr>
          <SortTh k="symbol" sort={sort} setSort={setSort}>Stock</SortTh>
          <th>Latest price / 1D</th>
          <SortTh k="score" sort={sort} setSort={setSort} title="Composite 0–100: 1M/3M/6M momentum, relative strength, 52W-high proximity, trend and delivery">Score</SortTh>
          {COLUMNS.map(([k, l, , , t], i) => <SortTh key={k} k={k} sort={sort} setSort={setSort} title={t} className={i > 4 ? 'hide-sm' : ''}>{l}</SortTh>)}
          <th className="hide-sm">Trend</th><th><Star size={13} /></th>
        </tr></thead><tbody>
          {rows.slice(0, limit).map(r => { const w = (watch || []).includes(r.symbol + '.NS'); return <tr key={r.symbol}>
            <td><div className="screen-stock"><button className="instrument" onClick={() => onOpen(r.symbol + '.NS')}><strong>{r.symbol}</strong><span>{r.name} · {r.industry}</span></button><ScreenChart range={chartRange} symbol={r.symbol} refresh={refresh} /></div></td>
            <td className="number"><LatestQuote quote={latest.quotes[r.symbol + '.NS']} /></td>
            <td><span className="score"><i style={{ width: (r.score ?? 0) + '%' }} /><b>{r.score ?? '—'}</b></span></td>
            {COLUMNS.map(([k, , f, colored], i) => <td key={k} className={`number ${colored ? tone(r[k]) : ''} ${i > 4 ? 'hide-sm' : ''}`}>{f(r)}</td>)}
            <td className="hide-sm"><span className="trend-flags">{r.above50 != null && <i className={r.above50 ? 'on' : ''} title="Above 50 DMA">50</i>}{r.above200 != null && <i className={r.above200 ? 'on' : ''} title="Above 200 DMA">200</i>}{r.golden && <i className="on gold" title="50 DMA above 200 DMA">GC</i>}{r.breakout20 && <i className="on" title="20-day breakout">BO</i>}</span></td>
            <td><button className={`icon-button ${w ? 'starred' : ''}`} aria-label={`${w ? 'Remove' : 'Add'} ${r.symbol} ${w ? 'from' : 'to'} watchlist`} onClick={() => toggleWatch(r.symbol + '.NS')}><Star size={14} fill={w ? 'currentColor' : 'none'} /></button></td>
          </tr>; })}
        </tbody></table>
        {rows.length > limit && <div className="more-row"><button className="button" onClick={() => setLimit(l => l + 100)}>Show more ({rows.length - limit} left)</button></div>}
        </div>}
      <div className="panel-foot">{data ? `${data.coverage.withHistory}/${data.coverage.symbols} with 1Y history · Nifty 50 3M ${pct(data.benchmark?.r3m)} · ${data.source}` : 'Yahoo Finance + NSE delivery bhavcopy'} · research, not advice</div>
    </section>
    <section className="panel saved-screens">
      <PanelTitle title="Saved screens" tag="SAVE"><span className="muted">{saved.length} / 5</span></PanelTitle>
      {!saved.length ? <div className="watch-empty">No saved screens.</div>
        : <div className="saved-list">{saved.map(s => { const n = runScreen(all, s).length; return <div key={s.id + s.industry}>
          <button className="saved-name" onClick={() => { if (PRESETS.some(p => p.id === s.id)) setActive(s.id); else { setCustom({ ...s }); setActive('custom'); } setIndustry(s.industry || ''); }}><strong>{s.name}</strong><span className="muted small">{describe(s.when)}{s.industry ? ` · ${s.industry}` : ''}</span></button>
          <span className="number">{data ? n : '…'}</span>
          <button className="icon-button" aria-label={`Remove ${s.name}`} onClick={() => setSaved(saved.filter(x => x !== s))}><Trash2 size={14} /></button>
        </div>; })}</div>}
      <div className="radar-digest">{pushOn ? <p className="small muted"><BellRing size={12} /> New matches · evening digest · 19:30–22:30 IST.</p> : <button className="button" onClick={goAlerts}>Turn on push for screen alerts <ChevronRight size={14} /></button>}</div>
      <details className="signal-explainer radar-help"><summary><Info size={14} /> About the score and data <ChevronRight size={14} /></summary><div>
        <p><strong>Score (0–100)</strong> ranks each stock against the rest of the universe on 1M, 3M and 6M return, 3-month relative strength versus the Nifty 50, closeness to the 52-week high and delivery surge, then adds +5 above the 200-day average (−5 below) and +3 for a golden-cross trend.</p>
        <p>Prices: Yahoo Finance daily closes (1 year, may be delayed). Volume and delivery: NSE end-of-day bhavcopy for the last 21 sessions. The universe follows the official Nifty 500 list. Screens are research filters, not recommendations.</p>
      </div></details>
    </section>
  </>;
}
