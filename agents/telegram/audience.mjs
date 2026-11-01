import { createHash } from 'node:crypto';
import { istParts } from '../jarvis/config.mjs';

export const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '909802034';
export const ALLOWED_UPDATES = ['message', 'channel_post', 'my_chat_member', 'chat_member'];
const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dateTime = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' IST' : 'Unknown';
const member = value => ['member', 'administrator', 'creator'].includes(value?.status) || (value?.status === 'restricted' && value.is_member === true);
const signed = n => `${n >= 0 ? '+' : ''}${n}`;
const name = person => escape([person.firstName, person.lastName].filter(Boolean).join(' ').slice(0, 70) || String(person.title || person.id).slice(0, 70));

export function isAdminMessage(message, adminId = ADMIN_CHAT_ID) {
  return message?.chat?.type === 'private' && String(message.chat.id) === adminId &&
    String(message.from?.id) === adminId && !message.from?.is_bot && !message.sender_chat;
}

export function ensureAudience(state, now = new Date()) {
  state.audience ||= { since: now.toISOString(), channels: {} };
  for (const chat of Object.values(state.chats).filter(c => c.type === 'channel')) ensureChannel(state, chat, now);
  return state.audience;
}

function ensureChannel(state, chat, now) {
  state.audience ||= { since: now.toISOString(), channels: {} };
  const id = String(chat.id);
  const channel = state.audience.channels[id] ||= { id, since: now.toISOString(), members: {}, daily: {}, sources: {}, lastUpdateId: null };
  channel.title = chat.title || channel.title || id;
  channel.username = chat.username || channel.username || null;
  return channel;
}

export function recordMembership(state, update, now = new Date()) {
  const self = update.my_chat_member;
  const event = update.chat_member;
  if (self?.chat?.type === 'channel') {
    const channel = ensureChannel(state, self.chat, now);
    channel.botAdmin = self.new_chat_member?.status === 'administrator' || self.new_chat_member?.status === 'creator';
    return true;
  }
  if (!event || event.chat?.type !== 'channel' || !Number.isInteger(update.update_id) || !Number.isFinite(event.date)) return false;
  const user = event.new_chat_member?.user;
  if (!user?.id || user.is_bot) return false;
  const channel = ensureChannel(state, event.chat, now);
  if (channel.lastUpdateId !== null && update.update_id <= channel.lastUpdateId) return false;
  channel.lastUpdateId = update.update_id;
  const at = new Date(event.date * 1000).toISOString(), id = String(user.id);
  const current = channel.members[id] ||= { id, firstObservedAt: at, firstJoinedAt: null, lastJoinedAt: null, leftAt: null };
  const before = member(event.old_chat_member), active = member(event.new_chat_member);
  Object.assign(current, { firstName: user.first_name || '', lastName: user.last_name || '', username: user.username || null,
    active, status: event.new_chat_member.status, lastMembershipAt: at });
  if (before === active) return true; // Promotion/restriction is not a join or exit.
  const date = istParts(new Date(at)).date;
  const daily = channel.daily[date] ||= { joins: 0, exits: 0 };
  if (active) {
    daily.joins++;
    current.firstJoinedAt ||= at;
    current.lastJoinedAt = at;
    current.leftAt = null;
    const link = event.invite_link;
    const sourceKey = link?.invite_link ? createHash('sha256').update(link.invite_link).digest('hex').slice(0, 12) :
      event.via_join_request ? 'direct-join-request' : event.via_chat_folder_invite_link ? 'chat-folder' : 'unknown';
    const label = link ? (link.name || `Invite ${sourceKey.slice(0, 6)}`) :
      event.via_join_request ? 'Direct join request' : event.via_chat_folder_invite_link ? 'Chat folder' : 'Not provided by Telegram';
    current.source = { key: sourceKey, label, inviteLink: link?.invite_link || null };
    const source = channel.sources[sourceKey] ||= { label, joins: 0 };
    source.joins++;
  } else { daily.exits++; current.leftAt = at; }
  const cutoff = istParts(new Date(now - 90 * 86400_000)).date;
  for (const day of Object.keys(channel.daily)) if (day < cutoff) delete channel.daily[day];
  return true;
}

