# Alpha Nova Pro unlock

Alpha Nova Pro offers a 30-minute free trial, then is ₹300 for 30 days, paid by UPI to the founder's static QR code (`public/pro/upi-qr.png`). It locks five workspaces: Forecast, Advanced analytics, Breakout insights, Futures & options and Institutional flows. Everything else stays free. Markets and Fundamentals were Pro until 17 November 2026; they were unlocked because they sit on the phone tab bar and new visitors met a paywall before seeing any research (65 visitors on 16 November, no sign-ins). Their paywall copy and sample charts are kept, so adding a name back to `PRO_PAGES` locks that workspace again. Price, period and the page list live in `lib/proPlan.js`. Without Pro, each of the five workspaces opens on one live example (see below); asking for anything beyond it opens the paywall, which has question-led copy and an illustrative preview.

## Free examples

Since 17 November 2026 a reader without Pro no longer meets the paywall first. Each locked workspace opens on one example with real data, with no account needed, under a strip that says what is free and what Pro adds (`src/ProExample.jsx`). In the three days before this change about 280 visits to a locked page led to no trials.

| Workspace | Free example | Opens the paywall |
| --- | --- | --- |
| Forecast | The 10-session range and trend what-if for Reliance | Any other ticker |
| Advanced analytics | Reliance's performance and risk, with the market view | Any other stock |
| Breakout insights | The full check for the session's top breakout | Every other breakout |
| Futures & options | The Nifty option chain at its nearest expiry | Other underlyings and expiries, live futures, OI build-up, export |
| Institutional flows | FII/DII cash and the five largest deals | Participant positioning, the full deal list, filters, watchlist matches, export |

The example stock, underlying and deal count are `PRO_EXAMPLE_SYMBOL`, `PRO_EXAMPLE_UNDERLYING` and `PRO_EXAMPLE_DEALS` in `lib/proPlan.js`; the rules are in `src/proExample.js`. The top breakout is the confirmed breakout with the highest average turnover, which is also the first name under **Top breakout buys** on the home page. On a session with no confirmed breakouts, or when the screen feed is unavailable, Breakout insights shows the paywall as before.

The paywall opens when the reader:

- selects the Pro button in the strip, or the Pro offer on the home page;
- chooses something beyond the example: another stock, underlying or expiry, a control marked **PRO**, or **See all deals**;
- searches for another ticker from the header while on Forecast;
- arrives on a link ending `?pro=1`, such as the install page's **Start my 3 free days**;
- has a payment reference being checked, so the "don't pay again" notice stays in front of them;
- is on a Pro workspace at the moment their trial or paid period ends.

The paywall links back with **See the free live example**, and the browser's Back button returns to the example. A reader who arrives asking for another stock, for example from a shared Forecast link, sees the example with a note that their stock needs Pro.

Controls that open the paywall carry a **PRO** mark. The strip's button follows the account: the 30-minute trial, the 3-day trial for readers with the app, or ₹300 once the trial is used. Accounts paused by support see no button.

Events (sent, but not stored on the current Vercel plan): `pro_example_viewed`, `pro_example_locked` with the control that was used, `pro_example_opened` from the paywall's link, and `pro_cta_clicked` with `source: example`.

## Free trial

New and existing Google accounts can select **Start 30-minute free trial** on the paywall of any Pro workspace. All five workspaces open immediately with no payment details and no automatic charge. The server records the start time once; signing out, switching devices or clearing browser storage does not reset it. The trial is available once per account. Active paid accounts keep their paid access; revoked accounts must contact support.

### Three days for readers who install the app

Installing the app earns a 3-day trial instead of 30 minutes. It is a thank-you, not an advertised offer: nothing on the home page, the paywall, the install page before installing, or the pricing pages mentions it. It appears only once the reader has the app:

- on `/install`, as a card with **Start my 3 free days**, as soon as the browser reports the install (it opens the paywall directly through `/breakouts?pro=1`);
- at the top of the home page inside the app (**Thanks for installing. 3 days of Pro, free**), and on the Setup watch button;
- on every Pro paywall, which then reads **Free for 3 days**, and on the strip above each free example.

A reader who already used or is still inside the 30-minute browser trial gets the 3 days too, counted from when they start it in the app. It is still once per account, needs Google sign-in, and is not offered on top of paid access. `PRO_APP_TRIAL_DAYS` in `lib/proPlan.js` sets the length.

How the app is recognised (`src/installState.js`): the page is running as the installed app, the browser has just reported the install in this tab, or this browser saw either of those before (remembered in `an2-app-installed-v1`, which Android and desktop Chrome share between the app and the browser). An iPhone home-screen app has its own storage, so the reader signs in again there. The page tells the server `{ "app": true }` when starting the trial. The server cannot verify that, so a technical reader could claim the 3 days without installing; like the rest of the lock, this is enforced in the interface.

The trial record stores `minutes: 4320` and `app: true`; a replaced browser trial keeps its original start as `browserStartedAt`. This is the one case where a trial record is rewritten. Status adds `appTrialEligible`.

