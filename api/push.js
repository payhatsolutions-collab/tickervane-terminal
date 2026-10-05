// Web Push for price alerts, the daily Delivery Radar digest and saved-screen
// matches — built for Vercel Hobby: one private Blob file per device, VAPID keys in
// env, and daily-slot cron jobs (Hobby allows each job once per day, so vercel.json
// schedules one per hour). No database, no paid add-ons.
import webpush from 'web-push';
import { put, get, list, del } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';
import { chart, validSymbol } from './market.js';
import { recentSessions, nifty500, buildRadar, buildScreen, deliveryStats, istDate, BASELINE } from '../lib/nse.js';
import { cleanScreen, runScreen } from '../src/screens.js';

const PREFIX = 'push/subs/';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@alphanova48.in';
// Only real browser push services — the server never POSTs to arbitrary URLs.
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com|android\.googleapis\.com)$/;
const hasBlob = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
export const configured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && hasBlob());
const short = s => String(s || '').replace(/\.NS$/, '');
const fmt = v => Number.isFinite(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';

const rate = new Map();
function rateLimited(ip) {
  const now = Date.now(), e = rate.get(ip);
  if (!e || now > e.reset) { rate.set(ip, { count: 1, reset: now + 60000 }); if (rate.size > 2000) rate.delete(rate.keys().next().value); return false; }
  return ++e.count > 30;
}

export function validSubscription(s) {
  try {
    const u = new URL(s?.endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname) && s.endpoint.length < 1200 &&
      /^[A-Za-z0-9_-]{40,200}={0,2}$/.test(s.keys?.p256dh || '') && /^[A-Za-z0-9_-]{8,64}={0,2}$/.test(s.keys?.auth || '');
  } catch { return false; }
}
const idFor = endpoint => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
const sameSecret = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y); };

export function cleanAlerts(list) {
  return (Array.isArray(list) ? list : []).filter(a => a && typeof a.id === 'string' && validSymbol(String(a.symbol || '')) && (a.condition === 'above' || a.condition === 'below') && Number(a.price) > 0)
    .slice(0, 50).map(a => ({ id: a.id.slice(0, 64), symbol: a.symbol, condition: a.condition, price: Number(a.price), created: Number(a.created) || Date.now(), triggered: !!a.triggered, triggeredAt: a.triggeredAt || null }));
}
function cleanBody(b) {
  return {
    alerts: cleanAlerts(b.alerts),
    watch: (Array.isArray(b.watch) ? b.watch : []).filter(s => typeof s === 'string' && validSymbol(s)).slice(0, 40),
    prefs: { alerts: b.prefs?.alerts !== false, delivery: !!b.prefs?.delivery, screens: b.prefs?.screens !== false },
    screens: (Array.isArray(b.screens) ? b.screens : []).map(cleanScreen).filter(Boolean).slice(0, 5),
  };
}
/** Keep server-side triggers unless the device re-armed the alert (new `created`). */
export function mergeAlerts(incoming, stored) {
  const byId = new Map((stored || []).map(a => [a.id, a]));
  return incoming.map(a => { const s = byId.get(a.id); return s && s.triggered && !a.triggered && s.created === a.created ? { ...a, triggered: true, triggeredAt: s.triggeredAt, via: 'push' } : a; });
}
/** Price alerts that fire on these quotes; only quotes stamped after alert creation count. */
export function dueAlerts(alerts, quotes) {
  return (alerts || []).filter(a => {
    const q = quotes[a.symbol];
    if (a.triggered || !Number.isFinite(q?.price)) return false;
    if (q.marketTime != null && q.marketTime < a.created / 1000) return false;
    return (a.condition === 'above' && q.price >= a.price) || (a.condition === 'below' && q.price <= a.price);
  });
}

async function load(id) {
  const r = await get(`${PREFIX}${id}.json`, { access: 'private', useCache: false }).catch(() => null);
  if (!r || r.statusCode !== 200) return null;
  try { return JSON.parse(await new Response(r.stream).text()); } catch { return null; }
}
const save = sub => put(`${PREFIX}${sub.id}.json`, JSON.stringify({ ...sub, updated: new Date().toISOString() }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
const remove = id => del(`${PREFIX}${id}.json`).catch(() => null);

async function send(sub, payload) {
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload), {
      TTL: 6 * 3600, urgency: 'high', topic: String(payload.tag || 'alphanova').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
      vapidDetails: { subject: SUBJECT, publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY },
    });
    sub.log = [{ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), ...payload.log, title: payload.title, body: payload.body }, ...(sub.log || [])].slice(0, 40);
    return 'sent';
  } catch (e) {
    return e?.statusCode === 404 || e?.statusCode === 410 ? 'gone' : 'failed';
  }
}

