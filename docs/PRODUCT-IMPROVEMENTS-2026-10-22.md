# Alpha Nova product improvements — 22 October 2026

## Product assessment

Alpha Nova already has broad research coverage: charts, screening, delivery data, forecasts, alerts and a journal. The clearest opportunity in this review was to connect discovery, saving, returning and sharing into one easy workflow. These are hypotheses based on the code and browser experience, not conclusions from a retention study; production funnel data was not available in this review.

| Finding | Impact | Implemented response |
| --- | --- | --- |
| The overview presents the same discovery pitch to returning users | Saved research has little influence on the starting experience | Personalized headline, watchlist CTA and a market brief showing rising/falling counts and the three largest absolute session moves |
| Watchlist was inside mobile More | The main return destination takes extra navigation | Watchlist is now a primary mobile destination; Markets remains in More |
| A return link only opens the recipient's own browser-local list | Sharing does not transfer the research starting point | Selected-symbol sharing with a recipient preview, selective import, duplicate handling, capacity feedback and Undo |
| Large watchlists require scanning | Users cannot quickly find a company or prioritize movement | Company/symbol search and saved-order, alphabetical, gainers, decliners and absolute-move sorting |
| Signup automatically opens a modal after two minutes | It interrupted a watchlist task during browser testing | The timer now only highlights the header entry; registration opens on a deliberate click |
| The empty watchlist asked for three stocks while the guide required one | Inconsistent activation expectations | A consistent one-stock starting point and a direct search action |

The design keeps common actions prominent and optional details secondary, consistent with [Nielsen Norman Group's progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/).

## Sharing behavior and limits

Share stocks opens a selection dialog. Copy link and the browser's native share action use a clean `/watchlist` URL with a versioned fragment containing only symbols. Holdings, costs, journal notes, alerts, registration fields and unrelated query parameters are excluded. The fragment is not sent in HTTP requests, but anyone given the link can read its symbols. Links are snapshots, not synchronized or revocable shared workspaces.

Recipients see the selected symbols and company names before anything is saved. Existing records remain intact, unknown directory symbols are not imported, and the 40-instrument limit is enforced. Refreshing an incoming link preserves the preview. Opening another shared link in the same tab updates the preview. Imports can be undone. Custom social preview images and per-sender referral attribution are not included.

The market brief uses existing quotes with no additional data request. Counts exclude missing changes. The oldest timestamp is shown when known; mixed exchanges can reflect different sessions. These are session changes, not changes since the user's last visit. No missing values are filled with invented prices.

## Measure after release

Use the existing analytics integration. New events contain counts and coarse action names, never the selected symbols or private research records:

- `personal_brief_opened`: overview brief to Watchlist action.
- `watchlist_share_opened`: share selection dialog opened.
- `watchlist_share_copied`: clipboard copy actually succeeded.
- `watchlist_share_handoff`: the browser share promise resolved; this is not proof a recipient received it.
- `shared_watchlist_opened`: incoming preview, with count and valid/invalid flag.
- `shared_watchlist_saved`: number of newly saved symbols and overflow count.
- `signup_nudge_viewed`: optional header highlight. This replaces the timed modal impression and must not be compared as the same event.

Keep the existing `first_stock_saved`, `watchlist_activated` (historical three-stock milestone) and `activated_return_within_7d` events. A shared-stock import can reach the same activation milestones as a manual save.

Evaluate first-stock save rate and time, seven-day return after activation, and shared-preview-to-save conversion. Separate existing and new visitors where the existing event properties permit. Aggregate events do not establish unique sender-to-recipient attribution or prove viral growth. Verify production event ingestion before using results to make decisions.

## Next product priorities

1. **Validate the return habit.** Observe five first-time users discovering, saving and revisiting a stock. Review funnel drop-off before expanding onboarding again.
2. **Explain changes with evidence.** Bring relevant company news, delivery changes and triggered alerts into the personal brief with source dates. Validate coverage before making this the default daily experience.
3. **Make device continuity reliable.** If research loss or changing phones is a common complaint, introduce authenticated synchronization and clear restore controls. Current registration does not authenticate or sync users.
4. **Improve shared outputs based on actual use.** If stock-list sharing produces activated users, add optional named research collections and exportable chart cards with sources and timestamps. Public hosted previews require an explicit publishing/privacy design.

## Verification

- All 302 automated tests passed, including five new tests covering share validation, privacy boundaries, capacity, freshness and missing-value sorting.
- The production build and workspace HTML generation passed.
- Browser checks: existing-stock recognition, new-stock import, Undo, subset selection, successful clipboard copy, no-results recovery, decliner sorting and the compact navigation layout, using real quote data.
- The environment provides Node but no npm. A temporary runner outside the repository executed the existing package scripts verbatim for the test that invokes `npm run build`; no project scripts were changed.
- Native device share completion, narrow-phone hardware testing, production analytics ingestion and retention impact remain unverified.
- Published to https://alphanova48.in on 22 October 2026 after the user requested deployment. Vercel build and public page/asset checks passed. Release and rollback details: [release record](product-improvements-release-2026-10-22.json).
