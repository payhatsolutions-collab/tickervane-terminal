import { get, put, del, BlobNotFoundError } from '@vercel/blob';

// Private Blob storage shared by sign-in sessions and Pro access records.
export const blobOptions = { access: 'private', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 };
export const storageConfigured = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
export const secureCookies = () => !!process.env.VERCEL || process.env.NODE_ENV === 'production';

export async function readJson(pathname) {
  try {
    const result = await get(pathname, { access: 'private', useCache: false });
    return result?.statusCode === 200 ? await new Response(result.stream).json() : null;
  } catch (error) { if (error instanceof BlobNotFoundError) return null; throw error; }
}

const sessionPath = key => `auth/sessions/${key}.json`;
export const sessions = {
  read: key => readJson(sessionPath(key)),
  write: (key, record) => put(sessionPath(key), JSON.stringify(record), { ...blobOptions, allowOverwrite: false }),
  remove: key => del(sessionPath(key)),
};
