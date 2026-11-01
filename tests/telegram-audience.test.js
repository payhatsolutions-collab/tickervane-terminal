import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_UPDATES, isAdminMessage, ensureAudience, recordMembership, growth, refreshCounts, audienceMessages, sendAudience, splitAudienceMessages } from '../agents/telegram/audience.mjs';
import { applyUpdate } from '../agents/telegram/telegram.mjs';

const now = new Date('2026-10-31T05:00:00Z');
const state = () => ({ version: 1, offset: 0, chats: {}, delivered: {}, report: null });
const channel = { id: -100123456789, type: 'channel', title: 'Signals & <research>' };
const user = { id: 1234, first_name: 'A < B', last_name: '& Co', username: 'test_person' };
const admin = { chat: { id: 909802034, type: 'private' }, from: { id: 909802034, is_bot: false }, text: '/users' };
function update(updateId, oldStatus = 'left', status = 'member', extra = {}) {
  return { update_id: updateId, chat_member: { chat: channel, date: Math.floor(now / 1000), old_chat_member: { status: oldStatus, user }, new_chat_member: { status, user }, ...extra } };
}

test('admin reports require the exact private chat and authenticated sender identity', () => {
  assert.equal(isAdminMessage(admin), true);
  assert.equal(isAdminMessage({ ...admin, from: { id: 1 } }), false);
  assert.equal(isAdminMessage({ ...admin, chat: { id: -100123, type: 'supergroup' } }), false);
  assert.equal(isAdminMessage({ ...admin, chat: { id: 909802034, type: 'channel' } }), false);
  assert.equal(isAdminMessage({ ...admin, from: { id: 909802034, is_bot: true } }), false);
  assert.equal(isAdminMessage({ ...admin, sender_chat: channel }), false);
  assert.equal(isAdminMessage({ ...admin, from: undefined }), false);
});

test('unauthorized users cannot trigger API lookups or receive audience information', async () => {
  const calls = [], s = state();
  const telegram = { call: async (...args) => calls.push(args), send: async (...args) => calls.push(args) };
  const result = await sendAudience(s, telegram, { message: { ...admin, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: '/users bot' }, now });
  assert.deepEqual(result, { authorized: false, sent: 0 });
  assert.deepEqual(calls, []);
  assert.equal(s.audience, undefined);
});

test('membership polling is explicitly enabled and old state migrates without losing subscriptions', () => {
  assert.ok(ALLOWED_UPDATES.includes('chat_member'));
  const s = state(); s.chats['9'] = { id: '9', type: 'private', active: false };
  ensureAudience(s, now);
  assert.equal(s.chats['9'].active, false);
  assert.equal(s.audience.since, now.toISOString());
  assert.deepEqual(s.audience.channels, {});
});

test('join, leave and rejoin record identities, invite sources and distinct events only', () => {
  const s = state();
  const join = update(10, 'left', 'member', { invite_link: { name: 'Instagram & friends', invite_link: 'https://t.me/+private-invite' } });
  assert.equal(recordMembership(s, join, now), true);
  assert.equal(recordMembership(s, join, now), false);
  let c = s.audience.channels[String(channel.id)];
  assert.equal(c.daily['2026-10-31'].joins, 1);
  assert.equal(c.members['1234'].username, 'test_person');
  assert.equal(c.members['1234'].source.inviteLink, 'https://t.me/+private-invite');
  assert.equal(Object.values(c.sources)[0].joins, 1);
  recordMembership(s, update(11, 'member', 'left'), now);
  assert.equal(c.members['1234'].active, false);
  assert.ok(c.members['1234'].leftAt);
  recordMembership(s, update(12, 'left', 'member'), now);
  assert.equal(c.members['1234'].active, true);
  assert.equal(c.members['1234'].leftAt, null);
  assert.deepEqual(c.daily['2026-10-31'], { joins: 2, exits: 1 });
  // A channel subscriber must never become a private signal destination.
  assert.deepEqual(s.chats, {});
});

test('promotions and member restrictions do not inflate joins and exits', () => {
  const s = state();
  recordMembership(s, update(1, 'member', 'administrator'), now);
  const c = s.audience.channels[String(channel.id)];
  assert.equal(c.members['1234'].active, true);
  assert.equal(c.members['1234'].firstJoinedAt, null);
  assert.deepEqual(c.daily, {});
  const restriction = update(2, 'member', 'restricted');
  restriction.chat_member.new_chat_member.is_member = true;
  recordMembership(s, restriction, now);
  assert.deepEqual(c.daily, {});
  restriction.update_id = 3;
  restriction.chat_member.old_chat_member = { status: 'restricted', is_member: true, user };
  restriction.chat_member.new_chat_member.is_member = false;
  recordMembership(s, restriction, now);
  assert.deepEqual(c.daily['2026-10-31'], { joins: 0, exits: 1 });
});

test('bot membership events and bot users are excluded from subscriber growth', () => {
  const s = state();
  recordMembership(s, { my_chat_member: { chat: channel, new_chat_member: { status: 'administrator' } } }, now);
  const c = s.audience.channels[String(channel.id)];
  assert.equal(c.botAdmin, true);
  const bot = update(2); bot.chat_member.new_chat_member.user = { ...user, is_bot: true };
  assert.equal(recordMembership(s, bot, now), false);
  assert.deepEqual(c.members, {});
  assert.deepEqual(c.daily, {});
  const group = update(3); group.chat_member.chat = { ...channel, type: 'supergroup' };
  assert.equal(recordMembership(s, group, now), false);
});

