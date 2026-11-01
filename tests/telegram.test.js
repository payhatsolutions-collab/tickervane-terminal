import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { averageTurnoverCr, divergences, evaluateSignals, formatSignal, freshReport } from '../agents/telegram/signals.mjs';
import { applyUpdate, signalChunks, Telegram, TelegramError } from '../agents/telegram/telegram.mjs';

const home = mkdtempSync(join(tmpdir(), 'telegram-test-'));
process.env.TELEGRAM_HOME = home;
const { scan, deliver, saveState, loadState } = await import('../agents/telegram/runtime.mjs');
after(() => rmSync(home, { recursive: true, force: true }));
const state = () => ({ version: 1, offset: 0, chats: {}, delivered: {}, report: null });
function candles(count = 400) {
  const bars = [], date = new Date('2025-01-01T00:00:00Z');
  while (bars.length < count) {
    if (![0, 6].includes(date.getUTCDay())) bars.push({ time: date.toISOString().slice(0, 10), open: 100, high: 102, low: 98, close: 100, volume: 1_000_000 });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return bars;
}
function sessions(count = 21) {
  return candles(count).reverse().map((b, i) => ({ date: b.time, rows: new Map([['ABC', { turnover: i === 0 ? 999_999 : 10_000 }]]) }));
}

test('ADV uses actual traded value, exactly twenty prior unique sessions, and crore units', () => {
  const list = sessions();
  assert.equal(averageTurnoverCr(list, 'ABC', list[0].date), 100);
  assert.equal(averageTurnoverCr(list.slice(0, 20), 'ABC', list[0].date), null);
  assert.equal(averageTurnoverCr([list[0], list[1], ...list.slice(1, 20)], 'ABC', list[0].date), null);
  list[2].rows.clear();
  assert.equal(averageTurnoverCr(list, 'ABC', list[0].date), null);
});

test('breakout requires closing confirmation, liquidity and volume, with no current-bar leakage', () => {
  const bars = candles();
  const input = { symbol: 'ABC.NS', bars, advCr: 100, sessionDate: bars.at(-1).time };
  Object.assign(bars.at(-1), { open: 100, high: 112, low: 99, close: 110, volume: 2_000_000 });
  assert.ok(evaluateSignals(input).some(s => s.kind === 'momentum-breakout'));
  assert.deepEqual(evaluateSignals({ ...input, advCr: 99.99 }), []);
  assert.deepEqual(evaluateSignals({ ...input, advCr: null }), []);
  assert.deepEqual(evaluateSignals({ ...input, sessionDate: '2030-01-01' }), []);
  bars.at(-1).volume = 1_000_000;
  assert.ok(!evaluateSignals(input).some(s => s.kind === 'momentum-breakout'));
  Object.assign(bars.at(-1), { volume: 2_000_000, close: 101 });
  assert.ok(!evaluateSignals(input).some(s => s.kind === 'momentum-breakout'));
});

test('52-week extremes use wick highs/lows, reject ties and require full calendar-year coverage', () => {
  const bars = candles();
  const evaluate = () => evaluateSignals({ symbol: 'ABC.NS', bars, advCr: 200, sessionDate: bars.at(-1).time });
  assert.ok(!evaluate().some(s => s.kind.startsWith('52-week')));
  bars.at(-1).high = 103; bars.at(-1).low = 97;
  assert.deepEqual(evaluate().filter(s => s.kind.startsWith('52-week')).map(s => s.kind), ['52-week-high', '52-week-low']);
  const recent = bars.slice(-100);
  assert.ok(!evaluateSignals({ symbol: 'IPO.NS', bars: recent, advCr: 200, sessionDate: recent.at(-1).time }).some(s => s.kind.startsWith('52-week')));
});

test('malformed or nonchronological history cannot produce a signal', () => {
  const bars = candles();
  bars.at(-1).high = 99;
  assert.deepEqual(evaluateSignals({ symbol: 'ABC.NS', bars, advCr: 100, sessionDate: bars.at(-1).time }), []);
  bars.at(-1).high = 103; bars[10].time = bars[9].time;
  assert.deepEqual(evaluateSignals({ symbol: 'ABC.NS', bars, advCr: 100, sessionDate: bars.at(-1).time }), []);
});

test('RSI divergence fires on the third confirming candle, not on an unconfirmed pivot', () => {
  const bars = candles(44), strength = bars.map(() => 50);
  bars[25].low = 95; strength[25] = 25;
  bars[40].low = 90; strength[40] = 32;
  assert.equal(divergences(bars.slice(0, 43), strength.slice(0, 43)).length, 0);
  const result = divergences(bars, strength);
  assert.equal(result[0].kind, 'rsi-bullish');
  assert.equal(result[0].pivotDate, bars[40].time);
  assert.equal(divergences([...bars, ...candles(1).map(b => ({ ...b, time: '2026-01-01' }))], [...strength, 50]).length, 0);
  bars[25].low = 98; bars[40].low = 98;
  bars[25].high = 108; bars[40].high = 112;
  strength[25] = 78; strength[40] = 70;
  assert.equal(divergences(bars, strength)[0].kind, 'rsi-bearish');
});

test('private start/stop and bot membership updates persist opt-in and removal', () => {
  const s = state(), chat = { id: 10, type: 'private' };
  applyUpdate(s, { message: { chat, text: '/start' } });
  assert.equal(s.chats['10'].active, true);
  applyUpdate(s, { message: { chat, text: '/stop' } });
  applyUpdate(s, { message: { chat, text: 'hello' } });
  assert.equal(s.chats['10'].active, false);
  const membership = { chat: { id: -20, type: 'channel' }, new_chat_member: { status: 'administrator', can_post_messages: true } };
  applyUpdate(s, { my_chat_member: membership });
  assert.equal(s.chats['-20'].active, true);
  membership.new_chat_member = { status: 'left' };
  applyUpdate(s, { my_chat_member: membership });
  assert.equal(s.chats['-20'].active, false);
});

test('group subscription commands require an admin and bot messages never register chats', () => {
  const s = state(), chat = { id: -30, type: 'supergroup' };
  const update = { message: { chat, from: { id: 1 }, text: '/start@TestBot' } };
  applyUpdate(s, update);
  assert.equal(s.chats['-30'].active, false);
  applyUpdate(s, update, { groupAdmin: true });
  assert.equal(s.chats['-30'].active, true);
  update.message.text = '/stop'; applyUpdate(s, update);
  assert.equal(s.chats['-30'].active, true);
  applyUpdate(s, update, { groupAdmin: true });
  assert.equal(s.chats['-30'].active, false);
  assert.equal(applyUpdate(s, { message: { chat: { id: 99, type: 'private' }, from: { is_bot: true }, text: '/start' } }), null);
});

test('reports clearly label tests, escape ticker HTML, and split within Telegram limits without losing signals', () => {
  const signal = { symbol: 'M&M.NS', kind: '52-week-low', direction: 'bearish', label: 'New 52-week low', close: 500, advCr: 150, detail: 'Low < prior low' };
  const text = formatSignal(signal);
  assert.match(text, /M&amp;M/); assert.match(text, /&lt;/);
  const signals = Array.from({ length: 40 }, (_, i) => ({ id: String(i), text }));
  const chunks = signalChunks({ date: '2026-10-30', signals, scanned: 40, eligible: 40, failed: 0 }, signals, true);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(c => c.text.length <= 3800 && c.text.includes('TEST SIGNALS') && c.text.includes('2026-10-30')));
  assert.deepEqual(chunks.flatMap(c => c.ids), signals.map(s => s.id));
});

