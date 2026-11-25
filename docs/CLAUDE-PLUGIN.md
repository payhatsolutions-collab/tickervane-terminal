# AlphaNova for Claude

The same public MCP server as the ChatGPT plugin (`https://alphanova-chatgpt.vercel.app/api/mcp`, ten read-only tools) is distributed to Claude three ways.

| Channel | Who it reaches | Status (12 Nov 2026) |
| --- | --- | --- |
| Custom connector URL | claude.ai web, desktop, mobile | Live; server verified with the official MCP client, not yet tested inside claude.ai |
| GitHub marketplace [payhatsolutions-collab/alphanova-claude-plugin](https://github.com/payhatsolutions-collab/alphanova-claude-plugin) | Claude Code, Claude desktop (Cowork) | Public; `marketplace add` + `install` verified in a clean config |
| Anthropic directory (claude.ai/directory/manage) | Everyone browsing Claude's connectors and plugins | Two submissions needed: MCP connector, then plugin bundle. Requires a paid plan sign-in |

Source of the marketplace repo: `outputs/claude-plugin/` (gitignored here; it is its own git repo). The plugin's `.mcp.json` points at the same server URL as the connector, so users who have both see one set of tools.

## Share text

> **Use AlphaNova market research inside Claude** — Indian & global quotes, fundamentals, Nifty 500 screens, NSE delivery and FII/DII flows.
>
> claude.ai: Settings → Connectors → Add custom connector → name **AlphaNova**, URL `https://alphanova-chatgpt.vercel.app/api/mcp`, no auth.
>
> Claude Code: `/plugin marketplace add payhatsolutions-collab/alphanova-claude-plugin` then `/plugin install alphanova@alphanova`

## Directory review notes

- Every tool has a `title`, `readOnlyHint: true` and `destructiveHint: false` (`lib/chatgptTools.js`).
- No auth, so no test credentials are needed. Public docs: the GitHub README.
- The review criteria say the server domain should match the service. The server is on `alphanova-chatgpt.vercel.app`, not `alphanova48.in`. If a reviewer raises this, attach a subdomain such as `mcp.alphanova48.in` to the `alphanova-chatgpt` Vercel project, then update both `.mcp.json` files.
- `api/mcp.js` rejects requests whose `Origin` is not on its allowlist. Claude's connectors call from Anthropic's servers without a browser Origin, but if claude.ai testing returns 403, add `https://claude.ai` to `ORIGINS` and redeploy the isolated project.

Review docs: [Publish to the directory](https://claude.com/docs/directory/publish), [Connector pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria).
