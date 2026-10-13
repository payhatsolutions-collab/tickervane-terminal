import { readFile, writeFile } from 'node:fs/promises';
import { WORKSPACE_SEO, SITE_ORIGIN, SEO_UPDATED, robotsForPage } from '../src/seo.js';

import { PAGE_LABELS } from '../src/navigation.js';

const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const template = await readFile('dist/index.html', 'utf8');
for (const [page, seo] of Object.entries(WORKSPACE_SEO)) {
  const url = SITE_ORIGIN + seo.path;
  let html = template.replace(/<title>.*?<\/title>/, `<title>${esc(seo.title)}</title>`);
  for (const [attribute, key, value] of [
    ['name','description',seo.description], ['name','robots',robotsForPage(seo)], ['property','og:title',seo.title],
    ['property','og:description',seo.description], ['property','og:url',url],
    ['name','twitter:title',seo.title], ['name','twitter:description',seo.description],
  ]) html = html.replace(new RegExp(`(<meta ${attribute}="${key}" content=")[^"]*`), `$1${esc(value)}`);
  html = html.replace(/(<link rel="canonical" href=")[^"]*/, `$1${url}`);
  html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (_, json) => {
    const schema = JSON.parse(json);
    for (const node of schema['@graph']) if (node['@type'] === 'WebPage') Object.assign(node, {
      '@id':url+'#webpage', url, name:seo.title, description:seo.description, dateModified:SEO_UPDATED,
    });
    return `<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<','\\u003c')}</script>`;
  });
  html = html.replace(/<main class="seo-fallback">[\s\S]*?<\/main>/, `<main class="seo-fallback">
<h1>${esc(seo.heading)}</h1><p>${esc(seo.description)}</p>
<p>Use the interactive workspace to explore available data. JavaScript is required; market data may be delayed or unavailable.</p>
<p>Watchlists, holdings and trade records are stored in your browser. Personal records are not part of this public page.</p>
<nav aria-label="Research workspaces">${Object.entries(WORKSPACE_SEO).map(([key, item]) => `<a href="${item.path}">${esc(PAGE_LABELS[key])}</a>`).join(' · ')}</nav>
</main>`);
  // These entry pages immediately consume the same cached public screener feed.
  // Discover it with the HTML instead of waiting for React and the route chunk.
  if (page === 'Today' || page === 'Markets') {
    html = html.replace('</head>', '<link rel="preload" as="fetch" href="/api/market?op=screen" crossorigin="anonymous" />\n</head>');
  }
  await writeFile(page === 'Today' ? 'dist/index.html' : `dist${seo.path}.html`, html);
}
console.log(`Built ${Object.keys(WORKSPACE_SEO).length} workspace pages with unique HTML metadata.`);
