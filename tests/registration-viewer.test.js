import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistrations } from '../local-admin/registrations.mjs';

test('viewer includes paginated Google accounts without merging unverified identities or exposing auth fields', async () => {
  const hash = 'a'.repeat(64);
  const legacy = `signups/${hash}.json`, google = `auth/accounts/google-${hash}.json`;
  const later = `auth/accounts/google-${'b'.repeat(64)}.json`;
  const calls = [];
  const result = await loadRegistrations({
    list: async ({ prefix, cursor }) => {
      calls.push([prefix, cursor]);
      if (prefix === 'signups/') return { blobs: [{ pathname: legacy }], hasMore: false };
      return cursor ? { blobs: [{ pathname: later }], hasMore: false } : {
        blobs: [{ pathname: google }, { pathname: `auth/sessions/${hash}.json` }], hasMore: true, cursor: 'next',
      };
    },
    get: async (path, options) => {
      assert.deepEqual(options, { access: 'private', useCache: false });
      assert.ok([legacy, google, later].includes(path));
      return { statusCode: 200, stream: JSON.stringify({ name: 'Reader', email: 'same@example.com',
        createdAt: path === legacy ? '2026-11-15T00:00:00Z' : '2026-11-16T00:00:00Z',
        emailVerified: true, googleSubject: 'private-subject', token: 'secret',
      }) };
    },
    now: () => Date.parse('2026-11-16T12:00:00Z'),
  });
  assert.equal(result.users.length, 3);
  assert.equal(new Set(result.users.map(user => user.id)).size, 3);
  assert.deepEqual(result.users.map(user => user.source), ['google', 'google', 'free-signup']);
  assert.deepEqual(result.users.map(user => user.emailVerified), [true, true, false]);
  assert.equal(result.unavailable, 0);
  assert.ok(calls.some(([prefix, cursor]) => prefix === 'auth/accounts/' && cursor === 'next'));
  assert.doesNotMatch(JSON.stringify(result), /private-subject|secret|googleSubject|token/);
});

test('viewer reports unreadable Google records and rejects incomplete listings', async () => {
  const list = async ({ prefix }) => ({ blobs: prefix === 'signups/' ? [] : [
    { pathname: `auth/accounts/google-${'a'.repeat(64)}.json` },
    { pathname: `auth/accounts/google-${'b'.repeat(64)}.json` },
  ] });
  let reads = 0;
  const result = await loadRegistrations({ list, get: async () => {
    if (reads++ === 0) throw new Error('Storage failure');
    return { statusCode: 200, stream: '{"name":"No email"}' };
  } });
  assert.equal(result.unavailable, 2);
  assert.equal(result.users.length, 0);
  await assert.rejects(loadRegistrations({ list: async () => { throw new Error('Cannot list'); }, get: async () => {} }), /Cannot list/);
});
