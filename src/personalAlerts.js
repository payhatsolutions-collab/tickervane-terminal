export const PERSONAL_METRICS = {
  change: { label: 'Session change', unit: '%' },
  rsi: { label: 'RSI (14)', unit: '' },
  volRatio: { label: 'Volume vs 20 sessions', unit: '×' },
  rs3m: { label: 'Relative strength vs Nifty (3M)', unit: 'pts' },
  breakout20: { label: 'Confirmed 20-day breakout', unit: '' },
};
export function cleanPersonalRule(rule) {
  if (!rule || !Object.hasOwn(PERSONAL_METRICS, rule.metric) || !['min', 'max'].includes(rule.operator) || !['once', 'daily'].includes(rule.frequency)) return null;
  if (rule.scope !== 'watchlist' && !(typeof rule.scope === 'string' && /^[A-Z0-9][A-Z0-9&._-]{0,24}\.NS$/.test(rule.scope))) return null;
  if (typeof rule.id !== 'string' || !rule.id || !Number.isFinite(rule.threshold)) return null;
  if (rule.metric === 'rsi' && (rule.threshold < 0 || rule.threshold > 100)) return null;
  if (rule.metric === 'volRatio' && rule.threshold < 0) return null;
  return { id: rule.id.slice(0, 80), name: String(rule.name || PERSONAL_METRICS[rule.metric].label).slice(0, 80), scope: rule.scope,
    metric: rule.metric, operator: rule.operator, threshold: rule.threshold, frequency: rule.frequency,
    enabled: rule.enabled !== false, lastSession: /^\d{4}-\d{2}-\d{2}$/.test(rule.lastSession) ? rule.lastSession : null };
}
export function evaluatePersonalRules(rules, snapshot, watch = [], now = new Date()) {
  const date = snapshot?.date;
  const age = now.getTime() - Date.parse(`${date}T15:30:00+05:30`);
  // Reject missing, future or old snapshots rather than deliver stale signals.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(age) || age < 0 || age > 4 * 86400000 || !Array.isArray(snapshot.rows)) return { rules, events: [] };
  const events = [];
  const next = rules.map(raw => {
    const rule = cleanPersonalRule(raw);
    if (!rule || !rule.enabled || rule.lastSession === date) return raw;
    const matches = snapshot.rows.filter(row => {
      if (!(rule.scope === 'watchlist' ? watch.includes(`${row.symbol}.NS`) : rule.scope === `${row.symbol}.NS`)) return false;
      if (rule.metric === 'breakout20') return row.breakout20 === true && Number.isFinite(row.volRatio) && row.volRatio >= 1.3;
      const value = row[rule.metric];
      return Number.isFinite(value) && (rule.operator === 'min' ? value >= rule.threshold : value <= rule.threshold);
    });
    if (!matches.length) return raw;
    events.push({ id: `${rule.id}/${date}`, ruleId: rule.id, name: rule.name, session: date, at: now.toISOString(), symbols: matches.map(row => `${row.symbol}.NS`), metric: rule.metric });
    return { ...rule, lastSession: date, enabled: rule.frequency === 'daily' };
  });
  return { rules: events.length ? next : rules, events };
}