`POST /api/pro?op=trial` requires a valid session, same-site origin and JSON, and is rate limited. Private `pro/trials/google-<sha256(sub)>.json` records are separate from payment records and create-only, apart from the app replacement above. Repeated starts return the same active trial; expired trials cannot restart. Status combines paid and trial access. An open browser tab relocks at expiry even if the status refresh fails. A payment during the trial adds 30 days after the remaining trial time.

## How a reader unlocks

1. Opens a Pro workspace, sees its free example, and selects the Pro button or anything beyond the example. The paywall (`src/ProGate.jsx`) then replaces the page.
2. Signs in with the Google button inside the paywall (it shares the header's sign-in client). Access is tied to Google's account identifier, so it follows the reader across devices.
3. Pays from a QR generated for their account, with ₹300 and a payment note such as `AN3F9A1C` already filled in. On a phone, a **Pay ₹300 in a UPI app** button opens the UPI app directly; the QR can also be saved as a PNG to scan from the gallery.
4. Pastes or types the 12-digit UPI reference number (UTR) on the same screen as the payment options. `POST /api/pro?op=claim` unlocks immediately for 30 days, unless the fraud checks below refuse or hold the reference.

The note is the first six hex characters of `sha256(Google subject)`, so it is stable per account and does not reveal who paid. The payee UPI ID lives only in `api/pro.js` (override with `PRO_UPI_ID`) and is sent only to signed-in readers inside their payment link.

Readers with a pending reference can check its status or correct a typo. Payment help is available by email or WhatsApp through the checkout and pricing page.

Some UPI apps decline pre-filled payments to a personal UPI ID. The paywall offers **Use the plain QR** (`public/pro/upi-qr.png`), where the reader types ₹300 and the note themselves. That image is a public file and encodes the same UPI ID, as any UPI QR must.

A static personal QR sends no payment confirmation, so for plausible references **access is granted before the payment is checked**, and the operator audits afterwards.

## Fraud checks on the reference

`utrRisk` in `lib/pro.js` sorts every submitted reference:

- **Refused** (400, nothing stored): one or two distinct digits, a repeat of 1–4 digits (`121212121212`), or a counting run of 10+ (`123456789012`, `987654321098`).
- **Held** (202, stored, no access): anything without a fresh UPI timestamp. Genuine references start `YDDDHH`: last digit of the year, day of the year and hour in IST. A reference is fresh when that stamp is between 72 hours ago and one hour ahead. A counting run of 7–9 digits is also held. The reader sees “We’re checking your payment” and can submit a corrected number, which replaces the held one and frees it.
- **Instant**: everything else unlocks immediately, as before.

Someone can still unlock without paying by inventing a reference in the right format. That takes deliberate effort, lasts only until the audit, and a revoke blocks the account.

Renewal is offered during the last 7 days and extends from the current expiry. There is no auto-renewal.

## Auditing payments

Run `npm run users` (or double-click **Open User Viewer.command**) and open the **Pro payments** table. Each submitted reference is one row with its payment note. Match the reference or the note against the Kotak statement (whether the note appears depends on the payer's app), then:

- **Approve** / **Reject** on a held row: approve starts 30 days from approval; reject declines that reference without pausing the account.
- **Mark paid** when a ₹300 credit with that reference exists.
- **Revoke** when it does not. Access ends at once and the account can no longer self-unlock.
- **Restore** undoes a revoke and gives back the paid period.
- **Allow retry** lets a revoked account submit a new reference.

An **Unusual** flag marks a reference that was held because it lacked a fresh timestamp. It is a hint to look closely, not proof either way.

## Abuse limits

- A reference can be used once, by one account (`pro/utr/<utr>.json` is create-only).
- An account with active access cannot stack more time until the last 7 days.
- An account may hold at most two unchecked instant payments; further instant claims wait for review.
- Obviously made-up references are refused; implausible ones are held without access (see above).
- Claims are rate limited per IP and per account (best effort, per function instance).
- A revoked account is refused until the operator restores it or allows a retry.

## Storage and API

Private Blob records: `pro/accounts/google-<sha256(sub)>.json` holds name, email, status, expiry and the payment list; `pro/utr/<utr>.json` marks a used reference. `GET /api/pro?op=status` returns only the caller's own access state with `private, no-store`.

If Google sign-in or Blob storage is not configured, status reports `configured: false` and the app leaves every workspace open, because nobody could unlock.

## Limits of this design

The lock, and the limit of each free example, are enforced in the app interface. The market-data endpoints behind the Pro workspaces are still public, and the ChatGPT/MCP tools are not gated, so a technical user can reach the underlying data. Closing that needs session checks on those endpoints, which would also stop their responses being CDN-cached.

## Verification

`node --test tests/pro.test.js tests/pro-example.test.js tests/workspace-render.test.js tests/google-auth.test.js`, then the full suite and build. In a signed-out browser, open each of the five workspaces: the example should load with real data, and a control marked PRO should open the paywall. After deploying, do one real run: sign in, submit a reference, confirm the workspace opens, find the row in the viewer and revoke it.
