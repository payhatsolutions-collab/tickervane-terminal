import test from 'node:test';
import assert from 'node:assert/strict';
import { createProHandler, paymentNote, reviewRecord, utrDateMatches, utrRisk } from '../lib/pro.js';
import { sessionKey } from '../lib/googleAuth.js';
import { DAY, PRO_APP_TRIAL_DAYS, PRO_DAYS, PRO_TRIAL_MINUTES, PRO_PAGES, normalizeUtr, proState, upiLink } from '../lib/proPlan.js';

const token = 'a'.repeat(43), other = 'b'.repeat(43);
function harness({ settings = { signIn: true, storage: true, upiId: 'payee.test@bank' } } = {}) {
  let clock = Date.UTC(2026, 10, 14, 6);
  const accounts = new Map(), utrs = new Map(), trials = new Map();
  const sessions = new Map([
    [sessionKey(token), { name: 'Test Reader', email: 'reader@example.com', googleSubject: 'sub-1', expiresAt: clock + 400 * DAY }],
    [sessionKey(other), { name: 'Second Reader', email: 'second@example.com', googleSubject: 'sub-2', expiresAt: clock + 400 * DAY }],
  ]);
  const handler = createProHandler({ config: () => settings, now: () => clock, limited: () => false,
    sessions: { read: async key => sessions.get(key) },
    store: { readTrial: async key => trials.get(key),
      startTrial: async (key, value) => { if (!trials.has(key)) trials.set(key, value); return trials.get(key); },
      upgradeTrial: async (key, value) => { trials.set(key, value); return value; },
      readAccount: async key => accounts.get(key), writeAccount: async (key, value) => accounts.set(key, value),
      reserveUtr: async (utr, value) => utrs.has(utr) ? false : !!utrs.set(utr, value), releaseUtr: async utr => utrs.delete(utr) },
  });
  async function call(op, body, { as = token, headers = {} } = {}) {
    let status, data;
    await handler({ method: body === undefined ? 'GET' : 'POST', query: { op }, body,
      headers: { origin: 'https://alphanova48.in', 'content-type': 'application/json', cookie: as ? `__Host-an-session=${as}` : '', ...headers } },
    { setHeader() {}, status: value => { status = value; return { json: value => { data = value; } }; } });
    return { status, data };
  }
  return { call, accounts, utrs, trials, sessions, advance: ms => { clock += ms; }, now: () => clock };
}

// The harness clock is 14 Nov 2026, 11:30 IST: day 318, so fresh references start 6318 and hour 00–12.
const fresh = '631811047293', fresh2 = '631810582736';

test('Pro covers five premium workspaces, leaves Markets and Fundamentals free, and reads 12-digit UPI references', () => {
  assert.deepEqual(PRO_PAGES, ['Forecast', 'Analytics', 'Breakouts', 'FnO', 'Flows']);
  assert.equal(normalizeUtr(' 6318 1104 7293 '), fresh);
  for (const bad of ['63181234567', '6318123456789', 'T2611141234AB', '', null, 631812345678]) assert.equal(normalizeUtr(bad), null);
});

test('references carry a recent YDDDHH timestamp; fakes are refused and odd ones held', () => {
  const now = Date.UTC(2026, 10, 14, 6);
  assert.equal(utrDateMatches(fresh, now), true);
  assert.equal(utrDateMatches('631712047293', now), true);    // yesterday noon
  assert.equal(utrDateMatches('631512047293', now), true);    // 71.5 hours ago
  assert.equal(utrDateMatches('631411047293', now), false);   // older than 72 hours
  assert.equal(utrDateMatches('631812047293', now), true);    // within an hour of now
  assert.equal(utrDateMatches('631814047293', now), false);   // in the future
  assert.equal(utrDateMatches('531811047293', now), false);   // wrong year
  assert.equal(utrDateMatches('636711047293', now), false);   // no day 367
  assert.equal(utrDateMatches('631825047293', now), false);   // no hour 25
  assert.equal(utrDateMatches('536511047293', Date.UTC(2026, 0, 1, 6)), true);  // 31 Dec 2025 seen on 1 Jan 2026
  for (const fake of ['123456789012', '012345678901', '987654321098', '000000000000', '111111111111', '121212121212', '123123123123', '123412341234', '112211221122', '999999999990'])
    assert.equal(utrRisk(fake, now), 'fake', fake);
  for (const odd of ['631712345678', '631899999999', '531811047293', '631411047293'])
    assert.equal(utrRisk(odd, now), 'review', odd);
  assert.equal(utrRisk(fresh, now), 'instant');
});

