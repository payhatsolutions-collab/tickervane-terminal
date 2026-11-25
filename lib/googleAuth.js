import { cleanSymbols, WATCH_LIMIT } from '../src/watchlistTools.js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { allowedSignupOrigin, createSignupLimiter } from './signup.js';

export const AUTH_NOTICE_VERSION = '2026-11-11';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const CHALLENGE_SECONDS = 10 * 60;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const sessionKey = token => createHash('sha256').update(token).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function cookies(req) {
  return Object.fromEntries((req.headers?.cookie || '').split(';').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? [] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }).filter(pair => pair.length === 2));
}
function sign(value, secret) { return createHmac('sha256', secret).update(value).digest('base64url'); }
function challenge(secret, now) {
  const nonce = randomBytes(32).toString('base64url');
  const value = `${nonce}.${now + CHALLENGE_SECONDS * 1000}`;
  return { nonce, cookie: `${value}.${sign(value, secret)}` };
}
function readChallenge(value, secret, now, minRemaining = 0) {
  if (typeof value !== 'string') return null;
  const [nonce, expires, mac, extra] = value.split('.');
  if (extra || !tokenPattern.test(nonce) || !equal(mac, sign(`${nonce}.${expires}`, secret)) || Number(expires) <= now + minRemaining || Number(expires) > now + CHALLENGE_SECONDS * 1000) return null;
  return nonce;
}
export async function jsonBody(req) {
  const limit = 12_000;
  if (Number(req.headers?.['content-length']) > limit) throw Object.assign(new Error(), { status: 413 });
  let raw = req.body;
  if (raw === undefined) {
    raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > limit) throw Object.assign(new Error(), { status: 413 });
    }
  }
  if (Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw)) > limit) throw Object.assign(new Error(), { status: 413 });
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw Object.assign(new Error(), { status: 400 }); }
}

// The verified profile behind this request's session cookie, or null.
export async function readSession(req, { sessions, secure = true, now = Date.now }) {
  const token = cookies(req)[secure ? '__Host-an-session' : 'an-dev-session'];
  if (!tokenPattern.test(token || '')) return null;
  const record = await sessions.read(sessionKey(token));
  return record && record.expiresAt > now() && typeof record.googleSubject === 'string' ? record : null;
}

// The verifier checks Google's signature, issuer, audience and token lifetime.
export function googleVerifier(client) {
  return async (credential, audience) => (await client.verifyIdToken({ idToken: credential, audience })).getPayload();
}

