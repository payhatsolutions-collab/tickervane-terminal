# Watchlist activation and return measurement

New visitors start with an empty watchlist and an optional animated guide. Save three real stocks, find the permanent Watchlist destination, then optionally create a price alert and enable notifications. Every example has a shareable chart link; Watchlist and Price alerts also have direct links. Skip persists, saved stocks remain, and Help or Watchlist can reopen the guide. Existing saved lists are preserved and existing users are not automatically enrolled. Reduced-motion preferences disable the guide animations.

Links to Watchlist open the current browser's saved list. They do not publish the list or transfer it across devices. Portfolio's backup/restore handles moving records.

## Events

Events use the existing Vercel Analytics integration. No stock symbols, target prices, watchlist contents, user identifiers, or full referrers are added as custom properties. Cohort dates are UTC.

| Event | Trigger and useful properties |
| --- | --- |
| `first_visit` | Once per browser at first measurement; `cohort`, `existing_user` |
| `visit_started` | New session after 30 minutes without a visible app visit; `cohort`, `existing_user` |
| `watchlist_stock_saved` / `watchlist_stock_removed` | Deliberate star action; `stock_count` |
| `watchlist_activated` | First time a new visitor has three distinct equity stocks saved (indices, FX, crypto and futures excluded); `cohort`, `activation_cohort`, `seconds_to_activation`, `stock_count` |
| `activated_return_within_7d` | Once on a later session within seven days of activation, inclusive; `cohort`, `activation_cohort`, `hours_since_activation` |
| `onboarding_started` / `onboarding_reopened` | User starts or reopens the guide |
| `onboarding_step_completed` | User advances; `step` is the destination |
| `onboarding_completed` | User finishes the optional guide |
| `onboarding_skipped` | User skips; `step`, `stock_count` |
| `watchlist_viewed` | User opens the Watchlist workspace; `stock_count` |
| `view_link_copied` | Clipboard copy succeeds; `page` |
| `price_alert_created` | A new, valid, nonduplicate alert is saved; `watchlisted`, `push_enabled` |
| `alert_notifications_enabled` | Permission granted / push subscription succeeds; `channel` |

## Funnel to review

In Vercel Web Analytics, review custom events (availability depends on the project's analytics plan). Confirm collection on a production deployment before relying on reports. Local development logs events to the browser console.

1. **Visits → activation:** for a `cohort`, divide `watchlist_activated` count by `first_visit` count filtered to `existing_user=false`. Also examine seconds to activation and where users skip.
2. **Activation → return:** for an `activation_cohort`, divide `activated_return_within_7d` count by `watchlist_activated` count. Allow the full seven-day window to mature before comparing cohorts.
3. **Alerts and revisit links:** compare alert creation, successful notification enablement, Watchlist opens, and copied return links alongside the funnel.

The primary conversion fires even when the guide is skipped and stocks are saved elsewhere in the app. Reloads, duplicate saves, StrictMode mounts, second tabs in the same session, and removing/readding stocks do not inflate conversion or return counts. A visible tab refreshes session activity once per minute; hidden tabs do not. Clearing browser storage resets measurement; it cannot identify returns across browsers or devices. These are aggregate custom-event cohorts, not an account-level analytics dashboard.
