// Shared by the browser and the server: keep this file free of Node-only imports.
export const PRO_PRICE = 300;
export const PRO_DAYS = 30;
export const PRO_TRIAL_MINUTES = 30;
// Readers who install the app get a longer trial, once per account.
export const PRO_APP_TRIAL_DAYS = 3;
export const PRO_APP_TRIAL_MINUTES = PRO_APP_TRIAL_DAYS * 1440;
export const PRO_RENEW_DAYS = 7;
// The locked workspaces. Markets and Fundamentals were unlocked on 17 November 2026: they sit on the
// phone tab bar, so new visitors met a paywall before seeing any research. Their paywall copy and
// sample charts are kept, so adding a name back here locks that workspace again.
export const PRO_PAGES = ['Forecast', 'Analytics', 'Breakouts', 'FnO', 'Flows'];
// Without Pro, each locked workspace opens on one live example and the rest stays behind the paywall.
// Forecast and Advanced analytics show the app's default stock; Breakout insights shows the session's
// top breakout; Futures & options shows this underlying at its nearest expiry; Institutional flows
// shows FII/DII cash and this many of the largest deals.
export const PRO_EXAMPLE_SYMBOL = 'RELIANCE.NS';
export const PRO_EXAMPLE_UNDERLYING = 'NIFTY';
export const PRO_EXAMPLE_DEALS = 5;
export const PRO_SUPPORT_EMAIL = 'yashsarda31@gmail.com';
export const PRO_SUPPORT_WHATSAPP = 'https://wa.me/919831810983';
export const PRO_SUPPORT_MAILTO = `mailto:${PRO_SUPPORT_EMAIL}?subject=Alpha%20Nova%20Pro%20payment%20help`;
export const PRO_PAYEE = 'YASHVARDHAN SARDA';
export const DAY = 86_400_000;

// A UPI payment request with the amount and a note that identifies the payer's account.
// Spaces are %20 and the VPA stays unescaped: several UPI apps mishandle '+' and '%40'.
export function upiLink({ upiId, payee = PRO_PAYEE, note }) {
  if (!/^[\w.-]{2,64}@[A-Za-z][\w.-]{1,32}$/.test(upiId || '')) return null;
  const text = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `upi://pay?pa=${upiId}&pn=${text(payee)}&am=${PRO_PRICE.toFixed(2)}&cu=INR&tn=${text(`Alpha Nova Pro ${note}`)}`;
}

// UPI apps show a 12-digit reference (UTR / RRN) for every completed payment.
export function normalizeUtr(value) {
  const utr = typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
  return /^\d{12}$/.test(utr) ? utr : null;
}

// What an account holder may know about their own access.
export function proState(record, now = Date.now()) {
  const expiresAt = Number.isFinite(record?.expiresAt) ? record.expiresAt : 0;
  const paused = record?.status === 'revoked';
  const active = !!record && !paused && expiresAt > now;
  const pending = !paused && Array.isArray(record?.payments) && record.payments.some(payment => payment.status === 'held');
  return { active, expiresAt: active ? expiresAt : null, renewable: !paused && (!active || expiresAt - now <= PRO_RENEW_DAYS * DAY), paused, pending };
}

// Trials live separately from payment records. A browser trial is never reset;
// installing the app replaces it once with the longer app trial.
export function proAccessState(record, trial, now = Date.now()) {
  const paid = proState(record, now);
  const minutes = Number.isFinite(trial?.minutes) ? trial.minutes : PRO_TRIAL_MINUTES;
  const trialExpiresAt = Number.isFinite(trial?.startedAt) ? trial.startedAt + minutes * 60_000 : null;
  const trialActive = !paid.paused && !paid.active && trialExpiresAt > now;
  const open = !paid.paused && !paid.active;
  return { ...paid, active: paid.active || trialActive,
    expiresAt: paid.active ? paid.expiresAt : trialActive ? trialExpiresAt : null,
    trialActive, trialExpiresAt, trialEligible: !trial && open, appTrialEligible: !trial?.app && open };
}
