# Alpha Nova Terminal

A personal research terminal for Indian and global markets. Built with React, Vite and TradingView Lightweight Charts. Market data comes from public Yahoo Finance endpoints; Indian news falls back to Google News RSS.

## Features

- Search the existing NSE company directory and a curated global instrument universe.
- Actual OHLCV history, eight timeframes, candlestick/area charts, pan/zoom, EMA 20/50, Bollinger bands, RSI and volume.
- Responsive research workspace with desktop sidebar navigation, a watchlist beside the chart, and touch-friendly mobile navigation. The full watchlist sits immediately after the chart on phones.
- Context-aware company search for News and instrument selection inside position/alert forms; keyboard search, sortable tables, filter reset, and undo for watchlist, holding, and alert removals.
- **Delivery radar** (NSE): every liquid EQ stock's delivered quantity and delivery % versus its own 20-session average, classified as accumulation, distribution, high conviction or spike, with close location, volume ratio and a 10-session delivery strip. Company insights show delivery for any NSE stock.
- **Nifty 500 screener**: 1-year momentum, relative strength vs Nifty 50, RSI, 50/200-DMA trend, 52-week-high distance, volatility, volume surge and delivery, plus a 0–100 composite score. Candlestick snapshots beside each stock name with 1M/3M/1Y periods and an enlarged preview inside the screener, ten presets, a custom rule builder, industry filter, CSV export and up to five saved screens. Global instruments remain in Markets; the duplicate quick screen was removed.
- Sortable cross-asset monitor, CSV exports and company headlines. SEC filings and material events rank above generic price pages.
- Browser-local holdings grouped by currency.
- **Web Push**: price alerts, a daily delivery-radar digest (watchlist spikes + top Nifty 500 accumulation) and new matches for saved screens reach the device with the app closed. iPhone/iPad need the app added to the Home Screen first. In-tab checks every 5 minutes continue as a fallback, with 24h deduplication and a delivery history.
- Backup & restore (Portfolio → Backup & restore): export/import watchlists, holdings, alerts and history as JSON, with recovery guidance. No brokerage, orders or cloud account required.
- Daily trend bias uses a separate one-year daily feed, excludes the current exchange date, and stays consistent across chart ranges. Bullish/bearish labels describe trend, not trade recommendations.
- Watchlist rows show Bullish/Mixed/Bearish technical signals with expandable indicator readings, plus real 1M/3M/1Y candlestick previews that open into larger charts. Signals and candles share one daily feed per instrument, including global tickers; visible rows load with at most three concurrent requests and follow the market refresh cycle.
- No generated prices or fabricated fallback history. Sources and timestamps are visible; unavailable data stays unavailable.

## Trader workflow (2.1)

- Cash-equity risk planner: long/short scenarios, capital cap, whole-share sizing, stop/target, round-trip costs, reward/risk, and required setup notes. Drafts persist per symbol. No orders are sent.
- Trade journal: planned/open/closed/cancelled states, whole-position manual exits, actual costs, net realized P&L, win rate, average R and aggregate original open risk, grouped by currency. CSV and version-4 JSON backups include journal entries. Older backups leave an existing journal intact.
- Daily levels: prior high/low/close, 20-session extremes and Wilder ATR(14), excluding the current date in the exchange timezone. Prior H/L and draft entry/stop/target can be shown on the chart.
- Removed duplicate watchlist strip, repeated technical panel and global quick screen. Marketing content is available on the public information pages instead of below each workspace.
- Company headlines are filtered for company/ticker relevance before event ranking. Yahoo failures can use RSS fallback.

Limitations: cash equities only; no contract multipliers or leverage sizing, partial exits, broker fills or tax accounting. Open risk is the original plan, not guaranteed maximum loss or live stop exposure. Quote/alert timing is unsuitable for execution-critical use. Short plans do not verify borrow eligibility. Current-day bars remain excluded even after the session closes until the exchange date changes.

## Trader workflow (2.2)

