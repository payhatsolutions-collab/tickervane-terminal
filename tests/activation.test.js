import test from "node:test";
import assert from "node:assert/strict";
import { visitTransition, activationTransition, firstStockTransition, SESSION_GAP, RETURN_WINDOW } from "../src/activation.js";
const start = Date.UTC(2026, 9, 5);
const stocks = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS"];
const activate = () => activationTransition(visitTransition({}, start).state, stocks, start + 1000).state;

test("first visit and session emit once across StrictMode, reload and second tab", () => {
  const first = visitTransition({}, start);
  assert.deepEqual(first.events.map(([name]) => name), ["first_visit", "visit_started"]);
  assert.deepEqual(visitTransition(first.state, start).events, []);
  assert.deepEqual(visitTransition(first.state, start + 1000).events, []);
});
test("activation requires three distinct saved stocks and emits once", () => {
  const first = visitTransition({}, start).state;
  const one = firstStockTransition(first, start + 1000);
  assert.deepEqual(one.events.map(([name]) => name), ["first_stock_saved"]);
  assert.deepEqual(activationTransition(one.state, stocks.slice(0, 2), start + 1500).events, []);
  assert.deepEqual(activationTransition(one.state, [stocks[0], stocks[0], stocks[1]], start + 1000).events, []);
  const result = activationTransition(one.state, stocks, start + 2000);
  assert.equal(result.events[0][0], "watchlist_activated");
  assert.equal(result.events[0][1].seconds_to_activation, 2);
  assert.deepEqual(activationTransition(result.state, [], start + 3000).events, []);
  assert.deepEqual(activationTransition(result.state, stocks, start + 4000).events, []);
});
test("legacy watchlists are excluded from newcomer activation", () => {
  const legacy = visitTransition({}, start, true).state;
  assert.deepEqual(activationTransition(legacy, stocks, start + 1000).events, []);
  assert.equal(visitTransition(legacy, start + SESSION_GAP, false).state.existing, true);
});
test("return requires a later session, not reloads or continued browsing", () => {
  const active = activate();
  assert.deepEqual(visitTransition(active, start + 2000).events, []);
  const returned = visitTransition(active, start + SESSION_GAP);
  assert.deepEqual(returned.events.map(([name]) => name), ["visit_started", "activated_return_within_7d"]);
  assert.equal(returned.events[1][1].activation_cohort, "2026-10-05");
  assert.deepEqual(visitTransition(returned.state, start + SESSION_GAP * 2).events.map(([name]) => name), ["visit_started"]);
});
test("seven-day boundary is inclusive and late visits never count", () => {
  const active = activate();
  assert.equal(visitTransition(active, active.activatedAt + RETURN_WINDOW).events.length, 2);
  assert.deepEqual(visitTransition(active, active.activatedAt + RETURN_WINDOW + 1).events.map(([name]) => name), ["visit_started"]);
});
test("unactivated users and active tabs do not generate retained activations", () => {
  let current = visitTransition({}, start).state;
  assert.equal(visitTransition(current, start + SESSION_GAP).events.length, 1);
  current = activate();
  for (let i = 1; i <= 40; i++) {
    const next = visitTransition(current, start + i * 60000);
    assert.deepEqual(next.events, []);
    current = next.state;
  }
});

 test("first-stock milestone survives reload, removal and re-add without changing legacy activation", () => {
  const initial = visitTransition({}, start).state;
  const result = firstStockTransition(initial, start + 4000);
  assert.equal(result.events[0][1].seconds_to_save, 4);
  assert.equal(result.state.activatedAt, undefined);
  const removed = activationTransition(result.state, [], start + 5000);
  assert.deepEqual(firstStockTransition(removed.state, start + 6000).events, []);
  assert.deepEqual(activationTransition(initial, stocks, start + 4000).events.map(([name]) => name), ["watchlist_activated"]);
 });

test("restoring old watchlists does not backfill first-save events", () => {
  assert.deepEqual(firstStockTransition(activate(), start + 5000).events, []);
  assert.deepEqual(firstStockTransition(visitTransition({}, start, true).state, start + 5000).events, []);
});
