import test from 'node:test';
import assert from 'node:assert/strict';
import { marketPhase, liveToday, marketSymbols, marketNotifications, marketState, MAX_MARKET_SYMBOLS } from '../lib/pushMarket.js';
import { scheduleOneTap } from '../src/oneTap.js';

// Tuesday 24 Nov 2026. IST = UTC + 5:30.
const ist = (h, m = 0, date = 24) => Date.UTC(2026, 10, date, h, m) - 5.5 * 3600e3;
const quote = (price, change, at) => ({ price, change, marketTime: Math.floor(at / 1000) });

test('market phase covers 09:15–15:40 IST on weekdays only', () => {
  assert.equal(marketPhase(ist(9, 14)), 'closed');
  assert.equal(marketPhase(ist(9, 15)), 'market');
  assert.equal(marketPhase(ist(12, 30)), 'market');
  assert.equal(marketPhase(ist(15, 40)), 'market');
  assert.equal(marketPhase(ist(15, 41)), 'closed');
  assert.equal(marketPhase(ist(19, 45)), 'closed');
  assert.equal(marketPhase(ist(11, 0, 28)), 'closed'); // Saturday
});

test('only quotes stamped today in IST count, so holidays send nothing', () => {
  const now = ist(10, 30);
  assert.equal(liveToday(quote(25800, 0.4, ist(10, 15)), now), true);
  assert.equal(liveToday(quote(25800, 0.4, ist(15, 30, 23)), now), false);
  assert.equal(liveToday({ price: 1, marketTime: now / 1000 }, now), false);
  const holiday = marketNotifications({ watch: ['TCS.NS'], quotes: { '^NSEI': quote(25800, -1.4, ist(15, 30, 23)), 'TCS.NS': quote(4000, 5, ist(15, 30, 23)) }, now });
  assert.deepEqual(holiday.notes, []);
});

test('first market run sends one update and absorbs the Nifty move it already reports', () => {
  const now = ist(9, 50);
  const quotes = { '^NSEI': quote(25600, -1.2, now), '^NSEBANK': quote(58000, -1.6, now), '^INDIAVIX': quote(18.2, 7.5, now),
    'TCS.NS': quote(4000, 0.5, now), 'INFY.NS': quote(1500, -0.8, now), 'AAPL': quote(230, 2, now) };
  const first = marketNotifications({ watch: ['TCS.NS', 'INFY.NS', 'AAPL'], quotes, now });
  assert.equal(first.notes.length, 1);
  assert.match(first.notes[0].title, /^Market open · Nifty 50 25,600 \(−1\.2%\)$/);
  assert.equal(first.notes[0].body, 'Bank Nifty −1.6% · VIX 18.2 (+7.5%) · Your watchlist: 1 up, 1 down');
  assert.deepEqual(first.state.nifty, { down: 1 });

  const later = ist(11, 40);
  const again = marketNotifications({ watch: [], state: first.state, quotes: { '^NSEI': quote(25550, -1.4, later) }, now: later });
  assert.deepEqual(again.notes, []);

  const worse = ist(13, 10);
  const second = marketNotifications({ watch: [], state: again.state, quotes: { '^NSEI': quote(25300, -2.3, worse) }, now: worse });
  assert.equal(second.notes.length, 1);
  assert.equal(second.notes[0].title, 'Nifty 50 down 2.3% · 25,300');
  assert.equal(second.notes[0].tag, 'nifty-move');
});

test('a mid-day first run is labelled a market update, not the open', () => {
  const now = ist(13, 5);
  const { notes } = marketNotifications({ quotes: { '^NSEI': quote(25800, 0.3, now) }, now });
  assert.match(notes[0].title, /^Market update · /);
  assert.equal(notes[0].body, 'Quotes may be delayed.');
});

