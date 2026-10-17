export const SIGNUP_DELAY = 120_000;
export const SIGNUP_COOLDOWN = 7 * 24 * 60 * 60 * 1000;
export const SIGNUP_KEYS = {
  clock: 'an2-signup-session-v1',
  profile: 'an2-signup-profile-v1',
  dismissed: 'an2-signup-dismissed-v1',
};

export function readSignupValue(storage, key) {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
}
export function saveSignupValue(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* Continue in memory. */ }
}
export function signupProfile(value) {
  return value && typeof value.name === 'string' && value.name.trim() &&
    Number.isFinite(value.registeredAt) && value.registeredAt > 0
    ? { name: value.name.trim().slice(0, 80), registeredAt: value.registeredAt } : null;
}
export function signupClock(value) {
  return {
    elapsed: Number.isFinite(value?.elapsed) ? Math.max(0, Math.min(SIGNUP_DELAY, value.elapsed)) : 0,
    shown: value?.shown === true,
  };
}
export function advanceSignupClock(state, delta, visible) {
  return { ...state, elapsed: Math.min(SIGNUP_DELAY, state.elapsed + (visible && Number.isFinite(delta) ? Math.max(0, delta) : 0)) };
}
export function shouldPromptSignup({ clock, profile, dismissedUntil, now, visible, busy }) {
  return !profile && !clock.shown && clock.elapsed >= SIGNUP_DELAY && visible && !busy &&
    !(Number.isFinite(dismissedUntil) && dismissedUntil > now);
}
