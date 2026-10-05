import test from "node:test";
import assert from "node:assert/strict";
import {
  NAV_GROUPS,
  PAGE_LABELS,
  PAGES,
  viewFromSearch,
  viewURL,
} from "../src/navigation.js";
import { serializeCSV } from "../src/csv.js";
import { sortRows } from "../src/table.js";

test("navigation exposes every workspace exactly once with readable labels", () => {
  assert.equal(PAGES.length, 13);
  assert.equal(new Set(PAGES).size, PAGES.length);
  assert.deepEqual(
    NAV_GROUPS.flatMap((group) => group.pages),
    PAGES,
  );
  assert.ok(PAGES.every((page) => PAGE_LABELS[page]));
  assert.ok(PAGES.includes("FnO") && PAGES.includes("Flows"));
});
test("deep links validate page, symbol and chart range", () => {
  assert.deepEqual(viewFromSearch("?page=Forecast&symbol=tcs.ns&range=1y"), {
    page: "Forecast",
    symbol: "TCS.NS",
    range: "1y",
  });
  assert.deepEqual(
    viewFromSearch("?page=Unknown&symbol=../secret&range=forever"),
    { page: "Today", symbol: "RELIANCE.NS", range: "6mo" },
  );
  for (const symbol of ["^NSEI", "USDINR=X", "BTC-USD"])
    assert.equal(
      viewFromSearch("?symbol=" + encodeURIComponent(symbol)).symbol,
      symbol,
    );
  assert.equal(
    viewFromSearch("?symbol=" + "A".repeat(26)).symbol,
    "RELIANCE.NS",
  );
});
test("workspace URLs preserve forecast horizon and remove irrelevant screen and anchors", () => {
  const view = { page: "Forecast", symbol: "TCS.NS", range: "1y" };
  const url = new URL(
    viewURL(
      "https://alphanova48.in/?screen=momentum&horizon=20#main-content",
      view,
    ),
    "https://alphanova48.in",
  );
  assert.equal(url.searchParams.get("horizon"), "20");
  assert.equal(url.searchParams.has("screen"), false);
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.get("symbol"), "TCS.NS");
  const screen = new URL(
    viewURL(url.href, { ...view, page: "Screener", screen: "pullback" }),
    "https://alphanova48.in",
  );
  assert.equal(screen.searchParams.get("screen"), "pullback");
});
test("CSV export escapes formulas and quotations without corrupting negative numbers", () => {
  assert.equal(
    serializeCSV([
      ["=1+1", " +SUM(A1)", "@SUM(1)", "-stock", -12, 'a"b', null],
    ]),
    '"\'=1+1","\' +SUM(A1)","\'@SUM(1)","\'-stock","-12","a""b",""',
  );
});
test("table sorting keeps missing numbers last in both directions and sorts false correctly", () => {
  const rows = [
    { id: "missing", v: null },
    { id: "nan", v: NaN },
    { id: "low", v: -3 },
    { id: "high", v: 5 },
    { id: "missing2" },
  ];
  assert.deepEqual(
    sortRows(rows, ["v", 1]).map((row) => row.id),
    ["low", "high", "missing", "nan", "missing2"],
  );
  assert.deepEqual(
    sortRows(rows, ["v", -1]).map((row) => row.id),
    ["high", "low", "missing", "nan", "missing2"],
  );
  assert.deepEqual(
    sortRows([{ v: true }, { v: false }], ["v", 1]).map((row) => row.v),
    [false, true],
  );
  assert.equal(rows[0].id, "missing");
});
