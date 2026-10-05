import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { fmt, pct } from './data';
import { screenChart, SCREEN_CHART_RANGES } from './screenerChartMath.js';
import { useChartPreview } from './useChartPreview.js';

function Candles({ chart, symbol, range, width = 176, height = 76 }) {
  const label = `${symbol}: ${range} ${chart.interval.toLowerCase()} candlestick chart, ${chart.sessions} sessions, ${chart.from} to ${chart.to}`;
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    {[.25, .5, .75].map(f => <line key={f} className="chart-grid" x1="4" x2={width - 4} y1={height * f} y2={height * f} />)}
    {chart.candles.map(b => <g key={b.time} className={b.close >= b.open ? 'positive' : 'negative'}>
      <title>{`${b.time}${b.end && b.end !== b.time ? ` – ${b.end}` : ''} · O ${fmt(b.open)} · H ${fmt(b.high)} · L ${fmt(b.low)} · C ${fmt(b.close)}`}</title>
      <line x1={b.x} x2={b.x} y1={b.highY} y2={b.lowY} stroke="currentColor" strokeWidth={width > 200 ? 1.2 : .8} />
      <rect x={b.x - b.bodyWidth / 2} y={b.bodyY} width={b.bodyWidth} height={b.bodyHeight} fill="currentColor" />
    </g>)}
  </svg>;
}

export default function ScreenChart({ range, symbol, refresh = 0 }) {
  const { host, feed, onRetry } = useChartPreview(symbol + '.NS', refresh);
  return <CandlestickPreview hostRef={host} range={range} symbol={symbol} feed={feed} onRetry={onRetry} />;
}

export function CandlestickPreview({ range, symbol, feed, onRetry, hostRef }) {
  const dialog = useRef();
  const [expandedRange, setExpandedRange] = useState(range);
  const chart = screenChart(feed.data?.bars, range);
  const expanded = screenChart(feed.data?.bars, expandedRange, 640, 280);
  const currency = feed.data?.currency || '';
  return <div ref={hostRef} className="screen-chart-slot">
    {chart ? <button className="screen-chart" aria-label={`Enlarge ${symbol} candlestick chart`} title={`${chart.interval} candles · ${chart.from} to ${chart.to} · click to enlarge`} onClick={() => { setExpandedRange(range); dialog.current.showModal(); }}>
      <div className="screen-chart-caption"><span>{range} · {chart.interval}</span><span className={`number ${chart.change >= 0 ? 'positive' : 'negative'}`}>{pct(chart.change)}</span></div>
      <Candles chart={chart} symbol={symbol} range={range} />
    </button> : <div className="screen-chart unavailable" aria-busy={feed.loading}>
      <span>{feed.loading ? 'Loading candles…' : 'Chart unavailable'}</span>
      {!feed.loading && <button className="link" onClick={onRetry}>Retry</button>}
    </div>}
    <dialog ref={dialog} className="dialog screen-candle-dialog" aria-label={`${symbol} candlestick chart`} onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>
      {expanded && <>
        <div className="screen-candle-heading"><div><strong>{symbol}</strong><span>{expanded.interval} candlesticks · OHLC</span></div><button className="icon-button" aria-label="Close candlestick preview" onClick={() => dialog.current.close()}><X size={18} /></button></div>
        <div className="screen-candle-controls"><div className="segments" role="group" aria-label="Expanded candlestick period">{Object.keys(SCREEN_CHART_RANGES).map(r => <button key={r} className={expandedRange === r ? 'active' : ''} aria-pressed={expandedRange === r} onClick={() => setExpandedRange(r)}>{r}</button>)}</div><span className="number">{fmt(expanded.candles.at(-1).close)} {currency} <span className={expanded.change >= 0 ? 'positive' : 'negative'}>{pct(expanded.change)}</span></span></div>
        <div className="screen-candle-scale"><span>High {fmt(expanded.high)} {currency}</span><span>Low {fmt(expanded.low)} {currency}</span></div>
        <Candles chart={expanded} symbol={symbol} range={expandedRange} width={640} height={280} />
        <div className="screen-candle-dates"><span>{expanded.from}</span><span>{expanded.to}</span></div>
        <p className="screen-candle-source">Yahoo Finance · {expanded.sessions} trading sessions · green: close ≥ open · red: close &lt; open · prices may be delayed</p>
      </>}
    </dialog>
  </div>;
}
