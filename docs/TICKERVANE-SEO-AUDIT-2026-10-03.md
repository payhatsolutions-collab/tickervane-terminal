# TickerVane search visibility audit

3 October 2026, IST. Website: https://tickervane.vercel.app/. Skills used: seo-audit, ai-seo and programmatic-seo.

## Main finding

The site was renamed from AlphaNova and moved to its current canonical address on 3 October 2026, according to the deployment record and README. Public checks found no obvious technical indexing block. The owner reports that Search Console has been submitted and says “in progress.” That wording does not establish the homepage's indexing status or an exclusion reason. The available browser session is not signed into Search Console, so its Page Indexing and URL Inspection reports were not accessed.

A direct Google search for `ticker vane` showed unrelated finance pages and an AI Overview interpreting the query as a stock ticker; TickerVane was absent from the visible first-page results. Search-provider spot checks for `tickervane` and `site:tickervane.vercel.app` also surfaced no relevant site results. These observations establish poor current brand visibility, not proof of a penalty or a complete index coverage count.

The working diagnosis is discovery/indexing and brand recognition following a same-day rename. A definitive diagnosis requires the exact URL Inspection status, last crawl date and Google-selected canonical. Google says crawling can take days to weeks, submission does not guarantee inclusion, and repeated requests do not accelerate crawling: https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl.

## Prioritized findings and actions

| Priority | Issue and evidence | Impact | Action |
|---|---|---|---|
| P1 | New canonical address and new brand launched today; owner reports processing in Search Console. Actual homepage indexing status unverified. | High: an unindexed page cannot rank for the brand. | Inspect the exact root URL, record the indexed status and selected canonical, and confirm the submitted sitemap reports Success and discovers 15 URLs. |
| P2 | “Ticker Vane” exists in WebSite/WebApplication alternateName but was absent from rendered visible homepage copy and the title. | Medium: weak consistency for the exact phrase the owner searches. It is not a diagnosed indexing block. | Add the alternate spelling naturally to the homepage title and overview, About heading and definition, and optional plain-text site guide. Keep the React title consistent after mounting. |
| P2 | Generated guide dates displayed 2 October while datetime and schema dateModified said 3 October. | Low to medium: inconsistent freshness information. | Derive the visible date from the maintained editorial date; keep build dates stable. |
| P2 | About page lacks a named owner, verified expertise, dedicated contact route and explicit policy links. | Medium: limited accountability for a finance research tool. | Add real owner/contact and privacy information when supplied. No credentials, registration, performance, authors or endorsements invented. |
| P3 | Old domain serves copies with canonicals pointing to the new domain. Old browser-local research still needs export access. | Medium migration consideration; no conflicting canonical found on sampled old pages. | Keep new URLs canonical. Plan redirects only after providing a safe export path for existing users; avoid removing access to device-local data during this SEO change. |

## Technical and on-page verification

All 15 URLs in the live sitemap returned HTTP 200 with matching canonicals, one static H1, and no observed meta or header noindex. robots.txt allows public crawling and excludes /api/; its sitemap points to the current domain. Sitemap XML is readable. Unknown pages return 404. /index.html returns a permanent 308 response. The broker callback stays outside the sitemap and has a local noindex tag.

The rendered homepage retains its readable overview and ordinary links to product pages, the guide hub, methodology and pricing after React mounts. Browser inspection confirmed WebSite, WebApplication and WebPage JSON-LD. The existing alternate names already include Ticker Vane. Its rendered H1 is “Your trading desk,” while the product overview names TickerVane; this is a modest branding improvement opportunity, not a reason to claim Google cannot read the page.

No field Core Web Vitals, traffic, backlinks, keyword volume, manual-action report or exhaustive accessibility audit was measured. The local build's main JavaScript is approximately 494 kB (146 kB gzip); this alone does not establish a performance failure. Static guides avoid loading the interactive application bundle.

Evidence: `tickervane-seo-live-check-2026-10-03.json` and `tickervane-seo-crawl-verification-2026-10-03.json`. The first captures the baseline before this task's changes; the second checks all sitemap pages and sampled old-domain canonicals.

## AI search assessment

