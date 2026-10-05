// Browser side of Web Push: service-worker registration, subscribe/unsubscribe
// and keeping the server copy of alerts, watchlist and saved screens in sync.
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);

export async function registerSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}
async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) || registerSW();
}
export async function currentSubscription() {
  try { const reg = await registration(); return reg ? await reg.pushManager.getSubscription() : null; } catch { return null; }
}

const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
const sameKey = (buf, key) => { try { const a = new Uint8Array(buf), b = b64(key); return a.length === b.length && a.every((v, i) => v === b[i]); } catch { return false; } };

async function post(op, body) {
  const r = await fetch(`/api/push?op=${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e = new Error(j?.error || `Push request failed (${r.status})`); e.status = r.status; throw e; }
  return j;
}

/** Ask permission, subscribe this device and store its alerts server-side. */
export async function enablePush(payload) {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? 'On iPhone/iPad, add Alpha Nova to your Home Screen first (Share → Add to Home Screen), then enable push from the installed app.' : 'This browser does not support push notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser’s site settings, then try again.');
  const cfg = await fetch('/api/push?op=vapid').then(r => r.json()).catch(() => null);
  if (!cfg?.configured || !cfg.key) throw new Error('Push is not configured on the server yet.');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, cfg.key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.key) });
  return post('subscribe', { subscription: sub.toJSON(), ...payload });
}

export async function syncPush(payload) {
  const sub = await currentSubscription();
  if (!sub) { const e = new Error('No push subscription on this device'); e.status = 404; throw e; }
  try { return await post('sync', { subscription: sub.toJSON(), ...payload }); }
  catch (e) { if (e.status === 404) return post('subscribe', { subscription: sub.toJSON(), ...payload }); throw e; }
}

export async function pushAction(op) {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Push is not enabled on this device.');
  return post(op, { subscription: sub.toJSON() });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await post('unsubscribe', { subscription: sub.toJSON() }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Local notification through the service worker (required on Android), falling back to the page API. */
export async function showLocal(title, options = {}) {
  try { const reg = await registration(); if (reg?.showNotification) return await reg.showNotification(title, { icon: '/icon-192.png', badge: '/icon-192.png', ...options }); } catch { /* fall through */ }
  try { const n = new Notification(title, options); n.onclick = () => { try { window.focus(); } catch { /* ignore */ } }; } catch { /* unsupported */ }
}
