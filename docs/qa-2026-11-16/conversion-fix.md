# Conversion funnel repair — 16 November 2026

The owner reported roughly 400 visitors, mostly from YouTube, with no new registrations or subscriptions. Traffic volume and source were supplied by the owner; no traffic analytics account was available to independently inspect visitor-level drop-off.

## Verified findings

- Production auth and Pro status returned configured and available. Google's sign-in button rendered in both the account dialog and Pro gate. A real OAuth completion and payment were not performed.
- The homepage's main action was app installation. Its account invitation focused on watchlist backup; the free Pro trial was inside locked workspaces.
- On mobile, the Pro gate placed its illustrative and stock-specific evidence before sign-in.
- The local user viewer read only `signups/`, omitting all Google accounts. The corrected loader reads 7 registration records: 4 legacy and 3 Google, with no unreadable records. These are records, not deduplicated people.
- Read-only Blob metadata showed no new legacy or Google account records on 16 November IST, one trial record uploaded that day, and no Pro account records uploaded that day. This does not establish whether the trial belonged to a visitor or the operator, and payment records are not bank-confirmed revenue.

## Changes

- The Setup watch panel is the homepage hero: title, Nifty pulse, the three setup filters and six names, with the market snapshot below it. The earlier marketing masthead is removed. On phones the panel uses the roomier spacing the owner chose (23px × 20px panel padding, 24px between sections).
- The homepage no longer shows the Setups / Watchlist / Alerts tabs, the watchlist and price-alert side panels, or the watchlist prompt. Both remain on their own pages. The trading snapshot still appears beside the hero on desktop for readers with journal trades.
- The Pro offer sits directly under the setup names (`src/SetupOffer.jsx`): one line of copy, the terms (no card or UPI, no automatic charge, ₹300 for 30 days only on continuing) and a **Try Pro free for 30 min** button that opens the Breakout insights gate for the top breakout. Subscribers and paused accounts see no offer; accounts that have used the trial see **Get Pro · ₹300**.
- Free account creation is named explicitly in the header and account dialog. Returning readers still use the same Google sign-in.
- Mobile checkout shows the sign-in/trial card before the illustrative evidence. Price, duration and no automatic charge remain visible.
- The Pro gate's offer card lists its three assurances, shows a two-step progress mark and uses Google's **Continue with Google** button. Payment help appears only once payment options are open. The sample preview shows its three figures as tiles, and the workspace list is a compact grid. On desktop the offer card stays in view while the evidence scrolls.
- The free-account dialog lists what an account gives: the 30-minute trial, watchlist backup, and no payment details.
- Mobile tab bar: the PRO mark sits on the icon's corner, so all five icons and labels share a baseline and the active pill is centred on its icon. The bar is 16px shorter.
- Added `signup_cta_clicked`, Google account prompt views, `google_signin_submitted`, `pro_cta_clicked`, and `pro_trial_submitted` / `pro_trial_started` / `pro_trial_failed` events to existing Vercel analytics. These contain no identity or payment-reference fields. Google sign-in completion includes returning users; use account creation records to count new signups.
- Local viewer now includes verified Google accounts and keeps them separate from legacy registrations, including when email addresses match.

## Validation

- All 450 repository tests passed with local socket access; the suite includes the production build and SEO checks.
- New loader regression tests cover both stores, pagination, unreadable records, identity separation, and exclusion of private auth fields.
- Local desktop and 375 × 812 mobile checks: visible trial CTA, price/terms, free-account action, CTA navigation to the Pro gate, Google button rendering, and sign-in above the preview on mobile.
- No real signup, trial or payment was created by this review.
- The running local viewer was restarted and its actual `/api/users` endpoint returned 7 records, including 3 Google accounts, with no unreadable records.

## Deployment packaging

Two staged deployments failed after the frontend build passed, while packaging generated Python bytecode. A clean-cache retry reproduced the missing-file error. The installed `@vercel/python` builder's `runPrefixCompileAndFill` removes and recreates the same `.vercel/python/pycache` directory for each function; both failures referenced files inside that directory. Disabling optional precompilation exposed the same issue with a native dependency inside the shared `.venv`: the second function's different requirements removed dependencies already referenced by the first function bundle.

A later attempt failed earlier still: Vercel's requirements parser rejects `-r` includes (`PYTHON_REQUIREMENTS_PARSE_ERROR`). `api/lodestar/requirements.txt` now repeats the root list line for line, so both functions install the same set and neither removes the other's files.

The underlying difference from the last successful build (16 November, 01:35 UTC) is the packaging mode. That build logged `enabling large functions (beta)` for both Python functions; the failed ones logged `optimizing dependencies`, the runtime-install path that broke at upload. The builder selects large-function packaging only when `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` is present at build time, and it is not a project environment variable. Deploy with:

`vercel deploy --prod --skip-domain --yes --build-env VERCEL_SUPPORT_LARGE_FUNCTIONS=1`

A staged build with that flag (`alphanova2-mhysn3gdy`) completed, the first since the morning. At the owner's instruction the final build was then deployed directly to the domain without a staging step, and checked live afterwards. Rollback: `vercel promote https://alphanova2-nq9g5vwy2-wdcre.vercel.app --yes`.

## Measurement

For the next comparable YouTube traffic cohort, compare homepage Pro clicks → gate views → Google sign-in submissions/completions → trial starts → payment submissions/held/unlocked events. New accounts and confirmed paid subscriptions must be checked against account creation timestamps and payment review respectively. These changes remove verified friction; improved conversion has not yet been measured.
