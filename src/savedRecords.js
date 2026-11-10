// Shared validation for browser storage and imported backups.
export const validSavedSymbol = value => typeof value === 'string' && /^[A-Z0-9^][A-Z0-9._^=&-]{0,24}$/.test(value);
const text = value => typeof value === 'string' ? value : undefined;
const positive = value => (typeof value === 'number' || typeof value === 'string') && Number.isFinite(Number(value)) && Number(value) > 0;
const idFor = (record, index, kind) => text(record.id) || `${kind}-${index}`;

export function cleanPositions(values) {
  return (Array.isArray(values) ? values : []).flatMap((p, i) => {
    if (!p || !validSavedSymbol(p.symbol) || !positive(p.quantity) || !positive(p.cost)) return [];
    return [{ id: idFor(p, i, 'holding'), symbol: p.symbol, quantity: Number(p.quantity), cost: Number(p.cost),
      currency: typeof p.currency === 'string' && /^[A-Za-z]{3}$/.test(p.currency) ? p.currency : 'Unknown' }];
  });
}

export function cleanPriceAlerts(values) {
  return (Array.isArray(values) ? values : []).flatMap((a, i) => {
    if (!a || !validSavedSymbol(a.symbol) || !positive(a.price) || !['above', 'below'].includes(a.condition)) return [];
    return [{ id: idFor(a, i, 'alert'), symbol: a.symbol, price: Number(a.price), condition: a.condition,
      created: positive(a.created) ? Number(a.created) : Date.now(), triggered: a.triggered === true,
      triggeredAt: text(a.triggeredAt), deduped: a.deduped === true }];
  });
}

export function cleanDeliveryHistory(values) {
  return (Array.isArray(values) ? values : []).flatMap((h, i) => {
    if (!h || typeof h !== 'object' || !Number.isFinite(Date.parse(h.at)) ||
        !(validSavedSymbol(h.symbol) || (typeof h.title === 'string' && h.title))) return [];
    return [{ id: idFor(h, i, 'delivery'), at: h.at, symbol: validSavedSymbol(h.symbol) ? h.symbol : undefined,
      kind: text(h.kind), title: text(h.title), body: text(h.body), condition: text(h.condition),
      channel: ['push', 'notification', 'deduped', 'in-app'].includes(h.channel) ? h.channel : 'in-app',
      target: positive(h.target) ? Number(h.target) : null, observed: positive(h.observed) ? Number(h.observed) : null,
      dedup: text(h.dedup), alertId: text(h.alertId) }];
  }).slice(0, 200);
}
