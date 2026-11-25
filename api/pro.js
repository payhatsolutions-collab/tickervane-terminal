import { head, put, del } from '@vercel/blob';
import { createProHandler } from '../lib/pro.js';
import { blobOptions, readJson, secureCookies, sessions, storageConfigured } from '../lib/authStore.js';

// Keyed like auth/accounts: sha256 of Google's subject, never an email.
const accountPath = key => `pro/accounts/google-${key}.json`;
const utrPath = utr => `pro/utr/${utr}.json`;
const trialPath = key => `pro/trials/google-${key}.json`;
const store = {
  readTrial: key => readJson(trialPath(key)),
  async startTrial(key, record) {
    try { await put(trialPath(key), JSON.stringify(record), { ...blobOptions, allowOverwrite: false }); return record; }
    catch (error) {
      const existing = await readJson(trialPath(key));
      if (existing) return existing;
      throw error;
    }
  },
  // The one permitted rewrite: a browser trial becoming the longer app trial.
  async upgradeTrial(key, record) {
    await put(trialPath(key), JSON.stringify(record), { ...blobOptions, allowOverwrite: true });
    return record;
  },
  readAccount: key => readJson(accountPath(key)),
  writeAccount: (key, record) => put(accountPath(key), JSON.stringify(record), { ...blobOptions, allowOverwrite: true }),
  // Create-only: each payment reference unlocks one account once.
  async reserveUtr(utr, value) {
    try { await put(utrPath(utr), JSON.stringify(value), { ...blobOptions, allowOverwrite: false }); return true; }
    catch (error) { try { await head(utrPath(utr)); return false; } catch { throw error; } }
  },
  releaseUtr: utr => del(utrPath(utr)),
};

// Server-only: sent to signed-in readers inside their payment link, never bundled into the page.
const UPI_ID = '9831810983@kotakbank';

export default createProHandler({
  config: () => ({ upiId: process.env.PRO_UPI_ID || UPI_ID, signIn: !!(process.env.GOOGLE_CLIENT_ID && process.env.AUTH_SESSION_SECRET?.length >= 32), storage: storageConfigured(), secure: secureCookies() }),
  sessions, store,
});
