import { MarketMap } from './VisualData';
import { useMemo } from 'react';
import { useFeed, useQuotes } from './hooks';
import { fmt, pct } from './data';
import { Empty, PanelTitle, tone } from './ui';
import { breadth, vixRead } from './marketMath';

export const SECTORS = [['^NSEBANK', 'Bank'], ['NIFTY_FIN_SERVICE.NS', 'Fin services'], ['^CNXIT', 'IT'], ['^CNXAUTO', 'Auto'], ['^CNXPHARMA', 'Pharma'], ['^CNXFMCG', 'FMCG'], ['^CNXMETAL', 'Metal'], ['^CNXENERGY', 'Energy'], ['^CNXPSUBANK', 'PSU Bank'], ['^CNXREALTY', 'Realty'], ['^CNXMEDIA', 'Media'], ['^CNXINFRA', 'Infra'], ['^CNXPSE', 'PSE'], ['^CNXCONSUM', 'Consumption'], ['^CNXCMDT', 'Commodities']];
const BROAD = [['^NSEI', 'Nifty 50'], ['^NSMIDCP', 'Next 50'], ['^NSEMDCP50', 'Midcap 50'], ['^CNXSC', 'Smallcap 100']];
const GLOBAL = [['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^N225', 'Nikkei'], ['^KS11', 'KOSPI'], ['BZ=F', 'Brent'], ['INR=X', 'USD/INR'], ['^TNX', 'US 10Y'], ['GC=F', 'Gold']];

const fiveDay = q => { const s = (q?.spark || []).filter(Number.isFinite); return s.length > 1 ? (s.at(-1) / s[0] - 1) * 100 : null; };
function Bar({ value, max }) {
  const w = Number.isFinite(value) && max ? Math.min(100, Math.abs(value) / max * 100) : 0;
  return <span className="pulse-bar"><i className={value >= 0 ? 'up' : 'down'} style={{ width: `${w / 2}%`, [value >= 0 ? 'left' : 'right']: '50%' }} /></span>;
}

export default function Pulse({ onOpen, refresh }) {
  const screen = useFeed('/api/market?op=screen', refresh);
  const { quotes, loading } = useQuotes(['^INDIAVIX', ...BROAD.map(x => x[0]), ...SECTORS.map(x => x[0]), ...GLOBAL.map(x => x[0])], refresh);
  const rows = screen.data?.rows || [];
  const b = useMemo(() => breadth(rows), [rows]);
  const movers = useMemo(() => { const r = rows.filter(x => Number.isFinite(x.change) && (x.turnoverCr ?? 0) >= 5).sort((a, c) => c.change - a.change); return { up: r.slice(0, 6), down: r.slice(-6).reverse() }; }, [rows]);
  const sectors = SECTORS.map(([s, name]) => ({ s, name, d1: quotes[s]?.change, d5: fiveDay(quotes[s]) })).sort((a, c) => (c.d1 ?? -99) - (a.d1 ?? -99));
  const maxMove = Math.max(0.5, ...sectors.flatMap(x => [Math.abs(x.d1 || 0), Math.abs(x.d5 || 0)]));
  const vix = quotes['^INDIAVIX'], nifty = quotes['^NSEI'], read = vixRead(vix?.price);
  const implied = Number.isFinite(vix?.price) && Number.isFinite(nifty?.price) ? nifty.price * vix.price / 100 / Math.sqrt(252) : null;
  const mover = x => <button key={x.symbol} className="mover" onClick={() => onOpen(`${x.symbol}.NS`)}><strong>{x.symbol}</strong><span className={tone(x.change)}>{pct(x.change)}</span><small>{Number.isFinite(x.volRatio) ? `${x.volRatio.toFixed(1)}× vol` : ''}{Number.isFinite(x.delivPct) ? ` · ${fmt(x.delivPct, 0)}% del` : ''}</small></button>;

  return <section className="panel pulse-panel">
    <PanelTitle title="Market pulse" tag="PULSE"><span className="muted small">{screen.data?.date ? `Breadth as of ${screen.data.date}` : ''}</span></PanelTitle>
    <div className="pulse-cards">
      <div className={`radar-card ${read.tone}`}><span>India VIX</span><strong>{fmt(vix?.price)}</strong><small><b className={tone(-(vix?.change ?? NaN))}>{pct(vix?.change)}</b> · {read.label}</small><small>{implied ? `Nifty 1σ day ≈ ±${fmt(implied, 0)} pts (${fmt(vix.price / Math.sqrt(252))}%)` : ''}</small></div>
      <div className={`radar-card ${b && b.adv >= b.dec ? 'positive' : 'negative'}`}><span>Advance / decline</span><strong>{b ? `${b.adv} : ${b.dec}` : '—'}</strong><small>{b ? `A/D ratio ${b.ratio == null ? '—' : fmt(b.ratio)} · Nifty 500` : screen.loading ? 'Scanning Nifty 500…' : 'Unavailable'}</small></div>
      <div className={`radar-card ${b?.above50 >= 50 ? 'positive' : 'negative'}`}><span>Above 50 / 200 DMA</span><strong>{b ? `${fmt(b.above50, 0)}% · ${fmt(b.above200, 0)}%` : '—'}</strong><small>Nifty 500 · trend breadth</small></div>
      <div className="radar-card accent"><span>At 52W high / low</span><strong>{b ? `${b.nearHigh} / ${b.nearLow}` : '—'}</strong><small>Within 1% of extreme</small></div>
    </div>
    <MarketMap rows={rows} onOpen={onOpen} date={screen.data?.date}/>
    <div className="pulse-grid">
      <div className="pulse-block">
        <h3>Sector rotation <small className="muted">1D · 5D</small></h3>
        <div className="sector-list">{sectors.map(x => <button key={x.s} onClick={() => onOpen(x.s)}><span>{x.name}</span><Bar value={x.d1} max={maxMove} /><em className={tone(x.d1)}>{pct(x.d1)}</em><em className={`muted-num ${tone(x.d5)}`}>{pct(x.d5)}</em></button>)}</div>
        <div className="broad-row">{BROAD.map(([s, name]) => <button key={s} onClick={() => onOpen(s)}><span>{name}</span><strong className={tone(quotes[s]?.change)}>{pct(quotes[s]?.change)}</strong></button>)}</div>
      </div>
      <div className="pulse-block">
        <h3>Nifty 500 movers <small className="muted">turnover ≥ ₹5 Cr</small></h3>
        {!rows.length ? (screen.loading ? <div className="loading">Scanning Nifty 500…</div> : <Empty title="Movers unavailable" description={screen.error || 'Try refreshing.'} />) :
          <div className="movers"><div>{movers.up.map(mover)}</div><div>{movers.down.map(mover)}</div></div>}
        <h3 className="global-head">Global cues</h3>
        <div className="global-row">{GLOBAL.map(([s, name]) => <button key={s} onClick={() => onOpen(s)}><span>{name}</span><strong>{fmt(quotes[s]?.price)}</strong><em className={tone(s === '^TNX' || s === 'INR=X' ? -(quotes[s]?.change ?? NaN) : quotes[s]?.change)}>{pct(quotes[s]?.change)}</em></button>)}</div>
      </div>
    </div>
    <div className="panel-foot">{loading ? 'Updating quotes…' : 'Yahoo Finance indices · NSE bhavcopy breadth'} · 5D uses intraday closes · rising VIX, yields and USD/INR shown red</div>
  </section>;
}
