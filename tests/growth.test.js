import test from "node:test";
import assert from "node:assert/strict";
import { growthEvent, recordVisit, recordActivation } from "../src/growth.js";

test("events queue before Analytics initializes and funnel emissions persist once", () => {
  const oldWindow = globalThis.window;
  const oldStorage = globalThis.localStorage;
  try {
    const saved = new Map();
    globalThis.localStorage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
    globalThis.window = {};
    growthEvent("onboarding_started", { step: "choose" });
    assert.deepEqual(window.vaq, [["event", { name: "onboarding_started", data: { step: "choose" } }]]);
    const events = [];
    window.va = (...args) => events.push(args);
    recordVisit(false);
    recordVisit(false);
    recordActivation(["TCS.NS", "HDFCBANK.NS", "RELIANCE.NS"]);
    recordActivation(["TCS.NS", "HDFCBANK.NS", "RELIANCE.NS"]);
    assert.deepEqual(events.map(([, payload]) => payload.name), ["first_visit", "visit_started", "watchlist_activated"]);
    assert.equal(saved.size, 1);
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage;
  }
});
