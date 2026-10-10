import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PRESETS, describe, presetFromSearch } from '../src/screens.js';
import { guides } from '../content/seo/screens.mjs';

const origin = 'https://alphanova48.in';
const decode = s => s.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'");
const localFile = path => path === '/' ? 'index.html' : 'public'+(path.endsWith('/')?path+'index.html':path);

test('guide deep links select only known presets in the screener workspace', () => {
  for (const p of PRESETS) assert.equal(presetFromSearch('?page=Screener&screen='+p.id),p.id);
  for (const q of ['', '?screen=volume', '?page=Today&screen=volume', '?page=Screener&screen=custom', '?page=Screener&screen=unknown']) assert.equal(presetFromSearch(q),null);
});

test('public guide generation preserves rules, canonicals, structured data and local links', async () => {
  execFileSync(process.execPath,['scripts/generate-seo.mjs']);
  const sitemap = await readFile('public/sitemap.xml','utf8');
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
  assert.equal(new Set(urls).size,urls.length);
  assert.equal(urls.length,15);
  const titles = new Set();
  const descriptions = new Set();
  for (const url of urls) {
    assert.equal(new URL(url).origin,origin);
    assert.equal(new URL(url).search,'');
    const html = await readFile(localFile(new URL(url).pathname),'utf8');
    assert.ok(!html.includes('tickervane.vercel.app'),`Old domain in public metadata: ${url}`);
    assert.equal((html.match(/<h1[ >]/g)||[]).length,1,url);
    assert.equal((html.match(/rel="canonical"/g)||[]).length,1,url);
    assert.ok(html.includes(`rel="canonical" href="${url}"`),url);
    assert.ok(!/<meta[^>]+content="[^"]*noindex/.test(html),url);
    const title = html.match(/<title>(.*?)<\/title>/)[1];
    const description = html.match(/name="description" content="(.*?)"/)[1];
    assert.ok(!titles.has(title),`Duplicate title: ${title}`); titles.add(title);
    assert.ok(!descriptions.has(description),`Duplicate description: ${description}`); descriptions.add(description);
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(schemas.length,url);
    const graph = schemas.flatMap(m=>JSON.parse(m[1])['@graph']);
    assert.ok(graph.some(x=>x.url===url),url);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const target = new URL(decode(match[1]),url);
      if (target.origin!==origin) continue;
      const path = target.pathname;
      if (path.startsWith('/src/')) { assert.ok((await stat(path.slice(1))).isFile()); continue; }
      assert.ok((await stat(localFile(path))).isFile(),`${url} → ${path}`);
      if (target.searchParams.has('screen')) assert.ok(presetFromSearch(target.search));
    }
  }
  for (const guide of guides) {
    const html = decode(await readFile('public/screens/'+guide.slug+'.html','utf8'));
    const preset = PRESETS.find(x=>x.id===guide.id);
    for (const rule of preset.when) assert.ok(html.includes(describe([rule])),`${guide.id} rule drift`);
    assert.ok(html.includes(guide.example));
    assert.ok(html.includes(guide.caveat));
    assert.ok(urls.includes(origin+'/screens/'+guide.slug+'.html'));
  }
  const root = await readFile('index.html','utf8');
  const robots = await readFile('public/robots.txt','utf8');
  assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
  const hub = await readFile('public/screens.html','utf8');
  assert.ok(root.includes('href="/screens.html"'));
  for (const g of guides) assert.ok(hub.includes(`/screens/${g.slug}.html`));
  const first = await readFile('public/sitemap.xml','utf8');
  execFileSync(process.execPath,['scripts/generate-seo.mjs']);
  assert.equal(await readFile('public/sitemap.xml','utf8'),first,'Build must not change lastmod');
});
