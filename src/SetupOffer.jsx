import { ArrowRight, Gift } from 'lucide-react';
import { growthEvent } from './growth.js';
import { useHasApp } from './installState.js';
import { appTrialOpen } from './proOffer.js';
import { PRO_APP_TRIAL_DAYS, PRO_DAYS, PRO_PRICE } from '../lib/proPlan.js';
import { PRO_CHECKOUT_PATH } from './navigation.js';

export function BreakoutOffer({ access, stock, count, onExample }) {
  if (!access || access.loading || access.error || access.pending || access.paused ||
      access.configured === false || (access.active && !access.trialActive) || !Number.isInteger(count) || count < 2) return null;
  const symbol = stock.symbol + '.NS';
  return <aside className="setup-pro-offer" aria-label="Alpha Nova Pro breakout research">
    <div>
      <span className="eyebrow">Alpha Nova Pro</span>
      <h2>Research all {count} breakouts</h2>
      <p>See what drove each breakout and what could weaken it. Start with the free report on {stock.name || stock.symbol}.</p>
    </div>
    <div className="setup-pro-actions">
      <a className="button primary" href={PRO_CHECKOUT_PATH + '?symbol=' + encodeURIComponent(symbol)}
        onClick={() => growthEvent('pro_cta_clicked', { source: 'setup_watch', page: 'Breakouts', offer: 'paid' })}>
        Get Pro · ₹{PRO_PRICE} for {PRO_DAYS} days <ArrowRight size={14} aria-hidden="true" />
      </a>
      <button type="button" className="link" onClick={() => {
        growthEvent('pro_example_opened', { source: 'setup_watch', page: 'Breakouts' });
        onExample(symbol);
      }}>Read {stock.symbol} report</button>
    </div>
  </aside>;
}

// A thank-you for installing: never advertised, shown only once the reader has the app.
export function AppTrialStrip({ access, onStart }) {
  const hasApp = useHasApp();
  if (!hasApp || access?.loading || !appTrialOpen(access)) return null;
  return <button type="button" className="app-trial-strip" onClick={() => {
    growthEvent('pro_cta_clicked', { source: 'home_strip', offer: 'app_trial' });
    onStart();
  }}>
    <Gift size={16} aria-hidden="true" />
    <span><strong>Thanks for installing.</strong> {PRO_APP_TRIAL_DAYS} days of Pro, free</span>
    <ArrowRight size={15} aria-hidden="true" />
  </button>;
}
