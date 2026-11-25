import test from 'node:test';
import assert from 'node:assert/strict';
import { proExample, rankedBreakouts } from '../src/proExample.js';
import { proOffer, proOffered } from '../src/proOffer.js';
import { viewFromLocation, viewURL } from '../src/navigation.js';
import { buildOverview } from '../lib/overview.js';
import { PRO_EXAMPLE_SYMBOL, PRO_PAGES } from '../lib/proPlan.js';
import { PRO_WORKSPACE_COPY } from '../lib/proCopy.js';

const breakout = (symbol, turnoverCr, extra = {}) => ({ symbol, name: symbol, breakout20: true, volRatio: 2, turnoverCr, ...extra });
const rows = [
  breakout('SMALL', 20),
  breakout('BIG', 900),
  breakout('MID', 300),
  breakout('QUIET', 5000, { volRatio: 1.1 }),           // a 20-day high without the volume: not confirmed
  { symbol: 'RELIANCE', name: 'Reliance Industries', breakout20: false, volRatio: 3, turnoverCr: 9000 },
];

test('each Pro workspace has one free example, and a line of copy saying what it is', () => {
  for (const page of PRO_PAGES) {
    assert.equal(proExample(page, PRO_EXAMPLE_SYMBOL, { data: { rows } }).ready, true, page);
    assert.match(PRO_WORKSPACE_COPY[page].example, /\.$/, page);
  }
  // Workspaces that are not symbol-based need no stock to show their example.
  for (const page of ['FnO', 'Flows']) assert.deepEqual(proExample(page, 'TCS.NS'), { ready: true });
});

test('Forecast and Advanced analytics show the default stock and name the one the reader came for', () => {
  for (const page of ['Forecast', 'Analytics']) {
    assert.deepEqual(proExample(page, PRO_EXAMPLE_SYMBOL), { ready: true, symbol: PRO_EXAMPLE_SYMBOL, requested: null });
    assert.deepEqual(proExample(page, 'TCS.NS'), { ready: true, symbol: PRO_EXAMPLE_SYMBOL, requested: 'TCS.NS' });
  }
});

test('Breakout insights frees the top confirmed breakout by turnover, the first name on the home page', () => {
  assert.deepEqual(rankedBreakouts(rows).map(row => row.symbol), ['BIG', 'MID', 'SMALL']);
  const home = buildOverview({ rows }).setups.breakout20.rows;
  assert.equal(rankedBreakouts(rows)[0].symbol, home[0].symbol);
  const screen = { data: { rows }, loading: false };
  assert.deepEqual(proExample('Breakouts', 'BIG.NS', screen), { ready: true, symbol: 'BIG.NS', requested: null });
  // Another confirmed breakout is named as needing Pro; a stock that is not a breakout is not.
  assert.deepEqual(proExample('Breakouts', 'MID.NS', screen), { ready: true, symbol: 'BIG.NS', requested: 'MID.NS' });
  assert.deepEqual(proExample('Breakouts', 'RELIANCE.NS', screen), { ready: true, symbol: 'BIG.NS', requested: null });
  assert.deepEqual(proExample('Breakouts', 'QUIET.NS', screen), { ready: true, symbol: 'BIG.NS', requested: null });
});

test('Breakout insights waits for the session, and falls back to the paywall when there is nothing to show', () => {
  assert.deepEqual(proExample('Breakouts', 'TCS.NS', { data: null, loading: true }), { ready: false });
  assert.deepEqual(proExample('Breakouts', 'TCS.NS', { data: null, loading: false, error: 'offline' }), { ready: true, none: true });
  assert.deepEqual(proExample('Breakouts', 'TCS.NS', { data: { rows: [rows[4]] }, loading: false }), { ready: true, none: true });
  // A failed refresh keeps the example from the last session received.
  assert.equal(proExample('Breakouts', 'TCS.NS', { data: { rows }, loading: false, error: 'offline' }).symbol, 'BIG.NS');
});

test('the Pro button wording follows what the account can still claim', () => {
  assert.deepEqual(proOffer({ signedIn: false }, false), { offer: 'trial', label: 'Try Pro free for 30 min' });
  assert.deepEqual(proOffer({ signedIn: true, trialEligible: true }, false), { offer: 'trial', label: 'Try Pro free for 30 min' });
  assert.deepEqual(proOffer({ signedIn: true, trialEligible: false }, false), { offer: 'paid', label: 'Get Pro · ₹300' });
  // The longer trial is only for readers who have the app.
  assert.deepEqual(proOffer({ signedIn: false }, true), { offer: 'app_trial', label: 'Start 3 days of Pro free' });
  assert.deepEqual(proOffer({ signedIn: true, trialEligible: false, appTrialEligible: true }, true), { offer: 'app_trial', label: 'Start 3 days of Pro free' });
  assert.deepEqual(proOffer({ signedIn: true, trialEligible: false, appTrialEligible: true }, false), { offer: 'paid', label: 'Get Pro · ₹300' });
  for (const access of [null, { configured: false }, { active: true }, { paused: true }]) assert.equal(proOffered(access), false);
  assert.equal(proOffered({ signedIn: false }), true);
});

test('a ?pro=1 link opens the paywall on arrival and is dropped from every later address', () => {
  assert.equal(viewURL('https://alphanova48.in/breakouts?pro=1', { page: 'Breakouts', symbol: 'ITC.NS', range: '6mo' }, { share: false }), '/breakouts?symbol=ITC.NS');
  assert.equal(viewURL('https://alphanova48.in/breakouts?pro=1&utm_source=app', { page: 'Screener', symbol: 'ITC.NS', range: '6mo' }, { share: false }), '/screener?utm_source=app');
});

test('paid checkout keeps the requested breakout on reload and ordinary navigation leaves checkout', () => {
  const url = new URL('https://alphanova48.in/pro/checkout?symbol=ITC.NS&page=Markets');
  const view = viewFromLocation(url);
  assert.equal(view.page, 'Breakouts');
  assert.equal(view.symbol, 'ITC.NS');
  assert.equal(viewURL(url, view, { share: false, paidCheckout: true }), '/pro/checkout?symbol=ITC.NS');
  assert.equal(viewURL(url, view, { share: false }), '/breakouts?symbol=ITC.NS');
  assert.equal(viewURL(url, { ...view, page: 'Markets' }, { share: false }), '/markets');
});
