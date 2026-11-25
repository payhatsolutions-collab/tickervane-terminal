import { readFile, writeFile } from 'node:fs/promises';
import { recentSessions } from '../lib/nse.js';
import { candlesFromSessions } from '../lib/nseHistory.js';
// Keep the last verified snapshot when a provider is down; its original source
// dates remain visible. Never manufacture a fresh market-data timestamp.
export async function refreshPublicData() {
  try {
    const [screen, delivery, sessions] = await Promise.all([
      ...['screen', 'delivery&minTurnover=0'].map(async op => {
        const r = await fetch(`https://alphanova48.in/api/market?op=${op}`, { signal: AbortSignal.timeout(45000) });
        if (!r.ok) throw Error(`Market snapshot returned ${r.status}`);
        return r.json();
      }), recentSessions(21),
    ]);
    if (screen.rows?.length < 400 || !delivery.rows?.length || !sessions.length) throw Error('Incomplete snapshot');
    await writeFile('content/stock-snapshot.json', JSON.stringify({ screen, delivery }));
    await writeFile('content/nse-history.json', JSON.stringify(Object.fromEntries(
      screen.rows.map(({symbol}) => [symbol + '.NS', candlesFromSessions(sessions, symbol)]))));
    console.log(`Refreshed ${screen.rows.length} stock snapshots through ${screen.date}.`);
  } catch (error) {
    const previous = JSON.parse(await readFile('content/stock-snapshot.json', 'utf8'));
    if (!previous.screen?.rows?.length) throw error;
    console.log(`Using last verified stock snapshot (${previous.screen.date}): ${error.message}`);
  }
}
if (process.argv[1]?.endsWith('refresh-public-data.mjs')) await refreshPublicData();
