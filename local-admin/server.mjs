import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { list, get } from '@vercel/blob';

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, '..');
try { process.loadEnvFile(resolve(root, '.env.local')); } catch { /* Existing environment may provide storage access. */ }
const port = 5188;
const address = `http://127.0.0.1:${port}`;
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const origins = new Set([address, `http://localhost:${port}`]);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
let cached;
let pending;

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function registrations() {
  const paths = [];
  let cursor;
  do {
    const page = await list({ prefix: 'signups/', limit: 1000, cursor });
    paths.push(...page.blobs.filter(blob => /^signups\/[a-f0-9]{64}\.json$/.test(blob.pathname)).map(blob => blob.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const users = [];
  let unavailable = 0;
  for (let i = 0; i < paths.length; i += 8) {
    await Promise.all(paths.slice(i, i + 8).map(async path => {
      try {
        const result = await get(path, { access: 'private', useCache: false });
        if (!result || result.statusCode !== 200) throw new Error('Unavailable record');
        const value = JSON.parse(await new Response(result.stream).text());
        if (typeof value.name !== 'string' || typeof value.email !== 'string') throw new Error('Invalid record');
        users.push({
          id: path.slice('signups/'.length, -5),
          name: value.name.slice(0, 80), email: value.email.slice(0, 254),
          createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
          emailVerified: value.emailVerified === true,
          noticeVersion: typeof value.noticeVersion === 'string' ? value.noticeVersion.slice(0, 40) : null,
          source: typeof value.source === 'string' ? value.source.slice(0, 80) : 'free-signup',
        });
      } catch { unavailable++; }
    }));
  }
  users.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return { users, unavailable, updatedAt: new Date().toISOString() };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  // A loopback bind plus exact Host/Origin checks prevents exposing this
  // password-free viewer to the LAN, cross-site requests, or DNS rebinding.
  if (!hosts.has(req.headers.host) ||
      (req.headers.origin && !origins.has(req.headers.origin)) ||
      (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
    return json(res, 403, { error: 'Open this viewer directly on this computer.' });
  }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Read-only viewer.' }); }
  const url = new URL(req.url, address);
  try {
    if (url.pathname === '/api/users') {
      if (!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)) {
        return json(res, 503, { error: 'Registration storage is not connected. Restore the project’s local storage configuration, then restart this viewer.' });
      }
      if (!cached || Date.now() - Date.parse(cached.updatedAt) > 60_000 || url.searchParams.get('refresh') === '1') {
        if (!pending) pending = registrations().then(value => { cached = value; return value; }).finally(() => { pending = undefined; });
        await pending;
      }
      return json(res, 200, cached);
    }
    const file = files.get(url.pathname);
    if (!file) return json(res, 404, { error: 'Not found.' });
    const body = await readFile(resolve(folder, file[0]));
    res.writeHead(200, { 'Content-Type': file[1] });
    res.end(body);
  } catch {
    json(res, 503, { error: 'Couldn’t load registrations. Check your connection and try Refresh.' });
  }
});
function openBrowser() {
  const browser = spawn('open', [address], { stdio: 'ignore' });
  browser.on('error', () => console.log(`Open ${address} in your browser.`));
}
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `The viewer is already running, or port ${port} is in use. Open ${address}.` : 'The local viewer could not start.');
  if (error.code === 'EADDRINUSE' && process.argv.includes('--open')) openBrowser();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`AlphaNova users: ${address}\nLocal to this computer · read-only · no password\nKeep this process open while using the viewer.`);
  if (process.argv.includes('--open')) openBrowser();
});
