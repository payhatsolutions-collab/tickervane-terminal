import { fmt, pct } from './data';
import { tone } from './ui';

export default function LatestQuote({ quote }) {
  if (!Number.isFinite(quote?.price)) return <span className="muted">Awaiting quote</span>;
  const stamp = quote.marketTime ? new Date(quote.marketTime * 1000).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Time unavailable';
  return <span title={`${quote.source || 'Yahoo Finance'} · ${stamp} · may be delayed`}>
    {fmt(quote.price)} <small className={tone(quote.change)}>{pct(quote.change)}</small>
    <small className="muted" style={{ display: 'block' }}>{stamp}</small>
  </span>;
}
