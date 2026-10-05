import { useMemo, useState } from 'react';
import { fmt, pct } from './data';
import { dcf, defaultInputs, impliedGrowth, marginOfSafety } from './valuation';

// Earnings DCF + reverse DCF inside Company insights. Mount with key={symbol}
// so inputs reset per company. Nothing leaves the browser.
const FIELDS = [['eps', 'EPS (TTM)'], ['growth', 'Growth % · stage 1'], ['years', 'Stage 1 years'], ['terminal', 'Terminal growth %'], ['terminalYears', 'Terminal years'], ['discount', 'Discount rate %']];

export default function FairValue({ fund, price, currency }) {
  const [inputs, setInputs] = useState(() => defaultInputs(fund, currency));
  const n = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, Number(v)]));
  const sane = n.years >= 1 && n.years <= 30 && n.terminalYears >= 0 && n.terminalYears <= 30 && n.discount > 0 && n.discount <= 40 && n.growth >= -50 && n.growth <= 100 && n.terminal >= -10 && n.terminal <= 15;
  const result = useMemo(() => sane ? dcf(n) : null, [JSON.stringify(n), sane]);
  const mos = marginOfSafety(result?.fair, price);
  const implied = useMemo(() => sane ? impliedGrowth(price, n) : null, [price, JSON.stringify(n), sane]);
  const cur = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : '';
  const reset = () => setInputs(defaultInputs(fund, currency));
  const noEps = !(n.eps > 0);
  return <details className="compact-details fair-value">
    <summary>Fair value · DCF calculator</summary>
    <div className="fv-body">
      <div className="planner-fields three">{FIELDS.map(([k, label]) => <label key={k}>{label}<input type="number" step="any" value={inputs[k]} onChange={e => setInputs({ ...inputs, [k]: e.target.value })} /></label>)}</div>
      {noEps ? <p className="notice">An earnings DCF needs positive EPS. {Number.isFinite(fund?.epsTrailing) ? 'Trailing EPS is negative or zero.' : 'Trailing EPS is unavailable — enter one to model it.'}</p>
        : !sane ? <p className="notice">Check the inputs: 1–30 stage years, discount 0–40%, growth −50–100%, terminal −10–15%.</p>
        : <div className="fv-results">
          <div><span>Fair value</span><strong>{result ? `${cur}${fmt(result.fair)}` : '—'}</strong><small>{result ? `${fmt(result.growthValue / result.fair * 100, 0)}% from stage 1` : ''}</small></div>
          <div><span>Price</span><strong>{Number.isFinite(price) ? `${cur}${fmt(price)}` : '—'}</strong><small>{Number.isFinite(price) && n.eps > 0 ? `P/E ${fmt(price / n.eps, 1)}` : ''}</small></div>
          <div><span>Margin of safety</span><strong className={mos == null ? '' : mos >= 0 ? 'positive' : 'negative'}>{mos == null ? '—' : pct(mos)}</strong><small>{mos == null ? '' : mos >= 0 ? 'below fair value' : 'above fair value'}</small></div>
          <div><span>Price implies</span><strong>{implied == null ? '—' : `${fmt(implied, 1)}%`}</strong><small>stage-1 growth / yr</small></div>
        </div>}
      <div className="fv-foot"><button type="button" className="button" onClick={reset}>Reset to defaults</button><span className="muted small">Two-stage earnings DCF, no perpetuity term. Defaults use trailing EPS and reported earnings growth capped at 20%. A model of assumptions, not a price target.</span></div>
    </div>
  </details>;
}