- **Market pulse** (Markets): India VIX with regime read and implied 1σ Nifty day move, Nifty 500 advance/decline, % above 50/200 DMA, stocks at 52-week highs/lows, 15 sector indices ranked by 1D with 5D, broad-market indices, Nifty 500 top movers (turnover ≥ ₹5 Cr, with volume × and delivery %), and global cues (S&P, Nasdaq, Nikkei, Brent, USD/INR, US 10Y, gold).
- **Auto Indian charges** in the planner: Delivery (CNC) or Intraday (MIS) — STT, stamp duty, NSE transaction, SEBI fee, GST, DP charge and per-order brokerage (intraday capped at 0.03%). Size is the largest whole-share quantity whose loss at the stop *including charges* fits the risk budget; reward/risk is net of charges. Manual costs remain for other markets.
- **Quick-fill** stop (1× / 1.5× ATR, prior low/high, 20-session extreme, S1/R1) and target (1.5R / 2R / 3R, 20-session extreme, R1/S1), rounded to the ₹0.05 tick.
- **Pivots & CPR** for the next session in daily levels (S2–R2, BC/TC, CPR width label); P/R1/S1 drawn with Key levels. **Session VWAP** on 1D/5D charts.
- **Journal edge stats** in R: expectancy, win rate, profit factor, average win/loss, total R, max drawdown, worst losing streak, and a per-setup breakdown. Plans carry product and setup tags; exit costs auto-calculate from the exit price.
- NSE session status (pre-open / open / closed, IST clock; holidays not tracked), keys 1–8 switch chart range, ticker shows India VIX and Brent instead of Bitcoin and gold. Removed the sidebar info card, placeholder avatar, page subtitles and the duplicate regime line.

## Run

### Broker handoffs

Terminal → risk planner → Continue with your broker supports NSE directory stocks with valid Delivery/Intraday plans. Zerodha can receive a prefilled LIMIT entry basket. Groww and ICICI Direct currently provide copyable tickets and official website links for manual order entry; these are not account connections or order APIs. Short plans require Intraday. Stops/targets are planning references, never transmitted as protective orders. Journal status never changes from a handoff or callback.

To enable Zerodha prefilling, create a Kite Publisher app and set its registered redirect URL to `https://<your-domain>/broker-return.html`. Set `VITE_KITE_PUBLISHER_KEY` to the app's public Publisher key in the build environment, then rebuild. Do not put a secret, access token or broker password in any `VITE_` variable. With no key, Zerodha also uses manual handoff. The dedicated return page discards callback parameters and asks users to verify Kite's order book; it does not authenticate or infer fills.

Implementation uses Zerodha's recommended [offsite form POST](https://kite.trade/docs/connect/v3/basket/) without third-party JavaScript or embedded login. Production CSP permits form submission only to self and Kite. Before release, validate the configured app's login/return flow on desktop and mobile without submitting a live trade. Live order execution has not been tested. Groww/ICICI account sync and prefilled execution remain dependent on supported broker integration access.

`npm ci`, then `npm run dev`. The Vite development server includes the same market API used in production. `npm test` checks normalization, input validation, RSS safety and indicator edge cases. `npm run build` produces the static frontend.

## Vercel Hobby architecture

Two Node serverless functions (`api/market.js`, `api/push.js`) in `bom1`, a static frontend, and only free Hobby features.

