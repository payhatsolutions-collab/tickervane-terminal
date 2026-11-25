import { useCallback, useEffect, useRef, useState } from 'react';
import { PRO_APP_TRIAL_DAYS, PRO_DAYS, PRO_PAGES, PRO_PRICE, PRO_TRIAL_MINUTES } from '../lib/proPlan.js';

export const AUTH_EVENT = 'an-auth-change';
const KEY = 'an2-pro-v1';
// Only spares a returning Pro reader a flash of the paywall; the server decides access.
function remembered() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return Number.isFinite(value?.expiresAt) && value.expiresAt > Date.now() ? value.expiresAt : null;
  } catch { return null; }
}
function remember(expiresAt) {
  try { expiresAt ? localStorage.setItem(KEY, JSON.stringify({ expiresAt })) : localStorage.removeItem(KEY); } catch { /* Continue in memory. */ }
}

export async function proRequest(op, body) {
  const response = await fetch(`/api/pro?op=${op}`, {
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'We couldn’t check Pro access. Please try again.');
  return result;
}

export function useProAccess() {
  const [state, setState] = useState(() => {
    const expiresAt = remembered();
    return { loading: true, error: '', configured: true, signedIn: false, active: !!expiresAt, expiresAt, renewable: !expiresAt, paused: false, trialEligible: false, appTrialEligible: false, trialActive: false, plan: { price: PRO_PRICE, days: PRO_DAYS, trialMinutes: PRO_TRIAL_MINUTES, appTrialDays: PRO_APP_TRIAL_DAYS } };
  });
  const revision = useRef(0);
  const apply = useCallback(data => {
    revision.current += 1;
    remember(data.active ? data.expiresAt : null);
    setState(previous => ({ ...previous, ...data, loading: false, error: '' }));
  }, []);
  const refresh = useCallback(async () => {
    const started = ++revision.current;
    try {
      const data = await proRequest('status');
      if (started !== revision.current) return;
      apply(data);
      return data;
    } catch (failure) {
      if (started === revision.current) setState(previous => ({ ...previous, loading: false, error: failure.message }));
    }
  }, [apply]);
  useEffect(() => {
    refresh();
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(AUTH_EVENT, refresh);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener(AUTH_EVENT, refresh); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  useEffect(() => {
    if (!state.active || !state.expiresAt) return;
    // Close an expired workspace even if the tab stays open or the next request fails.
    const expire = () => {
      remember(null);
      setState(previous => ({ ...previous, active: false, trialActive: false, expiresAt: null, renewable: !previous.paused }));
      refresh();
    };
    let timer;
    const schedule = () => {
      const remaining = state.expiresAt - Date.now();
      if (remaining <= 0) expire();
      else timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [state.active, state.expiresAt, refresh]);
  const gated = state.configured && !state.active;
  return { ...state, apply, refresh, lockedPages: gated ? PRO_PAGES : [], locks: page => gated && PRO_PAGES.includes(page) };
}
