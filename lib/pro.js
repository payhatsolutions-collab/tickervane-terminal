import { allowedSignupOrigin, createSignupLimiter } from './signup.js';
import { jsonBody, readSession, sessionKey } from './googleAuth.js';
import { DAY, PRO_APP_TRIAL_DAYS, PRO_APP_TRIAL_MINUTES, PRO_DAYS, PRO_PRICE, PRO_TRIAL_MINUTES, normalizeUtr, proAccessState, upiLink } from './proPlan.js';

// Short, stable and not reversible to the Google account: shown to the payer as the UPI note.
export const paymentNote = key => `AN${key.slice(0, 6).toUpperCase()}`;

const HOUR = 3_600_000;
const IST = 5.5 * HOUR;
export const STAMP_HOURS = 72;

// UPI references (RRN) start with a timestamp: last digit of the year, day of
// the year and hour, in IST (YDDDHH). A genuine reference entered just after
// paying carries a stamp from the last few days, never one in the future.
export function utrDateMatches(utr, now = Date.now()) {
  const year = Number(utr[0]), day = Number(utr.slice(1, 4)), hour = Number(utr.slice(4, 6));
  if (day < 1 || day > 366 || hour > 23) return false;
  const current = new Date(now + IST).getUTCFullYear();
  return [current, current - 1].some(full => {
    if (full % 10 !== year) return false;
    const stamp = Date.UTC(full, 0, day, hour) - IST;
    if (new Date(stamp + IST).getUTCFullYear() !== full) return false; // day 366 in a short year
    return stamp <= now + HOUR && stamp >= now - STAMP_HOURS * HOUR;
  });
}

function longestRun(utr) {
  const digits = [...utr].map(Number);
  let up = 1, down = 1, run = 1;
  for (let i = 1; i < digits.length; i++) {
    up = (digits[i] - digits[i - 1] + 10) % 10 === 1 ? up + 1 : 1;
    down = (digits[i - 1] - digits[i] + 10) % 10 === 1 ? down + 1 : 1;
    run = Math.max(run, up, down);
  }
  return run;
}

// Numbers no payment app issues: one or two digits, short repeats, long counting runs.
export function utrLooksFake(utr) {
  const digits = [...utr].map(Number);
  if (new Set(digits).size <= 2) return true;
  if ([1, 2, 3, 4].some(size => utr === utr.slice(0, size).repeat(12 / size))) return true;
  return longestRun(utr) >= 10;
}

// 'fake': refuse. 'review': record it, but no access until the operator approves. 'instant': unlock now.
export function utrRisk(utr, now = Date.now()) {
  if (utrLooksFake(utr)) return 'fake';
  return longestRun(utr) >= 7 || !utrDateMatches(utr, now) ? 'review' : 'instant';
}

// Operator review of a claimed payment. Instant claims are reviewed afterwards;
// held claims give no access until approved here.
export function reviewRecord(record, action, now = Date.now()) {
  const payments = Array.isArray(record?.payments) ? record.payments : [];
  const base = { ...record, updatedAt: new Date(now).toISOString() };
  const held = payments.some(payment => payment.status === 'held');
  if (action === 'verify') {
    // Held payments start when approved (or when current access ends); this also restores a revoke.
    let end = Math.max(now, record.trialExpiresAt || 0, ...payments.map(payment => payment.status === 'held' ? 0 : payment.periodEnd || 0));
    const next = payments.map(payment => {
      if (payment.status !== 'held') return { ...payment, status: 'verified' };
      const periodStart = end; end += PRO_DAYS * DAY;
      return { ...payment, status: 'verified', periodStart, periodEnd: end, approvedAt: new Date(now).toISOString() };
    });
    return { ...base, status: 'verified', revokedAt: undefined, expiresAt: Math.max(0, ...next.map(payment => payment.periodEnd || 0)), payments: next };
  }
  if (action === 'revoke') {
    return { ...base, status: 'revoked', expiresAt: now, revokedAt: new Date(now).toISOString(),
      payments: payments.map(payment => ['unverified', 'held'].includes(payment.status) ? { ...payment, status: 'rejected' } : payment) };
  }
  // A held reference that doesn't match: decline it without pausing the account.
  if (action === 'reject' && held) {
    return { ...base, status: record.status === 'held' ? 'lapsed' : record.status,
      payments: payments.map(payment => payment.status === 'held' ? { ...payment, status: 'rejected' } : payment) };
  }
  // Lets a revoked account submit a fresh reference again.
  if (action === 'unpause' && record?.status === 'revoked') return { ...base, status: 'lapsed', revokedAt: undefined };
  return null;
}

