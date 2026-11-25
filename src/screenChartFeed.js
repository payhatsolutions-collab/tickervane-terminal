import { load } from './hooks.js';

// Load only visible previews, with three upstream requests running at a time.
const queue = [];
const requests = new Map();
let active = 0;
function drain() {
  while (active < 3 && queue.length) {
    const task = queue.shift();
    active++;
    load(task.url, task.force).then(task.resolve, task.reject).finally(() => { active--; drain(); });
  }
}
export function loadDailyChart(symbol, force = false) {
  const url = `/api/market?op=chart&symbol=${encodeURIComponent(symbol)}&range=1y`;
  // Deduplicate before queueing so repeated rows/StrictMode do not occupy slots
  // or replay a forced refresh once the first request has already completed.
  if (requests.has(url)) return requests.get(url);
  const request = new Promise((resolve, reject) => {
    queue.push({ url, force, resolve, reject });
    drain();
  }).finally(() => {
    if (requests.get(url) === request) requests.delete(url);
  });
  requests.set(url, request);
  return request;
}
export function loadScreenChart(symbol, force = false) {
  return loadDailyChart(symbol + '.NS', force);
}
