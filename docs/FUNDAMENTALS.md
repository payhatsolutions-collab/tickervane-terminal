# Fundamentals workspace

Updated 10 November 2026. `/fundamentals?symbol=RELIANCE.NS` opens a company-specific report. The mobile tray is Top Setups, Delivery, Markets, Fundamentals and More; Watchlist remains in More and the desktop sidebar. The internal Today route is unchanged.

## Original interface

The interface is vendored directly from `yashsarda31/lodestar`, commit `4d172b4775fbd8c16768d52ca81012a738ab77b2`, `static/index.html`, in `vendor/lodestar/index.html`. `scripts/build-lodestar.mjs` keeps the original body markup and CSS, externalizing the stylesheet and script for the existing content security policy. CSS SHA-256: `7058ca8d498a6031edff23451290963413b018e9ed5e8ce24637ee1c112f8d77`.

A same-origin iframe isolates the original typography, colours, spacing, charts, report cards and responsive behaviour from Alphanova's global CSS. The enclosing workspace toolbar is omitted to avoid a duplicate heading. Only the embedded path permits same-origin framing; other pages retain their existing frame restrictions. Parent/child navigation messages validate origin, source, type and symbol. Company searches update Alphanova's shareable URL.

Integration patches replace data transport, expand company search and label statement-only data. Original full reports retain BUY/HOLD/SELL calls, score caps, weights, explanations and methodology. There is no added Powered by Lodestar banner. The original Lodestar branding is retained as part of the requested original interface.

## Data coverage

`op=lodestar` in the existing market endpoint reads published snapshots. The verified source index contains 219 full six-pillar reports. Search merges those reports with Alphanova's entire NSE directory: 3,263 searchable names at verification. Other companies now run the original Lodestar engine on demand via `/api/lodestar?symbol=...`. The unchanged upstream `engine.py` is vendored in `lodestar_engine/` from the same pinned revision as the interface. It pulls Yahoo statements, estimates and price history through yfinance and applies the original six-pillar weights, thresholds, coverage rules and caps. If the provider cannot supply a usable analysis, available statements and ratios remain accessible through the existing Screener.in / Yahoo Finance fallback. Searchability does not guarantee provider coverage. Missing fields remain unavailable. Statement-only companies display NO CALL and no numeric score; scoring weights have not been applied to them.

The original model is not reimplemented. Full-report values, periods and model calls come from the source snapshots, with their supplied dates. The source quote is a dated snapshot, not a live quote. Scores have not been backtested. Statement-only source and reporting periods are displayed separately. The on-demand Python function uses the existing Vercel project; no paid data service or scheduler was added. Results cache for fifteen minutes, with bounded warm-instance cache/concurrency and a 120-second function limit. Returned listing identity is checked before rendering or caching. Failed requests are not cached.

Upstream snapshot requests use a fixed origin, validated symbols, an eight-second timeout, request deduplication and a bounded fifteen-minute cache. Filenames follow the published convention, including M&M.NS → M_M.NS.json. A failed refresh can retain the last successful response with an explicit stale warning. A stale index cannot establish that a new symbol is unsupported. Normal responses use fifteen-minute CDN caching; stale responses use no-store.

## Validation

The complete suite passed 405 tests before the final quarterly-parser regression was added. All 14 focused Lodestar/company-research tests then passed, including the new regression. Checks cover original markup and stylesheet preservation, snapshot validation/caching, directory expansion, unscored fallback reports, period separation, EPS units, mobile navigation and shareable routes. Desktop and 390px mobile browser checks confirmed the original interface, company search, route synchronization, full and statement-only reports, the five-item tray and no console errors. The production build passed and was promoted to alphanova48.in. Hosted checks verified exact upstream CSS, frame policy and both data paths. Live desktop/mobile checks verified full and statement-only reports with no console errors. Release record: `docs/lodestar-original-deployment-2026-11-10.json`.

## On-demand scoring fix, 10 November 2026

The initial broader-directory implementation only showed statement data for companies outside the 219 published snapshots, leaving Tega unscored despite sufficient source data. The adapter now tries the original engine for every non-snapshot company (and on published-snapshot failure), then retains the existing statement-only fallback when genuine provider limitations prevent scoring. Tega verified locally at 50.9/100, HOLD, 88% coverage with all six pillars populated. The original model is unchanged.

Validation: 408 JavaScript tests, four Python endpoint tests and the production build passed. Tests cover on-demand routing, model-result preservation, listing mismatch rejection, invalid inputs, caching and failure without fabricated scores. Original stylesheet hash remains unchanged.

The endpoint lives in `api/lodestar/index.py`, with function-local `api/lodestar/requirements.txt`; `/api/lodestar` rewrites to it. This avoids including the separate Nifty Edge scipy dependencies in the Lodestar bundle. Local development: run `python -m uvicorn api.lodestar.index:app --host 127.0.0.1 --port 5189` in an environment with the function requirements and uvicorn installed; Vite proxies `/api/lodestar` to that port.

Unmodified upstream engine SHA-256: `4af4ec094d921034c8051ebea70639104618f8a545233710a0c92ffa1c13e4df`.

Hosted verification passed for TEGA and TEXINFRA; promoted and visually verified Tega with all six scores on production. Release record: `docs/lodestar-ondemand-deployment-2026-11-10.json`.
