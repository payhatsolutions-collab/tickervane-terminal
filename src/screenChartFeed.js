import { load } from './hooks.js';

// Load only visible previews, with three upstream requests running at a time.
const queue = [];
let active = 0;
function drain() {
  while (active < 3 && queue.length) {
    const task = queue.shift();
    active++;
    load(task.url, task.force).then(task.resolve, task.reject).finally(() => { active--; drain(); });
  }
}
export function loadDailyChart(symbol, force = false) {
  return new Promise((resolve, reject) => {
    queue.push({ url: `/api/market?op=chart&symbol=${encodeURIComponent(symbol)}&range=1y`, force, resolve, reject });
    drain();
  });
}
export function loadScreenChart(symbol, force = false) {
  return loadDailyChart(symbol + '.NS', force);
}