- **Market data**: Yahoo chart/spark endpoints, NSE's security-wise delivery bhavcopy (`sec_bhavdata_full_DDMMYYYY.csv`, last 21 sessions) and the official Nifty 500 list. Everything is cached per instance and at the edge (quotes 5 min, screener 15 min, delivery 30 min with 6 h stale-while-revalidate), reducing repeated upstream work. Cache hits still count toward CDN requests and transfer; cold-instance latency depends on upstream availability.
- **Push storage**: one private Vercel Blob file per subscribed device (`push/subs/<sha256(endpoint)>.json`) holding the subscription, alerts, watchlist, saved screens and a short delivery log. Endpoints are restricted to real browser push services; updates require the subscription's auth secret.
- **Scheduling**: two weekday cron jobs at 14:00 and 16:00 UTC (19:30–20:30 and 21:30–22:30 IST execution windows on Hobby), authenticated with `CRON_SECRET`. Closed-app price checks and daily digests run in these evening windows; active tabs continue checking prices every five minutes. Browser subscription sync runs on preference changes and entry to Alerts, not every market refresh.
- **Env vars** (already set on the project): `BLOB_READ_WRITE_TOKEN` (from the linked `alphanova-push` store), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`; optional `VAPID_SUBJECT`. Without them push reports "not configured" and everything else keeps working.

Free public providers can delay, throttle or withdraw service. Browser storage stays device-local; use Portfolio → Backup & restore for JSON export/import.

## Deployment

Linked to existing Vercel project `alphanova2`, which owns `alphanova48.in`. Deploy a staged production build with `vercel deploy --prod --skip-domain`, inspect it, then use `vercel promote <deployment-url>` to switch the domain. Never deploy the parent Downloads directory. Version 2.3 is `alphanova2-k1v2abdtn-wdcre.vercel.app` (`dpl_2D3E2kksHXnX9CWy3LN3KtLDM5Wm`); version 2.2 `alphanova2-1u0pxhny1-wdcre.vercel.app` is retained for rollback (`vercel promote <url>`).

## Attribution

TradingView Lightweight Charts™ — Copyright (c) 2025 TradingView, Inc. https://www.tradingview.com/
Market data: Yahoo Finance. Headlines link to the source publisher, directly or via Google News. This app is not affiliated with Bloomberg, Yahoo, Google or TradingView. It is for research, not investment advice.

## Data workspace (2.3)

- Larger chart area, compact headings, clickable watchlist and 60-stock market heatmaps (1D/1M/3M). Equal-size tiles ranked by average turnover; no extra API calls.
- Completed-daily return bars and 15-session delivery/volume charts reuse loaded feeds.
- Planner, daily levels and company descriptions are expandable. Screener, Markets and Delivery load on demand.
- Terminal-only feeds pause on other workspaces. Shared benchmarks use stable quote batches; failed quote refreshes retain previous values with a warning.
- Two evening push jobs replace 30 schedules to reduce private Blob reads. Actual free-plan capacity still depends on subscriptions and other account usage.

## Search discovery (2026-10-01)

- Homepage metadata and WebSite alternate names connect AlphaNova, Alpha Nova and AlphaNova Terminal. The Today and Terminal views retain the descriptive stock-market title after React loads.
- Visible HTML overview and ordinary links connect six indexable pages. `/stock-prices.html` explains quotes and opens NSE charts; `/stock-market-app.html` covers features, installation, storage and broker handoffs. All information pages have self-canonicals, social metadata and WebPage/BreadcrumbList JSON-LD.
- `/sitemap.xml` lists canonical URLs only; `/robots.txt` references it. Keep `lastmod` tied to actual content changes. `/index.html` permanently redirects to `/`. The broker callback remains noindex.
- Verified production deployment: `https://alphanova2-1p2n7ori3-wdcre.vercel.app` (`dpl_4aw6U8HVUhT8EKRKv6AKePpN36Zf`), promoted to `alphanova48.in`. Build and 164 existing tests passed; checked rendered desktop/mobile pages, stock shortcut navigation, JSON-LD, canonical URLs and live responses.
- Search Console submission and Google indexing are not verified. A property owner can submit `https://alphanova48.in/sitemap.xml` and request indexing for the homepage and new pages. Track queries for Alpha Nova, AlphaNova, Indian stock prices and stock market app. Deployment does not guarantee indexing or rankings.

## Derivatives, flows and valuation (2.4)

Brought over from the previous AlphaNova release (5alpha), rebuilt on free NSE archive files so it stays within Vercel Hobby: no new functions (all ops live in `api/market.js`), no new storage, no paid APIs, and every response is CDN-cached.

- **F&O workspace**: end-of-day option chain for every F&O underlying and expiry from NSE's F&O bhavcopy zip (`BhavCopy_NSE_FO_…csv.zip`, unzipped with `node:zlib`): OI, OI change, volume and close per strike in contracts, ITM shading, PCR (total and today's additions), max pain, call/put OI walls and the ATM straddle-implied move. Futures OI build-up (long build-up / short build-up / short covering / long unwinding) with OI summed across expiries so rollover nets out, plus basis and OI value. `op=options&symbol=&expiry=`, `op=futures`.
- **Flows workspace**: FII/DII cash-market flows (NSE JSON API, best-effort — shown as unavailable if NSE refuses the server), participant-wise derivatives OI for FII/DII/Pro/Client with day-on-day change, and latest-session bulk and block deals with watchlist highlights and CSV export. `op=flows`, `op=deals`.
- **Sector rotation** (Markets): RRG-style chart of 15 NSE sector indices plus Midcap/Smallcap/Capital goods versus Nifty 50 from 26 weekly snapshots of NSE's `ind_close_all` archive (Yahoo no longer carries history for most sector indices). **Index valuation**: NSE-published P/E, P/B and dividend yield with P/E placed in its 26-week range. `op=rotation`.
- **Fair value** (Research → Company insights): two-stage earnings DCF and reverse DCF (growth implied by the price), defaults from trailing EPS and reported growth; runs entirely in the browser.
- **Minervini trend template** screener preset (price > 50 > 150 > 200 DMA, rising 200 DMA, ≥30% off the low, within 25% of the high, score ≥ 70).
- "Options" shortcut from Company insights opens the stock's chain.

