# Google sign-in and free registration

When Google sign-in is not configured, the app offers an optional name/email registration. After 120 seconds in a visible tab, the header entry is highlighted without automatically opening a dialog. The clock is invisible, persists across reloads in the same tab and pauses in hidden tabs. Open dialogs, text-entry fields and the watchlist guide defer the prompt. The header also provides an immediate signup button.

A dismissal suppresses automatic prompts for seven days. A successful signup stores only a welcome name and registration timestamp locally and suppresses future prompts on that browser. Storage failures fall back to in-memory behavior. Clearing site data or using a different browser resets this recognition.

This is voluntary registration, not authentication. Names and emails are unverified. It does not unlock protected data, identify an existing account, sync holdings or upload portfolio/journal records. The interface deliberately uses “Sign up” rather than claiming a secure login. The legacy form does not require Google credentials, passwords or mail delivery.

## Google sign-in

When configured, the header shows a labeled Sign up free button on mobile and desktop for signed-out readers; it supports both new and returning Google accounts. It opens an account dialog containing Google's own themed sign-in button. The paywall also offers Google's button. Returning users can use Google's one-click account selection where supported; Google may still require account selection or first-use consent. No automatic sign-in prompt interrupts research.

`GOOGLE_CLIENT_ID` is the public web client ID authorized for `https://alphanova48.in`. `AUTH_SESSION_SECRET` is a separate random server-only secret of at least 32 characters, used to sign ten-minute browser challenges. The OAuth client secret is not used or shipped. Development may use local `.env.local`; localhost must also be authorized in Google Cloud to complete a real local sign-in.

`GET /api/auth?op=session` returns configuration and the current session's name/email with `private, no-store`. `GET ...?op=challenge` issues a signed HttpOnly challenge cookie and a nonce. `POST ...?op=google` accepts JSON from explicit site origins, verifies the nonce and Google's signature, issuer, audience and expiry with `google-auth-library`, and requires a verified email claim. Identity is keyed by Google's `sub`, never linked through the unverified name/email form. The Google JWT is not persisted.

Private Blob records: `auth/accounts/google-<sha256(sub)>.json` stores first registration; `auth/sessions/<sha256(random-token)>.json` stores the verified profile and seven-day expiry. The random bearer token is stored only in a Secure, HttpOnly, SameSite=Lax, host-only cookie. Session reads bypass the Blob CDN cache. Logout deletes the server session and clears cookies; expired sessions are rejected and removed when encountered. Expired records whose cookies have already disappeared may remain in private storage until operator cleanup. Account records persist until operator deletion. The local registration viewer includes both verified `auth/accounts/` Google accounts and legacy `signups/` registrations. It keeps records separate even when their emails match.

Signing in uploads no research. A signed-in reader can explicitly save one watchlist backup in private Blob storage at `auth/watchlists/google-<sha256(sub)>.json`, restore its symbols without replacing their local watchlist, or delete the account backup. Only symbols and the backup timestamp are stored. Changes are not synced automatically; portfolios, journals and push subscriptions are outside the account backup. No private information is included in analytics events. Signing out leaves local research intact. Clearing site data also clears the login cookie. API failures fail closed; legacy local welcome names never establish an authenticated session.

Verification: `node --test tests/google-auth.test.js tests/signup.test.js`, full suite, Vite build, live button rendering on desktop/mobile, then a real Google sign-in and sign-out. Only production origin is authorized by the supplied Google client, so preview origins cannot complete a Google login without a separate Google configuration.

## Storage and operation

`POST /api/signup` writes to the existing private Vercel Blob store using the server-only `BLOB_READ_WRITE_TOKEN` (or linked store credentials). Records are under `signups/<sha256(normalized-email)>.json`. The first successful record is retained; duplicate registrations never overwrite it. Both new and existing addresses receive the same `{ok:true}` response with no profile lookup endpoint. Only the operator can read records through the private store.

Fields: name, normalized email, creation timestamp, notice version, source and `emailVerified:false`. The API accepts explicit site/deployment origins and JSON only, caps request bodies at 4 KB, validates inputs, includes a honeypot and allows five requests per IP per ten minutes per function instance. This limiter is best-effort, not a distributed anti-bot system. IPs are not stored with registrations. Existing Vercel infrastructure logs remain separate.

The status endpoint exposes only whether storage is configured. If unavailable, automatic signup and its entry button stay hidden. Failed writes keep the form open for retry and never mark the browser registered. Analytics events contain only prompt source and event names; no name, email or profile data.

The operator can find registrations in the Vercel project's private Blob storage under `signups/`. Registration is not marketing consent. Records persist until removed by the operator. The public `/privacy.html` notice explains collection, local recognition, optional push storage and deletion requests through the existing founder contact links. Removing the local welcome name does not delete the server record.

## Verification

Run `node --test tests/signup.test.js`, the repository test suite and production build. Before promotion, verify the deployed status endpoint, modal dismissal, keyboard behavior, successful persistence using a clearly synthetic address, duplicate handling, responsive layout and the absence of a visible timer. Remove only the synthetic test record after verification.
