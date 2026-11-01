import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chart } from '../../api/market.js';
import { recentSessions, nifty500 } from '../../lib/nse.js';
import { secret, istParts } from '../jarvis/config.mjs';
import { averageTurnoverCr, evaluateSignals, formatSignal, freshReport, validDailyBars } from './signals.mjs';
import { Telegram, applyUpdate, signalChunks } from './telegram.mjs';
import { ADMIN_CHAT_ID, ALLOWED_UPDATES, ensureAudience, recordMembership, sendAudience } from './audience.mjs';

export const STORE = resolve(process.env.TELEGRAM_HOME || join(fileURLToPath(new URL('../../', import.meta.url)), 'outputs/telegram'));
const STATE = join(STORE, 'state.json');
const WELCOME = '<b>⚡ ALPHA NOVA · SIGNALS CONNECTED</b>\n\n🏛 <b>Nifty 500 · Daily candles</b>\n💧 Prior 20-session avg traded value <b>≥ ₹100 Cr</b>\n\n🔎 Bullish &amp; bearish RSI divergence\n🚀 Momentum breakout with volume confirmation\n📈 New 52-week highs\n📉 New 52-week lows\n\n🕡 Scan after <b>18:45 IST</b> on trading days.\nSignals include evidence and the market session date.\n\n/sample — latest test signals\n/status — scanner status\n/stop — unsubscribe\n/start — subscribe again';
export const log = (event, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
export function loadState() {
  if (!existsSync(STATE)) return { version: 1, offset: 0, chats: {}, delivered: {}, report: null };
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  if (state.version !== 1 || !state.chats || !state.delivered || !Number.isInteger(state.offset)) throw new Error('Invalid Telegram state; refusing to reset subscriptions or deliveries');
  return state;
}
export function saveState(state) {
  ensureAudience(state);
  mkdirSync(STORE, { recursive: true, mode: 0o700 });
  const temp = `${STATE}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(temp, STATE);
}

export async function scan(state, { now = new Date(), sessionsLoader = recentSessions, universeLoader = nifty500, chartLoader = chart } = {}) {
  const today = istParts(now), afterClose = today.hour * 60 + today.minute >= 15 * 60 + 45;
  // Some NSE archive URLs serve the preceding session on a holiday. Count
  // unique file dates, not successful HTTP responses, in the ADV baseline.
  const sessions = [...new Map((await sessionsLoader(26)).map(s => [s.date, s])).values()]
    .filter(s => s.date < today.date || (s.date === today.date && afterClose)).sort((a, b) => b.date.localeCompare(a.date));
  const date = sessions[0]?.date;
  if (!date || !freshReport({ date }, now)) throw new Error('Latest NSE session is missing or stale; no signals sent');
  if (state.report?.date === date && state.report.failed === 0) return state.report;
  const universe = await universeLoader();
  if (universe.size < 450) throw new Error('Nifty 500 membership unavailable; no substitute universe used');
  const eligible = [...universe.keys()].map(symbol => ({ symbol, advCr: averageTurnoverCr(sessions, symbol, date) })).filter(s => s.advCr >= 100);
  if (!eligible.length) throw new Error('No complete ₹100 Cr liquidity baselines available');
  const report = { date, generatedAt: now.toISOString(), universe: universe.size, eligible: eligible.length, scanned: 0, failed: 0, signals: [] };
  log('scan.started', { date, eligible: eligible.length });
  for (let i = 0; i < eligible.length; i += 4) {
    await Promise.all(eligible.slice(i, i + 4).map(async ({ symbol, advCr }) => {
      try {
        const data = await chartLoader(`${symbol}.NS`, '2y', false, true);
        const bars = data.bars.filter(b => b.time <= date);
        if (data.currency !== 'INR' || bars.at(-1)?.time !== date || bars.length < 51 || !validDailyBars(bars)) throw new Error('Incomplete history');
        const signals = evaluateSignals({ symbol: `${symbol}.NS`, bars, advCr, sessionDate: date });
        report.signals.push(...signals.map(s => ({ ...s, text: formatSignal(s) })));
        report.scanned++;
      } catch { report.failed++; }
    }));
    if (i % 40 === 0) log('scan.progress', { scanned: report.scanned, failed: report.failed });
    await sleep(200);
  }
  if (!report.scanned) throw new Error('All price histories unavailable; no signals sent');
  report.signals.sort((a, b) => a.kind.localeCompare(b.kind) || b.advCr - a.advCr);
  // Preserve valid readings from a previous partial run if an upstream retry
  // fails for a different stock. The date and signal rules cannot change here.
  if (state.report?.date === date) report.signals = [...new Map([...state.report.signals, ...report.signals].map(s => [s.id, s])).values()];
  state.report = report;
  saveState(state);
  log('scan.completed', { date, scanned: report.scanned, failed: report.failed, signals: report.signals.length });
  return report;
}

export async function deliver(state, telegram, { sample = false, acknowledge = !sample, chatId = null, now = new Date() } = {}) {
  const report = state.report;
  if (!freshReport(report, now)) return { sent: 0, complete: false, reason: 'No fresh report' };
  let sent = 0, failed = 0;
  for (const chat of Object.values(state.chats).filter(c => c.active && (!chatId || c.id === String(chatId)))) {
    const delivered = state.delivered[chat.id] ||= {};
    const pending = acknowledge ? report.signals.filter(s => !delivered[s.id]) : report.signals;
    if (acknowledge && !pending.length && (report.signals.length || delivered[`${report.date}:no-matches`])) continue;
    for (const chunk of signalChunks(report, pending, sample)) {
      try {
        await telegram.send(chat.id, chunk.text);
        if (acknowledge) { for (const id of chunk.ids) delivered[id] = new Date().toISOString(); saveState(state); }
        sent++;
        await sleep(1100);
      } catch (error) {
        failed++;
        if (error.code === 403) { chat.active = false; if (acknowledge) saveState(state); }
        if (error.code === 429) state.nextDeliveryAt = Date.now() + (error.retryAfter || 60) * 1000;
        log('delivery.failed', { code: error.code || 'unknown', sample });
        break;
      }
    }
  }
  return { sent, complete: failed === 0 };
}

function acquireLock() {
  mkdirSync(STORE, { recursive: true, mode: 0o700 });
  const lock = join(STORE, 'runner.pid');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    let alive = false;
    if (pid > 0) { try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    if (alive) throw new Error('Telegram runner already active');
    unlinkSync(lock);
  }
  const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
  const release = () => { try { unlinkSync(lock); } catch {} };
  process.once('exit', release);
  return release;
}

export async function main(command = process.argv[2] || 'run') {
  if (command === 'status') {
    const state = loadState();
    log('status', { activeChats: Object.values(state.chats).filter(c => c.active).length,
      chats: Object.values(state.chats).map(({ id, type, active }) => ({ id, type, active })), report: state.report && { date: state.report.date, scanned: state.report.scanned, failed: state.report.failed, signals: state.report.signals.length }, lastError: state.lastError || null });
    return;
  }
  if (!['run', 'scan', 'sample', 'users'].includes(command)) throw new Error('Use run, scan, sample, users or status');
  // One-shot report senders do not write state and may coexist with the daemon.
  const release = ['sample', 'users'].includes(command) ? () => {} : acquireLock();
  const state = loadState();
  if (command === 'scan') { try { await scan(state); } finally { release(); } return; }
  const token = process.env.TELEGRAM_BOT_TOKEN || secret('alphanova.telegram.bot');
  if (!token) throw new Error('Telegram bot token missing from Keychain');
  const telegram = new Telegram(token);
  if (command === 'users') {
    log('audience.report.sent', await sendAudience(state, telegram, { trustedLocal: true, message: { text: ['/users', ...process.argv.slice(3)].join(' ') } }));
    return;
  }
  if (command === 'sample') {
    if (!Object.values(state.chats).some(c => c.active)) throw new Error('No subscribed chats yet; tap Start on the bot or add it as channel admin');
    if (!freshReport(state.report)) throw new Error('No fresh market scan available for a sample');
    log('sample.completed', await deliver(state, telegram, { sample: true })); return;
  }
  const webhook = await telegram.call('getWebhookInfo');
  if (webhook.url) throw new Error('Bot has an existing webhook; polling cannot start until its owner removes it');
  const commands = [
    { command: 'start', description: 'Subscribe to daily stock signals' }, { command: 'stop', description: 'Unsubscribe this chat' },
    { command: 'sample', description: 'Send the latest real signals as a test' }, { command: 'status', description: 'Scanner status and signal rules' }
  ];
  await telegram.call('setMyCommands', { commands });
  try {
    await telegram.call('setMyCommands', { scope: { type: 'chat', chat_id: ADMIN_CHAT_ID }, commands: [...commands, { command: 'users', description: 'Private subscriber counts, joins, exits and member records' }] });
  } catch (error) { log('admin.menu.unavailable', { code: error.code || 'unknown' }); }
  ensureAudience(state); saveState(state);
  let stopping = false, scanning = null, nextScan = 0;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  log('runner.started');
  while (!stopping) {
    try {
      const p = istParts(), minute = p.hour * 60 + p.minute;
      if (!scanning && Date.now() >= nextScan && (!freshReport(state.report) || (p.dow >= 1 && p.dow <= 5 && minute >= 18 * 60 + 45))) {
        nextScan = Date.now() + 30 * 60_000;
        scanning = scan(state).then(() => { state.lastError = null; saveState(state); }).catch(() => {
          state.lastError = 'Market scan unavailable; retrying in 30 minutes'; saveState(state); log('scan.failed');
        }).finally(() => { scanning = null; });
      }
      const updates = await telegram.call('getUpdates', { offset: state.offset, timeout: 20, allowed_updates: ALLOWED_UPDATES });
      for (const update of updates) {
        if (update.update_id < state.offset) continue;
        recordMembership(state, update);
        const message = update.message;
        let groupAdmin = false;
        if (['group', 'supergroup'].includes(message?.chat?.type) && /^\/(start|stop)(@\w+)?(?:\s|$)/i.test(message.text || '')) {
          const member = await telegram.call('getChatMember', { chat_id: message.chat.id, user_id: message.from.id });
          groupAdmin = ['creator', 'administrator'].includes(member.status);
        }
        const result = applyUpdate(state, update, { groupAdmin });
        state.offset = update.update_id + 1;
        saveState(state);
        if (!result) continue;
        const { chat, command: cmd, authorized } = result;
        if (cmd === '/users') {
          await sendAudience(state, telegram, { message: result.message });
          saveState(state);
        }
        else if (cmd === '/stop' && authorized) await telegram.send(chat.id, '🔕 <b>Signals paused.</b> Use /start to subscribe again.');
        else if (cmd === '/status') await telegram.send(chat.id, `<b>📊 ALPHA NOVA · STATUS</b>\n\n${chat.active ? '🟢 Subscribed' : '🔕 Paused'}\nLatest session: <b>${state.report?.date || 'Scanning…'}</b>\nMatches: <b>${state.report?.signals.length ?? 'Pending'}</b>\nCoverage: ${state.report?.scanned ?? 0}/${state.report?.eligible ?? 0} liquid stocks · ${state.report?.failed ?? 0} unavailable\n\nNifty 500 · Daily candles · ADV ≥ ₹100 Cr\nScan: after <b>18:45 IST</b>\n${state.lastError || 'Yahoo Finance + NSE turnover'}`);
        else if (cmd === '/sample' && chat.active && Date.now() - (chat.lastSampleAt || 0) >= 60_000) {
          chat.lastSampleAt = Date.now();
          if (freshReport(state.report)) await deliver(state, telegram, { sample: true, chatId: chat.id });
          else { chat.samplePending = true; await telegram.send(chat.id, '🔎 <b>Scanning the latest available session.</b> Your test signals will follow when it finishes.'); }
          saveState(state);
        }
      }
      for (const chat of Object.values(state.chats).filter(c => c.active)) {
        if (chat.welcomePending) { await telegram.send(chat.id, WELCOME); chat.welcomePending = false; saveState(state); }
        if (chat.initialTestPending && freshReport(state.report)) {
          const result = await deliver(state, telegram, { sample: true, acknowledge: true, chatId: chat.id });
          if (result.complete) { chat.initialTestPending = false; saveState(state); log('initial-test.delivered', { messages: result.sent }); }
        }
        if (chat.samplePending && freshReport(state.report)) {
          const result = await deliver(state, telegram, { sample: true, chatId: chat.id });
          if (result.complete) { chat.samplePending = false; saveState(state); }
        }
      }
      if (Date.now() >= (state.nextDeliveryAt || 0)) await deliver(state, telegram);
      const cutoff = new Date(Date.now() - 45 * 86400_000).toISOString();
      for (const entries of Object.values(state.delivered)) for (const [id, at] of Object.entries(entries)) if (at < cutoff) delete entries[id];
    } catch (error) {
      log('runner.retry', { code: error.code || 'unknown' });
      await sleep(Math.min(60, error.retryAfter || 5) * 1000);
    }
  }
  if (scanning) await scanning;
  saveState(state); release();
  log('runner.stopped');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ event: 'runner.failed', error: error.message })); process.exitCode = 1; });
}