test('a signed-in account unlocks instantly with a fresh unused reference, for thirty days', async () => {
  const h = harness();
  assert.deepEqual((await h.call('status', undefined, { as: null })).data, { configured: true, signedIn: false, plan: { price: 300, days: 30, trialMinutes: 30, appTrialDays: 3 }, active: false, expiresAt: null, renewable: true, paused: false, pending: false, trialActive: false, trialExpiresAt: null, trialEligible: true, appTrialEligible: true });
  assert.equal((await h.call('claim', { utr: fresh }, { as: null })).status, 401);
  assert.equal((await h.call('claim', { utr: 'not-a-reference' })).status, 400);
  assert.equal((await h.call('claim', { utr: fresh }, { headers: { origin: 'https://evil.example' } })).status, 403);
  const claimed = await h.call('claim', { utr: '6318 1104 7293' });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.data.held, false);
  assert.equal(claimed.data.active, true);
  assert.equal(claimed.data.expiresAt, h.now() + PRO_DAYS * DAY);
  const record = h.accounts.get(sessionKey('sub-1'));
  assert.equal(record.status, 'unverified');
  assert.deepEqual({ ...record.payments[0], claimedAt: undefined }, { utr: fresh, note: paymentNote(sessionKey('sub-1')), amount: 300, claimedAt: undefined, periodStart: h.now(), periodEnd: h.now() + PRO_DAYS * DAY, dateMatch: true, status: 'unverified' });
  assert.equal((await h.call('status')).data.active, true);
  // The reference is single-use across accounts, and an active plan cannot be stacked.
  assert.equal((await h.call('claim', { utr: fresh }, { as: other })).status, 409);
  assert.equal((await h.call('claim', { utr: fresh2 })).status, 409);
  assert.equal((await h.call('status', undefined, { as: other })).data.active, false);
  h.advance(PRO_DAYS * DAY + 1);
  assert.equal((await h.call('status')).data.active, false);
});

test('made-up references are refused without touching storage', async () => {
  const h = harness();
  for (const utr of ['123456789012', '111111111111', '1212 1212 1212']) {
    const result = await h.call('claim', { utr });
    assert.equal(result.status, 400, utr);
    assert.match(result.data.error, /isn’t a UPI reference/);
  }
  assert.equal(h.accounts.size, 0);
  assert.equal(h.utrs.size, 0);
});

test('an unusual reference is held with no access until approved, and can be corrected', async () => {
  const h = harness(), key = sessionKey('sub-1');
  const held = await h.call('claim', { utr: '531811047293' });
  assert.equal(held.status, 202);
  assert.deepEqual([held.data.held, held.data.active, held.data.pending], [true, false, true]);
  assert.equal(h.accounts.get(key).status, 'held');
  assert.equal(h.accounts.get(key).payments[0].status, 'held');
  assert.equal((await h.call('status')).data.active, false);
  // Correcting a typo frees the old reference and unlocks if the new one is fresh.
  const fixed = await h.call('claim', { utr: fresh });
  assert.equal(fixed.status, 200);
  assert.deepEqual([fixed.data.active, fixed.data.pending], [true, false]);
  assert.deepEqual(h.accounts.get(key).payments.map(payment => payment.utr), [fresh]);
  assert.equal(h.utrs.has('531811047293'), false);
  // A second held reference, approved by the operator, starts when approved.
  const other_ = sessionKey('sub-2');
  await h.call('claim', { utr: '631411047293' }, { as: other });
  h.advance(DAY);
  const approved = reviewRecord(h.accounts.get(other_), 'verify', h.now());
  assert.equal(approved.status, 'verified');
  assert.equal(approved.expiresAt, h.now() + PRO_DAYS * DAY);
  assert.equal(proState(approved, h.now()).active, true);
  // Rejecting a held reference declines it without pausing the account.
  await h.call('claim', { utr: '631411047294' }, { as: other });
  h.accounts.set(other_, reviewRecord(approved, 'verify', h.now()));
  const sub2 = sessionKey('sub-2');
  h.accounts.set(sub2, { ...h.accounts.get(sub2), payments: [...h.accounts.get(sub2).payments, { utr: '000000000001', status: 'held' }] });
  const rejected = reviewRecord(h.accounts.get(sub2), 'reject', h.now());
  assert.equal(rejected.status, 'verified');
  assert.equal(rejected.payments.at(-1).status, 'rejected');
  assert.equal(proState(rejected, h.now()).paused, false);
  assert.equal(reviewRecord({ status: 'verified', payments: [] }, 'reject', h.now()), null);
});

