import { createHash } from 'node:crypto';
import { head, put, BlobNotFoundError } from '@vercel/blob';
import { createSignupHandler } from '../lib/signup.js';

async function save(record) {
  const id = createHash('sha256').update(record.email).digest('hex');
  const pathname = `signups/${id}.json`;
  try { await head(pathname); return; }
  catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  try {
    await put(pathname, JSON.stringify(record), {
      access: 'private', addRandomSuffix: false, allowOverwrite: false,
      contentType: 'application/json', cacheControlMaxAge: 60,
    });
  } catch (error) {
    // A concurrent signup for this email may have won the create-only write.
    // Confirm persistence before acknowledging success; never overwrite a profile.
    try { await head(pathname); } catch { throw error; }
  }
}

export default createSignupHandler({
  configured: () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
  save,
});
