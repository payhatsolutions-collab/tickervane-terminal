# Research-first release — 13 October 2026

Production: https://alphanova48.in
Deployment: https://alphanova2-2xri97mko-wdcre.vercel.app (`dpl_ALkuhgKX3NVuXRv2aVe7miQR2mGP`), Vercel `wdcre/alphanova2`.
Rollback target: https://alphanova2-fp805v2z9-wdcre.vercel.app.

## Changes

- The first visit opens research immediately. Existing welcome/unfinished guide state no longer inserts a guide above every workspace. The guide is explicitly opened from Watchlist or Help, is confined to Watchlist, and needs one saved stock to proceed.
- A successfully rendered chart offers a compact, dismissible save suggestion after the first pointer interaction. Saving one stock removes the suggestion. Chart refreshes and indicator changes do not count as new opens.
- The homepage has one primary action, “Find stocks to research,” leading to the screener. Search remains secondary. Competing quick actions were removed; the trading snapshot appears only when local INR delivery trades exist. Personal tools remain accessible through navigation.
- Mobile homepage search is labeled and visible, the ticker and introduction are compact, and the first stock card with its chart action fits above the bottom navigation at 360×740. Homepage code loads eagerly so the entry action does not wait for a separate workspace chunk.
- Vercel Speed Insights is installed with the current workspace route. Existing Web Analytics automatic pageview tracking is retained; no synthetic pageviews or timers were added to manipulate bounce rate.

## Measurement

| Event | Trigger |
| --- | --- |
| `research_cta_clicked` | Primary homepage action |
| `setup_filter_used` | Homepage setup filter selected |
| `chart_opened` | Chart successfully created with data; once per mounted stock view |
| `chart_interacted` | First pointer interaction with that rendered chart |
| `save_suggestion_dismissed` | Save suggestion dismissed |
| `chart_render_failed` | Chart error boundary catches a render failure |
| `screener_results_viewed` | Initial available screener results, including a zero-result count |
| `screener_used` | Changed screener controls with available data, after 500ms to settle input |
| `first_stock_saved` | First explicit newcomer stock-save action; persisted once |

Existing watchlist, guide, and three-stock `watchlist_activated` events remain. Historical activation and return definitions are preserved for comparison. Restoring an old watchlist does not backfill a first-save event. Search text, stock selections, custom screen names, trade records and financial amounts are not included in the new custom-event payloads.

Vercel's Hobby dashboard gates custom-event reporting behind Pro. The code emits events through the existing SDK, but cloud reporting requires a supported plan. No paid plan or new analytics provider was enabled. Speed Insights collection is confirmed: the final dashboard check showed 602 mobile events and a mobile Real Experience Score of 57 (needs improvement), with homepage 50 and markets 53; charts scored 94. These are the selected seven-day dashboard totals, not a controlled before/after comparison. They establish a starting point for further performance work, not proof of this release's impact.

Compare research use and first-stock saves with the same mobile/source mix after sufficient post-release traffic. Bounce is a single-page-session metric; homepage interactions can still count as bounces. No reduction in bounce rate has been measured yet.

## Verification

- 277 automated tests passed; production build and whitespace checks passed.
- Browser checks at 360, 390, 412 and 1440px; no homepage horizontal overflow at mobile widths. On the live 360×740 page, the first card bottom was 654px and bottom navigation began at 676px.
- Isolated local origin verified no automatic guide; chart interaction revealed the save prompt; saving hid it and emitted the first-stock milestone; the optional guide accepted one saved stock.
- Vercel development tracker received chart, screener and save events. Chart indicator changes did not duplicate chart-open events. Navigation produced one automatic pageview for each visited path.
- Staged homepage matched the tested `index-BB9Inoli.js` bundle, and the quote API returned data without errors before promotion.
- Live homepage matched that same bundle; live CTA opened `/screener`; Speed Insights route changed to `/screener`; the production performance script returned HTTP 200. No browser errors were observed during those checks.
- Live mobile screenshot: `bounce-mobile-live-2026-10-13.jpg`.

The initial staged upload omitted the existing `content/` dependency and failed before promotion. The corrected staged build passed and was promoted. Existing unrelated local changes were preserved; only application/build source was uploaded, excluding loose reports, media, and other projects. No commit was made.
