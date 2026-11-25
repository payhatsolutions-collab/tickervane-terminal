// Keep verified Google accounts distinct from unverified email registrations.
// Matching email addresses do not establish that two records share an identity.
export async function loadRegistrations({ list, get, now = Date.now }) {
  const paths = [];
  for (const [prefix, pattern] of [
    ['signups/', /^signups\/[a-f0-9]{64}\.json$/],
    ['auth/accounts/', /^auth\/accounts\/google-[a-f0-9]{64}\.json$/],
  ]) {
    let cursor;
    do {
      const page = await list({ prefix, limit: 1000, cursor });
      paths.push(...page.blobs.filter(blob => pattern.test(blob.pathname)).map(blob => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  const users = [];
  let unavailable = 0;
  for (let i = 0; i < paths.length; i += 8) {
    await Promise.all(paths.slice(i, i + 8).map(async path => {
      try {
        const result = await get(path, { access: 'private', useCache: false });
        if (!result || result.statusCode !== 200) throw new Error('Unavailable record');
        const value = JSON.parse(await new Response(result.stream).text());
        if (typeof value.name !== 'string' || typeof value.email !== 'string') throw new Error('Invalid record');
        const google = path.startsWith('auth/accounts/');
        users.push({
          id: path.split('/').at(-1).slice(0, -5),
          name: value.name.slice(0, 80), email: value.email.slice(0, 254),
          createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
          emailVerified: google && value.emailVerified === true,
          noticeVersion: typeof value.noticeVersion === 'string' ? value.noticeVersion.slice(0, 40) : null,
          source: google ? 'google' : 'free-signup',
        });
      } catch { unavailable++; }
    }));
  }
  users.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return { users, unavailable, updatedAt: new Date(now()).toISOString() };
}