Not carried over, because they need paid or stateful infrastructure beyond Hobby/free tiers or produced unverifiable output: accounts/cloud watchlists (SQLite + Blob), Gemini AI commentary, ML signal models, ARIMA/FLCL forecasts, prediction leaderboard, paper-trading game and share-card images.

Deployed 2026-10-02: `https://alphanova2-ewl6mfi0w-wdcre.vercel.app` (`dpl_89amPoceyf5sLgHvG2BJHdEnQ1x8`), promoted to `alphanova48.in` after checking every new op from Vercel (`bom1`), including FII/DII cash. Roll back with `vercel promote https://alphanova2-1p2n7ori3-wdcre.vercel.app`.

## Search guides and AI discovery (2026-10-02)

- Six curated static screener guides under `/screens/`, with a `/screens.html` hub, `/methodology.html` and `/pricing.html`. `/llms.txt` and `/pricing.md` summarize public product information.
- `npm run seo:generate` builds these from `content/seo/screens.mjs` and the actual rules in `src/screens.js`; `npm run build` runs it automatically. Edit the source content, not generated HTML. Review prose and update the fixed content date when rules change; build time must not become sitemap `lastmod`.
- `/?page=Screener&screen=<preset-id>` selects a validated built-in preset. The selected preset follows screener URL updates; custom rules are not imported from URLs.
- Sitemap contains 15 canonical HTML URLs; guides link through the homepage and existing overview pages. Tests verify rules, links, metadata and structured data. No new paid service, function, scheduled task or external API was added.
- Full audit, keyword mapping, scale-up gates and unverified measurements: `docs/SEO-AUDIT-2026-10-02.md`. Deployed and promoted to `alphanova48.in` on 2026-10-02.

SEO release: `https://alphanova2-b5p9523a6-wdcre.vercel.app` (`dpl_FJPVxsPtW53fLcd2qLQXnFEV3Jb3`). Verified all 15 canonical pages, sitemap, robots, AI text files, missing-page 404 and rendered guide-to-preset navigation on production. Verification: `docs/seo-production-verification-2026-10-02.json`. Previous live deployment for rollback: `https://alphanova2-huhp957vj-wdcre.vercel.app` (`dpl_HtTsQZZWED3GT5bkaa1f4156XiDC`). Search Console submission remains unverified.

## TickerVane rebrand (2026-10-03)

The current product name is TickerVane Terminal, with https://tickervane.vercel.app as its canonical public address. The existing Vercel project and storage identifiers stay unchanged. Historical release notes below the title retain their original names and deployment URLs. Browser storage keys remain compatible on the old origin; moving to the new origin requires Portfolio → Backup & restore export/import. Earlier AlphaNova backup files remain supported. Enable browser/push permissions again on the new origin. Existing contact email addresses remain unchanged.

Deployment: `https://alphanova2-m6xt8gsni-wdcre.vercel.app` (`dpl_6UtmPe1eKhYRTGSSsMKQc7tP4tz8`), promoted to production. `tickervane.vercel.app` is registered as a project production domain; future production releases should keep it updated. The old domain remains accessible for exporting existing browser data. Build and 178 tests passed. Verification: `docs/tickervane-deployment-verification-2026-10-03.json`. Previous production release: `dpl_FJPVxsPtW53fLcd2qLQXnFEV3Jb3`.

## TickerVane brand search audit (2026-10-03)

