import { useEffect } from 'react';
import { ArrowUpRight, Check, Lock, Sparkles } from 'lucide-react';
import { growthEvent } from './growth.js';
import { useHasApp } from './installState.js';
import { short } from './data.js';
import { proOffer, proOffered } from './proOffer.js';
import { PRO_EXAMPLE_DEALS } from '../lib/proPlan.js';
import './pro-example.css';

// What the reader is looking at, then what Pro adds. `asked` is a stock they came for that needs Pro.
function words(page, example, asked) {
  const stock = short(example);
  if (page === 'Forecast') return asked
    ? [`This is the free example, ${stock}.`, `Pro runs the forecast for ${asked} and any other ticker.`]
    : [`${stock}, with real data.`, 'Pro runs the forecast for any other stock, index or crypto ticker.'];
  if (page === 'Analytics') return asked
    ? [`This is the free example, ${stock}.`, `Pro runs this risk check for ${asked} and any other stock.`]
    : [`${stock}, with real data.`, 'Pro runs this risk check for any other stock.'];
  if (page === 'Breakouts') return asked
    ? [`This is the free example, ${stock}.`, `Pro opens this check for ${asked} and every other breakout.`]
    : [`${stock}, the latest session’s top breakout by turnover.`, 'Pro opens this check for every other breakout.'];
  if (page === 'FnO') return ['Nifty option chain, nearest expiry.', 'Pro adds Bank Nifty and stock options, other expiries, live futures and OI build-up.'];
  return [`FII/DII cash and the ${PRO_EXAMPLE_DEALS} largest deals.`, 'Pro adds participant positioning and every bulk and block deal, with filters and export.'];
}

// Marks a control that opens the paywall.
export const ProPill = () => <b className="pro-pill" aria-label="Alpha Nova Pro">PRO</b>;

// The strip above a locked workspace's live example: what is free here, what Pro adds, and the offer.
export default function ProExample({ page, access, example, requested, onUnlock }) {
  const hasApp = useHasApp();
  useEffect(() => { growthEvent('pro_example_viewed', { page }); }, [page]);
  const asked = requested ? short(requested) : '';
  const [shown, more] = words(page, example, asked);
  const { offer, label } = proOffer(access, hasApp);
  return <aside className={`pro-example${asked ? ' pro-example-asked' : ''}`} aria-label="Free example of this Pro workspace">
    <div className="pro-example-copy">
      <span className="eyebrow pro-example-eyebrow">{asked ? <><Lock size={12} aria-hidden="true" /> {asked} NEEDS PRO</> : <><Sparkles size={12} aria-hidden="true" /> FREE EXAMPLE</>}</span>
      <p><strong>{shown}</strong> {more}</p>
    </div>
    {!access.loading && proOffered(access) && <button type="button" className="button primary pro-example-cta" onClick={() => {
      growthEvent('pro_cta_clicked', { source: 'example', page, offer });
      onUnlock();
    }}>{label} <ArrowUpRight size={15} aria-hidden="true" /></button>}
  </aside>;
}

// What else a workspace holds for Pro readers, listed under its free example.
export function ProMore({ items, onUnlock }) {
  return <section className="panel pro-more" aria-label="More in Alpha Nova Pro">
    <span className="eyebrow pro-example-eyebrow"><Lock size={12} aria-hidden="true" /> MORE IN ALPHA NOVA PRO</span>
    <ul>{items.map(item => <li key={item}><Check size={13} aria-hidden="true" />{item}</li>)}</ul>
    <button type="button" className="button" onClick={onUnlock}>See Pro <ArrowUpRight size={15} aria-hidden="true" /></button>
  </section>;
}
