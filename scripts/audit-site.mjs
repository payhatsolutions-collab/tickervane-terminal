// Read-only release smoke check; never creates users, sends push, or places orders.
import { writeFile } from 'node:fs/promises';
import { WORKSPACE_SEO } from '../src/seo.js';

const origin = process.argv[2] || 'https://alphanova48.in';
const output = process.argv[3];
const paths = [...Object.values(WORKSPACE_SEO).map(page => page.path),
  '/about.html', '/privacy.html', '/manifest.webmanifest', '/sw.js',
  '/api/market?op=quotes&symbols=%5ENSEI,RELIANCE.NS,AAPL',
  '/api/market?op=chart&symbol=RELIANCE.NS&range=1d',
  '/api/market?op=chart&symbol=TCS.NS&range=5y&adjusted=1&daily=1',
  '/api/market?op=screen', '/api/market?op=delivery', '/api/market?op=delivery&symbol=TCS',
  '/api/market?op=fundamentals&symbol=TCS.NS', '/api/market?op=news&symbol=TCS.NS',
  '/api/market?op=options&symbol=NIFTY', '/api/market?op=live-futures&group=nse50_fut',
  '/api/market?op=futures', '/api/market?op=flows', '/api/market?op=deals',
  '/api/market?op=rotation', '/api/market?op=directory', '/api/push?op=vapid', '/api/signup?op=status',
];
const results = [];
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < paths.length) {
    const path = paths[cursor++], start = performance.now();
    let result;
    try {
      const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(65000) });
      const body = await response.text();
      const json = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(body) : null;
      result = { path, status: response.status, ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(body),
        cache: response.headers.get('x-vercel-cache'), ...(json ? { keys: Object.keys(json), rows: json.rows?.length,
          bars: json.bars?.length, quotes: json.quotes?.length, error: json.error, date: json.date } : {}) };
    } catch (error) { result = { path, error: error.message, ms: Math.round(performance.now() - start) }; }
    results.push(result);
    console.log(JSON.stringify(result));
  }
}));
if (output) await writeFile(output, JSON.stringify({ origin, checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
if (results.some(result => result.status !== 200)) process.exitCode = 1;
