# Independent app QA — 14 November 2026

Reviewed the current working tree and the deployed app at https://alphanova48.in. This was a whole-app behavioral review, not a review of changes against a commit. Two confirmed medium-priority defects remain. No critical defect was found in the exercised flows; this is not a guarantee that untested paths are defect-free.

## Confirmed findings

### 1. P2 — Missing trend history satisfies negative screener rules

**Location:** `src/screens.js:50` (`matches`, boolean coercion in the `is` branch).

**Reproduction:** Open Screener → Custom screen. Set the metric to **Above 200 DMA**, select **No**, and filter for **CMPDI**. The stock is returned even though the market response has `above200: null`, not `false`.

**Observed:** Reproduced in the local browser and on the production site at a 390 × 844 viewport. The 13 November session includes seven affected rows: CMPDI, CLEANMAX, FRACTAL, VAML, VISL, VOGL, and VEDPOWER. All seven incorrectly pass the negative 200-DMA rule. The same coercion affects other nullable flags, including the golden-cross trend and Minervini trend template.

**Expected:** Unknown indicators should fail the condition, or require an explicit “unknown” filter. Missing history does not establish that a stock is below its moving average.

**Impact:** Incorrect stock selections; the shared screen evaluator can also produce incorrect matches for saved-screen notifications.

**Cause:** `!!null` and `!!undefined` are both `false`, so the rule treats unavailable data as a known negative observation.

**Suggested correction:** Require a boolean observation before comparing it to the boolean condition. Add regression coverage for true, false, null, and undefined.

Evidence: [production screenshot](missing-trend-match-mobile.png), [dated API evidence](additional-api-checks.json), [executable reproduction](reproduce.mjs).

### 2. P2 — Backup validation accepts journal fields that crash rendering

**Location:** `src/tradeMath.js:98–102` (`validJournalEntry`), consumed by `src/backup.js:20` and rendered in `src/TradeDesk.jsx:711–713`.

**Reproduction:** Supply an otherwise valid version-5 backup with one valid planned journal entry and `notes: { "text": "Malformed note" }`. `parseBackup` accepts the entry. Rendering the actual `TradeJournal` component throws **“Objects are not valid as a React child.”** An object-valued `review` produces the same error.

**Expected:** Reject malformed fields or normalize optional notes/review to strings before updating saved records.

**Impact:** Opening Trade journal after importing the accepted backup can crash the React application. The invalid entry is persisted to `an2-journal`, so reloading does not repair it. A valid backup or storage repair is needed to remove the offending record. The normal UI cannot create these object-valued fields; this defect concerns malformed imports.

**Verification:** Executed `parseBackup` followed by server rendering of the real bundled JSX component. A valid string-note entry renders successfully; both malformed variants fail. Did not import destructive test data into the user's existing browser records.

**Suggested correction:** Normalize journal records at both import and storage-load boundaries, validate optional rendered fields, and add a regression that renders accepted imported entries.

Evidence: [executable reproduction](reproduce.mjs), [captured output](reproduction-output.txt).

## Checks completed

| Area | Result and scope |
| --- | --- |
| JavaScript suite | **430/430 passed**. Includes market normalization, indicators, forecasts, trade calculations, brokers, backup, auth, MCP, SEO, component rendering, Jarvis and Telegram tests. |
| Python suite | **9/9 passed**, using an isolated temporary Python 3.12 environment with the declared requirements and HTTP test client. Covers Lodestar and Nifty Edge. |
| Production build | Passed through the existing SEO test, which invokes `npm run build`. Also ran an independent Vite bundle build to `/tmp/alphanova-qa-dist`. |
| Public routes/APIs | **40/40 HTTP 200** in the release smoke check. Covered all workspace routes, quotes, daily/intraday history, fundamentals, screen, delivery, news, options, futures, flows, deals, rotation, directory, push configuration, signup status, and Nifty Edge lab/snapshot. Payload shapes/counts captured, not just status codes. |
| Additional API checks | Unknown operation, invalid chart symbol and invalid range returned **400**; invalid Lodestar symbol returned **422**. Auth session status, stock directory page and install page returned **200**. No account mutation. |
| Desktop navigation | Rendered all **16 workspaces**: Top Setups, Charts & plan, Forecast, Markets, Screener, Fundamentals, Breakout insights, Advanced analytics, Delivery radar, Futures & options, Institutional flows, News, Watchlist, Portfolio, Trade journal and Price alerts. See workspace evidence; navigation smoke coverage is not exhaustive feature validation. |
| Forecast | Loaded a TEGA forecast and switched to TCS through suggestions; transition showed loading without a stale-result crash. |
| Screener | Preset change, query filtering, empty results, custom-rule editing, and production reproduction of missing-data false matches. |
| Portfolio | Added a disposable local TCS holding (1 share at cost 100), verified calculation and persistence after reload, removed it, verified Undo, then removed the disposable holding again. Original records were retained. |
| Mobile | Checked the live 390 × 844 layout for Fundamentals, Screener, More navigation and the embedded Nifty Edge workspace. Fundamentals and Nifty Edge loaded within their frames. Restored the temporary viewport override afterward. |
| Browser errors | No application exception observed during the exercised ordinary flows. Local Google sign-in logged an origin-configuration error; see limitations. |

Full smoke evidence: [routes and APIs](live-smoke.json), [workspace render observations](workspace-smoke.json), [additional checks](additional-api-checks.json).

## Limitations and environment observations

- Real Google login/logout, new account registration, push permission/subscription and end-to-end notification delivery were not performed. Broker order placement and financial transactions were not performed. Their automated tests do not establish a successful external-service round trip.
- Python services are proxied by Vite to ports 5189 and 5190, but `npm run dev` does not start them. The local Lodestar proxy reported `ECONNREFUSED`. Verified embedded functionality against production instead; Python unit/API tests passed in isolation. This is a local startup limitation, not evidence of a production outage.
- Google rejected the local origin for the configured client ID. Production displayed the sign-in control, but a real login was not attempted.
- The first sandboxed JavaScript run could not bind localhost integration-test sockets. The authorized rerun passed all 430 tests. The default system Python lacked FastAPI; the isolated environment resolved that setup issue.
- No exhaustive cross-browser, assistive-technology, load, offline/reconnection, long-duration refresh, or all-symbol/provider audit was performed. Quote/financial values were not reconciled against exchange filings.
- No application fixes or deployment changes were made. QA artifacts were added under this directory. The existing `npm test` SEO test runs the complete build, which can regenerate public files and refresh public market snapshots.

## Reproduce the findings

From the repository root:

```sh
node docs/qa-2026-11-14/reproduce.mjs
```

This diagnostic asserts that the defects are currently present and prints their evidence. It uses synthetic journal data, renders without a browser, and leaves saved user records untouched. Its successful exit means the defects reproduced, not that the behavior is correct.
