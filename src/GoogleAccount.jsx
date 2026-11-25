import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, LogOut, Sparkles, UserRound, X } from 'lucide-react';
import { growthEvent } from './growth.js';
import { useTheme } from './theme.jsx';
import { mergeWatchlist } from './watchlistTools.js';
import { AUTH_EVENT } from './pro.js';
import { PRO_APP_TRIAL_DAYS, PRO_PAGES, PRO_TRIAL_MINUTES } from '../lib/proPlan.js';
import { inAppBrowser, isAndroid, openInChromeUrl, useHasApp } from './installState.js';
import { markOneTap, oneTapOffered, scheduleOneTap } from './oneTap.js';

// Readers with the app are told about their longer trial; nobody else is.
const accountBenefits = hasApp => [
  [`A ${hasApp ? `${PRO_APP_TRIAL_DAYS}-day` : `${PRO_TRIAL_MINUTES}-minute`} Pro trial, free`, `Start it from any Pro workspace. All ${PRO_PAGES.length} open at once.`],
  ['Your watchlist, backed up', 'Restore it on another phone or computer.'],
  ['No payment details', 'No automatic charge and no marketing emails.'],
];

let googleScript;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!googleScript) googleScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const failed = () => { clearTimeout(timeout); script.remove(); googleScript = null; reject(new Error('Google sign-in could not load. Check your connection and try again.')); };
    const timeout = setTimeout(failed, 15_000);
    script.onload = () => { clearTimeout(timeout); window.google?.accounts?.id ? resolve(window.google.accounts.id) : failed(); };
    script.onerror = failed;
    document.head.appendChild(script);
  });
  return googleScript;
}
// Extra Sign in with Google buttons (the Pro paywall) share the header's initialized client.
const slots = new Set();
let readyClient = null;
const renderSlot = (google, slot) => {
  slot.el.replaceChildren();
  // Google accepts 200–400px; fit the slot's own column, inside any dialog padding.
  const width = Math.round(Math.max(200, Math.min(400, slot.el.clientWidth || slot.el.parentElement?.clientWidth || 240)));
  google.renderButton(slot.el, { type: 'standard', theme: slot.theme === 'dark' ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center', width });
  slot.onReady?.();
};
function attachGoogleButton(el, theme, onReady) {
  const slot = { el, theme, onReady };
  slots.add(slot);
  if (readyClient) renderSlot(readyClient, slot);
  return () => slots.delete(slot);
}

export function GoogleSignIn({ busy, fallback = 'Loading Google sign-in…' }) {
  const { theme } = useTheme();
  const slot = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => attachGoogleButton(slot.current, theme, () => setReady(true)), [theme]);
  // Google refuses sign-in inside other apps' built-in browsers, so send those readers to Chrome.
  const [embedded] = useState(inAppBrowser);
  return <>
    <div ref={slot} className={`google-button-slot${busy ? ' google-button-busy' : ''}`} aria-busy={busy} />
    {!ready && <p className="signup-note" role="status">{fallback}</p>}
    {embedded && <p className="signup-note signup-embedded" role="note">Google sign-in doesn’t work inside this app’s browser. {isAndroid() ?
      <a href={openInChromeUrl()} onClick={() => growthEvent('signin_open_chrome')}>Open this page in Chrome</a> : 'Open this page in Safari or Chrome'} to continue.</p>}
  </>;
}

function WatchlistBackup({ watch, onRestoreWatch }) {
  const [backup, setBackup] = useState(undefined);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    let live = true;
    authRequest('watchlist').then(result => {
      if (live) { setBackup(result.backup); setError(''); }
    }).catch(failure => { if (live) setError(failure.message); });
    return () => { live = false; };
  }, [attempt]);
  async function update(body) {
    setPending(true); setError(''); setMessage(''); setConfirm('');
    try {
      const result = await authRequest('watchlist', body);
      setBackup(result.backup);
      setMessage(body.remove ? 'Account backup deleted.' : 'Watchlist backed up to your account.');
    } catch (failure) { setError(failure.message); }
    finally { setPending(false); }
  }
  function restore() {
    const { added, overflow } = mergeWatchlist(watch, backup.symbols);
    onRestoreWatch(backup.symbols);
    setError('');
    setMessage((added.length ? `Added ${added.length} to this device’s watchlist.` : overflow ? 'This device’s watchlist is full.' : 'This device already has all the saved symbols.') +
      (overflow ? ` ${overflow} from your backup did not fit.` : ''));
  }
  return <section className="account-backup" aria-labelledby="account-backup-title">
    <h3 id="account-backup-title">Watchlist backup</h3>
    <p className="signup-note">Save this device’s watchlist to your account. Restore it on another device to add stocks without removing your local list. Changes aren’t synced automatically.</p>
    {backup && <p className="signup-note">{backup.symbols.length} saved · {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(backup.savedAt))}</p>}
    {backup !== undefined ? <div className="account-backup-actions">
      <button type="button" className="button primary" disabled={pending || !watch.length}
        onClick={() => backup ? setConfirm('replace') : update({ symbols: watch })}>Back up watchlist</button>
      {backup && <>
        <button type="button" className="button" disabled={pending} onClick={restore}>Restore watchlist</button>
        <button type="button" className="button" disabled={pending} onClick={() => setConfirm('delete')}>Delete backup</button>
      </>}
    </div> : error ? <button type="button" className="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry backup check</button> :
      <p className="signup-note" role="status">Checking for a saved watchlist…</p>}
    {confirm && <div className="account-backup-confirm">
      <p className="signup-note">{confirm === 'replace' ? 'Replace the account backup with this device’s watchlist?' : 'Delete the account backup? This device’s list will stay here.'}</p>
      <div className="account-backup-actions">
        <button type="button" className="button" onClick={() => update(confirm === 'replace' ? { symbols: watch } : { remove: true })}>{confirm === 'replace' ? 'Replace backup' : 'Delete account backup'}</button>
        <button type="button" className="button" onClick={() => setConfirm('')}>Cancel</button>
      </div>
    </div>}
    {message && <p className="signup-note" role="status">{message}</p>}
    {error && <p className="signup-error" role="alert">{error}</p>}
  </section>;
}

