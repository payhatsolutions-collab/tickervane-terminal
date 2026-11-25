// Vite's SPA fallback would otherwise return the terminal homepage for every
// /stocks URL. Mirror the deployed static routes in development and preview.
import { readFile } from 'node:fs/promises';

export function stockPageRoutes(dev) {
  let build;
  return async (req, res, next) => {
    const raw = (req.url || '/').split('?')[0];
    if (!/^\/(stocks|stock-pages)(\/|$)/.test(raw) && !(dev && (raw.startsWith('/share/') || raw === '/sitemap.xml'))) return next();
    let path;
    try { path = decodeURIComponent(raw); } catch { res.statusCode = 400; return res.end(); }
    const alias = /^\/stock-pages\/([A-Z0-9&-]+)\.html$/.exec(path);
    const group = /^\/stocks\/by-symbol\/(0-9|[a-z])(?:\/index\.html|\/)?$/.exec(path);
    const symbol = /^\/stocks\/([A-Z0-9&-]+)\/?$/.exec(path)?.[1];
    const share = dev && /^\/share\/(?:overview|[A-Z0-9&-]+)\.png$/.test(path);
    let file, canonical;
    if (alias || symbol) {
      canonical = '/stocks/' + encodeURIComponent(alias?.[1] || symbol);
      file = 'dist/stock-pages/' + (alias?.[1] || symbol) + '.html';
    } else if (path === '/stocks' || path === '/stocks/' || path === '/stocks/index.html' || group) {
      canonical = group ? '/stocks/by-symbol/' + group[1] + '/' : '/stocks/';
      file = 'dist' + canonical + 'index.html';
    } else if (share || (dev && path === '/sitemap.xml')) file = 'dist' + path;
    if (canonical && canonical !== raw) {
      res.writeHead(308, { Location: canonical });
      return res.end();
    }
    try {
      if (file) {
        if (dev) { build ??= import('./build-stock-pages.mjs'); await build; }
        const content = await readFile(file);
        res.setHeader('Content-Type', share ? 'image/png' : path === '/sitemap.xml' ? 'application/xml' : 'text/html; charset=utf-8');
        return res.end(content);
      }
    } catch (error) { if (error.code !== 'ENOENT') return next(error); }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Stock page not found.');
  };
}
