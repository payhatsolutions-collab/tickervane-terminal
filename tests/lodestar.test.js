import test from 'node:test';
import assert from 'node:assert/strict';
import { createLodestarClient, validateSnapshot } from '../lib/lodestar.js';
import { statementReport, createMarketBridge } from '../public/lodestar/adapter.js';
import { readFile } from 'node:fs/promises';
import { viewFromLocation, viewURL } from '../src/navigation.js';
import handler from '../api/market.js';
const snapshot = () => ({
  meta: { symbol: 'TCS.NS', name: 'Test company', currency: 'INR', finCurrency: 'INR', asOf: '10 Nov 2026, 12:00', lastFY: 'FY26', price: 2500 },
  verdict: { action: 'HOLD', score: 72, coverage: .8, caps: ['Valuation caps the assessment'], buyAt: 65, sellBelow: 45 },
  pillars: ['sales', 'margins', 'eps', 'returns', 'forward', 'valuation'].map(key => ({ key, name: key, weight: 15, score: null, metrics: [{ label: 'Missing value', value: null, unit: 'pct' }] })),
  annual: [{ fy: 'FY26', revenue: 2e9, eps: -2 }], quarterly: [], bull: [{ text: 'Revenue grew', pillar: 'sales' }], bear: [], flags: [{ level: 'high', text: 'Concentration risk' }], notes: ['EPS adjusted for one-offs'],
  forward: { eps: [] }, valuation: {}, ttm: { eps: -1 },
});
const index = { items: [{ symbol: 'TCS.NS', name: 'Test company', file: '../../evil.json' }] };

test('Lodestar keeps original scores, normalizes NSE symbols, fixes upstream paths and deduplicates reads', async () => {
  const calls = [];
  const client = createLodestarClient(async url => { calls.push(url); return { ok: true, json: async () => url.endsWith('index.json') ? index : snapshot() }; });
  const [a, b] = await Promise.all([client('TCS'), client('TCS.NS')]);
  assert.equal(a.meta.symbol, 'TCS.NS'); assert.equal(a.verdict.score, 72); assert.deepEqual(a, b);
  assert.equal(calls.length, 2); assert.equal(calls[1], 'https://yashsarda31.github.io/lodestar/data/TCS.NS.json');
  assert.equal((await client('AAPL')).available, false); assert.equal(calls.length, 2);
  await assert.rejects(client('../secret'), /Invalid/);
});

test('failed refresh keeps last successful company snapshot and date with an explicit stale marker', async () => {
  let now = 0, failed = false;
  const client = createLodestarClient(async url => { if (failed) throw new Error('offline'); return { ok: true, json: async () => url.endsWith('index.json') ? index : snapshot() }; }, () => now);
  await client('TCS'); failed = true; now = 16 * 60000;
  const data = await client('TCS');
  assert.equal(data.stale, true); assert.match(data.warning, /last available/); assert.equal(data.meta.asOf, '10 Nov 2026, 12:00');
  await assert.rejects(client('AAPL'), /coverage could not refresh/);
});

test('NSE symbols with ampersands use Lodestar’s published filename convention', async () => {
  const calls = [];
  const client = createLodestarClient(async url => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith('index.json') ? { items: [{ symbol: 'M&M.NS', name: 'Mahindra' }] } : { ...snapshot(), meta: { ...snapshot().meta, symbol: 'M&M.NS' } } };
  });
  assert.equal((await client('M&M.NS')).meta.symbol, 'M&M.NS');
  assert.equal(calls[1], 'https://yashsarda31.github.io/lodestar/data/M_M.NS.json');
});

test('wrong-company and malformed upstream responses never become research for the selected company', async () => {
  assert.throws(() => validateSnapshot(snapshot(), 'AAPL'), /incomplete/);
  assert.throws(() => validateSnapshot({ ...snapshot(), pillars: [null] }, 'TCS.NS'), /incomplete/);
  assert.throws(() => validateSnapshot({ ...snapshot(), annual: [null] }, 'TCS.NS'), /incomplete/);
  const client = createLodestarClient(async () => ({ ok: false }));
  await assert.rejects(client('TCS'), /temporarily unavailable/);
});

test('fundamentals links retain the selected company across direct navigation and reload', () => {
  const url = viewURL('https://alphanova48.in/charts', { page: 'Fundamentals', symbol: 'TCS.NS', range: '6mo' }, { share: false });
  assert.equal(url, '/fundamentals?symbol=TCS.NS');
  assert.equal(viewFromLocation(new URL(url, 'https://alphanova48.in')).page, 'Fundamentals');
  assert.equal(viewFromLocation(new URL(url, 'https://alphanova48.in')).symbol, 'TCS.NS');
});

test('API rejects invalid snapshot paths before contacting upstream', async () => {
  let status, body;
  await handler({ method: 'GET', query: { op: 'lodestar', symbol: '../secret' }, headers: {}, socket: {} }, { setHeader() {}, status(n) { status = n; return this; }, json(data) { body = data; } });
  assert.equal(status, 400); assert.match(body.error, /Invalid/);
});


