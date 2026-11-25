# Public stock page deployment

AlphaNova serves stock profiles at `https://alphanova48.in/stocks/`. The `alphanova2` project's CDN rule “Public stock pages and SEO assets” rewrites requests on the apex domain to the `alphanova-stock-pages` project's production alias. This origin serves static HTML, stock preview images, the stock price guide, SEO stylesheet, site guide and sitemap. The terminal, APIs and schedules run on the main project.

## Refresh and release

1. Run `npm run build` in the repository to refresh the exchange snapshots and generate the site. Check the printed snapshot dates and coverage.
2. Run `node scripts/prepare-stock-deploy.mjs` and change into the temporary directory it prints. The packager selects public build outputs and writes the static project's Vercel configuration.
3. In that directory run `vercel link --yes --scope wdcre --project alphanova-stock-pages`. Confirm the linked project before deploying.
4. Run `vercel deploy --prod --scope wdcre --archive=tgz --local-config vercel.json` from that directory. The production alias updates the existing rewrite.
5. Inspect the deployment's function list and check the directory, alphabet navigation, a mainboard stock, an SME stock, an encoded ticker such as `/stocks/M%26M`, the sitemap and an unknown ticker on the apex domain. Verify each stock canonical uses the apex host.

Republish the static origin after stock-data, sitemap or stock-template changes. A main-project deployment alone leaves the CDN rule in force. If consolidating the pages back into the terminal deployment, verify its stock outputs first, then disable the project-level rule and publish that routing change.

## Release record

On 25 November 2026, static deployment `dpl_9j627e4S8pdEahFacxjAnCEQQkNk` served 3,238 indexable stock profiles. The deployed build reported zero functions. Production routing version `c87efccd-27c3-446a-b9a2-e2b68a56c249` enabled the rewrite. The production market API, charts, stock aliases and sitemap were verified after publication. The stock data in this release covers the 23 November 2026 session.