export async function authRequest(op, body) {
  const response = await fetch(`/api/auth?op=${op}`, {
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'Sign-in is temporarily unavailable. Please try again.');
  return result;
}

export default function GoogleAccount({ initial, compact = false, watch = [], onRestoreWatch, accountButtonRef }) {
  const [user, setUser] = useState(initial.user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [clientReady, setClientReady] = useState(false);
  const dialog = useRef(null), inFlight = useRef(false);
  const hasApp = useHasApp();

  useEffect(() => {
    let live = true;
    if (user) return;
    const setup = async () => {
      try {
        const [google, { nonce }] = await Promise.all([loadGoogle(), authRequest('challenge')]);
        if (!live) return;
        google.initialize({ client_id: initial.clientId, nonce, auto_select: false,
          use_fedcm_for_button: true, button_auto_select: true,
          use_fedcm_for_prompt: true, context: 'signup', itp_support: true, cancel_on_tap_outside: true,
          callback: async ({ credential, select_by: via }) => {
            if (!live || inFlight.current) return;
            inFlight.current = true; setBusy(true); setError('');
            growthEvent('google_signin_submitted', { via: String(via || 'unknown') });
            try {
              const result = await authRequest('google', { credential, nonce });
              if (!live) return;
              // On a paywall the reader carries on paying; elsewhere, confirm the sign-in.
              setUser(result.user);
              window.dispatchEvent(new Event(AUTH_EVENT));
              growthEvent('google_signin_completed');
            } catch (failure) {
              if (!live) return;
              setError(failure.message); setOpen(true); setAttempt(value => value + 1);
              growthEvent('google_signin_failed');
            } finally { inFlight.current = false; if (live) setBusy(false); }
          },
        });
        readyClient = google;
        for (const slot of slots) renderSlot(google, slot);
        setClientReady(true);
      } catch (failure) { if (live) setError(failure.message); }
    };
    setup();
    // Refresh the browser-bound challenge before its ten-minute expiry.
    const refresh = setInterval(() => { if (!inFlight.current) setup(); }, 8 * 60_000);
    return () => { live = false; readyClient = null; clearInterval(refresh); };
  }, [initial.clientId, user, attempt]);

  useEffect(() => {
    // Google refuses sign-in inside other apps' browsers; those readers get the button's Chrome link instead.
    if (user || !clientReady || inAppBrowser() || oneTapOffered()) return;
    return scheduleOneTap(() => {
      growthEvent('one_tap_prompted');
      window.google?.accounts?.id?.prompt();
    });
  }, [user, clientReady]);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);

  useEffect(() => {
    let live = true;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || inFlight.current) return;
      try { const result = await authRequest('session'); if (live) setUser(previous => JSON.stringify(previous) === JSON.stringify(result.user) ? previous : result.user); }
      catch { /* Preserve the current view during a transient connection failure. */ }
    };
    document.addEventListener('visibilitychange', refresh);
    return () => { live = false; document.removeEventListener('visibilitychange', refresh); };
  }, []);

  async function logout() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      await authRequest('logout', {});
      window.google?.accounts?.id?.disableAutoSelect();
      setUser(null); setOpen(false); growthEvent('google_signout');
      window.dispatchEvent(new Event(AUTH_EVENT));
    } catch (failure) { setError(failure.message); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <>
    <button ref={accountButtonRef} className="button signup-entry google-account-entry" onClick={() => { setOpen(true); if (!user) { markOneTap(); window.google?.accounts?.id?.cancel(); growthEvent('signup_prompt_viewed', { source: 'account', method: 'google' }); } }}
      aria-label={user ? 'Your account' : 'Sign up free or sign in'} title={user ? `Signed in as ${user.name}` : 'Create a free account or sign in with Google'}>
      {!compact && <UserRound size={16} />}<span>{user ? compact ? 'Account' : `Hi, ${user.name.split(' ')[0]}` : 'Sign up free'}</span>
    </button>
    {createPortal(<dialog ref={dialog} className="signup-dialog" aria-labelledby="google-account-title" onCancel={() => setOpen(false)}
      onClick={event => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) setOpen(false); } }}>
      <button className="signup-close icon-button" aria-label="Close account" onClick={() => setOpen(false)}><X size={20} /></button>
      <div className="signup-emblem">{user ? <Check size={26} /> : <Sparkles size={24} />}</div>
      <h2 id="google-account-title">{user ? `Welcome, ${user.name.split(' ')[0]}.` : 'Create your free account'}</h2>
      {user && <p className="google-account-email">{user.email}</p>}
      {user ? open && onRestoreWatch && <WatchlistBackup key={user.email} watch={watch} onRestoreWatch={onRestoreWatch} /> :
        <>
          <p className="account-intro">One tap with Google. Use the same button to sign in again later.</p>
          <ul className="account-benefits">
            {accountBenefits(hasApp).map(([title, detail]) => <li key={title}><Check size={13} aria-hidden="true" /><div><strong>{title}</strong><span>{detail}</span></div></li>)}
          </ul>
        </>}
      <p className="signup-note">Your holdings, journal and other saved research stay on this device.</p>
      {error && <p className="signup-error" role="alert">{error}</p>}
      {user ? <button className="button signup-submit" disabled={busy} onClick={logout}><LogOut size={16} />{busy ? 'Signing out…' : 'Sign out'}</button> : error ? <button className="button primary signup-submit" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Try again</button> : open && <GoogleSignIn busy={busy} />}
      <p className="signup-note">Google shares your name, email and account identifier for sign-in. No marketing subscription. <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy details</a></p>
    </dialog>, document.body)}
  </>;
}
