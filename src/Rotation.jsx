import { useMemo, useState } from 'react';
import { Info, ChevronRight } from 'lucide-react';
import { useFeed, useQuotes } from './hooks';
import LatestQuote from './LatestQuote.jsx';
import { fmt, pct } from './data';
import { Empty, PanelTitle, tone } from './ui';

// Relative rotation of NSE sector indices versus Nifty 50 (weekly) and index
// valuations, both from NSE's daily index archive.
const Q = { Leading: 'q-leading', Weakening: 'q-weakening', Lagging: 'q-lagging', Improving: 'q-improving' };
const ORDER = ['Leading', 'Improving', 'Weakening', 'Lagging'];
const W = 560, H = 380, PAD = 30;

function RRGChart({ sectors, hidden, focus, setFocus }) {
  const shown = sectors.filter(s => !hidden.has(s.label) && s.trail.length);
  const pts = shown.flatMap(s => s.trail);
  const dx = Math.max(1.5, ...pts.map(p => Math.abs(p.x - 100))) * 1.12, dy = Math.max(1, ...pts.map(p => Math.abs(p.y - 100))) * 1.12;
  const sx = x => PAD + (x - 100 + dx) / (2 * dx) * (W - 2 * PAD), sy = y => H - PAD - (y - 100 + dy) / (2 * dy) * (H - 2 * PAD);
  const cx = sx(100), cy = sy(100);
  return <svg className="rrg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Relative rotation graph of NSE sectors versus Nifty 50">
    <rect x={cx} y={PAD} width={W - PAD - cx} height={cy - PAD} className="q-leading" /><rect x={PAD} y={PAD} width={cx - PAD} height={cy - PAD} className="q-improving" />
    <rect x={PAD} y={cy} width={cx - PAD} height={H - PAD - cy} className="q-lagging" /><rect x={cx} y={cy} width={W - PAD - cx} height={H - PAD - cy} className="q-weakening" />
    <line x1={cx} x2={cx} y1={PAD} y2={H - PAD} className="axis" /><line x1={PAD} x2={W - PAD} y1={cy} y2={cy} className="axis" />
    <text x={W - PAD - 6} y={PAD + 14} textAnchor="end" className="q-label">LEADING</text><text x={PAD + 6} y={PAD + 14} className="q-label">IMPROVING</text>
    <text x={PAD + 6} y={H - PAD - 8} className="q-label">LAGGING</text><text x={W - PAD - 6} y={H - PAD - 8} textAnchor="end" className="q-label">WEAKENING</text>
    <text x={W / 2} y={H - 8} textAnchor="middle" className="axis-label">RS-Ratio → stronger than Nifty 50</text>
    <text x={12} y={H / 2} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="axis-label">RS-Momentum ↑</text>
    {shown.map(s => { const head = s.trail.at(-1), dim = focus && focus !== s.label; return <g key={s.label} className={`trail ${Q[s.quadrant] || ''} ${dim ? 'dim' : ''}`} onMouseEnter={() => setFocus(s.label)} onMouseLeave={() => setFocus(null)}>
      <polyline fill="none" points={s.trail.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')} />
      {s.trail.slice(0, -1).map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="2" />)}
      <circle cx={sx(head.x)} cy={sy(head.y)} r="5" className="head" />
      <text x={sx(head.x) + 7} y={sy(head.y) + 4}>{s.label}</text>
    </g>; })}
  </svg>;
}

