import { useEffect, useId, useRef, useState } from 'react';
import { Activity, BarChart3 } from 'lucide-react';
import { fmt, pct } from './data.js';
import { tone } from './ui.jsx';

export function BreadthChart({ rows, stats }) {
  const above = rows.filter(row => row.above200 === true).length;
  const parts = [
    { label: 'Above 200 DMA', count: above, color: 'var(--green)' },
    { label: 'Below 200 DMA', count: stats.trendKnown - above, color: 'var(--red)' },
    { label: 'Unavailable', count: rows.length - stats.trendKnown, color: 'var(--line)' },
  ];
  let offset = 0;
  return <article className="analytics-chart-card analytics-breadth">
    <div className="analytics-chart-heading"><div><span className="analytics-eyebrow">TREND PARTICIPATION</span><h3>How broad is the market?</h3></div><Activity size={18} aria-hidden="true" /></div>
    <div className="analytics-breadth-body">
      <div className="analytics-donut">
        <svg viewBox="0 0 180 180" role="img" aria-label={parts.map(part => `${part.count} stocks ${part.label.toLowerCase()}`).join(', ')}>
          <circle cx="90" cy="90" r="72" fill="none" stroke="var(--line)" strokeWidth="15" />
          {parts.map(part => {
            const length = part.count / Math.max(1, rows.length) * 100;
            const start = offset; offset += length;
            return length > 0 && <circle key={part.label} cx="90" cy="90" r="72" fill="none" stroke={part.color} strokeWidth="15" pathLength="100" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} transform="rotate(-90 90 90)" />;
          })}
        </svg>
        <div><strong>{Number.isFinite(stats.trendPercent) ? `${fmt(stats.trendPercent, 0)}%` : '—'}</strong><span>above 200 DMA</span><small>of known stocks</small></div>
      </div>
      <div className="analytics-breadth-legend">{parts.map(part => <div key={part.label}><i style={{ background: part.color }} /><span>{part.label}</span><b>{part.count}</b></div>)}<small>{stats.trendKnown} of {stats.total} stocks covered</small></div>
    </div>
  </article>;
}

