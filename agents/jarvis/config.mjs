// Paths, environment and secret access for the Jarvis daemon.
// Every path is derived from JARVIS_HOME so the whole system can be pointed at a
// temp directory in tests without touching the real store.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const HOME = process.env.JARVIS_HOME || join(homedir(), '.alphanova');

export const paths = {
  home: HOME,
  db: join(HOME, 'jarvis.db'),
  signals: join(HOME, 'signals'),
  logs: join(HOME, 'logs'),
  briefs: join(HOME, 'briefs')
};

/** Create the store directories. Safe to call repeatedly. */
export function ensureDirs() {
  for (const dir of [paths.home, paths.signals, paths.logs, paths.briefs]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}

export const TZ = 'Asia/Kolkata';

/** Date parts in IST — the timezone every schedule and brief is expressed in. */
export function istParts(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
    }).formatToParts(date).map(x => [x.type, x.value])
  );
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), dow: weekdays[p.weekday],
    date: `${p.year}-${p.month}-${p.day}`
  };
}

/**
 * Read a secret from the macOS Keychain.
 *
 * Credentials never live in .env.local: that file sits in ~/Downloads, gets copied
 * around, and is one `vercel env pull` away from surprises. Store secrets with:
 *   security add-generic-password -a "$USER" -s jarvis.kite.token -w
 *
 * Returns null when absent so callers can degrade to a stated reason rather than
 * crash the daemon — an agent reporting "degraded: no Kite token" is more useful
 * than a dead process.
 */
export function secret(service, { required = false } = {}) {
  const override = process.env[`JARVIS_SECRET_${service.replace(/[.-]/g, '_').toUpperCase()}`];
  if (override) return override;
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || null;
  } catch {
    if (required) throw new Error(`Missing Keychain secret "${service}". Add it with: security add-generic-password -a "$USER" -s ${service} -w`);
    return null;
  }
}

/** Daily model-token ceiling; the governor degrades cadence as this fills (§10.3). */
export const DAILY_TOKEN_BUDGET = Number(process.env.JARVIS_TOKEN_BUDGET) || 500_000;

/** Hard cap on `urgent` escalations per day. The value of an interrupt is its rarity. */
export const URGENT_DAILY_CAP = Number(process.env.JARVIS_URGENT_CAP) || 3;
