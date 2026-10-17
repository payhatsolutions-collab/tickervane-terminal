export const SIGNUP_NOTICE_VERSION = '2026-10-16';

export function validateSignup(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Please enter your name and email address.' };
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!name || name.length > 80 || /[\x00-\x1f\x7f<>]/.test(name)) return { error: 'Enter your name using 1–80 characters.', field: 'name' };
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || /[\x00-\x1f\x7f]/.test(email)) {
    return { error: 'Enter a valid email address.', field: 'email' };
  }
  if (body.noticeVersion !== SIGNUP_NOTICE_VERSION) return { error: 'Please refresh the page and try again.' };
  return { name, email };
}

// Best-effort per-instance abuse control; never persist visitor IP addresses.
export function createSignupLimiter() {
  const requests = new Map();
  return (ip, now = Date.now()) => {
    for (const [key, value] of requests) if (value.reset <= now) requests.delete(key);
    const entry = requests.get(ip);
    if (entry) { entry.count++; return entry.count > 5; }
    if (requests.size >= 5000) return true;
    requests.set(ip, { count: 1, reset: now + 10 * 60_000 });
    return false;
  };
}

export function allowedSignupOrigin(origin, env = process.env) {
  const allowed = new Set(['https://alphanova48.in', 'https://tickervane.vercel.app']);
  if (env.VERCEL_URL) allowed.add(`https://${env.VERCEL_URL}`);
  if (env.VERCEL_BRANCH_URL) allowed.add(`https://${env.VERCEL_BRANCH_URL}`);
  if (env.NODE_ENV !== 'production' && !env.VERCEL) {
    allowed.add('http://127.0.0.1:5177');
    allowed.add('http://localhost:5177');
  }
  return allowed.has(origin);
}

export function createSignupHandler({ configured, save, limited = createSignupLimiter(), allowedOrigin = allowedSignupOrigin }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && req.query?.op === 'status') return res.status(200).json({ configured: configured() });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
    if (!allowedOrigin(req.headers?.origin)) return res.status(403).json({ error: 'Please sign up from Alpha Nova.' });
    if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return res.status(415).json({ error: 'Send a JSON form.' });
    if (!configured()) return res.status(503).json({ error: 'Signup is temporarily unavailable. You can keep exploring.' });
    const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (limited(ip)) { res.setHeader('Retry-After', '600'); return res.status(429).json({ error: 'Too many attempts. Please try again in ten minutes.' }); }
    try {
      if (Number(req.headers?.['content-length']) > 4096) return res.status(413).json({ error: 'Form is too large.' });
      let raw = req.body;
      if (raw === undefined) {
        raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 4096) return res.status(413).json({ error: 'Form is too large.' });
        }
      }
      if (Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw)) > 4096) return res.status(413).json({ error: 'Form is too large.' });
      let body;
      try { body = typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch { return res.status(400).json({ error: 'Please check the form and try again.' }); }
      if (body?.website) return res.status(200).json({ ok: true });
      const value = validateSignup(body);
      if (value.error) return res.status(400).json(value);
      await save({ ...value, createdAt: new Date().toISOString(), noticeVersion: SIGNUP_NOTICE_VERSION, emailVerified: false, source: 'free-signup' });
      // Identical responses for new and existing emails. Never return stored profiles.
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(503).json({ error: 'We couldn’t save your signup. Please try again. You can keep exploring.' });
    }
  };
}
