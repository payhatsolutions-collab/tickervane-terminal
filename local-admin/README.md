# Local user viewer

Double-click **Open User Viewer.command** in the project root, or run `npm run users`, then open http://127.0.0.1:5188. Keep its terminal window open while using it. The viewer is already running when first created in this chat.

This is a standalone HTML/CSS/JavaScript interface backed by a small local read-only server. It has no password, binds only to 127.0.0.1 and is excluded from Vercel deployments. Exact host and origin checks prevent other websites from reading its API through the browser. Anyone using this computer can access it while it is running.

The local server reads the existing private registration store using the project's `.env.local`. Storage credentials never go to the browser. It lists names, emails, signup timestamps, email verification status, registration source and notice version. It does not expose push subscriptions or pretend browser-local portfolios are attached to registrations.

Use **Refresh data** for the latest records, search by name or email, sort the table, choose **View** for details and export the current filtered list to CSV. Exports contain personal data and stay wherever you save them on your computer. The dashboard itself does not keep a persistent copy of the user list.