Audited all 15 canonical pages and the rendered homepage with seo-audit, ai-seo and programmatic-seo. No public crawlability block was found. The owner reports Search Console submission is in progress; actual indexing remains unverified. Added “Ticker Vane” naturally to homepage metadata and visible copy, About copy and the optional site guide, documented the AlphaNova rename, and fixed generated guide display dates. The six existing screener guides remain the bounded programmatic SEO pilot; expand only after indexing and query evidence.

Built, tested (178 passing tests), staged and promoted `https://alphanova2-8vl5ovds1-wdcre.vercel.app` (`dpl_9tPAR3D6ZNJWbnQfvw25DRR73843`). Verified the public TickerVane domain and rendered runtime title after promotion. Audit: `docs/TICKERVANE-SEO-AUDIT-2026-10-03.md`; release verification: `docs/tickervane-seo-release-verification-2026-10-03.json`. Rollback release: `https://alphanova2-m6xt8gsni-wdcre.vercel.app`.

## Alpha Nova name and Forecast restoration (2026-10-03)

The current app is named **Alpha Nova Terminal** again. The name, install metadata,
notifications, public guides and original Alpha Nova icons have been restored.
The configured hosting address remains unchanged; device-local storage keys and
backup imports remain compatible.

**Forecast** restores the original `5alpha/lite` tab using its existing browser-side
random-walk model: 5/10/20/30-weekday horizons, historical candles, projected median,
95% model interval, holdout MAPE, method details, daily values and CSV export.
Find an instrument while in Forecast to keep that workspace open, or use the
Forecast shortcut in Company insights. Links preserve `page=Forecast`, `symbol`
and `horizon`. One year of Yahoo adjusted daily candles comes through the existing
market function with `op=chart&range=1y&adjusted=1`; the current exchange date is
excluded. Missing adjusted history produces an error instead of a raw-price
substitute. Weekend dates are excluded, exchange holidays are not. This is the
original Lite method, not the full application's SARIMAX model.

Published the Alpha Nova name and original Forecast restoration on 3 October 2026:
`https://alphanova2-cykpknnvk-wdcre.vercel.app`
(`dpl_Go86n9h5BoxMfs8ndc4QqS4s632y`), promoted to production. Verified
Alpha Nova branding across all 15 canonical pages, the install manifest,
the Forecast bundle and its adjusted Yahoo history, and the rendered live
Forecast workspace. Both `tickervane.vercel.app` and `alphanova48.in` serve the
release. Verification: `docs/alpha-nova-forecast-deployment-2026-10-03.json`.
Rollback: `vercel promote https://alphanova2-8vl5ovds1-wdcre.vercel.app`.

## Founder search visibility (2026-10-04)

The public homepage and About page now identify Yash Sarda as AlphaNova's founder and link to his public professional bio. Both include the same Person identifier and exact LinkedIn URL; the About title and description include his name. The sitemap records the changed page dates, and the existing llms.txt adds factual founder links. The established Tickervane canonical URLs and market application behavior are preserved.

The two existing SEO tests and production build passed. Live HTML checks passed on tickervane.vercel.app (homepage and About) and alphanova48.in (About). Promoted production: https://alphanova2-dvesaep0r-wdcre.vercel.app (`dpl_3MJzdvHXU8AtMCNKU4NqdE2JUxm5`). Prior production for rollback: https://alphanova2-cykpknnvk-wdcre.vercel.app (`dpl_Go86n9h5BoxMfs8ndc4QqS4s632y`).

## Readability and navigation release (2026-10-04, 2.5)

- Replaced the large swing-workflow introduction and repeated instructions with a compact overview, three quick actions, setup filters, a clickable watchlist and a trading snapshot. Screen rules, metric explanations and public research guides are expandable.
- Desktop navigation keeps readable labels and groups the twelve workspaces under Workspace, Discover and Personal. Phones use four primary destinations and a native, keyboard-accessible More dialog for all workspaces. Larger controls and clearer type improve readability throughout the app.
- Browser Back/Forward and the in-app Back button now restore workspace, instrument, range and screener controls. Deep links and existing device-local storage keys remain compatible. Search includes Futures & options and Institutional flows.
- The planner shows its core fields first; fees, risk assumptions and broker handoffs are expandable. Alert text correctly describes two weekday evening background checks instead of hourly checks.
- Fixed previous-instrument data appearing during feed changes, stale chart hover readings, chart-error recovery when changing instrument/range, sorting missing values, unsafe CSV text cells, invalid saved-value types and the journal CSV Setup/Notes columns.
- Validation: 185 tests passed and the production build passed. Checked desktop and phone layouts, mobile More, Forecast instrument search, chart loading, browser Back/Forward, and screener-to-research return with its filter preserved. Staged HTML, quotes, screener (499 rows) and adjusted Forecast history (251 bars) returned HTTP 200. Verified both public domains serve the new asset bundle after promotion; the live screener and Forecast rendered real market data.

