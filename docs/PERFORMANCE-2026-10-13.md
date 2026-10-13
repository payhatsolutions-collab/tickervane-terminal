# Homepage and Markets performance — 13 October 2026

Implemented and verified locally on 13 October; deployed to https://alphanova48.in on 14 October 2026. See `PERFORMANCE-RELEASE-2026-10-14.md`. The post-release Vercel real-user score has not yet been measured.

## Changes

- Load news, watchlist, onboarding, valuation and trade-planning code with their workspaces. Keep the homepage eager. Load onboarding and news styles with their components.
- Give Markets pulse and rotation independent loading boundaries so one module cannot delay mounting the other or hide the cross-asset monitor. Reserve viewport space for the pulse while its code loads.
- Preload the existing public screener feed from generated homepage and Markets HTML, allowing data transfer to overlap JavaScript loading. Other workspaces do not preload it. No new endpoint, cache lifetime, refresh interval, market calculation or data-freshness rule was introduced.
- Reuse number formatters and memoize search, market-table sorting and the heatmap's top-turnover selection. Preserve Indian number grouping, precision, missing-value handling and existing sorting/filtering behavior.
- Preserve the sparkline footprint before quotes arrive; reserve space for setup cards and heatmap tiles while loading; stabilize the VIX summary. The initial HTML reserves a viewport so its footer does not jump through the visible screen when React mounts.

## Build comparison

| Initial asset | Before | After | Before gzip | After gzip |
|---|---:|---:|---:|---:|
| JavaScript | 539,433 B | 497,690 B | 159,998 B | 146,760 B |
| CSS | 119,125 B | 106,717 B | 22,330 B | 20,433 B |

Initial JS/CSS transfer is approximately 15 KB smaller using gzip. Deferred features remain available on navigation. These are entry-asset measurements, not total bytes across every workspace.

## Verification

- All 278 regression tests passed, including market calculations, quote freshness, chart data, trade calculations, navigation, SEO and formatter output parity. Production build and whitespace check passed.
- Browser checks used isolated local origins and the same public market data. Homepage breakouts, pullbacks and delivery filters returned results; saving COFORGE persisted to the watchlist; its chart rendered and its risk planner and news loaded. Stock search and the optional guide worked. No browser errors were observed.
- Markets retained all 60 heatmap tiles, working period controls, rotation graph, cross-asset categories, filtering and descending change sorting.
- No horizontal page overflow at 360px and 1440px. At 360×740, the homepage first card ended at 654px; bottom navigation started at 676px.
- Each checked homepage/Markets load fetched the screener feed once; the preload was reused. Generated charts, screener and watchlist HTML do not preload it.
- Illustrative local mobile-viewport CLS samples improved from 0.166 to below 0.001 on the homepage and from 0.343 to below 0.001 on Markets. Tests used an unthrottled desktop browser and a public-data proxy with controlled response delay and cached responses. These are diagnostic samples, not a controlled field-performance comparison or a prediction of the production score.
- A 5,000-value formatter microbenchmark produced identical strings: 33–36ms previously versus about 1ms with reuse on this machine. This measures only formatting, not whole-page speed.

The comparison preserved the existing local work. The test proxy and measurement instrumentation live outside the project and are not part of the production build.

Evidence: `performance-verification-2026-10-13.json`, `performance-home-mobile-2026-10-13.png`, `performance-markets-mobile-2026-10-13.png`.

After deployment, compare mobile LCP, INP and CLS by route and release with comparable visitor/device samples. Do not infer production improvement from a single Lighthouse run or the aggregate Vercel score alone.