async function quotesFor(symbols) {
  const quotes = {};
  const list = [...new Set(symbols)];
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async s => { try { const d = await chart(s, '5d'); quotes[s] = { price: d.price, marketTime: d.marketTime }; } catch { /* skip */ } }));
  }
  return quotes;
}

async function priceCheck(sub, quotes) {
  if (sub.prefs?.alerts === false) return { fired: 0, changed: false, gone: false };
  let fired = 0, changed = false;
  for (const a of dueAlerts(sub.alerts, quotes)) {
    const q = quotes[a.symbol];
    const result = await send(sub, {
      title: `${short(a.symbol)} ${a.condition} ${fmt(a.price)}`, body: `Last ${fmt(q.price)} · ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} IST · Alpha Nova`,
      tag: `${a.symbol}|${a.condition}|${a.price}`, url: `/?page=Alerts&symbol=${encodeURIComponent(a.symbol)}`,
      log: { kind: 'alert', alertId: a.id, symbol: a.symbol, condition: a.condition, target: a.price, observed: q.price },
    });
    if (result === 'gone') return { fired, changed: true, gone: true };
    if (result === 'sent') { a.triggered = true; a.triggeredAt = new Date().toISOString(); fired++; changed = true; }
  }
  return { fired, changed, gone: false };
}

/** After NSE publishes (~18:00 IST), one delivery digest and one saved-screen digest per device per session. */
async function digests(subs) {
  const today = istDate().toISOString().slice(0, 10);
  const wantsDelivery = subs.filter(s => s.prefs?.delivery && s.lastDelivery !== today);
  const wantsScreens = subs.filter(s => s.prefs?.screens !== false && s.screens?.length && s.lastScreens !== today);
  if (!wantsDelivery.length && !wantsScreens.length) return;
  const [sessions, universe] = await Promise.all([recentSessions(BASELINE + 1), nifty500()]);
  if (sessions[0].date !== today) return; // today's file is not out yet
  const touched = new Set();
  if (wantsDelivery.length) {
    const radar = buildRadar(sessions, universe, { minTurnoverCr: 5, limit: 400 });
    const top = radar.rows.filter(r => r.n500 && r.signal === 'Accumulation').slice(0, 3);
    for (const sub of wantsDelivery) {
      const mine = sub.watch.filter(s => s.endsWith('.NS')).map(s => deliveryStats(sessions, short(s))).filter(s => s?.delivRatio >= 1.5).sort((a, b) => b.delivRatio - a.delivRatio).slice(0, 3);
      const parts = [];
      if (mine.length) parts.push('Watchlist: ' + mine.map(s => `${s.symbol} ${s.delivRatio.toFixed(1)}× (${s.change >= 0 ? '+' : ''}${s.change.toFixed(1)}%)`).join(', '));
      if (top.length) parts.push('Accumulation: ' + top.map(r => `${r.symbol} ${r.delivRatio.toFixed(1)}×`).join(', '));
      if (!parts.length) parts.push(`${radar.counts.Accumulation || 0} accumulation · ${radar.counts.Distribution || 0} distribution signals today`);
      const res = await send(sub, { title: `Delivery radar · ${new Date(today + 'T12:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`, body: parts.join(' · '), tag: 'delivery-digest', url: '/?page=Delivery', log: { kind: 'delivery' } });
      if (res === 'gone') sub.gone = true;
      sub.lastDelivery = today; touched.add(sub);
    }
  }
  if (wantsScreens.length) {
    const screen = await buildScreen();
    for (const sub of wantsScreens) {
      if (sub.gone) continue;
      sub.screenState ||= {};
      for (const sc of sub.screens) {
        const hits = runScreen(screen.rows, sc).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map(r => r.symbol);
        const before = new Set(sub.screenState[sc.id] || []);
        const fresh = hits.filter(s => !before.has(s));
        sub.screenState[sc.id] = hits.slice(0, 150);
        if (!fresh.length) continue;
        const res = await send(sub, { title: `${sc.name}: ${fresh.length} new match${fresh.length > 1 ? 'es' : ''}`, body: `${fresh.slice(0, 6).join(', ')}${fresh.length > 6 ? ` +${fresh.length - 6} more` : ''} · ${hits.length} total`, tag: `screen-${sc.id}`, url: '/?page=Screener', log: { kind: 'screen' } });
        if (res === 'gone') { sub.gone = true; break; }
      }
      sub.lastScreens = today; touched.add(sub);
    }
  }
  return touched;
}

async function allSubs() {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    out.push(...page.blobs.map(b => b.pathname.slice(PREFIX.length).replace(/\.json$/, '')));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const subs = [];
  for (let i = 0; i < out.length; i += 8) subs.push(...(await Promise.all(out.slice(i, i + 8).map(load))).filter(Boolean));
  return subs;
}