export function createProHandler({ config, sessions, store, now = Date.now, limited = createSignupLimiter(), allowedOrigin = allowedSignupOrigin }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const settings = config();
    // Without sign-in and storage nobody could unlock, so the app stays open.
    const configured = !!(settings.signIn && settings.storage);
    const op = req.query?.op || 'status';
    const plan = { price: PRO_PRICE, days: PRO_DAYS, trialMinutes: PRO_TRIAL_MINUTES, appTrialDays: PRO_APP_TRIAL_DAYS };
    const fail = (status, error) => res.status(status).json({ error });
    try {
      const session = configured ? await readSession(req, { sessions, secure: settings.secure !== false, now }) : null;
      const key = session ? sessionKey(session.googleSubject) : null;
      // The payee's UPI ID and the payer's note go only to signed-in readers.
      const payment = key => { const note = paymentNote(key); return { note, upi: upiLink({ upiId: settings.upiId, note }) }; };
      if (req.method === 'GET' && op === 'status') {
        const [record, trial] = key ? await Promise.all([store.readAccount(key), store.readTrial(key)]) : [null, null];
        return res.status(200).json({ configured, signedIn: !!session, plan, ...proAccessState(record, trial, now()), ...(key ? payment(key) : {}) });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return fail(405, 'Method not allowed.'); }
      if (!allowedOrigin(req.headers?.origin)) return fail(403, 'Open Alpha Nova to unlock Pro.');
      if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return fail(415, 'Send JSON.');
      if (!['claim', 'trial'].includes(op)) return fail(400, 'Unknown action.');
      if (!configured) return fail(503, 'Pro unlock is temporarily unavailable.');
      if (!session) return fail(401, 'Sign in with Google first to unlock Pro.');
      const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
      if (limited(`ip:${ip}`) || limited(`account:${key}`)) { res.setHeader('Retry-After', '600'); return fail(429, 'Too many attempts. Please try again in ten minutes.'); }
      const body = await jsonBody(req);
      if (op === 'trial') {
        const [record, existing] = await Promise.all([store.readAccount(key), store.readTrial(key)]);
        const state = proAccessState(record, existing, now());
        if (state.paused) return fail(403, 'Contact payment support to restore access to this account.');
        // The installed app reports itself; the claim is not verifiable, and the lock is in the interface.
        const appTrial = { startedAt: now(), minutes: PRO_APP_TRIAL_MINUTES, app: true };
        // Installing the app replaces a browser trial, running or used, with the app trial once.
        const upgrade = body?.app === true && !!existing && state.appTrialEligible;
        if (existing && !state.trialActive && !upgrade) return fail(409, 'This account has already used its free trial.');
        if (!existing && !state.trialEligible) return fail(409, 'Pro is already active on this account.');
        const trial = upgrade ? await store.upgradeTrial(key, { ...appTrial, browserStartedAt: existing.startedAt })
          : existing || await store.startTrial(key, body?.app === true ? appTrial : { startedAt: now() });
        return res.status(200).json({ ok: true, configured, signedIn: true, plan, ...proAccessState(record, trial, now()), ...payment(key) });
      }
      const utr = normalizeUtr(body?.utr);
      if (!utr) return fail(400, 'Enter the 12-digit UPI reference number (UTR) shown in your payment app.');
      const risk = utrRisk(utr, now());
      if (risk === 'fake') return fail(400, 'That isn’t a UPI reference number. Copy the 12-digit UTR or UPI Ref No. exactly as it appears on your payment receipt.');
      const [record, trial] = await Promise.all([store.readAccount(key), store.readTrial(key)]);
      const state = proAccessState(record, trial, now());
      if (state.paused) return fail(403, 'We could not match your last payment reference, so instant unlock is paused for this account. Use the payment support links below before paying again.');
      if (!state.renewable) return fail(409, 'Pro is already active on this account.');
      const payments = Array.isArray(record?.payments) ? record.payments : [];
      if (risk === 'instant' && payments.filter(payment => payment.status === 'unverified').length >= 2) return fail(409, 'Your earlier payments are still being checked. Please try again later.');
      const claimedAt = new Date(now()).toISOString();
      if (!(await store.reserveUtr(utr, { account: key, claimedAt }))) return fail(409, 'This payment reference has already been used.');
      // A new reference replaces a held one: usually the reader fixing a typo.
      const replaced = payments.filter(payment => payment.status === 'held');
      const kept = payments.filter(payment => payment.status !== 'held');
      const base = { utr, note: paymentNote(key), amount: PRO_PRICE, claimedAt, dateMatch: risk === 'instant' };
      let claim, status, expiresAt;
      if (risk === 'instant') {
        const periodStart = state.active ? state.expiresAt : now();
        claim = { ...base, periodStart, periodEnd: periodStart + PRO_DAYS * DAY, status: 'unverified' };
        status = 'unverified'; expiresAt = claim.periodEnd;
      } else {
        claim = { ...base, status: 'held' };
        status = record && record.status !== 'held' ? record.status : 'held';
        expiresAt = Number.isFinite(record?.expiresAt) ? record.expiresAt : 0;
      }
      const next = { googleSubject: session.googleSubject, name: session.name, email: session.email, note: paymentNote(key), trialExpiresAt: state.trialExpiresAt, createdAt: record?.createdAt || claimedAt,
        updatedAt: claimedAt, status, expiresAt, payments: [...kept, claim].slice(-36) };
      try { await store.writeAccount(key, next); }
      catch (error) { await store.releaseUtr(utr).catch(() => {}); throw error; }
      // Free a mistyped reference so its real owner can still use it.
      await Promise.all(replaced.map(payment => store.releaseUtr(payment.utr).catch(() => {})));
      return res.status(risk === 'instant' ? 200 : 202).json({ ok: true, held: risk !== 'instant', configured, signedIn: true, plan, ...proAccessState(next, trial, now()), ...payment(key) });
    } catch (error) {
      if (error.status === 413) return fail(413, 'Request is too large.');
      if (error.status === 400) return fail(400, 'Invalid request.');
      return fail(503, 'Pro unlock is temporarily unavailable. Your payment is safe; please try again.');
    }
  };
}
