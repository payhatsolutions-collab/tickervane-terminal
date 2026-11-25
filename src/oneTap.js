// Google One Tap: offered at most once per visit, after the reader's first tap,
// key press or wheel scroll (plus a short pause), or after 15 seconds.
const ONE_TAP_KEY = 'an2-one-tap-offered';
const ONE_TAP_IDLE = 15_000, ONE_TAP_AFTER_ACTION = 1_500;
const ONE_TAP_EVENTS = ['pointerdown', 'keydown', 'wheel'];
export const oneTapOffered = () => { try { return sessionStorage.getItem(ONE_TAP_KEY) === '1'; } catch { return false; } };
export const markOneTap = () => { try { sessionStorage.setItem(ONE_TAP_KEY, '1'); } catch { /* private mode */ } };

export function scheduleOneTap(prompt, { idle = ONE_TAP_IDLE, afterAction = ONE_TAP_AFTER_ACTION, target = window, doc = document } = {}) {
  let timer, finished = false;
  const detach = () => ONE_TAP_EVENTS.forEach(type => target.removeEventListener(type, onAction, true));
  const show = () => {
    if (finished) return;
    if (oneTapOffered()) { finished = true; detach(); return; }
    // Wait for any open dialog (search, Pro offer) to close, and for the tab to be visible.
    if (doc.visibilityState !== 'visible' || doc.querySelector('dialog[open], [aria-modal="true"]')) { timer = setTimeout(show, 5_000); return; }
    finished = true; detach(); markOneTap();
    prompt();
  };
  function onAction() { detach(); clearTimeout(timer); timer = setTimeout(show, afterAction); }
  ONE_TAP_EVENTS.forEach(type => target.addEventListener(type, onAction, { capture: true, passive: true }));
  timer = setTimeout(show, idle);
  return () => { finished = true; detach(); clearTimeout(timer); };
}