export function IndustryMomentum({ sectors }) {
  const [view, setView] = useState('leaders');
  const known = sectors.filter(sector => Number.isFinite(sector.return3m));
  const ranked = [...known].sort((a, b) => view === 'leaders' ? b.return3m - a.return3m : a.return3m - b.return3m).slice(0, 6);
  // Keep a shared scale when switching between leaders and laggards.
  const max = Math.max(1, ...known.map(sector => Math.abs(sector.return3m)));
  return <article className="analytics-chart-card">
    <div className="analytics-chart-heading"><div><span className="analytics-eyebrow">3-MONTH MEDIAN RETURN</span><h3>Industry momentum</h3></div><BarChart3 size={18} aria-hidden="true" /></div>
    <div className="analytics-chart-tabs" role="group" aria-label="Industry momentum ranking">{[['leaders', 'Leaders'], ['laggards', 'Laggards']].map(([value, label]) => <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}</div>
    {ranked.length ? <div className="analytics-rank-bars">{ranked.map(sector => <div className="analytics-rank-row" key={sector.industry} title={`${sector.industry}: ${pct(sector.return3m)} · ${sector.coverage} of ${sector.count} returns available`}>
      <span>{sector.industry}</span><div className="analytics-diverging-track" aria-hidden="true"><i className={tone(sector.return3m)} style={{ left: `${sector.return3m < 0 ? 50 - Math.abs(sector.return3m) / max * 50 : 50}%`, width: `${Math.abs(sector.return3m) / max * 50}%` }} /></div><b className={tone(sector.return3m)}>{pct(sector.return3m)}</b>
    </div>)}<div className="analytics-bar-axis" aria-hidden="true"><span>−{fmt(max, 0)}%</span><span>0</span><span>+{fmt(max, 0)}%</span></div></div> : <div className="analytics-chart-empty">Industry returns unavailable</div>}
  </article>;
}

const dateLabel = (time, year = false) => new Date(`${time}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: '2-digit' } : {}), timeZone: 'UTC' });

export function HistoryChart({ points, label, stockLabel, benchmark = false, drawdown = false }) {
  const gradient = useId();
  const container = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);
  const hasData = points.length >= 2;
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [hasData]);
  if (!hasData) return <div className="analytics-chart-empty">At least two completed sessions are needed for this chart.</div>;
  const W = width, H = 230, left = 47, right = W - 12, top = 16, bottom = H - 28;
  const values = points.flatMap(point => benchmark ? [point.value, point.benchmark] : [point.value]).filter(Number.isFinite);
  const min = Math.min(0, ...values), max = Math.max(0, ...values), span = max - min || 1;
  const low = min - span * .08, high = drawdown ? 0 : max + span * .12;
  const x = index => left + index / (points.length - 1) * (right - left);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  const path = key => points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(point[key]).toFixed(2)}`).join(' ');
  const selected = hover === null ? points.length - 1 : Math.max(0, Math.min(points.length - 1, hover));
  const point = points[selected];
  const color = drawdown ? 'var(--red)' : 'var(--accent)';
  const readout = `${point.time}: ${drawdown ? 'drawdown' : stockLabel} ${pct(point.value)}${benchmark ? `, Nifty 50 ${pct(point.benchmark)}` : ''}`;
  const updatePointer = event => {
    const box = event.currentTarget.getBoundingClientRect();
    const coordinate = (event.clientX - box.left) / box.width * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round((coordinate - left) / (right - left) * (points.length - 1)))));
  };
  return <div className="analytics-history-chart" ref={container}>
    <div className="analytics-chart-readout"><span>{dateLabel(point.time, true)}</span><strong className={drawdown ? 'negative' : 'analytics-stock-value'}>{drawdown ? 'Drawdown' : stockLabel} {pct(point.value)}</strong>{benchmark && <span className="analytics-benchmark-value">Nifty 50 {pct(point.benchmark)}</span>}</div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" tabIndex="0" aria-label={`${label}. ${readout}. Use left and right arrow keys to explore sessions.`} onPointerMove={updatePointer} onPointerDown={updatePointer} onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      setHover(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, selected + (event.key === 'ArrowLeft' ? -1 : 1))));
    }}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={drawdown ? .06 : .24} /><stop offset="100%" stopColor={color} stopOpacity={drawdown ? .3 : .01} /></linearGradient></defs>
      {[0, 1, 2, 3].map(tick => {
        const value = drawdown ? (tick === 0 ? 0 : low * tick / 3) : high - (high - low) * tick / 3;
        return <g key={tick} className="analytics-chart-grid"><line x1={left} x2={right} y1={y(value)} y2={y(value)} /><text x={left - 9} y={y(value) + 4} textAnchor="end">{fmt(value, 1)}%</text></g>;
      })}
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="analytics-zero-line" />
      <path d={`${path('value')} L${right},${y(0)} L${left},${y(0)} Z`} fill={`url(#${gradient})`} />
      {benchmark && <path d={path('benchmark')} fill="none" stroke="var(--theme-purple, #ae9eff)" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
      <path d={path('value')} fill="none" stroke={color} strokeWidth="2.3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {hover !== null && <line x1={x(selected)} x2={x(selected)} y1={top} y2={bottom} className="analytics-zero-line" />}
      <circle cx={x(selected)} cy={y(point.value)} r="4" fill={color} stroke="var(--panel)" strokeWidth="2" />
      {benchmark && hover !== null && <circle cx={x(selected)} cy={y(point.benchmark)} r="3" fill="var(--theme-purple, #ae9eff)" />}
      {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((index, position) => <text key={position} x={x(index)} y={H - 6} textAnchor={position === 0 ? 'start' : position === 2 ? 'end' : 'middle'} className="analytics-axis-label">{dateLabel(points[index].time, position !== 1 && points[0].time.slice(0, 4) !== points.at(-1).time.slice(0, 4))}</text>)}
    </svg>
  </div>;
}
