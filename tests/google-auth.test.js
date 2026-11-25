import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createAuthHandler, googleVerifier, sessionKey, SESSION_SECONDS } from '../lib/googleAuth.js';

function harness(overrides = {}) {
  let clock = Date.now();
  const records = new Map(), accounts = [], jar = {};
  const settings = { clientId: 'our-client', secret: 'x'.repeat(40), storage: true };
  let claims = { sub: 'google-user-123', name: 'Test Reader', email: 'reader@example.com', email_verified: true };
  let verified = 0;
  const handler = createAuthHandler({ config: () => settings, now: () => clock,
    verify: async (credential, audience) => { verified++; assert.equal(audience, settings.clientId); if (credential !== 'signed-token') throw Error('private verification detail'); return claims; },
    sessions: { read: async key => records.get(key), write: async (key, value) => records.set(key, value), remove: async key => records.delete(key) },
    saveAccount: async value => accounts.push(value), ...overrides,
  });
  async function call(op, body, extra = {}) {
    let status, data; const headers = {};
    await handler({ method: body === undefined ? 'GET' : 'POST', query: { op }, body,
      headers: { origin: 'https://alphanova48.in', 'content-type': 'application/json', cookie: Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; '), ...extra.headers }, ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'headers')),
    }, { setHeader: (k, v) => { headers[k] = v; }, status: value => { status = value; return { json: value => { data = value; } }; } });
    for (const value of [headers['Set-Cookie']].flat().filter(Boolean)) {
      const [pair] = value.split(';'), i = pair.indexOf('=');
      if (value.includes('Max-Age=0')) delete jar[pair.slice(0, i)]; else jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return { status, data, headers };
  }
  async function challenge() { const result = await call('challenge'); claims.nonce = result.data.nonce; return result.data.nonce; }
  return { call, challenge, jar, records, accounts, settings, claims, advance: ms => { clock += ms; }, verified: () => verified };
}

test('Google login persists verified identity and a revocable HttpOnly session, then survives reload', async () => {
  const h = harness();
  assert.deepEqual((await h.call('session')).data, { configured: true, clientId: 'our-client', user: null });
  const nonce = await h.challenge();
  const result = await h.call('google', { nonce, credential: 'signed-token', name: 'Attacker', email: 'other@example.com' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.user, { name: 'Test Reader', email: 'reader@example.com' });
  assert.equal(h.accounts[0].googleSubject, 'google-user-123');
  assert.equal(h.accounts[0].source, 'google');
  assert.ok(result.headers['Set-Cookie'][0].includes('HttpOnly; SameSite=Lax; Max-Age=604800; Secure'));
  const token = h.jar['__Host-an-session'];
  assert.ok(h.records.has(sessionKey(token)));
  assert.equal(JSON.stringify([...h.records]).includes(token), false);
  assert.equal((await h.call('session')).data.user.email, 'reader@example.com');
  assert.equal((await h.call('logout', {})).status, 200);
  assert.equal(h.records.size, 0);
  // Even a copied session cookie is invalidated by sign-out.
  assert.equal((await h.call('session', undefined, { headers: { cookie: `__Host-an-session=${token}` } })).data.user, null);
});

test('unverified local signup names cannot establish a Google session', async () => {
  const h = harness();
  assert.equal((await h.call('session', undefined, { headers: { cookie: 'an2-signup-profile-v1=Reader; __Host-an-session=fake' } })).data.user, null);
  const nonce = await h.challenge();
  h.claims.email_verified = false;
  assert.equal((await h.call('google', { nonce, credential: 'signed-token' })).status, 401);
  assert.equal(h.accounts.length, 0); assert.equal(h.records.size, 0);
});

test('login rejects cross-origin, non-JSON, malformed, oversized and missing challenge requests', async () => {
  const h = harness(); const nonce = await h.challenge(); const body = { nonce, credential: 'signed-token' };
  assert.equal((await h.call('google', body, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await h.call('logout', {}, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await h.call('google', body, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await h.call('google', '{')).status, 400);
  assert.equal((await h.call('google', 'x'.repeat(12001))).status, 413);
  assert.equal((await h.call('google', body, { headers: { cookie: '' } })).status, 403);
  assert.equal(h.verified(), 0);
  assert.equal((await h.call('challenge', undefined, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
});

test('nonce is browser-bound, signed, time-limited, and must match the verified Google token', async () => {
  const h = harness(); const nonce = await h.challenge();
  h.claims.nonce = 'other-browser';
  assert.equal((await h.call('google', { nonce, credential: 'signed-token' })).status, 401);
  h.claims.nonce = nonce;
  assert.equal((await h.call('google', { nonce, credential: 'signed-token' }, { headers: { cookie: `__Host-an-challenge=${h.jar['__Host-an-challenge']}tampered` } })).status, 403);
  h.advance(601_000);
  assert.equal((await h.call('google', { nonce, credential: 'signed-token' })).status, 403);
  assert.notEqual(await h.challenge(), nonce);
  assert.equal(h.records.size, 0);
});

test('challenge refresh rotates near expiry and sessions expire after seven days', async () => {
  const h = harness(); const nonce = await h.challenge();
  assert.equal(await h.challenge(), nonce);
  h.advance(480_000);
  const next = await h.challenge(); assert.notEqual(next, nonce);
  await h.call('google', { nonce: next, credential: 'signed-token' });
  h.advance(SESSION_SECONDS * 1000 + 1);
  assert.equal((await h.call('session')).data.user, null);
  assert.equal(h.records.size, 0);
});

test('verification and storage failures do not grant sessions or expose errors', async () => {
  const h = harness(); const nonce = await h.challenge();
  const bad = await h.call('google', { nonce, credential: 'forged' });
  assert.equal(bad.status, 401); assert.doesNotMatch(JSON.stringify(bad), /private verification detail/);
  const broken = harness({ saveAccount: async () => { throw Error('storage secret'); } });
  const result = await broken.call('google', { nonce: await broken.challenge(), credential: 'signed-token' });
  assert.equal(result.status, 503); assert.equal(broken.records.size, 0); assert.equal(result.headers['Set-Cookie'], undefined);
  assert.doesNotMatch(JSON.stringify(result), /storage secret/);
});

test('disabled configuration and rate limits fail closed', async () => {
  const h = harness(); h.settings.secret = '';
  assert.equal((await h.call('session')).data.configured, false);
  assert.equal((await h.call('challenge')).status, 503);
  assert.equal((await h.call('google', {})).status, 503);
  const blocked = harness({ limited: () => true });
  const result = await blocked.call('google', { nonce: await blocked.challenge(), credential: 'signed-token' });
  assert.equal(result.status, 429); assert.equal(blocked.verified(), 0);
});

test('Google library rejects forged signatures, other audiences, wrong issuers and expired tokens', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const client = new OAuth2Client();
  client.getFederatedSignonCertsAsync = async () => ({ certs: { test: publicKey.export({ type: 'spki', format: 'pem' }) } });
  const verify = googleVerifier(client);
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const jwt = (extra = {}) => { const payload = `${encode({ alg: 'RS256', kid: 'test' })}.${encode({ iss: 'https://accounts.google.com', aud: 'our-client', sub: '123', iat: now - 10, exp: now + 3600, ...extra })}`; return `${payload}.${sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64url')}`; };
  assert.equal((await verify(jwt(), 'our-client')).sub, '123');
  for (const extra of [{ aud: 'other-client' }, { iss: 'https://evil.example' }, { iat: now - 7200, exp: now - 3600 }]) await assert.rejects(verify(jwt(extra), 'our-client'));
  const token = jwt(); await assert.rejects(verify(token.slice(0, token.lastIndexOf('.') + 1) + 'forged', 'our-client'));
});

test('watchlist backups require a verified account, are isolated, and can be restored or deleted', async () => {
  const backups = new Map();
  const watchlists = {
    read: async key => backups.get(key) ?? null,
    write: async (key, backup) => backups.set(key, backup),
    remove: async key => backups.delete(key),
  };
  const first = harness({ watchlists });
  const second = harness({ watchlists });
  assert.equal((await first.call('watchlist')).status, 401);
  assert.equal((await first.call('watchlist', { symbols: ['RELIANCE.NS'] })).status, 401);
  await first.call('google', { nonce: await first.challenge(), credential: 'signed-token' });
  assert.equal((await first.call('watchlist', { symbols: ['RELIANCE.NS'] }, { headers: { origin: 'https://other.example' } })).status, 403);
  assert.equal((await first.call('watchlist', { symbols: ['invalid/symbol'] })).status, 400);
  assert.equal((await first.call('watchlist', { symbols: Array.from({ length: 41 }, (_, i) => `STOCK${i}.NS`) })).status, 400);
  const accepted = await first.call('watchlist', { symbols: ['RELIANCE.NS', 'TCS.NS'], googleSubject: 'another-reader' });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.data.backup.symbols, ['RELIANCE.NS', 'TCS.NS']);
  const restored = await first.call('watchlist');
  assert.equal(restored.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(restored.data.backup, accepted.data.backup);
  second.claims.sub = 'another-reader';
  await second.call('google', { nonce: await second.challenge(), credential: 'signed-token' });
  assert.deepEqual((await second.call('watchlist')).data, { backup: null });
  await second.call('watchlist', { remove: true });
  assert.equal(backups.size, 1);
  await first.call('watchlist', { remove: true });
  assert.deepEqual((await first.call('watchlist')).data, { backup: null });
});
