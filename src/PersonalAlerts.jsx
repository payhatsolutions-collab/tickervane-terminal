import { useEffect, useRef, useState } from 'react';
import { useFeed } from './hooks.js';
import { PERSONAL_METRICS, cleanPersonalRule, evaluatePersonalRules } from './personalAlerts.js';
import { PanelTitle } from './ui.jsx';
import { short } from './data.js';

export function PersonalAlertMonitor({ rules, setRules, setEvents, watch, refresh, notify }) {
  const enabled = rules.some(rule => cleanPersonalRule(rule)?.enabled);
  const feed = useFeed(enabled ? '/api/market?op=screen' : null, refresh);
  const handled = useRef(new Set());
  useEffect(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const result = evaluatePersonalRules(rules, feed.data, watch);
    const fresh = result.events.filter(event => !handled.current.has(event.id));
    if (!fresh.length) return;
    fresh.forEach(event => handled.current.add(event.id));
    setRules(result.rules);
    setEvents(current => [...fresh, ...current.filter(event => !fresh.some(next => next.id === event.id))].slice(0, 100));
    notify(`${fresh[0].name}: ${fresh[0].symbols.map(short).slice(0, 3).join(', ')}${fresh[0].symbols.length > 3 ? ` +${fresh[0].symbols.length - 3} more` : ''}. Review personalized alerts.`);
  }, [feed.data, rules, watch]);
  return null;
}

export default function PersonalAlerts({ rules, setRules, events, setEvents, watch, symbol, onOpen, refresh = 0 }) {
  const [metric, setMetric] = useState('breakout20');
  const [error, setError] = useState('');
  const enabled = rules.some(rule => cleanPersonalRule(rule)?.enabled);
  const feed = useFeed(enabled ? '/api/market?op=screen' : null, refresh);
  const choices = [...new Set([symbol, ...watch])].filter(s => /\.NS$/.test(s) && !s.startsWith('^'));
  const submit = event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rule = cleanPersonalRule({ id: crypto.randomUUID(), name: form.get('name') || PERSONAL_METRICS[metric].label,
      scope: form.get('scope'), metric, operator: form.get('operator') || 'min', threshold: metric === 'breakout20' ? 1 : Number(form.get('threshold')),
      frequency: form.get('frequency'), enabled: true });
    if (!rule) { setError('Enter a valid threshold. RSI must be 0–100; volume must be zero or greater.'); return; }
    if (rules.length >= 20) { setError('You can save up to 20 rules. Remove one to add another.'); return; }
    if (rules.some(r => r.scope === rule.scope && r.metric === rule.metric && r.operator === rule.operator && r.threshold === rule.threshold && r.enabled)) {
      setError('An active rule already watches this condition.'); return;
    }
    setRules(current => [...current, rule]); setError(''); event.currentTarget.reset(); setMetric('breakout20');
  };
  return <section className="panel research-tools">
    <PanelTitle title="Personalized alerts" tag="FOR YOU"><span>{rules.length} / 20 rules</span></PanelTitle>
    <p className="muted">Watch your NSE stocks for breakouts, momentum or unusual volume. These in-app alerts use the latest session snapshot, checked every five minutes while the app is visible. Saved on this device; no closed-app delivery for these rules.</p>
    {enabled && <p role="status" className="muted">{feed.loading ? 'Checking session data…' : feed.error ? `Session data could not refresh: ${feed.error}` : feed.data?.date ? `Latest available snapshot: ${feed.data.date}. Snapshots older than four days are ignored.` : 'Waiting for session data. No matches can be checked yet.'}</p>}
    <form className="personal-rule-form" onSubmit={submit}>
      <label>Alert name<input name="name" maxLength={80} placeholder="My breakout watch" /></label>
      <label>Watch<select name="scope"><option value="watchlist">My NSE watchlist</option>{choices.map(s => <option key={s} value={s}>{short(s)}</option>)}</select></label>
      <label>Signal<select value={metric} onChange={e => setMetric(e.target.value)}>{Object.entries(PERSONAL_METRICS).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}</select></label>
      {metric !== 'breakout20' && <><label>Condition<select name="operator"><option value="min">At or above</option><option value="max">At or below</option></select></label><label>Threshold ({PERSONAL_METRICS[metric].unit || 'value'})<input key={metric} name="threshold" type="number" step="any" required min={['rsi', 'volRatio'].includes(metric) ? 0 : undefined} max={metric === 'rsi' ? 100 : undefined} /></label></>}
      <label>Repeat<select name="frequency"><option value="once">Once, then pause</option><option value="daily">Once per matching session</option></select></label>
      <button className="button primary" disabled={rules.length >= 20}>Save personalized alert</button>
    </form>
    {error && <p role="alert" className="negative">{error}</p>}
    {!watch.some(s => /\.NS$/.test(s)) && <p className="muted">Your NSE watchlist is empty. Add stocks to your watchlist or choose an individual stock above.</p>}
    <div className="personal-rule-list">{rules.map(rule => <div key={rule.id}>
      <div><strong>{rule.name}</strong><p>{rule.scope === 'watchlist' ? 'My NSE watchlist' : short(rule.scope)} · {PERSONAL_METRICS[rule.metric]?.label}{rule.metric !== 'breakout20' ? ` ${rule.operator === 'min' ? '≥' : '≤'} ${rule.threshold}${PERSONAL_METRICS[rule.metric]?.unit || ''}` : ' · volume ≥ 1.3×'} · {rule.frequency === 'daily' ? 'Each matching session' : 'One time'}</p><small>{rule.enabled ? 'Watching' : 'Paused'}{rule.lastSession ? ` · Last match ${rule.lastSession}` : ''}</small></div>
      <button className="button" onClick={() => setRules(current => current.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))}>{rule.enabled ? 'Pause' : 'Resume'}</button>
      <button className="button" aria-label={`Delete ${rule.name}`} onClick={() => setRules(current => current.filter(r => r.id !== rule.id))}>Delete</button>
    </div>)}</div>
    <div className="insight-heading"><h3>Personalized alert history</h3>{events.length > 0 && <button className="button" onClick={() => setEvents([])}>Clear history</button>}</div>
    {!events.length ? <p className="muted">Matching signals appear here. A resumed rule will not repeat a match from the same session.</p> : <div className="personal-rule-list">{events.slice(0, 20).map(event => <div key={event.id}><div><strong>{event.name}</strong><p>Session {event.session} · Detected {new Date(event.at).toLocaleString()}</p><div className="insight-actions">{event.symbols.map(s => <button className="button" key={s} onClick={() => onOpen(s)}>{short(s)}</button>)}</div></div></div>)}</div>}
  </section>;
}
