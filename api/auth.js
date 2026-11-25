import { OAuth2Client } from 'google-auth-library';
import { head, put, del, BlobNotFoundError } from '@vercel/blob';
import { createAuthHandler, googleVerifier, sessionKey } from '../lib/googleAuth.js';
import { blobOptions as options, readJson, secureCookies, sessions, storageConfigured } from '../lib/authStore.js';

async function saveAccount(record) {
  // Google's subject, not an email or an unverified registration, identifies an account.
  const pathname = `auth/accounts/google-${sessionKey(record.googleSubject)}.json`;
  try { await head(pathname); return; }
  catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  try { await put(pathname, JSON.stringify(record), { ...options, allowOverwrite: false }); }
  catch (error) { try { await head(pathname); } catch { throw error; } }
}
const watchlistPath = key => `auth/watchlists/google-${key}.json`;
const watchlists = {
  read: key => readJson(watchlistPath(key)),
  write: (key, record) => put(watchlistPath(key), JSON.stringify(record), { ...options, allowOverwrite: true }),
  remove: key => del(watchlistPath(key)),
};
export default createAuthHandler({
  config: () => ({ clientId: process.env.GOOGLE_CLIENT_ID, secret: process.env.AUTH_SESSION_SECRET,
    storage: storageConfigured(), secure: secureCookies(),
  }),
  verify: googleVerifier(new OAuth2Client()), sessions, saveAccount, watchlists,
});