Production: https://alphanova2-myzc1550p-wdcre.vercel.app (`dpl_8qRgG6rq1Ae2XjZqwqfqiXCAQsHL`), promoted to the existing project domains, including https://alphanova48.in and https://tickervane.vercel.app. Prior production for rollback: `vercel promote https://alphanova2-dvesaep0r-wdcre.vercel.app --yes`. Release record and screenshots are in `docs/ux-release-verification-2026-10-04.json` and `docs/ux-*-live-2026-10-04.jpg`.

## Screener candlestick snapshots (2026-10-04)

Stock names now have real OHLC candlestick thumbnails. The 1M and 3M views show daily candles; 1Y groups actual daily bars into calendar-week OHLC candles for readability. Clicking a thumbnail opens a larger chart within the screener with period controls, dates, range and source. History loads as rows enter view, with three concurrent requests and the existing client cache. Missing data has a retry control.

Deployed and promoted `https://alphanova2-dxg7j9snk-wdcre.vercel.app` (`dpl_7BZQBzr226AZuGvdFkmrGstmBsjY`). All 188 tests and local/Vercel builds passed. Both existing public domains serve `index-BhqfI7s1.js`; live daily OHLC and rendered thumbnails/enlarged preview were verified. Release record: `docs/screener-candles-release-2026-10-04.json`. Prior production for rollback: `vercel promote https://alphanova2-myzc1550p-wdcre.vercel.app --yes`.

## Voice feature rollback (2026-10-04)

Removed the website Jarvis voice/text agent at the user’s request after ElevenLabs credits ran out. Restored the preceding screener release: https://alphanova2-dxg7j9snk-wdcre.vercel.app. The website agent is archived with zero conversation limits; the website’s Vercel ElevenLabs secrets were removed. The desktop Jarvis credential is unchanged. Integration source and pre-removal files are preserved in `outputs/voice-feature-rollback-2026-10-04/` and excluded from deployments.

### Theme switch · 2026-10-05

Added a saved dark/light appearance switch at the bottom of the desktop sidebar and mobile More menu. Charts update their appearance without resetting the view. The startup script loads from the same origin to comply with the production CSP.

Deployed and promoted `https://alphanova2-q70sbjg6k-wdcre.vercel.app` (`dpl_FqyYeHzgZu61CLe4Eg1qjqzSZp13`). Build and all 188 tests passed. Both public domains serve the new bundle; live light-mode switching and persistence after reload were verified without browser errors. Release record: `docs/theme-release-verification-2026-10-05.json`. Rollback: `vercel promote https://alphanova2-dxg7j9snk-wdcre.vercel.app --yes`.


### Watchlist activation and return flow — 2026-10-05

Added optional animated first-visit guidance to save three stocks, revisit a permanent Watchlist workspace, and create relevant price alerts. The guide can be skipped and reopened; existing records are preserved. Demonstrations use direct shareable views. Newcomer activation and seven-day return events use the existing Vercel Analytics integration. Funnel definitions: `docs/WATCHLIST-ACTIVATION.md`.

Deployed and promoted `https://alphanova2-7vct8ner7-wdcre.vercel.app` (`dpl_Caa1AFartb82rQU6o841BUc77D4Q`). Production build and all 195 tests passed. Both public domains serve `index-BSX65KTm.js`; the live Watchlist shortcut and guide were verified with no browser errors. The analytics script returns 200 on both domains; analytics dashboard ingestion and future return rates are not yet verified. Release record: `docs/watchlist-release-verification-2026-10-05.json`. Rollback: `vercel promote https://alphanova2-q70sbjg6k-wdcre.vercel.app --yes`.

## Watchlist technical signals (2026-10-05)