Public definitions, pricing, methodology, worked examples and source links are already available without signing in or executing the application. /llms.txt and /pricing.md return their expected content types. The wildcard crawler policy allows search crawlers on public paths. Rendered structured data identifies the application and canonical site.

The existing implementation is an adequate discovery foundation. The improvements connect the spaced name to the product and explain the rename. Optional AI text files are navigation aids, not verified ranking factors or a substitute for indexing. Google's AI features require ordinary Search eligibility; no special AI file is required: https://developers.google.com/search/docs/appearance/ai-features.

No ChatGPT, Perplexity, Claude or Gemini citation rate was measured. The single observed Google AI Overview did not identify this product. Do not generalize that one run to every platform. Keep training crawler policy separate from search crawler access; no crawler-policy change was needed here.

After indexing, monitor these prompts: “What is TickerVane?”, “Is Ticker Vane free?”, “Where does TickerVane get stock data?”, “TickerVane Nifty 500 screener”, and “TickerVane delivery radar methodology.” Run each several times per platform and record the date, sample count, brand mention and cited URL. No monitoring automation was created.

## Programmatic SEO strategy

The existing pilot already contains six distinct guides linked through /screens.html. Each imports executable screening rules and adds a condition-specific definition, worked example, limitations, source links and a CTA to the matching preset. They are useful documentation rather than stock-name substitutions.

| Search intent | Existing page | Distinct value |
|---|---|---|
| Delivery accumulation screener | /screens/delivery-accumulation.html | Delivered-quantity baseline, delivery-share threshold and buyer-identity limits. |
| Volume surge stock screener | /screens/volume-surge.html | Total traded quantity versus prior-session volume and end-of-day limitations. |
| 20-day breakout stock screener | /screens/20-day-breakout.html | Close versus prior highs with volume confirmation. |
| Near 52-week high stock screener | /screens/near-52-week-high.html | Closing-price high reference and distance calculation. |
| Relative strength versus Nifty 50 | /screens/relative-strength.html | Benchmark return difference distinguished from RSI. |
| Minervini trend template screener | /screens/minervini-trend-template.html | Documented adaptation and composite-score substitution. |

Keep this 15-page cohort stable until Search Console supplies indexing and query evidence. The primary brand target remains the homepage; do not create competing TickerVane/Ticker Vane landing pages. Possible later expansion: a genuinely distinct pullback or golden-cross guide, with documented product rules and examples. Company profiles require reliable dated data, adequate history, useful company-specific context and maintainable coverage; do not generate thousands of thin ticker pages to solve this brand-indexing problem.

Measure guide indexing, impressions, relevant queries and whether people open the associated screen before expanding. No keyword-volume or competitor-ranking estimates are claimed.

## Changes and validation

Updated the homepage's static/social/schema page title and React runtime title to “TickerVane (Ticker Vane) | Indian Stock Screener”; added a natural alternate-name definition to the visible overview and About page; documented the rename and backup migration; updated the optional site guide; and derived guide display dates from the maintained editorial date.

Local build and focused SEO checks pass. All 178 existing tests pass with local-server access. The restricted full run stalled in the server tests and was stopped; the successful unrestricted run is the reported full-suite result. No new speculative tests were added for prose edits.

Publication details and final live verification are recorded in the README release note and `tickervane-seo-release-verification-2026-10-03.json` once complete. Google indexing and ranking remain externally controlled and unverified until URL Inspection confirms them.

## Owner follow-through

1. Confirm Sitemaps → /sitemap.xml says Success, rather than only submitted.
2. Inspect https://tickervane.vercel.app/ and record the exact status. If indexed, check Google-selected canonical and Performance queries for both name spellings. If discovered but not indexed, confirm internal discovery and allow processing time. If crawled but not indexed, inspect Google's rendered page and content/canonical decisions. If blocked, share the exact reported reason.
3. Inspect /about.html and /screens.html as representative public pages; use the sitemap for the remaining cohort.
4. Use the current name and canonical link on existing public profiles and genuine product announcements. No external posting or directory submissions were performed.
5. Recheck after processing has had time to complete. Repeated submission is not an acceleration mechanism.