test('original Lodestar styling and markup are retained rather than recreated', async () => {
  const source = await readFile('vendor/lodestar/index.html', 'utf8');
  const css = await readFile('public/lodestar/lodestar.css', 'utf8');
  assert.equal(css, source.match(/<style>([\s\S]*?)<\/style>/)[1]);
  const html = await readFile('public/lodestar/index.html', 'utf8');
  assert.equal(html.match(/<body[\s\S]*?<script/)[0], source.match(/<body[\s\S]*?<script/)[0]);
  assert.match(html, /type="module" src="\.\/lodestar.js"/);
  assert.doesNotMatch(html, /<script>/);
  const app = await readFile('public/lodestar/lodestar.js', 'utf8');
  assert.ok(app.includes('market.analyze(hit)'));
  assert.ok(app.includes('e.origin!==location.origin||e.source!==parent'));
  const config=JSON.parse(await readFile('vercel.json','utf8'));
  const scoped=config.headers.find(row=>row.source==='/lodestar/:path*');
  assert.equal(scoped.headers.find(h=>h.key==='X-Frame-Options').value,'SAMEORIGIN');
  assert.ok(scoped.headers.find(h=>h.key==='Content-Security-Policy').value.includes("frame-ancestors 'self'"));
});

test('broad company financials fit the original UI without inventing scores or mixing annual and TTM periods', () => {
  const report=statementReport({symbol:'TEXINFRA.NS',peTrailing:188,epsTrailing:.7,roe:.0091,company:{currency:'INR',period:'TTM',netMargin:.5576,operatingMargin:-.408,history:[{period:'Mar 2026',revenue:174600000,eps:.87},{period:'TTM',revenue:165700000}],quarterlyHistory:[{period:'Sep 2026',revenue:4e7,eps:.23}]}},{price:131,currency:'INR',bars:[{time:'2026-10-01',close:130}]},{name:'Texmaco Infrastructure',exchange:'NSE'});
  assert.equal(report.verdict.action,'NO CALL');assert.equal(report.verdict.score,null);
  assert.ok(report.pillars.every(p=>p.score===null&&p.metrics.every(m=>m.score===null)));
  assert.equal(report.pillars.find(p=>p.key==='returns').metrics[0].value,.91);
  assert.equal(report.pillars.find(p=>p.key==='margins').metrics[0].value,-40.8);
  assert.equal(report.annual.length,1);assert.equal(report.annual[0].eps,.87);
  assert.equal(report.quarterly[0].eps,.23);assert.deepEqual(report.price,[['2026-10-01',130]]);
  assert.equal(report.forward.eps.length,0);
});

test('bridge searches the whole NSE directory and preserves published model calls', async () => {
  const calls=[];
  const bridge=createMarketBridge(async path=>{calls.push(path);let data;
    if(path==='/api/market?op=directory')data={stocks:[{symbol:'TEXINFRA',name:'Texmaco Infrastructure'},{symbol:'TCS',name:'TCS'}]};
    else if(path==='/api/market?op=lodestar')data=index;
    else if(path.includes('op=lodestar&'))data={...snapshot(),available:true};
    else if(path.includes('op=fundamentals'))data={symbol:'TEXINFRA.NS',company:{currency:'INR',history:[]}};
    else data={bars:[]};
    return {ok:true,json:async()=>data};});
  const ix=await bridge.index();assert.equal(ix.items.length,2);assert.equal(ix.fullCount,1);
  const full=await bridge.analyze(ix.items.find(i=>i.symbol==='TCS.NS'));
  assert.equal(full.verdict.action,'HOLD');assert.equal(full.verdict.score,72);
  const broad=await bridge.analyze(ix.items.find(i=>i.symbol==='TEXINFRA.NS'));
  assert.equal(broad.meta.symbol,'TEXINFRA.NS');assert.equal(broad.verdict.action,'NO CALL');
  assert.ok(calls.some(p=>p.includes('op=chart&symbol=TEXINFRA.NS&range=5y')));
});

test('companies outside snapshots run the original model before using statement-only fallback', async () => {
  const paths=[];
  const bridge=createMarketBridge(async path=>{
    paths.push(path);
    return {ok:true,json:async()=>({...snapshot(),meta:{...snapshot().meta,symbol:'TEGA.NS'},available:true,onDemand:true})};
  });
  const report=await bridge.analyze({symbol:'TEGA.NS',full:false});
  assert.equal(report.meta.symbol,'TEGA.NS');
  assert.equal(report.verdict.score,72);
  assert.equal(report.verdict.action,'HOLD');
  assert.deepEqual(paths,['/api/lodestar?symbol=TEGA.NS']);
});

test('wrong-listing or unavailable on-demand results fall back to the selected company statements', async () => {
  for(const wrongListing of [true,false]){
    const bridge=createMarketBridge(async path=>({ok:true,json:async()=>path.startsWith('/api/lodestar?')
      ? (wrongListing ? {...snapshot(),available:true} : {available:false})
      : path.includes('op=fundamentals') ? {symbol:'TEGA.NS',company:{history:[]}} : {bars:[]}}));
    const report=await bridge.analyze({symbol:'TEGA.NS',full:false});
    assert.equal(report.meta.symbol,'TEGA.NS');
    assert.equal(report.verdict.action,'NO CALL');
  }
});
