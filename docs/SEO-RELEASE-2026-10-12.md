# Alpha Nova SEO release — 12 October 2026

Deployed and verified https://alphanova48.in from `/Users/sarda/Downloads/alphanova-terminal`, linked to Vercel `wdcre/alphanova2` (`prj_RxwC99g2zhlKUm3DZWf3NwfdF7ti`). The Git remote is `payhatsolutions-collab/tickervane-terminal`; Vercel currently has no Git integration. The checkout link, production deployment history and matching project domains establish this release target.

Production: https://alphanova2-fp805v2z9-wdcre.vercel.app (`dpl_5vkSCQXHD7Xy9DXUemCD5BdE6aP6`). Rollback: promote https://alphanova2-a32qgahr9-wdcre.vercel.app in the same project.

## Changes

- Shared metadata drives generated HTML and React headings. Homepage H1: “Alpha Nova: Indian Stock Market Overview”; title: “Alpha Nova | Indian Stock Market Overview & NSE Screener”. Screener, delivery, charts and institutional flows use the requested descriptive H1s. Other public headings were audited. Navigation labels remain short.
- The H1 stays visible while lazy-loaded workspaces load. Homepage copy includes Alpha Nova and AlphaNova; existing WebSite structured data retains the brand and alternate name, and WebPage metadata matches the page. No invented credentials, ratings, freshness or ranking claims.
- Watchlist, portfolio, journal and alerts store personal records through browser storage. Their raw HTML, rendered metadata and HTTP headers now use `noindex, follow`; navigation back to public pages restores indexable metadata. All four remain usable but are absent from the sitemap. Public feature and screener guides remain indexable.
- Sitemap now contains 23 unique public URLs, down from 27. No security settings or robots crawl access were weakened. The sitemap is valid XML and served with HTTP 200 and application/xml. A synthetic Googlebot user-agent request also succeeded; this is not evidence of a real Google crawl.
- Permanent www-to-HTTPS-apex redirect is deployed and preserves paths and queries through the host rule. www was added in Safari to this project's production environment; Vercel reports ownership verification required. DNS and TLS remain pending on the other PC.

## Verification

275 tests passed, 0 failures; production build and diff checks passed. The first isolated upload omitted `lib/` and failed before promotion; the corrected upload built successfully and was checked before promotion. The release source was copied from the authoritative checkout with unrelated loose files excluded. Its manifest matches the source. Production JavaScript exactly matches the locally tested `index-DMs0fVFY.js`.

Raw checks passed on all 27 pages (23 indexable and 4 personal), including canonical, social and structured metadata. All 13 workspaces were tested for rendered H1s and client navigation metadata in both indexing directions. All 27 pages were checked at 320px without page overflow. Hosted and live redirects returned 308 with query parameters preserved; missing paths returned genuine 404. The apex HTTP-to-HTTPS redirect preserves path and query. Safari verified staged pages and the live homepage, screener, delivery, charts, institutional flows and watchlist.

Evidence: `seo-release-verification-2026-10-12.json`, `seo-browser-verification-2026-10-12.json`, `seo-safari-live-verification-2026-10-12.json`, `seo-live-home-2026-10-12.jpg`, `seo-www-dns-2026-10-12.jpg`.

## Remaining work

www is not restored yet. Authoritative DNS is Namecheap (dns1/dns2.registrar-servers.com). Public DNS returned NXDOMAIN. Vercel says the domain is linked to another account and requires the TXT ownership record shown in the handoff. Valid TLS and the end-to-end www redirect must be checked after DNS propagation and Vercel verification.

Search Console's “Couldn't fetch” report remains unresolved. The existing accepted submission and successful live inspection are user-provided evidence. A one-day Vercel static-log query for sitemap.xml returned no records; log coverage/retention may limit what is observable. No permanent crawler block was inferred. No indexing requests or sitemap resubmissions were made. Do not repeat the four accepted indexing requests.

Unrelated changes were preserved; no commit was made. abovealphasolutions.com is not attached to this project and was not modified. SEO ranking gains have not been measured.
