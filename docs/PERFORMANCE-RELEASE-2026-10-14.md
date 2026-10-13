# Performance release — 14 October 2026

Deployed and verified on https://alphanova48.in.

- Deployment: https://alphanova2-besfggbhp-wdcre.vercel.app (`dpl_HXL1mfHVyrrEDRJaPvumbj81z67R`), Vercel `wdcre/alphanova2`.
- Rollback: promote https://alphanova2-2xri97mko-wdcre.vercel.app in the same project.
- Production bundle: `index-B7DciLUs.js`, matching the locally tested and staged build byte for byte.

## Delivered

Homepage and Markets now start their existing screener-data download from HTML, use smaller initial assets, reuse number formatters, and reserve loading space to reduce layout movement. Markets sections load independently. Secondary tools load with their workspaces. Features, market calculations, quote-refresh cadence and data-cache rules are preserved.

Initial compressed JavaScript and CSS together are about 15 KB smaller. Local mobile-viewport layout-shift samples improved substantially; this is not a claim about the post-release Vercel real-user score. Full implementation and measurement details are in `PERFORMANCE-2026-10-13.md`.

## Release checks

- 278 regression tests passed before release. The source manifest matched the tested checkout when staged; only application/build files were uploaded, excluding unrelated reports, images, other projects and agent files.
- Staged production deployment completed successfully. Authenticated Vercel checks verified homepage, Markets, the exact compiled application, two quote results without feed errors, and 499 screener records. The public domain remained on the old deployment until promotion.
- Promotion completed successfully; inspecting `alphanova48.in` resolved to the new deployment ID above.
- Live homepage and Markets returned the optimized bundle and exactly one screener preload per HTML document.
- Live 360×740 browser check: no page overflow; homepage first card ended at 654px, above navigation at 676px. Markets rendered all 60 heatmap tiles and its rotation chart. The 1M heatmap control and TCS table filter worked.
- Live homepage-to-chart navigation rendered seven chart canvases and the risk planner. No browser errors were observed in these checks. Existing analytics and Speed Insights scripts remained present.

Evidence: `performance-release-verification-2026-10-14.json`, `performance-home-live-2026-10-14.png`, `performance-markets-live-2026-10-14.png`.

No post-release field-score improvement is claimed yet. Evaluate fresh mobile LCP, INP and CLS samples for `/` and `/markets`, comparing similar visitors and devices.