Watchlist rows now show the existing daily Bullish/Mixed/Bearish signal, score and expandable five-rule indicator breakdown. Real 1M/3M/1Y candle previews open into an enlarged chart with the instrument's currency. Signals use completed daily sessions independently of the preview period. Signals and candles share the daily feed, load visible rows with three concurrent requests, and refresh with the workspace.

Deployed and promoted `https://alphanova2-ma2ab75p2-wdcre.vercel.app` (`dpl_Hn374GkeJDvzwGcqCxVRRBg8YmCs`). Local and hosted builds passed, and all 197 tests passed. Both public domains serve the exact tested bundle, `index-EcHdXozl.js`. Indian and US daily feeds, signals and candle periods were verified on the staged deployment. Release record: `docs/watchlist-technicals-release-2026-10-05.json`. Rollback: `vercel promote https://alphanova2-7vct8ner7-wdcre.vercel.app --yes`.


### Backup screen restore fix — 2026-10-05

Backup imports now validate saved screens with the shared screen validator, preventing malformed rules from crashing the Screener. Valid rules retain their filtering behavior. The regression reproduces the crash before the fix and passes afterward.

Deployed and promoted `https://alphanova2-dd49y4k4b-wdcre.vercel.app` (`dpl_413cXCpVVT7wuzgLwc4As6GbiAxP`). All 199 tests and local/hosted builds passed. Both public domains serve the exact tested bundle, `index-BbkHmuP-.js`; the live Screener renders successfully. Release record: `docs/backup-restore-release-2026-10-05.json`. Rollback: `vercel promote https://alphanova2-i9x4b2y8a-wdcre.vercel.app --yes`.

## Forecast model v2 (2026-10-07)

Forecast requests five years of adjusted **daily** history (`daily=1` preserves weekly bars for ordinary long-range charts). A background worker compares a constant-volatility random walk, EWMA, and variance-targeted GARCH(1,1) with fixed Student-t(7) shocks, with or without shrunk drift. GARCH parameters use a bounded likelihood grid; this is deliberately a small candidate family, not an unrestricted optimizer.

Non-overlapping forecast targets are split chronologically: the first 60% select the model by weighted interval score, requiring a 5% improvement over baseline; the remaining 40% report untouched evaluation metrics. Each origin refits on prior data only. Fewer than eight tuning or five evaluation origins falls back to baseline without reporting accuracy. Evaluation paths number 512; current forecast paths number 4,096, seeded with antithetic pairs. The UI shows interval coverage, log-return error, Brier score, calibration bins, terminal threshold probabilities and 50/80/95% marginal prediction bands. Adjusted-price equivalents are not promised future quoted prices. Parameter/selection uncertainty is not included.

NSE 2026 dates follow [CMTR71775](https://nsearchives.nseindia.com/content/circulars/CMTR71775.pdf) and [CMTR72260](https://nsearchives.nseindia.com/content/circulars/CMTR72260.pdf), including the Muhurat session. Crypto uses calendar days; unsupported exchanges/years explicitly show estimated weekday dates. Calendars need maintenance as new exchange circulars appear.

Checks: `node --test tests/forecast.test.js tests/market.test.js tests/ux.test.js`. Model tests cover evaluation leakage, nested intervals, determinism, insufficient/invalid history, threshold probabilities, calendar behavior and daily-feed cache separation. A passing test suite validates implementation, not future predictive skill.


## Live NSE futures and options — 2026-10-07

The F&O tab now uses NSE's current `option-chain-contract-info` / `option-chain-v3` endpoints, with 30-second visible-tab refresh, a 15-second server cache, and no downstream caching. Option data includes exchange timestamps, selected expiry, LTP, IV, bid/ask and OI. Bullish / Bearish / Range is a transparent, unvalidated positioning heuristic; stale or incomplete data suppresses the signal. Outside regular hours the last-session read is explicitly dated. NSE futures contracts use `liveEquity-derivatives`; the broader OI build-up scanner remains labelled end-of-day.

All 225 tests and local/hosted builds passed. Promoted `https://alphanova2-oidisks74-wdcre.vercel.app` to both existing public domains, verified live endpoints and rendered UI. Release evidence: `docs/fno-release-verification-2026-10-07.json`. Rollback: `npx --yes vercel promote https://alphanova2-xh3fo97ta-wdcre.vercel.app --yes`.
