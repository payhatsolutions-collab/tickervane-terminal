export class TelegramError extends Error {
  constructor(code, retryAfter = null) {
    super(`Telegram request failed (${code})`);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export class Telegram {
  constructor(token, fetcher = fetch) { this.token = token; this.fetcher = fetcher; }
  async call(method, params = {}) {
    let response;
    try {
      response = await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(35_000)
      });
    } catch { throw new TelegramError('network'); } // Never log a token-bearing URL.
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new TelegramError(body?.error_code || response.status, body?.parameters?.retry_after);
    return body.result;
  }
  send(chatId, text) { return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }); }
}

export function applyUpdate(state, update, { groupAdmin = false } = {}) {
  const membership = update.my_chat_member;
  const message = update.message || update.channel_post;
  const chat = membership?.chat || message?.chat;
  if (!chat?.id) return null;
  // Messages from other bots must not opt them in or create reply loops.
  if (!membership && message?.from?.is_bot) return null;
  const id = String(chat.id), old = state.chats[id];
  const entry = old || { id, active: false, initialTestPending: true, joinedAt: new Date().toISOString() };
  entry.type = chat.type;
  entry.title = chat.title || chat.first_name || chat.username || id;
  if (chat.type === 'private' && message?.from && String(message.from.id) === id) {
    entry.person = { id, firstName: message.from.first_name || '', lastName: message.from.last_name || '', username: message.from.username || null };
    if (Number.isFinite(message.date)) entry.lastMessageAt = new Date(message.date * 1000).toISOString();
  }
  const command = String(message?.text || '').trim().split(/\s/)[0].split('@')[0].toLowerCase();
  const authorized = chat.type === 'private' || chat.type === 'channel' || groupAdmin;
  // Group commands that change subscriptions require admin verification by the
  // runner. Membership events are from Telegram itself, so already trusted.
  if (membership) {
    const m = membership.new_chat_member;
    const wasActive = entry.active;
    entry.active = chat.type === 'channel' ? m?.status === 'administrator' && m.can_post_messages !== false :
      ['member', 'administrator', 'creator'].includes(m?.status) || (m?.status === 'restricted' && m.is_member === true);
    if (!wasActive && entry.active) entry.welcomePending = true;
  } else if (command === '/stop' && authorized) {
    entry.active = false;
    entry.welcomePending = false;
  } else if ((command === '/start' && authorized) || (!old && chat.type === 'channel')) {
    entry.active = true;
    entry.welcomePending = true;
  }
  state.chats[id] = entry;
  return { chat: entry, command, message, authorized };
}

// Each chunk carries the exact signal ids it acknowledges, allowing failed
// recipients to retry without resending chunks already delivered to others.
export function signalChunks(report, signals = report.signals, sample = false) {
  const header = `<b>${sample ? '🧪 ALPHA NOVA · TEST SIGNALS' : '⚡ ALPHA NOVA · DAILY SIGNALS'}</b>\n\n📅 <b>Session: ${report.date}</b> · Daily candles\n🏛 Nifty 500 · 💧 ADV ≥ ₹100 Cr\n━━━━━━━━━━━━━━━━━━━━\n`;
  const footer = `\n━━━━━━━━━━━━━━━━━━━━\n📊 Scanned ${report.scanned}/${report.eligible} liquid stocks · ${report.failed} unavailable\n<i>Source: Yahoo Finance OHLCV + NSE turnover.\n${sample ? 'Test delivery · real latest-session readings.' : 'Completed daily candles · technical screening.'}</i>`;
  const out = [];
  let text = header, ids = [];
  for (const signal of signals) {
    const block = `\n${signal.text}\n`;
    if (text.length + block.length + footer.length > 3800 && ids.length) {
      out.push({ text: text + footer, ids }); text = header; ids = [];
    }
    text += block; ids.push(signal.id);
  }
  if (!signals.length) text += '\nNo matching signals in the available data.\n';
  out.push({ text: text + footer, ids: ids.length ? ids : [`${report.date}:no-matches`] });
  return out;
}
