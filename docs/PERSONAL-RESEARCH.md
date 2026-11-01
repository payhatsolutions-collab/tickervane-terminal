# Personalized alerts, analytics and breakout insights

Implemented 1 November 2026. No additional functions, paid APIs, dependencies or databases are required.

## Where to find the features

- **Price alerts → Personalized alerts:** up to 20 named rules for one NSE stock or the current NSE watchlist. Signals cover session change, RSI, volume ratio, relative strength and volume-confirmed 20-day breakouts. Numeric rules support upper/lower thresholds. Run once or once per matching session; pause, resume and delete rules. Matches remain in local history, with links to the stocks.
- **Discover → Advanced analytics:** Nifty 500/watchlist participation, industry concentration and medians; selected-stock period return, maximum drawdown, annualized volatility, Sharpe, beta and correlation versus Nifty 50. Select 3/6/12 months and export CSV.
- **Discover → Breakout insights:** confirmed breakout cards and individual stock research briefs. Overview breakout cards and breakout screener rows link here. The URL preserves the selected symbol, including after reload or Back/Forward. Briefs explain confirmation, relative strength, missing evidence and risks, and connect to the chart, watchlist and price-alert form.

## Data and persistence

Personalized rules use the existing cached `/api/market?op=screen` response. They evaluate on load and the existing five-minute visible-tab refresh. They do not use live quotes, closed-app push, or additional scheduled functions. Snapshots without a valid date, dated in the future, or more than four days after the dated session close are ignored. Each rule emits one event containing all matching stocks per snapshot session. Resuming a rule preserves same-session deduplication.

Rules are stored under `an2-personal-rules`; the latest 100 match events under `an2-personal-events` (20 displayed). Backup version 5 includes validated rules. Importing an older backup preserves existing personalized rules. Personal match history stays on the device and is not included in backups. Existing price alerts and push delivery remain separate.

Analytics requests adjusted history only for the selected stock and Nifty 50; no per-stock fan-out. It excludes today's exchange session. Risk statistics require 20 returns; beta and correlation require 20 matched date pairs. Zero-variance ratios and missing data display as unavailable. Sharpe assumes a zero risk-free rate and 252 sessions per year. This is historical analysis, not a backtest or prediction. Industry percentages count stocks, not invested capital.

Insight copy is deterministic from the provided snapshot; it does not invent news, forecasts, target prices or recommendations. Source and session date remain visible. Current chart history can cover a different date from the session screener snapshot; the two sources display their own dates.

## Vercel Hobby compatibility

- Static Vite pages at `/analytics` and `/breakouts`, with generated HTML and explicit rewrites.
- All new calculations run in the browser, reusing existing shared requests and CDN caching. No new storage writes, cron entries or server endpoints.
- `fluid: true` explicitly enables Fluid compute. Existing function durations (15–120 seconds) are within the current Hobby maximum of 300 seconds with Fluid compute.
- Existing two weekday evening cron entries each run at most once a day. Personalized rules do not depend on them. Hobby cannot support precise intraday scheduled alerts; the interface states that these rules require the app to be visible.
- Actual capacity still depends on traffic and account-wide function, transfer and Blob allowances. This implementation does not promise unlimited free usage. Existing push still needs its configured Blob/VAPID/cron credentials; the new features do not.

References checked 1 November 2026: [Cron usage and scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Function duration limits](https://vercel.com/docs/functions/limitations), [Fluid compute configuration](https://vercel.com/docs/fluid-compute).

## Verification

- Production Vite build and generated route metadata.
- Full Node suite: 369 tests passed, including added calculation, missing-data, stale-snapshot, threshold, deduplication, backup, route and component-render tests.
- Local browser with live feeds: breakout selection and research, adjusted-history analytics, personalized alert creation/matching, automatic one-time pause, persisted rule/history after reload, and mobile navigation/layout. Temporary QA alert and its history were removed after checking persistence.
- Deployed and promoted to https://alphanova48.in on 1 November 2026: `dpl_3zZcSLJoELJBjkP9n9m3XHRGyfXn`. Hosted build, new routes, screener feed, adjusted stock/benchmark history and live rendered breakout insight passed. Release evidence: `docs/personal-research-release-2026-11-01.json`.


## Company research update (1 November 2026)

Breakout insight pages now prioritize the company's business, financial statements and growth outlook. A compact desktop stock directory sits beside the brief; mobile uses a company selector. Eight compact financial metrics replace large technical cards. Financial history, breakout evidence and historical risk analytics are expandable; price-history requests start only when the risk section opens.

The existing fundamentals endpoint now prefers consolidated Screener.in statements for NSE companies and falls back to standalone, retaining Yahoo as a fallback when a complete statement is unavailable. It extracts revenue, net profit, operating profit, same-period margins, four financial periods, latest reported ROE, business description and company website. Figures in explicitly identified rupee crores are converted to base rupees; source basis, period, TTM end date where available and source links remain visible. Missing data stays unavailable. Concurrent company requests share one upstream lookup; existing caching is reused.

Growth commentary distinguishes reported year-over-year growth and margin trends from future business drivers and analyst estimates. Industry drivers are research prompts, not sourced company guidance or forecasts. Valuation describes the reported earnings multiple without asserting that a company is cheap or expensive. Company-specific management guidance is not invented. Source prices and the screener session close can differ.

Verified against live Coforge and Divi's Laboratories consolidated data, with mobile stock switching and no horizontal overflow at 390 pixels. Parser tests cover crore scaling, period alignment, negative income, empty cells, missing units and source metadata.

Published and verified on https://alphanova48.in: deployment `dpl_GiSDNqLCvByN6x7h2pDsf34kNcNR`. All 374 tests and the hosted build passed. Release evidence: `docs/company-research-release-2026-11-01.json`. Indian-company upstream retries are bounded so fallback work fits the existing 60-second function duration.
