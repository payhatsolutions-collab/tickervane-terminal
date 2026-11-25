import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderSVG } from 'uqr';
import { Activity, ArrowLeft, BookOpen, Check, Download, Gift, Globe, Landmark, Layers, Lock, Radar, RefreshCw, Smartphone, Sparkles, TrendingUp } from 'lucide-react';
import { GoogleSignIn } from './GoogleAccount.jsx';
import { useHasApp } from './installState.js';
import { PAGE_LABELS } from './navigation.js';
import ProWorkspacePreview from './ProWorkspacePreview.jsx';
import ProBreakoutPreview from './ProBreakoutPreview.jsx';
import { short } from './data.js';
import { PRO_WORKSPACE_COPY } from '../lib/proCopy.js';
import { PRO_APP_TRIAL_DAYS, PRO_DAYS, PRO_TRIAL_MINUTES, PRO_PAGES, PRO_PAYEE, PRO_PRICE, PRO_SUPPORT_EMAIL, PRO_SUPPORT_MAILTO, PRO_SUPPORT_WHATSAPP, normalizeUtr } from '../lib/proPlan.js';
import { proRequest } from './pro.js';
import { growthEvent } from './growth.js';
import './pro.css';

const FEATURES = [
  ['Forecast', TrendingUp],
  ['Analytics', Activity],
  ['Breakouts', Radar],
  ['FnO', Layers],
  ['Flows', Landmark],
  ['Fundamentals', BookOpen],
  ['Markets', Globe],
];
const PRICE = `₹${PRO_PRICE}`;
const touch = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };
function download(url, name) {
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
}
// UPI apps scan a gallery image, so the personal QR is saved as a PNG, not an SVG.
async function savePng(svg) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: 720, height: 720 });
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, 720, 720);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  const url = URL.createObjectURL(blob);
  download(url, 'alpha-nova-pro-upi-qr.png');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function GoogleSlot() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  return <GoogleSignIn fallback={late ? 'If Google sign-in doesn’t load here, try Sign up free at the top of the page.' : undefined} />;
}

function StaticQr({ note }) {
  return <>
    <span>Scan with any UPI app, enter {PRICE}{note ? <> and add <b className="pro-note">{note}</b> as the note</> : null}.</span>
    <img className="pro-qr" src="/pro/upi-qr.png" width="188" height="188" alt={`UPI QR code to pay ${PRO_PAYEE}`} />
    <button type="button" className="pro-link" onClick={() => download('/pro/upi-qr.png', 'alpha-nova-pro-upi-qr.png')}><Download size={12} /> Save QR to scan from your gallery</button>
  </>;
}

function PaymentQr({ access, page }) {
  const [plain, setPlain] = useState(false);
  const phone = useMemo(touch, []);
  const svg = useMemo(() => { try { return access.upi ? renderSVG(access.upi, { ecc: 'M', border: 2 }) : null; } catch { return null; } }, [access.upi]);
  if (!svg) return <StaticQr note={access.note} />;
  if (plain) return <>
    <StaticQr note={access.note} />
    <button type="button" className="pro-link" onClick={() => setPlain(false)}>Back to the pre-filled QR</button>
  </>;
  const qr = <>
    <div className="pro-qr" role="img" aria-label={`UPI QR code to pay ${PRICE} to ${PRO_PAYEE}`} dangerouslySetInnerHTML={{ __html: svg }} />
    <button type="button" className="pro-link" onClick={() => savePng(svg).catch(() => setPlain(true))}><Download size={12} /> Save QR to scan from your gallery</button>
  </>;
  return <>
    <span>{phone ? 'Open your UPI app' : 'Scan with your UPI app'}. The amount and payment note are prefilled.</span>
    {phone && <a className="button primary pro-pay" href={access.upi} onClick={() => growthEvent('pro_pay_tapped', { page })}><Smartphone size={16} /> Pay {PRICE} in a UPI app</a>}
    {phone ? <details className="pro-qr-options"><summary>Scan or save a QR code</summary>{qr}</details> : qr}
    <button type="button" className="pro-link" onClick={() => { setPlain(true); growthEvent('pro_plain_qr', { page }); }}>Trouble paying? Use the plain QR</button>
  </>;
}