test('seven-day growth uses IST event dates and reports exits even for previously unknown members', () => {
  const s = state();
  const exit = update(1, 'member', 'left');
  exit.chat_member.date = Date.parse('2026-10-30T20:00:00Z') / 1000; // Oct 31 IST
  recordMembership(s, exit, now);
  const c = s.audience.channels[String(channel.id)];
  assert.equal(c.members['1234'].firstJoinedAt, null);
  c.daily['2026-10-24'] = { joins: 100, exits: 100 };
  c.daily['2026-10-25'] = { joins: 5, exits: 2 };
  c.daily['2026-11-01'] = { joins: 99, exits: 99 };
  assert.deepEqual(growth(c, now), { day: { joins: 0, exits: 1 }, week: { joins: 5, exits: 3 } });
});

test('real Telegram totals stay distinct from recorded member counts and unavailable totals', async () => {
  const s = state(); recordMembership(s, update(1), now);
  const telegram = { call: async (method, args) => { assert.equal(method, 'getChatMemberCount'); assert.equal(args.chat_id, String(channel.id)); return 500; } };
  const counts = await refreshCounts(s, telegram, now);
  const text = audienceMessages(s, { target: String(channel.id), counts, now }).join('\n');
  assert.match(text, /Telegram total: <b>500<\/b>/);
  assert.match(text, /currently present: <b>1<\/b>/);
  telegram.call = async () => { throw new Error('Cannot fetch'); };
  const missing = await refreshCounts(s, telegram, now);
  assert.equal(missing[String(channel.id)], null);
  assert.match(audienceMessages(s, { target: String(channel.id), counts: missing, now })[0], /Telegram total: <b>Unavailable<\/b>/);
});

test('admin summaries distinguish private bot subscribers from channel subscribers and escape user content', () => {
  const s = state();
  s.chats['1'] = { id: '1', type: 'private', active: true, title: 'Bot <user>' };
  s.chats['2'] = { id: '2', type: 'private', active: false, title: 'Paused user' };
  recordMembership(s, update(1), now);
  const main = audienceMessages(s, { now })[0];
  assert.match(main, /1 active · 2 known/);
  assert.match(main, /Signals &amp; &lt;research&gt;/);
  const bot = audienceMessages(s, { target: 'bot', now })[0];
  assert.match(bot, /Bot &lt;user&gt;/);
  assert.doesNotMatch(bot, /test_person/);
  const members = audienceMessages(s, { target: String(channel.id), now })[0];
  assert.match(members, /A &lt; B &amp; Co/);
  assert.match(members, /@test_person/);
});

test('member pagination covers all recorded people and oversized HTML is safely split at complete blocks', () => {
  const s = state();
  for (let i = 0; i < 25; i++) {
    const event = update(i + 1, 'left', 'member', { invite_link: { name: '<'.repeat(32), invite_link: 'https://t.me/+test' } });
    event.chat_member.new_chat_member.user = { id: i + 1, first_name: '<'.repeat(70), username: 'example' };
    recordMembership(s, event, now);
  }
  const messages = audienceMessages(s, { target: String(channel.id), page: 2, now });
  assert.match(messages[0], /page 2\/3/);
  assert.match(messages[0], /11\. 🟢/); assert.match(messages[0], /20\. 🟢/);
  assert.doesNotMatch(messages[0], /21\. 🟢/);
  const chunks = splitAudienceMessages(messages);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => c.length <= 3800));
  for (const chunk of chunks) for (const tag of ['b', 'i', 'code']) assert.equal((chunk.match(new RegExp(`<${tag}>`, 'g')) || []).length, (chunk.match(new RegExp(`</${tag}>`, 'g')) || []).length);
});

test('admin command sends only to the configured owner and rejects malformed pagination', async () => {
  const s = state(), deliveries = [];
  const telegram = { call: async () => 0, send: async (id, text) => deliveries.push({ id, text }) };
  const result = await sendAudience(s, telegram, { message: admin, now });
  assert.equal(result.sent, 1);
  assert.equal(deliveries[0].id, '909802034');
  assert.match(deliveries[0].text, /No channel connected yet/);
  await sendAudience(s, telegram, { message: { ...admin, text: '/users bot -1' }, now });
  assert.match(deliveries[1].text, /Use \/users/);
});

test('private bot profile capture preserves first subscription date and does not alter channel tracking', () => {
  const s = state(), message = { chat: { id: 1234, type: 'private' }, from: user, text: '/start', date: Math.floor(now / 1000) };
  applyUpdate(s, { message });
  assert.equal(s.chats['1234'].person.username, 'test_person');
  const joined = s.chats['1234'].joinedAt;
  message.text = '/stop'; applyUpdate(s, { message });
  assert.equal(s.chats['1234'].joinedAt, joined);
  assert.equal(s.chats['1234'].active, false);
  assert.equal(s.audience, undefined);
});