export function growth(channel, now = new Date()) {
  const today = istParts(now).date, cutoff = istParts(new Date(now - 6 * 86400_000)).date;
  const day = channel.daily[today] || { joins: 0, exits: 0 };
  const week = Object.entries(channel.daily).filter(([date]) => date >= cutoff && date <= today)
    .reduce((sum, [, counts]) => ({ joins: sum.joins + counts.joins, exits: sum.exits + counts.exits }), { joins: 0, exits: 0 });
  return { day, week };
}

export async function refreshCounts(state, telegram, now = new Date()) {
  const audience = ensureAudience(state, now);
  const results = {};
  for (const channel of Object.values(audience.channels)) {
    try {
      const count = await telegram.call('getChatMemberCount', { chat_id: channel.id });
      if (!Number.isInteger(count) || count < 0) throw new Error('Invalid member count');
      channel.lastCount = { count, at: now.toISOString() };
      results[channel.id] = count;
    } catch { results[channel.id] = null; }
  }
  return results;
}

function rosterLines(people, page, channel = false) {
  const totalPages = Math.max(1, Math.ceil(people.length / 10));
  if (page > totalPages) return [`Page unavailable. Choose 1–${totalPages}.`];
  return people.slice((page - 1) * 10, page * 10).map((p, i) => {
    const handle = p.username ? ` · @${escape(p.username)}` : '';
    const joined = channel ? p.lastJoinedAt : p.joinedAt;
    const timestamp = joined ? `Joined ${dateTime(joined)}` : `First observed ${dateTime(p.firstObservedAt)}`;
    const extra = channel ? `${timestamp}${p.leftAt ? ` · Left ${dateTime(p.leftAt)}` : ''}${p.source ? `\n↳ Source: ${escape(p.source.label.slice(0, 50))}` : ''}` : `First seen ${dateTime(p.joinedAt)}`;
    return `${(page - 1) * 10 + i + 1}. ${p.active ? '🟢' : '⚪'} <b>${name(p)}</b>${handle}\nID <code>${escape(p.id)}</code> · ${p.active ? (channel ? 'Member' : 'Subscribed') : (channel ? 'Left / removed' : 'Paused')}\n${extra}`;
  });
}

