import { normalizeSymbol } from '../src/symbols.js';

const ORIGIN = 'https://yashsarda31.github.io/lodestar/data/';
const TTL = 15 * 60 * 1000;
const valid = symbol => /^[A-Z0-9][A-Z0-9.&_-]{0,24}$/.test(symbol);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateSnapshot(data, symbol) {
  if (!object(data?.meta) || data.meta.symbol !== symbol || typeof data.meta.name !== 'string' ||
      !object(data.verdict) || !Array.isArray(data.pillars) || data.pillars.length !== 6 ||
      !['sales', 'margins', 'eps', 'returns', 'forward', 'valuation'].every(key =>
        data.pillars.filter(p => object(p) && p.key === key && typeof p.name === 'string' &&
          Array.isArray(p.metrics) && p.metrics.every(object)).length === 1) ||
      !['annual', 'quarterly', 'bull', 'bear', 'flags', 'notes'].every(key => Array.isArray(data[key])) ||
      !['annual', 'quarterly', 'bull', 'bear', 'flags'].every(key => data[key].every(object)) ||
      !data.notes.every(note => typeof note === 'string') ||
      !object(data.forward) || !Array.isArray(data.forward.eps) || !data.forward.eps.every(object) ||
      !object(data.valuation)) throw new Error('Lodestar returned an incomplete company snapshot. Please retry.');
  return data;
}

// Fixed-origin reads only. Keep original per-company dates even when the index is newer.
export function createLodestarClient(fetcher = (...args) => fetch(...args), now = () => Date.now()) {
  const cache = new Map(), pending = new Map();
  async function read(file, validate) {
    const old = cache.get(file);
    if (old && now() - old.at < TTL) return old.data;
    if (pending.has(file)) return pending.get(file);
    const work = (async () => {
      try {
        const response = await fetcher(ORIGIN + encodeURIComponent(file), { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Lodestar snapshots are temporarily unavailable. Please retry.');
        const data = validate(await response.json());
        if (cache.size >= 300) cache.delete(cache.keys().next().value);
        cache.set(file, { data, at: now() });
        return data;
      } catch (error) {
        if (old) return { ...old.data, stale: true, warning: 'Lodestar could not refresh. Showing the last available snapshot.' };
        throw error;
      }
    })().finally(() => pending.delete(file));
    pending.set(file, work);
    return work;
  }
  return async function lodestar(input = '') {
    const symbol = normalizeSymbol(String(input).trim().toUpperCase());
    if (symbol && !valid(symbol)) throw new Error('Invalid company symbol');
    const index = await read('index.json', data => {
      if (!Array.isArray(data?.items) || !data.items.length || data.items.some(row =>
        !object(row) || typeof row.symbol !== 'string' || !valid(row.symbol) || typeof row.name !== 'string')) {
        throw new Error('Lodestar company directory is unavailable. Please retry.');
      }
      return { builtAt: data.builtAt, items: data.items.map(({ symbol, name, short, exchange, score }) => ({ symbol, name, short, exchange, score })) };
    });
    if (!symbol) return index;
    if (!index.items.some(row => row.symbol === symbol)) {
      // A stale directory cannot establish that a company is unsupported.
      if (index.stale) throw new Error('Lodestar coverage could not refresh. Please retry.');
      return { symbol, available: false, reason: 'This company is not in Lodestar’s published coverage yet.' };
    }
    // Match Lodestar's build_static.py filename convention (M&M.NS → M_M.NS.json).
    const file = symbol.replace(/[^A-Za-z0-9.\-]/g, '_') + '.json';
    const data = await read(file, data => validateSnapshot(data, symbol));
    return { ...data, available: true };
  };
}

export const lodestar = createLodestarClient();
