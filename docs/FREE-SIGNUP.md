# Free registration

The app offers a dismissible name/email registration after 120 seconds in a visible tab. The clock is invisible, persists across reloads in the same tab and pauses in hidden tabs. Open dialogs, text-entry fields and the watchlist guide defer the prompt. The header also provides an immediate signup button.

A dismissal suppresses automatic prompts for seven days. A successful signup stores only a welcome name and registration timestamp locally and suppresses future prompts on that browser. Storage failures fall back to in-memory behavior. Clearing site data or using a different browser resets this recognition.

This is voluntary registration, not authentication. Names and emails are unverified. It does not unlock protected data, identify an existing account, sync holdings or upload portfolio/journal records. The interface deliberately uses “Sign up” rather than claiming a secure login. No Google credentials, passwords or mail delivery service are required.

## Storage and operation

`POST /api/signup` writes to the existing private Vercel Blob store using the server-only `BLOB_READ_WRITE_TOKEN` (or linked store credentials). Records are under `signups/<sha256(normalized-email)>.json`. The first successful record is retained; duplicate registrations never overwrite it. Both new and existing addresses receive the same `{ok:true}` response with no profile lookup endpoint. Only the operator can read records through the private store.

Fields: name, normalized email, creation timestamp, notice version, source and `emailVerified:false`. The API accepts explicit site/deployment origins and JSON only, caps request bodies at 4 KB, validates inputs, includes a honeypot and allows five requests per IP per ten minutes per function instance. This limiter is best-effort, not a distributed anti-bot system. IPs are not stored with registrations. Existing Vercel infrastructure logs remain separate.

The status endpoint exposes only whether storage is configured. If unavailable, automatic signup and its entry button stay hidden. Failed writes keep the form open for retry and never mark the browser registered. Analytics events contain only prompt source and event names; no name, email or profile data.

The operator can find registrations in the Vercel project's private Blob storage under `signups/`. Registration is not marketing consent. Records persist until removed by the operator. The public `/privacy.html` notice explains collection, local recognition, optional push storage and deletion requests through the existing founder contact links. Removing the local welcome name does not delete the server record.

## Verification

Run `node --test tests/signup.test.js`, the repository test suite and production build. Before promotion, verify the deployed status endpoint, modal dismissal, keyboard behavior, successful persistence using a clearly synthetic address, duplicate handling, responsive layout and the absence of a visible timer. Remove only the synthetic test record after verification.
