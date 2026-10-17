import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGNUP_DELAY, SIGNUP_COOLDOWN, signupClock, advanceSignupClock, shouldPromptSignup, signupProfile, readSignupValue, saveSignupValue } from '../src/signupState.js';
import { SIGNUP_NOTICE_VERSION, validateSignup, createSignupHandler, createSignupLimiter, allowedSignupOrigin } from '../lib/signup.js';

test('signup waits for two minutes of visible use, survives reloads and excludes hidden time', () => {
  let clock = signupClock(null);
  clock = advanceSignupClock(clock, 60_000, true);
  clock = signupClock(JSON.parse(JSON.stringify(clock)));
  clock = advanceSignupClock(clock, 600_000, false);
  const ready = (extra = {}) => shouldPromptSignup({ clock, now: 1000, visible: true, busy: false, ...extra });
  assert.equal(ready(), false);
  clock = advanceSignupClock(clock, 59_999, true);
  assert.equal(ready(), false);
  clock = advanceSignupClock(clock, 1, true);
  assert.equal(clock.elapsed, SIGNUP_DELAY);
  assert.equal(ready(), true);
  assert.equal(ready({ busy: true }), false);
  assert.equal(ready({ visible: false }), false);
  assert.equal(ready({ profile: { name: 'Reader' } }), false);
  assert.equal(ready({ dismissedUntil: 1000 + SIGNUP_COOLDOWN }), false);
  assert.equal(ready({ dismissedUntil: 999 }), true);
  clock.shown = true;
  assert.equal(ready(), false);
});

test('bad or unavailable browser storage does not crash registration', () => {
  assert.deepEqual(signupClock({ elapsed: -20, shown: 'yes' }), { elapsed: 0, shown: false });
  assert.deepEqual(signupClock({ elapsed: Infinity }), { elapsed: 0, shown: false });
  assert.equal(signupProfile({ name: 'bad' }), null);
  assert.equal(signupProfile({ name: ' ', registeredAt: 1 }), null);
  assert.deepEqual(signupProfile({ name: ' Reader ', registeredAt: 1, email: 'private@example.com' }), { name: 'Reader', registeredAt: 1 });
  assert.equal(readSignupValue(null, 'key'), null);
  assert.doesNotThrow(() => saveSignupValue(null, 'key', {}));
});

const form = { name: ' Test  Reader ', email: ' Reader@Example.com ', noticeVersion: SIGNUP_NOTICE_VERSION };
test('signup validates and normalizes names and emails without accepting arbitrary profile data', () => {
  assert.deepEqual(validateSignup(form), { name: 'Test Reader', email: 'reader@example.com' });
  for (const name of ['', ' '.repeat(8), 'x'.repeat(81), '<script>']) assert.equal(validateSignup({ ...form, name }).field, 'name');
  for (const email of ['', 'missing-at', 'a@@example.com', 'a b@example.com', 'x@']) assert.equal(validateSignup({ ...form, email }).field, 'email');
  assert.ok(validateSignup({ ...form, noticeVersion: 'old' }).error);
  assert.ok(validateSignup(null).error);
});

function harness(options = {}) {
  const saved = [];
  const handler = createSignupHandler({ configured: () => true, save: async value => saved.push(value), ...options });
  const call = async (override = {}) => {
    let code, body;
    const headers = {};
    await handler({ method: 'POST', headers: { origin: 'https://alphanova48.in', 'content-type': 'application/json' }, body: form, ...override }, {
      setHeader(name, value) { headers[name] = value; },
      status(value) { code = value; return this; },
      json(value) { body = value; },
    });
    return { code, body, headers };
  };
  return { call, saved };
}

test('registration persists only approved fields privately and returns no personal information', async () => {
  const { call, saved } = harness();
  const result = await call({ body: { ...form, holdings: ['secret'], emailVerified: true, source: 'attacker', createdAt: 'fake' } });
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(saved[0].email, 'reader@example.com');
  assert.equal(saved[0].emailVerified, false);
  assert.equal(saved[0].source, 'free-signup');
  assert.equal('holdings' in saved[0], false);
  assert.notEqual(saved[0].createdAt, 'fake');
});

test('signup rejects cross-origin, malformed, excessive and unavailable writes', async () => {
  const { call, saved } = harness();
  assert.equal((await call({ method: 'GET' })).code, 405);
  assert.equal((await call({ headers: { origin: 'https://attacker.example', 'content-type': 'application/json' } })).code, 403);
  assert.equal((await call({ headers: { origin: 'https://alphanova48.in', 'content-type': 'text/plain' } })).code, 415);
  assert.equal((await call({ body: '{' })).code, 400);
  assert.equal((await call({ body: { ...form, name: '' } })).code, 400);
  assert.equal((await call({ body: 'x'.repeat(4097) })).code, 413);
  assert.equal(saved.length, 0);
  const unavailable = harness({ configured: () => false });
  assert.equal((await unavailable.call()).code, 503);
  assert.deepEqual((await unavailable.call({ method: 'GET', query: { op: 'status' } })).body, { configured: false });
});

test('failed persistence never reports a successful registration or exposes storage errors', async () => {
  const { call } = harness({ save: async () => { throw new Error('private token and storage URL'); } });
  const result = await call();
  assert.equal(result.code, 503);
  assert.equal(JSON.stringify(result.body).includes('private token'), false);
});

test('signup honeypot and rate limits prevent repeated writes', async () => {
  const { call, saved } = harness();
  assert.equal((await call({ body: { ...form, website: 'spam' } })).code, 200);
  assert.equal(saved.length, 0);
  for (let i = 0; i < 4; i++) assert.equal((await call()).code, 200);
  const blocked = await call();
  assert.equal(blocked.code, 429);
  assert.equal(blocked.headers['Retry-After'], '600');
  const limiter = createSignupLimiter();
  for (let i = 0; i < 5; i++) assert.equal(limiter('ip', 0), false);
  assert.equal(limiter('ip', 0), true);
  assert.equal(limiter('ip', 600_000), false);
});

test('only explicit production origins and this deployment are accepted', () => {
  const env = { NODE_ENV: 'production', VERCEL_URL: 'my-deployment.vercel.app' };
  assert.equal(allowedSignupOrigin('https://my-deployment.vercel.app', env), true);
  assert.equal(allowedSignupOrigin('https://alphanova48.in.evil.example', env), false);
  assert.equal(allowedSignupOrigin('https://other.vercel.app', env), false);
  assert.equal(allowedSignupOrigin(undefined, env), false);
  assert.equal(allowedSignupOrigin('http://localhost:5177', env), false);
});