export function createAuthHandler({ config, verify, sessions, saveAccount, watchlists, now = Date.now, limited = createSignupLimiter(), allowedOrigin = allowedSignupOrigin }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const settings = config();
    const enabled = !!(settings.clientId && settings.secret?.length >= 32 && settings.storage);
    const secure = settings.secure !== false;
    const sessionName = secure ? '__Host-an-session' : 'an-dev-session';
    const challengeName = secure ? '__Host-an-challenge' : 'an-dev-challenge';
    const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
    const jar = cookies(req);
    const token = jar[sessionName];
    const op = req.query?.op || 'session';
    const fail = (status, error) => res.status(status).json({ error });
    try {
      if (req.method === 'GET' && op === 'session') {
        let user = null;
        if (enabled && tokenPattern.test(token || '')) {
          const record = await sessions.read(sessionKey(token));
          if (record && record.expiresAt > now()) user = { name: record.name, email: record.email };
          else {
            if (record) await sessions.remove(sessionKey(token));
            res.setHeader('Set-Cookie', cookie(sessionName, '', 0));
          }
        }
        return res.status(200).json({ configured: enabled, clientId: enabled ? settings.clientId : null, user });
      }
      if (op === 'watchlist' && watchlists) {
        if (!['GET', 'POST'].includes(req.method)) {
          res.setHeader('Allow', 'GET, POST');
          return fail(405, 'Method not allowed.');
        }
        if (req.method === 'POST') {
          if (!allowedOrigin(req.headers?.origin)) return fail(403, 'Open Alpha Nova to manage your backup.');
          if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return fail(415, 'Send JSON.');
        }
        const session = enabled ? await readSession(req, { sessions, secure: settings.secure !== false, now }) : null;
        if (!session) return fail(401, 'Sign in with Google to access your watchlist backup.');
        const key = sessionKey(session.googleSubject);
        if (req.method === 'GET') return res.status(200).json({ backup: await watchlists.read(key) });
        if (limited(`watchlist:${key}`)) return fail(429, 'Too many backup changes. Please try again later.');
        const body = await jsonBody(req);
        if (body?.remove === true) {
          await watchlists.remove(key);
          return res.status(200).json({ backup: null });
        }
        const symbols = cleanSymbols(body?.symbols);
        if (!Array.isArray(body?.symbols) || !symbols.length || body.symbols.length > WATCH_LIMIT || symbols.length !== body.symbols.length) {
          return fail(400, 'Choose a valid watchlist to back up.');
        }
        const backup = { symbols, savedAt: new Date(now()).toISOString() };
        await watchlists.write(key, backup);
        return res.status(200).json({ backup });
      }
      if (req.method === 'GET' && op === 'challenge') {
        // No CORS headers: only the same origin can read the returned nonce.
        if (req.headers?.['sec-fetch-site'] === 'cross-site') return fail(403, 'Open Alpha Nova to sign in.');
        if (!enabled) return fail(503, 'Google sign-in is temporarily unavailable.');
        let nonce = readChallenge(jar[challengeName], settings.secret, now(), 180_000);
        if (!nonce) {
          const value = challenge(settings.secret, now());
          nonce = value.nonce;
          res.setHeader('Set-Cookie', cookie(challengeName, value.cookie, CHALLENGE_SECONDS));
        }
        return res.status(200).json({ nonce });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return fail(405, 'Method not allowed.'); }
      if (!allowedOrigin(req.headers?.origin)) return fail(403, 'Open Alpha Nova to sign in.');
      if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return fail(415, 'Send JSON.');
      if (op === 'logout') {
        if (tokenPattern.test(token || '')) await sessions.remove(sessionKey(token));
        res.setHeader('Set-Cookie', [cookie(sessionName, '', 0), cookie(challengeName, '', 0)]);
        return res.status(200).json({ ok: true });
      }
      if (op !== 'google') return fail(400, 'Unknown sign-in action.');
      if (!enabled) return fail(503, 'Google sign-in is temporarily unavailable.');
      const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
      if (limited(ip)) { res.setHeader('Retry-After', '600'); return fail(429, 'Too many attempts. Please try again in ten minutes.'); }
      const body = await jsonBody(req);
      const nonce = readChallenge(jar[challengeName], settings.secret, now());
      if (!nonce || !equal(body?.nonce, nonce)) return fail(403, 'Your sign-in expired. Please try again.');
      if (typeof body?.credential !== 'string' || body.credential.length > 10_000) return fail(400, 'Please choose your Google account again.');
      let identity;
      try { identity = await verify(body.credential, settings.clientId); }
      catch { return fail(401, 'Google could not verify this sign-in. Please try again.'); }
      if (!identity || !equal(identity.nonce, nonce) || !/^[A-Za-z0-9_-]{1,255}$/.test(identity.sub || '') || identity.email_verified !== true || typeof identity.email !== 'string' || identity.email.length > 254) {
        return fail(401, 'Google could not verify this sign-in. Please try again.');
      }
      const user = { name: (identity.name || identity.given_name || identity.email.split('@')[0]).slice(0, 80), email: identity.email };
      const account = { ...user, googleSubject: identity.sub, emailVerified: true, source: 'google', noticeVersion: AUTH_NOTICE_VERSION, createdAt: new Date(now()).toISOString() };
      await saveAccount(account);
      const nextToken = randomBytes(32).toString('base64url');
      await sessions.write(sessionKey(nextToken), { ...user, googleSubject: identity.sub, expiresAt: now() + SESSION_SECONDS * 1000 });
      if (tokenPattern.test(token || '')) await sessions.remove(sessionKey(token));
      res.setHeader('Set-Cookie', [cookie(sessionName, nextToken, SESSION_SECONDS), cookie(challengeName, '', 0)]);
      return res.status(200).json({ ok: true, user });
    } catch (error) {
      if (op === 'watchlist' && ![400, 413].includes(error.status)) return fail(503, 'Watchlist backup is temporarily unavailable.');
      if (error.status === 413) return fail(413, 'Sign-in request is too large.');
      if (error.status === 400) return fail(400, 'Invalid sign-in request.');
      return fail(503, 'Sign-in is temporarily unavailable. Please try again.');
    }
  };
}