test('renewal extends from the current expiry and unchecked payments cannot pile up', async () => {
  const h = harness();
  await h.call('claim', { utr: fresh });
  h.advance(25 * DAY);                                           // 9 Dec: day 343
  const first = h.accounts.get(sessionKey('sub-1')).expiresAt;
  const renewed = await h.call('claim', { utr: '634310482917' });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.data.expiresAt, first + PRO_DAYS * DAY);
  h.advance(30 * DAY);                                           // 8 Jan 2027: day 008
  assert.equal((await h.call('claim', { utr: '700810529384' })).status, 409);
  assert.equal(h.utrs.has('700810529384'), false);
});

test('operator review verifies, revokes and restores; a revoked account cannot self-unlock', async () => {
  const h = harness(), key = sessionKey('sub-1');
  await h.call('claim', { utr: fresh });
  h.accounts.set(key, reviewRecord(h.accounts.get(key), 'revoke', h.now()));
  const { note, upi, ...paused } = (await h.call('status')).data;
  assert.deepEqual(paused, { configured: true, signedIn: true, plan: { price: 300, days: 30, trialMinutes: 30, appTrialDays: 3 }, active: false, expiresAt: null, renewable: false, paused: true, pending: false, trialActive: false, trialExpiresAt: null, trialEligible: false, appTrialEligible: false });
  assert.equal(note, paymentNote(key));
  assert.equal((await h.call('claim', { utr: fresh2 })).status, 403);
  h.accounts.set(key, reviewRecord(h.accounts.get(key), 'unpause', h.now()));
  assert.equal((await h.call('claim', { utr: fresh2 })).status, 200);
  const verified = reviewRecord(h.accounts.get(key), 'verify', h.now());
  assert.equal(verified.status, 'verified');
  assert.ok(verified.payments.every(payment => payment.status === 'verified'));
  assert.equal(proState(verified, h.now()).active, true);
  assert.equal(reviewRecord(verified, 'unpause', h.now()), null);
  assert.equal(reviewRecord(verified, 'delete', h.now()), null);
});

test('the app stays open when sign-in or storage is not configured', async () => {
  const h = harness({ settings: { signIn: false, storage: true } });
  assert.equal((await h.call('status')).data.configured, false);
  assert.equal((await h.call('claim', { utr: fresh })).status, 503);
});

test('signed-in readers get a pre-filled UPI link with their own note; others get neither', async () => {
  const h = harness();
  const anonymous = (await h.call('status', undefined, { as: null })).data;
  assert.equal('upi' in anonymous || 'note' in anonymous, false);
  const first = (await h.call('status')).data, second = (await h.call('status', undefined, { as: other })).data;
  assert.match(first.note, /^AN[0-9A-F]{6}$/);
  assert.notEqual(first.note, second.note);
  assert.equal(first.note, (await h.call('status')).data.note);
  assert.equal(first.upi, `upi://pay?pa=payee.test@bank&pn=YASHVARDHAN%20SARDA&am=300.00&cu=INR&tn=Alpha%20Nova%20Pro%20${first.note}`);
  const claimed = (await h.call('claim', { utr: fresh })).data;
  assert.equal(claimed.note, first.note);
  assert.equal(h.accounts.get(sessionKey('sub-1')).note, first.note);
  assert.equal(upiLink({ upiId: 'not a vpa', note: 'X' }), null);
  assert.equal(upiLink({ upiId: 'a@b&am=1', note: 'X' }), null);
  assert.equal(upiLink({ upiId: 'ab@bank', note: "AN(1)'s" }), "upi://pay?pa=ab@bank&pn=YASHVARDHAN%20SARDA&am=300.00&cu=INR&tn=Alpha%20Nova%20Pro%20AN%281%29%27s");
});