export function audienceMessages(state, { counts = {}, target = null, page = 1, now = new Date() } = {}) {
  const audience = ensureAudience(state, now), channels = Object.values(audience.channels);
  const privateChats = Object.values(state.chats).filter(c => c.type === 'private');
  const people = privateChats.map(c => ({ ...c, ...(c.person || {}) })).sort((a, b) => String(b.joinedAt).localeCompare(String(a.joinedAt)));
  if (target === 'bot') {
    return [`<b>👥 ALPHA NOVA · BOT SUBSCRIBERS</b>\n\n🟢 Active: <b>${people.filter(p => p.active).length}</b> · Known: <b>${people.length}</b>\n\n${rosterLines(people, page).join('\n\n') || 'No bot subscribers recorded.'}\n\nPage ${page}/${Math.max(1, Math.ceil(people.length / 10))}\n<code>/users bot 2</code> — next page\n<i>Private bot subscriptions; separate from channel membership.</i>`];
  }
  if (target) {
    const channel = audience.channels[target];
    if (!channel) return ['Channel not recorded. Send /users to see connected channels.'];
    const members = Object.values(channel.members).sort((a, b) => b.lastMembershipAt.localeCompare(a.lastMembershipAt));
    const { day, week } = growth(channel, now);
    const sources = Object.values(channel.sources).sort((a, b) => b.joins - a.joins).slice(0, 3).map(s => `• ${escape(s.label.slice(0, 50))}: ${s.joins}`).join('\n');
    return [`<b>📊 CHANNEL AUDIENCE</b>\n<b>${escape(channel.title.slice(0, 80))}</b>\nID <code>${escape(channel.id)}</code>\n\n👥 Telegram total: <b>${Number.isInteger(counts[channel.id]) ? counts[channel.id] : 'Unavailable'}</b>\n🗂 Recorded people currently present: <b>${members.filter(m => m.active).length}</b>\n\n<b>Today · IST</b>\n➕ ${day.joins} joined · ➖ ${day.exits} left · Net ${signed(day.joins - day.exits)}\n<b>Last 7 days · observed events</b>\n➕ ${week.joins} joined · ➖ ${week.exits} left · Net ${signed(week.joins - week.exits)}\n\n<b>Recorded members · page ${page}/${Math.max(1, Math.ceil(members.length / 10))}</b>\n${rosterLines(members, page, true).join('\n\n') || 'No individual membership updates received yet.'}\n\n${sources ? `<b>Invite sources · observed joins</b>\n${sources}\n\n` : ''}<code>/users ${escape(channel.id)} 2</code> — next page\n<i>Tracking since ${dateTime(channel.since)}. Historical subscriber lists and individual post readers are unavailable.</i>`];
  }
  const lines = channels.map(c => {
    const { day, week } = growth(c, now);
    return `<b>${escape(c.title.slice(0, 80))}</b>\n👥 ${Number.isInteger(counts[c.id]) ? counts[c.id] : 'Unavailable'} subscribers · Today +${day.joins} / −${day.exits}\n7-day observed net: ${signed(week.joins - week.exits)}\n<code>/users ${escape(c.id)}</code>`;
  });
  const header = `<b>👑 ALPHA NOVA · ADMIN AUDIENCE</b>\n\n🔐 Private to your admin account\n🕒 ${dateTime(now.toISOString())}\n\n<b>Bot subscribers</b>\n🟢 ${privateChats.filter(c => c.active).length} active · ${privateChats.length} known\n<code>/users bot</code> — names, usernames &amp; IDs\n\n<b>Channels: ${channels.length}</b>\n`;
  if (!lines.length) return [header + '\nNo channel connected yet. Add this bot as a channel admin to begin recording joins and exits.\n\n<i>Bot subscriptions and channel membership are counted separately. Channel tracking records future membership updates.</i>'];
  const messages = [];
  let text = header;
  for (const line of lines) {
    if (text.length + line.length > 3400) { messages.push(text); text = '<b>📊 CHANNELS · CONTINUED</b>\n'; }
    text += `\n${line}\n`;
  }
  messages.push(text + '\n<i>Growth is based on recorded join/exit events. Existing subscriber identities cannot be imported.</i>');
  return messages;
}

export async function sendAudience(state, telegram, { message = null, trustedLocal = false, now = new Date() } = {}) {
  if (!trustedLocal && !isAdminMessage(message)) return { authorized: false, sent: 0 };
  const args = String(message?.text || '/users').trim().split(/\s+/).slice(1);
  if (args.length > 2 || (args[0] && args[0] !== 'bot' && !/^-\d+$/.test(args[0])) || (args[1] && !/^[1-9]\d{0,5}$/.test(args[1]))) {
    await telegram.send(ADMIN_CHAT_ID, 'Use /users, /users bot [page], or /users &lt;channel_id&gt; [page].');
    return { authorized: true, sent: 1 };
  }
  const counts = args[0] === 'bot' ? {} : await refreshCounts(state, telegram, now);
  if (args[0] === 'bot') {
    for (const chat of Object.values(state.chats).filter(c => c.type === 'private' && !c.person)) {
      try {
        const profile = await telegram.call('getChat', { chat_id: chat.id });
        if (profile.type === 'private' && String(profile.id) === chat.id) chat.person = { id: chat.id, firstName: profile.first_name || '', lastName: profile.last_name || '', username: profile.username || null };
      } catch { /* Existing display name remains usable if Telegram cannot refresh it. */ }
    }
  }
  const messages = audienceMessages(state, { counts, target: args[0], page: Number(args[1] || 1), now });
  const chunks = splitAudienceMessages(messages);
  for (const text of chunks) await telegram.send(ADMIN_CHAT_ID, text);
  return { authorized: true, sent: chunks.length };
}

export function splitAudienceMessages(messages) {
  const chunks = [];
  for (const message of messages) {
    let text = '';
    for (const paragraph of message.split('\n\n')) {
      if (text.length + paragraph.length + 2 > 3800 && text) {
        chunks.push(text); text = '<b>👥 AUDIENCE · CONTINUED</b>';
      }
      text += `${text ? '\n\n' : ''}${paragraph}`;
    }
    if (text) chunks.push(text);
  }
  return chunks;
}
