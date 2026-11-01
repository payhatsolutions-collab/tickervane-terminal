import test from "node:test";
import assert from "node:assert/strict";
import { cleanSymbols, watchlistURL, readSharedWatchlist, mergeWatchlist, watchlistBrief, filterWatchlist } from "../src/watchlistTools.js";

test("share links round trip mixed-market symbols without unrelated URL data", () => {
  const symbols = ["TCS.NS", "^NSEI", "USDINR=X", "BTC-USD", "BRK-B"];
  const url = new URL(watchlistURL("https://example.test/charts?email=private&symbol=OTHER#secret", symbols));
  assert.equal(url.pathname, "/watchlist");
  assert.equal(url.search, "");
  assert.deepEqual(readSharedWatchlist(url.hash), { symbols, error: "" });
  assert.throws(() => watchlistURL(url.origin, []));
  assert.deepEqual(cleanSymbols(["tcs.ns", "TCS.NS", null, {}, "<script>", "a".repeat(26)]), ["TCS.NS"]);
});

test("untrusted share payloads fail closed instead of partially importing", () => {
  for (const hash of ["#list=2&symbols=TCS.NS", "#list=1&symbols=", "#list=1&symbols=TCS.NS,%3Cscript%3E", "#list=1&symbols=" + "A".repeat(2500), "#list=1&symbols=" + Array.from({ length: 41 }, (_, i) => `S${i}`).join(",")]) {
    const result = readSharedWatchlist(hash);
    assert.deepEqual(result.symbols, []);
    assert.ok(result.error);
  }
  assert.equal(readSharedWatchlist("#main-content"), null);
  assert.deepEqual(readSharedWatchlist("#list=1&symbols=TCS.NS,TCS.NS").symbols, ["TCS.NS"]);
});

test("NSE ampersand symbols survive sharing and importing without losing existing stocks", () => {
  const symbols = ["M&M.NS", "J&KBANK.NS"];
  const url = new URL(watchlistURL("https://example.test", symbols));
  assert.deepEqual(readSharedWatchlist(url.hash), { symbols, error: "" });
  assert.deepEqual(mergeWatchlist(["M&M.NS"], ["TCS.NS"]).symbols, ["M&M.NS", "TCS.NS"]);
});

test("import preserves existing order, deduplicates and reports capacity accurately", () => {
  const current = Array.from({ length: 39 }, (_, i) => `S${i}`);
  const result = mergeWatchlist(current, ["S0", "TCS.NS", "RELIANCE.NS", "TCS.NS"]);
  assert.deepEqual(result.symbols, [...current, "TCS.NS"]);
  assert.deepEqual(result.added, ["TCS.NS"]);
  assert.equal(result.overflow, 1);
  assert.equal(current.length, 39);
  assert.deepEqual(mergeWatchlist(result.symbols, ["NEW"]), { symbols: result.symbols, added: [], overflow: 1 });
});

test("brief distinguishes missing changes from flat quotes and exposes oldest freshness", () => {
  const quotes = { A: { change: 2, marketTime: 100 }, B: { change: -5, marketTime: 90 }, C: { change: 0, marketTime: 110 }, D: { change: null }, E: { change: NaN } };
  const brief = watchlistBrief(["A", "B", "C", "D", "E", "F"], quotes);
  assert.deepEqual([brief.up, brief.down, brief.flat, brief.known, brief.missing], [1, 1, 1, 3, 3]);
  assert.deepEqual(brief.movers.map(item => item.symbol), ["B", "A", "C"]);
  assert.equal(brief.oldest, 90);
  assert.equal(watchlistBrief(["A"], { A: { change: 1 } }).oldest, null);
  assert.equal(watchlistBrief([], {}).oldest, null);
});

test("watchlist search finds company names, sorting keeps missing quotes last", () => {
  const watch = ["A", "MISSING", "B", "C"];
  const quotes = { A: { change: 2 }, B: { change: -5 }, C: { change: 0 } };
  const catalog = new Map([["A", { name: "Example company" }]]);
  assert.deepEqual(filterWatchlist(watch, quotes, catalog, " company ", "saved"), ["A"]);
  assert.deepEqual(filterWatchlist(watch, quotes, catalog, "", "movers"), ["B", "A", "C", "MISSING"]);
  assert.deepEqual(filterWatchlist(watch, quotes, catalog, "", "gainers"), ["A", "C", "B", "MISSING"]);
  assert.deepEqual(filterWatchlist(watch, quotes, catalog, "", "decliners"), ["B", "C", "A", "MISSING"]);
  assert.deepEqual(watch, ["A", "MISSING", "B", "C"]);
});
