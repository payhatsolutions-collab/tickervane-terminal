# Local user viewer

Double-click **Open User Viewer.command** in the project root, or run `npm run users`, then open http://127.0.0.1:5188. Keep its terminal window open while using it. The viewer is already running when first created in this chat.

This is a standalone HTML/CSS/JavaScript interface backed by a small local server. Registrations are read-only; the only change it can save is your review of a Pro payment. It has no password, binds only to 127.0.0.1 and is excluded from Vercel deployments. Exact host and origin checks prevent other websites from reading its API through the browser. Anyone using this computer can access it while it is running.

The local server reads the existing private registration store using the project's `.env.local`. Storage credentials never go to the browser. It reads both legacy `signups/` registrations and verified Google accounts under `auth/accounts/`, listing names, emails, signup timestamps, email verification status, registration source and notice version. It does not merge identities by email, so the total is registration records, not unique people. A **Pro payments** table lists every UPI reference readers submitted to unlock Alpha Nova Pro, with **Mark paid**, **Revoke**, **Restore** and **Allow retry** actions; see `docs/PRO-UNLOCK.md`. It does not expose push subscriptions or pretend browser-local portfolios are attached to registrations.

Use **Refresh data** for the latest records, search by name or email, sort the table, choose **View** for details and export the current filtered list to CSV. Exports contain personal data and stay wherever you save them on your computer. The dashboard itself does not keep a persistent copy of the user list.
