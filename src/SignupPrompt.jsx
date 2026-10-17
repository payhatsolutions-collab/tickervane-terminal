import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Mail, UserRound, X } from 'lucide-react';
import { growthEvent } from './growth.js';
import { SIGNUP_NOTICE_VERSION } from '../lib/signup.js';
import { SIGNUP_COOLDOWN, SIGNUP_KEYS, advanceSignupClock, readSignupValue, saveSignupValue, shouldPromptSignup, signupClock, signupProfile } from './signupState.js';
import './signup.css';

const local = () => { try { return window.localStorage; } catch { return null; } };
const session = () => { try { return window.sessionStorage; } catch { return null; } };
const editing = () => document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');

export default function SignupPrompt({ busy = false }) {
  const [available, setAvailable] = useState(false);
  const [profile, setProfile] = useState(() => signupProfile(readSignupValue(local(), SIGNUP_KEYS.profile)));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialog = useRef(null);
  const nameInput = useRef(null);
  const emailInput = useRef(null);
  const request = useRef(null);
  const inFlight = useRef(false);
  const clock = useRef(signupClock(readSignupValue(session(), SIGNUP_KEYS.clock)));
  const current = useRef({ busy, profile, open, available });
  current.current = { busy, profile, open, available };

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/signup?op=status', { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!controller.signal.aborted) setAvailable(data?.configured === true); })
      .catch(() => {});
    return () => { controller.abort(); request.current?.abort(); };
  }, []);

  useEffect(() => {
    let last = performance.now();
    let wasVisible = document.visibilityState === 'visible';
    const tick = () => {
      const now = performance.now();
      const visible = document.visibilityState === 'visible';
      clock.current = advanceSignupClock(clock.current, now - last, wasVisible);
      last = now;
      wasVisible = visible;
      saveSignupValue(session(), SIGNUP_KEYS.clock, clock.current);
      const state = current.current;
      if (!state.available || state.open) return;
      const remembered = signupProfile(readSignupValue(local(), SIGNUP_KEYS.profile));
      if (shouldPromptSignup({
        clock: clock.current, profile: state.profile || remembered,
        dismissedUntil: readSignupValue(local(), SIGNUP_KEYS.dismissed),
        now: Date.now(), visible,
        busy: state.busy || editing() || !!document.querySelector('dialog[open], [aria-modal="true"]'),
      })) {
        clock.current.shown = true;
        saveSignupValue(session(), SIGNUP_KEYS.clock, clock.current);
        setOpen(true);
        growthEvent('signup_prompt_viewed', { source: 'timed' });
      }
    };
    const interval = setInterval(tick, 1000);
    const storageChanged = event => {
      if (event.key === SIGNUP_KEYS.profile) {
        const remembered = signupProfile(readSignupValue(local(), SIGNUP_KEYS.profile));
        setProfile(remembered);
        if (remembered) setOpen(false);
      }
      if (event.key === SIGNUP_KEYS.dismissed) setOpen(false);
    };
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('pagehide', tick);
    window.addEventListener('storage', storageChanged);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('pagehide', tick);
      window.removeEventListener('storage', storageChanged);
    };
  }, []);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);

  function dismiss() {
    clock.current.shown = true;
    saveSignupValue(session(), SIGNUP_KEYS.clock, clock.current);
    saveSignupValue(local(), SIGNUP_KEYS.dismissed, Date.now() + SIGNUP_COOLDOWN);
    if (!profile) growthEvent('signup_prompt_dismissed');
    setOpen(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    growthEvent('signup_submitted');
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ name, email, noticeVersion: SIGNUP_NOTICE_VERSION, website: new FormData(event.currentTarget).get('website') }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) {
        if (result?.field === 'name') nameInput.current?.focus();
        if (result?.field === 'email') emailInput.current?.focus();
        throw new Error(result?.error || 'We couldn’t save your signup. Please try again.');
      }
      const saved = { name: name.trim().replace(/\s+/g, ' ').slice(0, 80), registeredAt: Date.now() };
      saveSignupValue(local(), SIGNUP_KEYS.profile, saved);
      setProfile(saved);
      setName('');
      setEmail('');
      growthEvent('signup_completed');
    } catch (failure) {
      setError(failure.name === 'AbortError' ? 'The request took too long. Please try again.' : failure.message);
      growthEvent('signup_failed');
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (!available && !profile) return null;
  return <>
    <button className="button signup-entry" onClick={() => {
      setError(''); setOpen(true);
      if (!profile) growthEvent('signup_prompt_viewed', { source: 'header' });
    }} aria-label={profile ? 'View free registration' : 'Sign up for free'}>
      <UserRound size={15} /><span>{profile ? `Hi, ${profile.name.split(' ')[0]}` : 'Sign up free'}</span>
    </button>
    {createPortal(<dialog ref={dialog} className="signup-dialog" aria-labelledby="signup-title" aria-describedby="signup-description"
      onCancel={event => { event.preventDefault(); dismiss(); }}
      onClick={event => { if (event.target === dialog.current) {
        const rect = dialog.current.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
      } }}>
      <button className="signup-close icon-button" onClick={dismiss} aria-label="Close signup"><X size={20} /></button>
      {profile ? <section className="signup-success">
        <div className="signup-emblem"><Check size={28} /></div>
        <p className="signup-kicker">WELCOME TO ALPHA NOVA</p>
        <h2 id="signup-title">You’re signed up, {profile.name.split(' ')[0]}.</h2>
        <p id="signup-description">Your free registration is saved. We’ll remember you on this browser.</p>
        <p className="signup-note">Your watchlist and portfolio still stay on this device.</p>
        <button className="button primary signup-submit" onClick={() => setOpen(false)}>Keep exploring <ChevronRight size={16} /></button>
        <button className="signup-later" onClick={() => {
          try { local()?.removeItem(SIGNUP_KEYS.profile); } catch { /* Memory still clears. */ }
          setProfile(null); dismiss();
        }}>Forget my name on this browser</button>
        <p className="signup-note">This clears your local welcome name, not your registration. <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy details</a></p>
      </section> : <section>
        <div className="signup-emblem"><UserRound size={27} /></div>
        <p className="signup-kicker">MAKE YOURSELF AT HOME</p>
        <h2 id="signup-title">A better experience.<br /><span>Still completely free.</span></h2>
        <p id="signup-description">Sign up with your name and email. We’ll remember you here, so you can get straight back to exploring the markets.</p>
        <form onSubmit={submit} className="signup-form">
          <label htmlFor="signup-name">Your name</label>
          <input ref={nameInput} id="signup-name" name="name" autoComplete="name" maxLength={80} required value={name} onChange={event => setName(event.target.value)} placeholder="Your name" />
          <label htmlFor="signup-email">Email address</label>
          <input ref={emailInput} id="signup-email" name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
          <div className="signup-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          <p className="signup-note">By signing up, you share your name and email with Alpha Nova for free registration. This doesn’t subscribe you to marketing emails. <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy details</a></p>
          {error && <p className="signup-error" role="alert">{error}</p>}
          <button className="button primary signup-submit" disabled={submitting}><Mail size={16} />{submitting ? 'Saving…' : 'Sign up for free'}{!submitting && <ChevronRight size={16} />}</button>
        </form>
        <button className="signup-later" onClick={dismiss}>Maybe later — keep exploring</button>
        <p className="signup-footnote">No password. No payment details. Your saved research stays on this device.</p>
      </section>}
    </dialog>, document.body)}
  </>;
}
