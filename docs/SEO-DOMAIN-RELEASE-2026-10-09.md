# Alpha Nova canonical domain correction

Published 9 October 2026 (IST). The preferred public website is now
https://alphanova48.in/. This supersedes the historical Tickervane canonical-domain
notes in README.md.

All 15 public pages use their corresponding alphanova48.in canonical URLs.
Website, application, page and breadcrumb structured data, social preview URLs,
sitemap, robots.txt, llms.txt and pricing.md use the same domain. The guide
generator and existing SEO regression checks were updated to preserve this on
future builds.

Public HTML pages and crawler documents on tickervane.vercel.app permanently
redirect to their matching new addresses. Query strings are preserved; index.html
redirects directly to the new homepage. These redirects are scoped to the old host.
API endpoints and static assets remain available on the old host for existing
clients. To export research stored on that origin, open
https://tickervane.vercel.app/?page=Portfolio and use Backup & restore. That recovery
page carries an X-Robots-Tag: noindex header. Import the backup on alphanova48.in;
browser storage and notification permissions do not transfer across origins.

abovealphasolutions.com was left unchanged, as requested.

## Verification

- Two SEO regression tests passed, including all 15 pages and generated metadata.
- Local and Vercel production builds passed. The application bundle is unchanged.
- All 15 staged pages passed metadata, structured data and link-domain checks.
- Live checks passed for 15 pages and 21 permanent redirects, including query
  preservation, robots/sitemap, backup access and its noindex header, old-host
  assets/API access, and a missing-page 404.
- The rendered live homepage retains the corrected canonical and WebSite URL.

Deployment: https://alphanova2-9al6egxk0-wdcre.vercel.app

Rollback: `npx --offline vercel promote https://alphanova2-oidisks74-wdcre.vercel.app --yes`

Detailed evidence: [verification JSON](seo-domain-verification-2026-10-09.json).
Search Console submission and Google's selected canonical/indexing remain
unverified. Submit https://alphanova48.in/sitemap.xml in Search Console and inspect
the homepage after Google's next crawl.