export default function Rotation({ onOpen, refresh }) {
  const { data, loading, error } = useFeed('/api/market?op=rotation', refresh);
  const [hidden, setHidden] = useState(() => new Set(['Midcap 100', 'Smallcap 100', 'Capital goods', 'Media', 'PSE', 'Commodities', 'Consumption', 'Infra']));
  const [focus, setFocus] = useState(null);
  const latest = useQuotes((data?.valuation || []).map(v => v.symbol).filter(Boolean), refresh);
  const sectors = data?.sectors || [];
  const grouped = useMemo(() => ORDER.map(q => [q, sectors.filter(s => s.quadrant === q).sort((a, b) => (b.rs13 ?? -99) - (a.rs13 ?? -99))]), [sectors]);
  const toggle = l => setHidden(h => { const n = new Set(h); n.has(l) ? n.delete(l) : n.add(l); return n; });
  return <>
    <section className="panel rotation-panel">
      <PanelTitle title="Sector rotation" tag="RRG"><span className="muted small">{data ? `Weekly · ${data.weeks.length} weeks to ${data.date}` : ''}</span></PanelTitle>
      {loading && !data ? <div className="loading">Loading 26 weeks of NSE index closes…</div>
        : error && !data ? <Empty title="Sector rotation unavailable" description={error} />
        : <div className="rotation-grid">
          <div className="rrg-wrap">
            <RRGChart sectors={sectors} hidden={hidden} focus={focus} setFocus={setFocus} />
            <div className="screen-filters rrg-toggles">{sectors.map(s => <button key={s.label} className={hidden.has(s.label) ? '' : 'active'} aria-pressed={!hidden.has(s.label)} onClick={() => toggle(s.label)} onMouseEnter={() => setFocus(s.label)} onMouseLeave={() => setFocus(null)}>{s.label}</button>)}</div>
          </div>
          <div className="rrg-list">{grouped.map(([q, list]) => list.length ? <div key={q} className="rrg-group"><h4 className={Q[q]}>{q}</h4>{list.map(s => <button key={s.label} className="rrg-row" disabled={!s.symbol} onClick={() => s.symbol && onOpen(s.symbol)} onMouseEnter={() => setFocus(s.label)} onMouseLeave={() => setFocus(null)}>
            <span>{s.label}</span><em className={tone(s.w1)} title="1 week">{pct(s.w1)}</em><em className={tone(s.w4)} title="4 weeks">{pct(s.w4)}</em><em className={tone(s.rs13)} title="13-week return minus Nifty 50">{s.rs13 == null ? '—' : `${s.rs13 >= 0 ? '+' : ''}${fmt(s.rs13, 1)}`}</em>
          </button>)}</div> : null)}<div className="rrg-legend muted small"><span>1W</span><span>4W</span><span>RS 13W</span></div></div>
        </div>}
      <details className="signal-explainer radar-help"><summary><Info size={14} /> How rotation is calculated <ChevronRight size={14} /></summary><div>
        <p>Relative strength = sector ÷ Nifty 50 on the last close of each week. RS-Ratio compares it with its own 10-week average; RS-Momentum compares RS-Ratio with its 5-week average. Both are centred on 100. Tails show the last six weeks.</p>
        <p>Sectors typically move clockwise: improving → leading → weakening → lagging. This is an open approximation of relative rotation graphs, not JdK’s proprietary RRG formula, and describes the past, not the next move.</p>
      </div></details>
      <div className="panel-foot">Source: NSE index closing archive (ind_close_all) · weekly closes</div>
    </section>
    {data?.valuation?.length > 0 && <section className="panel valuation-panel">
      <PanelTitle title="Index valuation" tag="VAL"><span className="muted small">As of {data.date} · P/E vs 26-week range</span></PanelTitle>
      <div className="table-wrap"><table><thead><tr><th>Index</th><th>Latest price / 1D</th><th>P/E</th><th className="hide-sm">P/B</th><th className="hide-sm">Div. yield</th><th>P/E in 26-week range</th></tr></thead><tbody>
        {data.valuation.map(v => <tr key={v.name}>
          <td><button className="instrument" disabled={!v.symbol} onClick={() => v.symbol && onOpen(v.symbol)}><strong>{v.name}</strong><span>{fmt(v.close)} <b className={tone(v.change)}>{pct(v.change)}</b></span></button></td>
          <td className="number"><LatestQuote quote={latest.quotes[v.symbol]} /></td>
          <td className="number"><strong>{fmt(v.pe, 1)}</strong></td>
          <td className="number hide-sm">{fmt(v.pb, 2)}</td>
          <td className="number hide-sm">{fmt(v.dy, 2)}%</td>
          <td><span className="range-track" title={`26-week P/E range ${fmt(v.peLow, 1)}–${fmt(v.peHigh, 1)}`}><small>{fmt(v.peLow, 1)}</small><span><i style={{ left: `${v.pePos ?? 50}%` }} /></span><small>{fmt(v.peHigh, 1)}</small></span></td>
        </tr>)}
      </tbody></table></div>
      <div className="panel-foot">Index P/E, P/B and dividend yield as published by NSE (trailing, free-float). Six months is a short window; compare with longer history before drawing conclusions.</div>
    </section>}
  </>;
}
