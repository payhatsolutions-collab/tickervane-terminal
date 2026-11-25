// Package only the public stock output for the zero-function Vercel origin.
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stage = await mkdtemp(join(tmpdir(), 'alphanova-stock-pages-'));
const output = join(stage, 'public');
await mkdir(output);
for (const file of ['stocks', 'stock-pages', 'stock-prices.html', 'sitemap.xml', 'llms.txt', 'seo.css',
  'favicon.svg', 'icon-192.png', 'google-tag.js', 'robots.txt']) {
  await cp(join('dist', file), join(output, file), { recursive: true });
}
await mkdir(join(output, 'share'));
for (const file of await readdir('dist/share')) {
  if (/^(?:overview|[A-Z0-9&-]+)\.png$/.test(file)) await cp(join('dist/share', file), join(output, 'share', file));
}
const site = JSON.parse(await readFile('vercel.json', 'utf8'));
const config = {
  framework: null, installCommand: '', buildCommand: '', outputDirectory: 'public',
  headers: site.headers.filter(rule => rule.source === '/(.*)'),
  redirects: [
    { source: '/', destination: 'https://alphanova48.in/stocks/', permanent: false },
    ...site.redirects.filter(rule => !rule.has && (rule.source.startsWith('/stocks/') || rule.source.startsWith('/stock-pages/'))),
  ],
  rewrites: site.rewrites.filter(rule => rule.source === '/stocks/:symbol'),
};
await writeFile(join(stage, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
await writeFile(join(stage, '.vercelignore'), '.env*\n.git*\n');
console.log(stage);