test('new and existing accounts get one 30-minute trial, shared across sessions', async () => {
  const h = harness(), key = sessionKey('sub-1');
  const before = await h.call('status');
  assert.equal(before.data.trialEligible, true);
  assert.equal(h.trials.size, 0); // Viewing a paywall never starts the clock.
  const start = await h.call('trial', {});
  const end = h.now() + 30 * 60_000;
  assert.equal(PRO_TRIAL_MINUTES, 30);
  assert.equal(start.status, 200);
  assert.equal(start.data.active, true);
  assert.equal(start.data.trialActive, true);
  assert.equal(start.data.trialEligible, false);
  assert.equal(start.data.expiresAt, end);
  assert.equal(h.accounts.size, 0);
  assert.equal(h.utrs.size, 0);
  h.advance(10 * 60_000);
  assert.equal((await h.call('trial', {})).data.expiresAt, end);
  // A fresh login token for the same Google subject sees the original expiry.
  h.sessions.set(sessionKey(other), { ...h.sessions.get(sessionKey(token)) });
  assert.equal((await h.call('status', undefined, { as: other })).data.expiresAt, end);
  h.advance(20 * 60_000 - 1);
  assert.equal((await h.call('status')).data.active, true);
  h.advance(1);
  assert.equal((await h.call('status')).data.active, false);
  assert.equal((await h.call('status')).data.trialEligible, false);
  assert.equal((await h.call('trial', {})).status, 409);
  assert.equal(h.trials.get(key).startedAt + 30 * 60_000, end);

  const existing = harness();
  existing.accounts.set(key, { status: 'verified', expiresAt: existing.now() - DAY, payments: [] });
  assert.equal((await existing.call('trial', {})).data.trialActive, true);
});