test('Telegram errors never expose the token or full upstream error', async () => {
  const client = new Telegram('secret-token', async () => { throw new Error('https://example.com/secret-token'); });
  await assert.rejects(client.call('getMe'), e => !e.message.includes('secret-token') && e.code === 'network');
  const throttled = new Telegram('secret-token', async () => ({ ok: false, status: 429, json: async () => ({ error_code: 429, description: 'secret-token', parameters: { retry_after: 42 } }) }));
  await assert.rejects(throttled.send('10', 'test'), e => e.code === 429 && e.retryAfter === 42 && !e.message.includes('secret-token'));
});

test('stale and future reports are never eligible for delivery', () => {
  assert.equal(freshReport({ date: '2026-10-30' }, new Date('2026-10-31T08:00:00Z')), true);
  assert.equal(freshReport({ date: '2026-10-20' }, new Date('2026-10-31T08:00:00Z')), false);
  assert.equal(freshReport({ date: '2026-11-01' }, new Date('2026-10-31T08:00:00Z')), false);
});

test('delivery checkpoints successful recipients and retries failed recipients only', async () => {
  const s = state(), date = '2026-10-30';
  s.chats = { a: { id: 'a', active: true }, b: { id: 'b', active: true } };
  s.report = { date, scanned: 1, eligible: 1, failed: 0, signals: [{ id: `${date}:ABC:high`, text: 'A real signal' }] };
  const sent = [], now = new Date('2026-10-31T08:00:00Z');
  const telegram = { send: async id => { if (id === 'b') throw new TelegramError(500); sent.push(id); } };
  await deliver(s, telegram, { now });
  assert.deepEqual(sent, ['a']);
  telegram.send = async id => sent.push(id);
  await deliver(s, telegram, { now });
  assert.deepEqual(sent, ['a', 'b']);
  await deliver(s, telegram, { now });
  assert.deepEqual(sent, ['a', 'b']);
  assert.ok(loadState().delivered.a[`${date}:ABC:high`]);
});

test('scan deduplicates holiday archive dates and explicitly counts unavailable histories', async () => {
  const list = sessions(26), date = list[0].date;
  list.splice(3, 0, list[2]);
  const universe = new Map(Array.from({ length: 450 }, (_, i) => [i ? `OTHER${i}` : 'ABC', {}]));
  const s = state(), bars = candles(26);
  const now = new Date(`${date}T20:00:00+05:30`);
  const result = await scan(s, { now, sessionsLoader: async () => list, universeLoader: async () => universe,
    chartLoader: async () => ({ bars, currency: 'INR' }) }).catch(e => e.message);
  assert.equal(result, 'All price histories unavailable; no signals sent');
  assert.equal(s.report, null);
  saveState(state());
});
