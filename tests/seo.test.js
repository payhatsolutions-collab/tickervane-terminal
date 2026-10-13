import { WORKSPACE_SEO, updatePageMetadata, robotsForPage } from '../src/seo.js';
import { viewFromLocation } from '../src/navigation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PRESETS, describe, presetFromSearch } from '../src/screens.js';
import { guides } from '../content/seo/screens.mjs';

const origin = 'https://alphanova48.in';
const decode = s => s.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'");
const localFile = path => path === '/' ? 'dist/index.html' : 'dist'+(Object.values(WORKSPACE_SEO).some(p=>p.path===path)?path+'.html':path.endsWith('/')?path+'index.html':path);

test('guide deep links select only known presets in the screener workspace', () => {
  for (const p of PRESETS) assert.equal(presetFromSearch('?page=Screener&screen='+p.id),p.id);
  for (const q of ['', '?screen=volume', '?page=Today&screen=volume', '?page=Screener&screen=custom', '?page=Screener&screen=unknown']) assert.equal(presetFromSearch(q),null);
});

test('public guide generation preserves rules, canonicals, structured data and local links', async () => {
  execFileSync('npm',['run','build']);
  const sitemap = await readFile('public/sitemap.xml','utf8');
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
  assert.equal(new Set(urls).size,urls.length);
  assert.equal(urls.length,23);
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
    assert.ok(decode(title).length >= 40 && decode(title).length <= 60, `Title length ${decode(title).length}: ${title}`);
    assert.ok(decode(description).length >= 140 && decode(description).length <= 154, `Description length ${decode(description).length}: ${url}`);
    assert.ok(html.includes(`property="og:url" content="${url}"`));
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
      if (path === '/api/market') {
        assert.equal(target.search, '?op=screen', 'only the public screen feed is preloaded');
        assert.ok(html.includes('<link rel="preload" as="fetch" href="/api/market?op=screen" crossorigin="anonymous" />'));
        continue;
      }
      if (path.startsWith('/src/')) { assert.ok((await stat(path.slice(1))).isFile()); continue; }
      assert.ok((await stat(localFile(path))).isFile(),`${url} → ${path}`);
      if (target.searchParams.has('screen')) assert.ok(presetFromSearch(target.search+"&page="+viewFromLocation(target).page));
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

test('workspace HTML uses descriptive headings and excludes device-local shells from indexing', async () => {
  const sitemap = await readFile('public/sitemap.xml', 'utf8');
  for (const [page, seo] of Object.entries(WORKSPACE_SEO)) {
    const html = await readFile(localFile(seo.path), 'utf8');
    assert.equal(decode(html.match(/<h1>(.*?)<\/h1>/)[1]), seo.heading, page);
    assert.ok(html.includes(`name="robots" content="${robotsForPage(seo)}"`), page);
    assert.equal(sitemap.includes(`<loc>${origin + seo.path}</loc>`), !seo.noindex, page);
  }
  assert.equal(WORKSPACE_SEO.Today.heading, 'Alpha Nova: Indian Stock Market Overview');
  assert.equal(WORKSPACE_SEO.Screener.heading, 'Nifty 500 Stock Screener');
  assert.equal(WORKSPACE_SEO.Delivery.heading, 'NSE Delivery Volume & Percentage Analysis');
  assert.equal(WORKSPACE_SEO.Terminal.heading, 'Stock Charts & Technical Analysis');
  assert.equal(WORKSPACE_SEO.Flows.heading, 'FII DII Data & NSE Bulk and Block Deals');
  const graph = JSON.parse((await readFile('dist/index.html','utf8')).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const website = graph.find(x => x['@type'] === 'WebSite');
  assert.equal(website.name, 'Alpha Nova');
  assert.ok(website.alternateName.includes('AlphaNova'));
});

test('client navigation restores robots, canonical and structured metadata in both directions', () => {
  const attributes = new Map();
  const script = {textContent: JSON.stringify({'@graph': [{'@type':'WebPage'}, {'@type':'WebSite', name:'Alpha Nova'}]})};
  const doc = {
    title: '',
    querySelector: selector => ({setAttribute: (name, value) => attributes.set(selector + ':' + name, value)}),
    querySelectorAll: () => [script],
  };
  for (const page of ['Today','Watchlist','Screener','Portfolio','Delivery','Journal','Alerts','Today']) {
    updatePageMetadata(page, doc);
    const seo = WORKSPACE_SEO[page];
    assert.equal(doc.title, seo.title);
    assert.equal(attributes.get('meta[name="robots"]:content'), robotsForPage(seo));
    assert.equal(attributes.get('link[rel="canonical"]:href'), origin + seo.path);
    assert.equal(attributes.get('meta[property="og:url"]:content'), origin + seo.path);
    assert.equal(attributes.get('meta[name="description"]:content'), seo.description);
    const graph = JSON.parse(script.textContent)['@graph'];
    assert.equal(graph[0].url, origin + seo.path);
    assert.equal(graph[0].name, seo.title);
    assert.equal(graph[1].name, 'Alpha Nova');
  }
});

test('hosting redirects www to the apex and keeps private robots directives separate', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const redirect = config.redirects.find(r => r.has?.some(h => h.type === 'host' && h.value === 'www.alphanova48.in'));
  assert.equal(redirect.source, '/:path*');
  assert.equal(redirect.destination, origin + '/:path*');
  assert.equal(redirect.permanent, true);
  const privateRule = config.headers.find(h => h.source.startsWith('/:path(watchlist|'));
  assert.equal(privateRule.headers.find(h => h.key === 'X-Robots-Tag').value, 'noindex, follow');
  const publicRule = config.headers.find(h => h.source.startsWith('/:path(charts|'));
  for (const path of ['watchlist','portfolio','trade-journal','price-alerts']) assert.ok(!publicRule.source.includes(path));
});