test('trial starts require sign-in and a permitted origin; paid and revoked access are preserved', async () => {
  const h = harness(), key = sessionKey('sub-1');
  assert.equal((await h.call('trial', {}, { as: null })).status, 401);
  assert.equal((await h.call('trial', {}, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await h.call('trial', {}, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await h.call('trial', '{')).status, 400);
  assert.equal((await h.call('trial', { padding: 'x'.repeat(20_000) })).status, 413);
  assert.equal(h.trials.size, 0);
  await h.call('claim', { utr: fresh });
  const paidEnd = h.accounts.get(key).expiresAt;
  assert.equal((await h.call('trial', {})).status, 409);
  assert.equal((await h.call('status')).data.expiresAt, paidEnd);
  h.accounts.set(key, reviewRecord(h.accounts.get(key), 'revoke', h.now()));
  assert.equal((await h.call('trial', {})).status, 403);
  assert.equal(h.trials.size, 0);
});

test('simultaneous trial starts keep one start time and accounts have independent trials', async () => {
  const h = harness();
  const starts = await Promise.all([h.call('trial', {}), h.call('trial', {})]);
  assert.ok(starts.every(result => result.status === 200 && result.data.active));
  assert.equal(starts[0].data.expiresAt, starts[1].data.expiresAt);
  assert.equal(h.trials.size, 1);
  h.advance(60_000);
  const second = await h.call('trial', {}, { as: other });
  assert.equal(second.data.expiresAt, starts[0].data.expiresAt + 60_000);
  assert.equal(h.trials.size, 2);
});

test('buying Pro during the trial preserves remaining trial time and cannot reset it', async () => {
  const h = harness(), key = sessionKey('sub-1');
  const trial = await h.call('trial', {});
  h.advance(5 * 60_000);
  const paid = await h.call('claim', { utr: fresh });
  assert.equal(paid.data.expiresAt, trial.data.expiresAt + PRO_DAYS * DAY);
  assert.equal(paid.data.trialActive, false);
  assert.equal(paid.data.trialEligible, false);
  assert.equal(h.accounts.get(key).payments[0].periodStart, trial.data.expiresAt);
  h.advance(31 * DAY);
  assert.equal((await h.call('status')).data.active, false);
  assert.equal((await h.call('trial', {})).status, 409);
});

test('held payment review retains trial time, while revocation ends trial access', async () => {
  const h = harness(), key = sessionKey('sub-1');
  const trial = await h.call('trial', {});
  const held = await h.call('claim', { utr: '531811047293' });
  assert.equal(held.data.pending, true);
  assert.equal(held.data.trialActive, true);
  const approved = reviewRecord(h.accounts.get(key), 'verify', h.now());
  assert.equal(approved.expiresAt, trial.data.expiresAt + PRO_DAYS * DAY);
  h.accounts.set(key, reviewRecord(h.accounts.get(key), 'revoke', h.now()));
  assert.equal((await h.call('status')).data.active, false);
  assert.equal((await h.call('trial', {})).status, 403);
});

test('readers with the app get one three-day trial instead of thirty minutes', async () => {
  const h = harness(), key = sessionKey('sub-1');
  assert.equal(PRO_APP_TRIAL_DAYS, 3);
  assert.equal((await h.call('status')).data.appTrialEligible, true);
  const start = await h.call('trial', { app: true });
  const end = h.now() + 3 * DAY;
  assert.equal(start.status, 200);
  assert.equal(start.data.active, true);
  assert.equal(start.data.trialActive, true);
  assert.equal(start.data.expiresAt, end);
  assert.equal(start.data.trialEligible, false);
  assert.equal(start.data.appTrialEligible, false);
  assert.deepEqual(h.trials.get(key), { startedAt: h.now(), minutes: 3 * 1440, app: true });
  h.advance(2 * DAY);
  // A later start, from the app or the browser, never moves the end.
  assert.equal((await h.call('trial', { app: true })).data.expiresAt, end);
  assert.equal((await h.call('trial', {})).data.expiresAt, end);
  assert.equal((await h.call('status')).data.active, true);
  h.advance(DAY);
  const after = (await h.call('status')).data;
  assert.equal(after.active, false);
  assert.equal(after.appTrialEligible, false);
  assert.equal((await h.call('trial', { app: true })).status, 409);
  assert.equal((await h.call('trial', {})).status, 409);
  // Only a literal true counts as the app.
  const loose = await h.call('trial', { app: 'true' }, { as: other });
  assert.equal(loose.data.expiresAt, h.now() + PRO_TRIAL_MINUTES * 60_000);
});

test('installing the app replaces a browser trial once, whether it is running or used', async () => {
  const h = harness(), key = sessionKey('sub-1'), began = h.now();
  await h.call('trial', {});
  h.advance(31 * 60_000);
  const used = (await h.call('status')).data;
  assert.equal(used.active, false);
  assert.equal(used.trialEligible, false);
  assert.equal(used.appTrialEligible, true);
  assert.equal((await h.call('trial', {})).status, 409);
  const upgraded = await h.call('trial', { app: true });
  assert.equal(upgraded.status, 200);
  assert.equal(upgraded.data.expiresAt, h.now() + 3 * DAY);
  assert.equal(upgraded.data.appTrialEligible, false);
  assert.deepEqual(h.trials.get(key), { startedAt: h.now(), minutes: 3 * 1440, app: true, browserStartedAt: began });
  h.advance(3 * DAY);
  assert.equal((await h.call('trial', { app: true })).status, 409);

  // A browser trial that is still running is extended to three days from the install.
  const running = await h.call('trial', {}, { as: other });
  h.advance(10 * 60_000);
  const extended = await h.call('trial', { app: true }, { as: other });
  assert.equal(extended.data.expiresAt, h.now() + 3 * DAY);
  assert.ok(extended.data.expiresAt > running.data.expiresAt);
});

test('the app trial never overrides paid, revoked or signed-out states', async () => {
  const h = harness(), key = sessionKey('sub-1');
  assert.equal((await h.call('trial', { app: true }, { as: null })).status, 401);
  await h.call('trial', {});
  const paid = await h.call('claim', { utr: fresh });
  assert.equal((await h.call('status')).data.appTrialEligible, false);
  assert.equal((await h.call('trial', { app: true })).status, 409);
  assert.equal((await h.call('status')).data.expiresAt, paid.data.expiresAt);
  assert.equal(h.trials.get(key).app, undefined);
  h.accounts.set(key, reviewRecord(h.accounts.get(key), 'revoke', h.now()));
  assert.equal((await h.call('trial', { app: true })).status, 403);
  // A reader who paid first and never tried Pro cannot stack the app trial on top.
  await h.call('claim', { utr: fresh2 }, { as: other });
  assert.equal((await h.call('trial', { app: true }, { as: other })).status, 409);
  assert.equal(h.trials.size, 1);
});