const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// `onExample` leads back to the workspace's free live example, when it has one to show.
export default function ProGate({ page, access, symbol, refresh, onUnlock, onExample, paidCheckout = false, renew = false }) {
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trialError, setTrialError] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const claimInFlight = useRef(false);
  const seenStep = useRef('');
  const seenGate = useRef('');
  const step = access.signedIn ? 2 : 1;
  // A thank-you for installing, never advertised: readers with the app get the longer trial,
  // including those whose browser trial is used.
  const hasApp = useHasApp();
  const appTrial = hasApp && !renew && !access.paused && (!access.signedIn || !!access.appTrialEligible);
  const offerTrial = !paidCheckout && !access.pending && !renew && !access.paused && (!access.signedIn || access.trialEligible || appTrial);
  const trialLength = appTrial ? `${PRO_APP_TRIAL_DAYS} days` : `${PRO_TRIAL_MINUTES} minutes`;
  const trialStart = `Start ${appTrial ? `${PRO_APP_TRIAL_DAYS}-day` : `${PRO_TRIAL_MINUTES}-minute`} free trial`;
  const { question, preview } = PRO_WORKSPACE_COPY[page];
  const pitchTitle = paidCheckout ? 'Get Alpha Nova Pro' : page === 'Breakouts' && symbol ? `How would you check a breakout in ${short(symbol)}?` : question;

  useEffect(() => {
    if (seenGate.current === page) return;
    seenGate.current = page;
    growthEvent('pro_gate_viewed', { page, renew, paidCheckout });
  }, [page, renew]);
  useEffect(() => {
    const key = `${page}:${step}`;
    if (access.paused || seenStep.current === key) return;
    seenStep.current = key;
    growthEvent('pro_checkout_step_viewed', { page, renew, step });
  }, [page, renew, step, access.paused]);

  async function startTrial() {
    if (claimInFlight.current) return;
    claimInFlight.current = true;
    setBusy(true); setTrialError('');
    growthEvent('pro_trial_submitted', { page, app: appTrial });
    try {
      const result = await proRequest('trial', appTrial ? { app: true } : {});
      if (result.trialActive) growthEvent('pro_trial_started', { page, app: appTrial });
      access.apply(result);
      if (result.active) onUnlock?.();
    } catch (failure) { setTrialError(failure.message); growthEvent('pro_trial_failed', { page }); }
    finally { claimInFlight.current = false; setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (claimInFlight.current) return;
    const value = normalizeUtr(utr);
    if (!value) { setError('Enter the 12-digit UPI reference number (UTR) from your payment app.'); return; }
    claimInFlight.current = true;
    setBusy(true); setError(''); setStatusMessage('');
    growthEvent('pro_claim_submitted', { page, renew });
    try {
      const result = await proRequest('claim', { utr: value });
      growthEvent(result.held ? 'pro_claim_held' : 'pro_unlocked', { page, renew });
      setUtr('');
      access.apply(result);
      if (result.active && !result.held) onUnlock?.();
    } catch (failure) { setError(failure.message); growthEvent('pro_claim_failed', { page }); }
    finally { claimInFlight.current = false; setBusy(false); }
  }
  async function checkStatus() {
    setChecking(true); setStatusMessage('');
    try {
      const status = await access.refresh();
      if (status && !status.pending && status.active) {
        if (renew) setStatusMessage('Payment confirmed. Your Pro access has been extended.');
      } else if (status?.pending) setStatusMessage('Your payment is still being checked.');
      else if (status) setStatusMessage('This payment is no longer pending. Contact support if you were charged.');
    } finally { setChecking(false); }
  }
  const paying = step === 2 && (!offerTrial || showPayment || access.pending);
  return <section className={`pro-gate${renew ? ' pro-gate-renew' : ''}${offerTrial ? ' pro-gate-trial' : ''}`} aria-labelledby="pro-gate-title">
    <div className="pro-gate-pitch">
      <span className="eyebrow pro-gate-eyebrow"><Lock size={12} /> ALPHA NOVA PRO</span>
      {renew ? <h2 id="pro-gate-title">Renew Alpha Nova Pro</h2> : <h1 id="pro-gate-title">{pitchTitle}</h1>}
      <p className="pro-gate-lead">{renew ? `Add ${PRO_DAYS} days to keep using all ${PRO_PAGES.length} Pro workspaces.` : preview}</p>
      {!renew && onExample && <button type="button" className="pro-link pro-gate-example" onClick={() => { growthEvent('pro_example_opened', { page }); onExample(); }}><ArrowLeft size={13} aria-hidden="true" /> See the free live example</button>}
    </div>
    {!renew && <div className="pro-gate-evidence">
      <ProWorkspacePreview page={page} />
      {page === 'Breakouts' && symbol && <ProBreakoutPreview symbol={symbol} refresh={refresh} />}
    </div>}
    <div className="pro-gate-pay">
      <div className="pro-offer-head">
        <div className="pro-price"><strong>{offerTrial ? 'Free' : PRICE}</strong><span>for {offerTrial ? trialLength : `${PRO_DAYS} days`}</span></div>
        {offerTrial && <span className="pro-offer-tag">{appTrial ? <Gift size={12} aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />} {appTrial ? 'App gift' : 'Free trial'}</span>}
      </div>
      {offerTrial ? <ul className="pro-assurances">
        {[`All ${PRO_PAGES.length} Pro workspaces unlocked`, 'No payment details or automatic charge', `Then ${PRICE} for ${PRO_DAYS} days, only if you choose`].map(item => <li key={item}><Check size={13} aria-hidden="true" />{item}</li>)}
      </ul> : <p className="pro-payment-note">{`${!renew ? `All ${PRO_PAGES.length} Pro workspaces. ` : ''}One UPI payment. No auto-renewal.`}</p>}
      {access.error && <p className="pro-gate-notice" role="alert">{access.error} <button type="button" className="pro-link" onClick={access.refresh}><RefreshCw size={12} /> Retry</button></p>}
      {access.paused ? <p className="pro-gate-notice" role="alert">We couldn’t match your last payment reference. Contact payment support before paying again.</p> : <>
        {!access.pending && <p className="pro-step-label" aria-live="polite"><span className="pro-progress" aria-hidden="true"><i className="on" /><i className={step === 2 ? 'on' : ''} /></span>Step {step} of 2 · {step === 1 ? 'Sign in' : offerTrial && !showPayment ? 'Start your free trial' : 'Pay and submit your reference'}</p>}
        {step === 1 ? <div className="pro-step">
          <p>{offerTrial ? `${appTrial ? 'A thank-you for installing the app. ' : ''}Sign in with Google, then start your ${trialLength}. Works with new and existing accounts, once per account.` : 'Start with Google sign-in. Your Pro access follows that account across devices.'}</p>
          <GoogleSlot />
        </div> : <div className="pro-step">
          {offerTrial && <div className="pro-trial">
            {appTrial && <p className="pro-gift-note"><Gift size={14} aria-hidden="true" /> A thank-you for installing the app.</p>}
            <button type="button" className="button primary pro-next pro-start" disabled={busy || access.loading} onClick={startTrial}>{busy ? 'Starting…' : trialStart}</button>
            {trialError && <p className="pro-gate-error" role="alert">{trialError}</p>}
            {!access.pending && <button type="button" className="pro-link" disabled={busy} onClick={() => setShowPayment(value => !value)}>{showPayment ? 'Hide payment options' : `Or buy ${PRO_DAYS} days for ${PRICE}`}</button>}
          </div>}
          {paying && <>
          {access.pending ? <>
            <p className="pro-gate-notice" role="status"><strong>We received your payment reference.</strong> We’ll match it to the bank record, usually within a day. Keep your receipt and don’t pay again.</p>
            <button type="button" className="button pro-next" disabled={checking} onClick={checkStatus}><RefreshCw size={14} /> {checking ? 'Checking…' : 'Check payment status'}</button>
          </> : <>
            <p>In your UPI app, look for <strong>{PRO_PAYEE}</strong>, the founder and payment recipient for Alpha Nova.</p>
            <PaymentQr access={access} page={page} />
          </>}
          <form className="pro-reference" onSubmit={submit} noValidate>
            <label htmlFor="pro-utr"><strong>{access.pending ? 'Need to correct the reference?' : 'After you pay, paste your UPI reference'}</strong>
              <span>Find the 12-digit UTR or UPI Ref No. on your payment receipt.</span></label>
            <input id="pro-utr" value={utr} onChange={event => { setUtr(event.target.value); setError(''); }} inputMode="numeric" autoComplete="off" maxLength={24}
              placeholder="12-digit UTR" disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'pro-utr-error' : undefined} />
            {error && <p id="pro-utr-error" className="pro-gate-error" role="alert">{error}</p>}
            <button className="button primary pro-submit" disabled={busy}>{busy ? 'Submitting…' : access.pending ? 'Submit corrected reference' : 'Submit payment reference'}</button>
          </form>
          </>}
        </div>}
        {statusMessage && <p className="pro-gate-notice" role="status">{statusMessage}</p>}
      </>}
      {(paying || access.paused) && <div className="pro-support">
        <strong>Payment help</strong>
        <p>If you’ve paid and need help, send your UPI reference and payment date.</p>
        <a className="pro-link" href={PRO_SUPPORT_MAILTO}>{PRO_SUPPORT_EMAIL}</a>
        <a className="pro-link" href={PRO_SUPPORT_WHATSAPP}>WhatsApp +91 98318 10983</a>
      </div>}
      <details className="pro-gate-terms">
        <summary>Payment and access terms</summary>
        <p>One {appTrial ? `${PRO_APP_TRIAL_DAYS}-day` : `${PRO_TRIAL_MINUTES}-minute`} free trial per account, starting when you select {trialStart}. No automatic charge. Paid access usually starts when you submit your reference. Some payments need a manual match first. Paid access is removed if no matching {PRICE} payment is found. <a href="/pricing.html">Pricing</a> · <a href="/privacy.html">Privacy</a></p>
      </details>
    </div>
    <div className="pro-includes">
      <strong>What you can check with Pro</strong>
      <ul className="pro-gate-features">
        {FEATURES.filter(([name]) => PRO_PAGES.includes(name)).map(([name, Icon]) => <li key={name} className={name === page ? 'current' : ''}><Icon size={17} /><div><strong>{PAGE_LABELS[name]}</strong><span>{PRO_WORKSPACE_COPY[name].benefit}</span></div></li>)}
      </ul>
    </div>
  </section>;
}

