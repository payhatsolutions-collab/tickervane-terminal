import { useState } from 'react';
import { fmt, pct, short, compact } from './data';
import { PanelTitle } from './ui';

export function Heatmap({ rows = [], onOpen, compact = false }) {
  return <div className={`heatmap ${compact ? 'compact' : ''}`} aria-label="Price change heatmap">
    {rows.map(r => { const valid = Number.isFinite(r.change); const alpha = valid ? .12 + Math.min(Math.abs(r.change), 5) / 5 * .38 : .05;
      return <button key={r.symbol} className={valid ? r.change >= 0 ? 'heat-up' : 'heat-down' : 'heat-missing'} style={{background: valid ? `rgba(${r.change >= 0 ? '40,175,130' : '221,77,101'},${alpha})` : undefined}} onClick={() => onOpen(r.symbol)} title={`${r.name || r.symbol} · ${pct(r.change)}`}><strong>{short(r.symbol)}</strong><span>{pct(r.change)}</span></button>;
    })}
  </div>;
}

export function ResearchCharts({ bars = [], delivery = [], loading, error, isNSE = false }) {
  const latest = bars.at(-1)?.close;
  const returns = [['1W',5],['1M',21],['3M',63],['6M',126]].map(([label,n]) => {
    const prior = bars.at(-1-n)?.close;
    return {label, value: Number.isFinite(latest) && Number.isFinite(prior) && prior > 0 ? (latest/prior-1)*100 : null};
  });
  const max = Math.max(1,...returns.map(r => Math.abs(r.value || 0)));
  const uniqueDelivery = [...new Map(delivery.map(s=>[s.date,s])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  const samples = isNSE ? uniqueDelivery.slice(-15) : bars.slice(-15).map(b=>({date:b.time,delivPct:b.volume}));
  const columnMax = isNSE ? 100 : Math.max(1,...samples.map(s=>Number.isFinite(s.delivPct)?s.delivPct:0));
  const columnLabel = value => isNSE ? fmt(value,0) : compact(value);
  return <section className="panel research-charts">
    <PanelTitle title={isNSE ? "Performance & delivery" : "Performance & volume"} tag="DATA"><span className="muted">{loading ? 'Updating…' : error ? 'Partial data' : bars.at(-1)?.time || '—'}</span></PanelTitle>
    <div className="research-grid"><div><h3>Close-to-close return <small>%</small></h3><div className="return-bars">{returns.map(r => <div key={r.label}><span>{r.label}</span><div className="return-track"><i className={r.value >= 0 ? 'up' : 'down'} style={{[r.value >= 0 ? 'left' : 'right']:'50%',width:`${Math.abs(r.value || 0)/max*48}%`}}/></div><b className={r.value == null ? 'muted' : r.value >= 0 ? 'positive' : 'negative'}>{pct(r.value)}</b></div>)}</div></div>
    <div><h3>{isNSE ? "Delivery share" : "Volume"} <small>{samples.length} sessions{isNSE ? " · %" : ""}</small></h3>{samples.some(s => Number.isFinite(s.delivPct)) ? <><div className="delivery-columns" role="img" aria-label={samples.map(s => `${s.date}: ${columnLabel(s.delivPct)}${isNSE ? " percent" : ""}`).join(', ')}>{samples.map(s => <div key={s.date} title={`${s.date} · ${columnLabel(s.delivPct)}${isNSE ? "%" : ""}`}><span>{Number.isFinite(s.delivPct) ? columnLabel(s.delivPct) : '—'}</span><i style={{height:`${Number.isFinite(s.delivPct) ? Math.max(0,Math.min(100,s.delivPct/columnMax*100))*.8 : 0}%`}}/></div>)}</div><div className="axis-labels"><span>{samples[0]?.date}</span><span>{samples.at(-1)?.date}</span></div></> : <div className="visual-empty">{loading ? 'Loading…' : isNSE ? 'NSE delivery unavailable' : 'Volume unavailable'}</div>}</div></div>
  </section>;
}

export function MarketMap({ rows = [], onOpen, date }) {
  const [metric,setMetric] = useState('change');
  const liquid = rows.filter(r => Number.isFinite(r.turnoverCr)).sort((a,b) => b.turnoverCr-a.turnoverCr).slice(0,60);
  return <section className="market-map"><div className="visual-heading"><h3>Market heatmap <small>60 most traded · avg turnover</small></h3><div className="segments">{[['change','1D'],['r1m','1M'],['r3m','3M']].map(([key,label])=><button key={key} className={metric===key?'active':''} aria-pressed={metric===key} onClick={()=>setMetric(key)}>{label}</button>)}</div></div>{liquid.length ? <Heatmap rows={liquid.map(r=>({...r,symbol:r.symbol+'.NS',change:r[metric]}))} onOpen={onOpen}/> : <div className="visual-empty">Heatmap awaiting market data</div>}<div className="map-legend"><span className="negative">−5%</span><i/><span className="positive">+5%</span><span>Equal-size tiles · {date || '—'} · delayed</span></div></section>;
}
