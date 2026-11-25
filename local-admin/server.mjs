import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { list, get, put } from '@vercel/blob';
import { blobOptions, readJson } from '../lib/authStore.js';
import { reviewRecord } from '../lib/pro.js';
import { loadRegistrations } from './registrations.mjs';

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, '..');
try { process.loadEnvFile(resolve(root, '.env.local')); } catch { /* Existing environment may provide storage access. */ }
const port = Number(process.env.USERS_PORT) || 5188;
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

const registrations = () => loadRegistrations({ list, get });

// Pro access claimed with a UPI reference. Access is instant, so these are reviewed afterwards.
const proPath = id => `pro/accounts/google-${id}.json`;
async function proPayments() {
  const ids = [];
  let cursor;
  do {
    const page = await list({ prefix: 'pro/accounts/', limit: 1000, cursor });
    ids.push(...page.blobs.map(blob => /^pro\/accounts\/google-([a-f0-9]{64})\.json$/.exec(blob.pathname)?.[1]).filter(Boolean));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  const accounts = [];
  let unavailable = 0;
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async id => {
      try {
        const value = await readJson(proPath(id));
        if (!value || !Array.isArray(value.payments)) throw new Error('Invalid record');
        accounts.push({ id, name: text(value.name, 80), email: text(value.email, 254), note: text(value.note, 12), status: text(value.status, 20),
          expiresAt: Number.isFinite(value.expiresAt) ? value.expiresAt : 0,
          payments: value.payments.map(payment => ({ utr: text(payment.utr, 12), note: text(payment.note, 12), amount: Number(payment.amount) || 0, claimedAt: text(payment.claimedAt, 40),
            periodEnd: Number.isFinite(payment.periodEnd) ? payment.periodEnd : 0, dateMatch: payment.dateMatch === true, status: text(payment.status, 20) })) });
      } catch { unavailable++; }
    }));
  }
  return { accounts, unavailable, updatedAt: new Date().toISOString() };
}
async function requestJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2000) throw new Error('Too large'); }
  return JSON.parse(raw);
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
  const url = new URL(req.url, address);
  const storage = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
  // The only write this viewer makes: recording your review of a Pro payment.
  if (req.method === 'POST' && url.pathname === '/api/pro/review') {
    if (!origins.has(req.headers.origin) || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 403, { error: 'Open this viewer directly on this computer.' });
    if (!storage) return json(res, 503, { error: 'Storage is not connected.' });
    try {
      const { id, action } = await requestJson(req);
      if (!/^[a-f0-9]{64}$/.test(id || '')) return json(res, 400, { error: 'Unknown account.' });
      const record = await readJson(proPath(id));
      const next = record && reviewRecord(record, action);
      if (!next) return json(res, 400, { error: 'That change is not available for this account.' });
      await put(proPath(id), JSON.stringify(next), { ...blobOptions, allowOverwrite: true });
      return json(res, 200, { ok: true });
    } catch { return json(res, 503, { error: 'Couldn’t save the review. Check your connection and try again.' }); }
  }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(res, 405, { error: 'Only Pro payment reviews can be changed here.' }); }
  try {
    if (url.pathname === '/api/pro') {
      if (!storage) return json(res, 503, { error: 'Storage is not connected. Restore the project’s local storage configuration, then restart this viewer.' });
      return json(res, 200, await proPayments());
    }
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
  console.log(`AlphaNova users: ${address}\nLocal to this computer · no password\nKeep this process open while using the viewer.`);
  if (process.argv.includes('--open')) openBrowser();
});