const trialEnd = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

export function ProRenewal({ page, access }) {
  const [open, setOpen] = useState(false);
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState('');
  const hasApp = useHasApp();
  // A running browser trial becomes the app trial once the reader has the app.
  const canExtend = access.trialActive && hasApp && access.appTrialEligible;
  async function extend() {
    setExtending(true); setExtendError('');
    try { access.apply(await proRequest('trial', { app: true })); growthEvent('pro_trial_started', { page, app: true }); }
    catch (failure) { setExtendError(failure.message); }
    finally { setExtending(false); }
  }
  return <>
    <div className="pro-renewal" role="status">
      <span><Lock size={13} /> {access.trialActive ? 'Your free trial' : 'Alpha Nova Pro'} ends on {(access.trialActive ? trialEnd : day).format(new Date(access.expiresAt))}.{access.trialActive ? ' No automatic charge.' : ''}</span>
      {canExtend && <button type="button" className="button primary" disabled={extending} onClick={extend}>{extending ? 'Extending…' : `Extend to ${PRO_APP_TRIAL_DAYS} days free`}</button>}
      <button type="button" className="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Not now' : `${access.trialActive ? 'Continue' : 'Renew'} for ₹${PRO_PRICE}`}</button>
    </div>
    {extendError && <p className="pro-gate-error" role="alert">{extendError}</p>}
    {open && <ProGate page={page} access={access} renew />}
  </>;
}
