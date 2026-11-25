# Install tracking

The homepage, sidebar, mobile header and More sheet link to `https://alphanova48.in/install`.
The install page supports direct visits and offers the native browser prompt when
available, plus manual instructions for Android, iOS and desktop browsers.

Use `/install` in Vercel Web Analytics to measure install-page visits. This is an
internal destination, so it does not appear as an outbound link. Page visits
include direct visits and reloads; they are not completed installations.

Where custom events are enabled, use:

| Event | Trigger | Properties |
| --- | --- | --- |
| `install_app_clicked` | Install link clicked | `destination`, `source` (placement), `pathname` |
| `install_prompt_opened` | Native installation prompt requested | `destination` |
| `install_prompt_result` | Browser reports acceptance or dismissal | `outcome` |
| `app_installed` | Browser emits `appinstalled` | `destination` |

| `install_open_chrome` | **Open in Chrome to install** tapped on Android | `destination` |
| `signin_open_chrome` | **Open this page in Chrome** tapped beside a Google button in an in-app browser | — |

These custom events need a Vercel plan that includes them; on the Hobby plan they are sent but not stored, so only page views (including `/install`) can be read.

The Google Ads tag (`public/google-tag.js`) counts a click on any link to `/install` as its conversion, including the mobile header button. Until 17 November 2026 it matched only the sidebar and More-sheet links, so most mobile install clicks were not reported.

Android custom tabs and in-app browsers (the usual route from an ad) often cannot install a web app. When the browser offers no install prompt, the install page shows **Open in Chrome to install** on Android. Google also refuses sign-in inside other apps' built-in browsers, so Google buttons there carry an **Open this page in Chrome** link.

Readers who install get a 3-day Pro trial as an unadvertised thank-you; see `docs/PRO-UNLOCK.md`.

Manual installation may not emit `appinstalled` in every browser. Acceptance of
the prompt is tracked separately from confirmed installation. No names, emails,
query parameters or saved research are included in these events.