test('watchlist movers fire once per threshold and group into one push', () => {
  const t1 = ist(10, 20);
  const base = { prefs: { market: false } };
  const one = marketNotifications({ ...base, watch: ['TCS.NS', 'INFY.NS', 'AAPL'], now: t1,
    quotes: { '^NSEI': quote(25800, 0.2, t1), 'TCS.NS': quote(4120.5, 3.4, t1), 'INFY.NS': quote(1500, -1, t1), 'AAPL': quote(230, 5, t1) } });
  assert.equal(one.notes.length, 1);
  assert.equal(one.notes[0].title, 'TCS +3.4% · ₹4,121');
  assert.equal(one.notes[0].url, '/charts?symbol=TCS.NS');

  const t2 = ist(12, 20);
  const same = marketNotifications({ ...base, watch: ['TCS.NS'], state: one.state, now: t2, quotes: { '^NSEI': quote(25800, 0.2, t2), 'TCS.NS': quote(4140, 3.9, t2) } });
  assert.deepEqual(same.notes, []);

  const t3 = ist(14, 20);
  const many = marketNotifications({ ...base, watch: ['TCS.NS', 'INFY.NS', 'SBIN.NS'], state: same.state, now: t3,
    quotes: { '^NSEI': quote(25800, 0.2, t3), 'TCS.NS': quote(4250, 6.5, t3), 'INFY.NS': quote(1450, -3.2, t3), 'SBIN.NS': quote(800, 1, t3) } });
  assert.equal(many.notes.length, 1);
  assert.equal(many.notes[0].title, '2 watchlist stocks are moving');
  assert.equal(many.notes[0].body, 'TCS +6.5% · INFY −3.2%');
  assert.equal(many.notes[0].url, '/watchlist');
});

test('preferences switch each kind off and a new day starts clean', () => {
  const now = ist(10, 0);
  const quotes = { '^NSEI': quote(25800, 1.5, now), 'TCS.NS': quote(4000, 4, now) };
  assert.deepEqual(marketNotifications({ prefs: { market: false, movers: false }, watch: ['TCS.NS'], quotes, now }).notes, []);
  const stale = { date: '2026-11-23', opened: true, nifty: { up: 2 }, moves: { 'TCS.NS:up': 3 } };
  assert.deepEqual(marketState(stale, now), { date: '2026-11-24', opened: false, nifty: {}, moves: {} });
  assert.equal(marketNotifications({ watch: ['TCS.NS'], state: stale, quotes, now }).notes.length, 2);
});

test('market symbols put the indices first, skip non-Indian listings and cap the list', () => {
  const big = Array.from({ length: 200 }, (_, i) => `S${i}.NS`);
  const symbols = marketSymbols([{ prefs: {}, watch: ['TCS.NS', 'AAPL', 'TCS.NS'] }, { prefs: {}, watch: big }, { prefs: { market: false, movers: false }, watch: ['ZZZ.NS'] }]);
  assert.deepEqual(symbols.slice(0, 4), ['^NSEI', '^NSEBANK', '^INDIAVIX', 'TCS.NS']);
  assert.equal(symbols.length, MAX_MARKET_SYMBOLS);
  assert.ok(!symbols.includes('AAPL') && !symbols.includes('ZZZ.NS'));
  assert.deepEqual(marketSymbols([{ prefs: { market: false, movers: false }, watch: ['TCS.NS'] }]), []);
});

test('One Tap waits for the first action or the idle timeout, then prompts once', async () => {
  const listeners = new Map();
  const target = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const doc = { visibilityState: 'visible', querySelector: () => null };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  let prompts = 0;
  const stop = scheduleOneTap(() => prompts++, { idle: 200, afterAction: 10, target, doc });
  await wait(5);
  assert.equal(prompts, 0);
  listeners.get('pointerdown')();
  assert.equal(listeners.size, 0); // one action is enough
  await wait(30);
  assert.equal(prompts, 1);
  await wait(220);
  assert.equal(prompts, 1);
  stop();

  let idlePrompts = 0;
  scheduleOneTap(() => idlePrompts++, { idle: 20, target, doc });
  await wait(40);
  assert.equal(idlePrompts, 1);

  let blocked = 0;
  const cancel = scheduleOneTap(() => blocked++, { idle: 10, target, doc: { visibilityState: 'visible', querySelector: () => ({}) } });
  await wait(30);
  assert.equal(blocked, 0); // a dialog is open, so it keeps waiting
  cancel();
});