async function cron() {
  const subs = await allSubs();
  if (!subs.length) return { subs: 0 };
  const quotes = await quotesFor(subs.flatMap(s => s.prefs?.alerts === false ? [] : s.alerts.filter(a => !a.triggered).map(a => a.symbol)));
  const dirty = new Set();
  let fired = 0;
  for (const sub of subs) {
    const r = await priceCheck(sub, quotes);
    fired += r.fired;
    if (r.gone) sub.gone = true;
    if (r.changed) dirty.add(sub);
  }
  let digestErr = null;
  try { for (const s of (await digests(subs.filter(s => !s.gone))) || []) dirty.add(s); } catch (e) { digestErr = e.message; }
  let removed = 0;
  for (const sub of subs) if (sub.gone) { await remove(sub.id); removed++; dirty.delete(sub); }
  await Promise.all([...dirty].map(save));
  return { subs: subs.length, symbols: Object.keys(quotes).length, fired, removed, saved: dirty.size, digestErr };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 64e3) throw new Error('Body too large'); }
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const op = String(req.query?.op || '');
  try {
    if (op === 'cron') {
      const secret = process.env.CRON_SECRET;
      if (!secret || !sameSecret(req.headers?.authorization, `Bearer ${secret}`)) return res.status(401).json({ error: 'Unauthorized' });
      if (!configured()) return res.status(200).json({ skipped: 'push not configured' });
      return res.status(200).json(await cron());
    }
    if (op === 'vapid') return res.status(200).json({ key: process.env.VAPID_PUBLIC_KEY || null, configured: configured() });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
    const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(ip)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many requests. Please wait a minute.' }); }
    if (!configured()) return res.status(503).json({ error: 'Push notifications are not configured on this deployment.' });
    const body = await readBody(req);
    const subscription = body.subscription;
    if (!validSubscription(subscription)) return res.status(400).json({ error: 'Invalid push subscription' });
    const id = idFor(subscription.endpoint);
    const stored = await load(id);
    const owned = stored && sameSecret(stored.subscription?.keys?.auth, subscription.keys.auth);
    if (op === 'subscribe') {
      const clean = cleanBody(body);
      const sub = { ...(owned ? stored : {}), id, subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }, ...clean, alerts: mergeAlerts(clean.alerts, owned ? stored.alerts : []), created: owned ? stored.created : new Date().toISOString() };
      if (!owned) { const r = await send(sub, { title: 'Alpha Nova push is on', body: 'Price alerts, the delivery digest and saved screens will reach this device even when the app is closed.', tag: 'welcome', url: '/?page=Alerts', log: { kind: 'system' } }); if (r === 'gone') return res.status(410).json({ error: 'The browser rejected this subscription. Try enabling again.' }); }
      await save(sub);
      return res.status(200).json({ ok: true, alerts: sub.alerts, log: sub.log || [] });
    }
    if (!owned) return res.status(404).json({ error: 'Subscription not found. Enable push again.' });
    if (op === 'sync') {
      const clean = cleanBody(body);
      const alerts = mergeAlerts(clean.alerts, stored.alerts);
      const sub = { ...stored, ...clean, alerts };
      const before = JSON.stringify([stored.alerts, stored.watch, stored.prefs, stored.screens]);
      if (JSON.stringify([sub.alerts, sub.watch, sub.prefs, sub.screens]) !== before) await save(sub);
      return res.status(200).json({ ok: true, alerts, log: stored.log || [] });
    }
    if (op === 'test') {
      const r = await send(stored, { title: 'Alpha Nova test push', body: 'Delivered by the server — this works with the app closed.', tag: 'test', url: '/?page=Alerts', log: { kind: 'test' } });
      if (r === 'gone') { await remove(id); return res.status(410).json({ error: 'This device’s subscription expired. Enable push again.' }); }
      await save(stored);
      return res.status(r === 'sent' ? 200 : 502).json(r === 'sent' ? { ok: true, log: stored.log } : { error: 'The push service did not accept the message. Try again.' });
    }
    if (op === 'check') {
      const quotes = await quotesFor(stored.alerts.filter(a => !a.triggered).map(a => a.symbol));
      const r = await priceCheck(stored, quotes);
      if (r.gone) { await remove(id); return res.status(410).json({ error: 'Subscription expired. Enable push again.' }); }
      if (r.changed) await save(stored);
      return res.status(200).json({ ok: true, fired: r.fired, checked: Object.keys(quotes).length, alerts: stored.alerts, log: stored.log || [] });
    }
    if (op === 'unsubscribe') { await remove(id); return res.status(200).json({ ok: true }); }
    return res.status(400).json({ error: 'Unknown operation' });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Push service error' });
  }
}
