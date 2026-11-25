# AlphaNova ChatGPT plugin

The integration provides ten read-only market-research tools through MCP Streamable HTTP, plus a portable plugin package containing research instructions. No OpenAI API key is needed; ChatGPT is the MCP client.

## Connect

Server: `https://alphanova-chatgpt.vercel.app/api/mcp`

1. Sign in to [ChatGPT Plugins](https://chatgpt.com/plugins).
2. Choose **+ → Add custom MCP server**.
3. Set the name to **AlphaNova**, paste the server URL and select **No authentication**.
4. Review ChatGPT's connection notice, create the plugin and install it.
5. Open a new chat and select **@AlphaNova**. Try: “Compare Reliance and TCS with source dates” or “Find stocks in AlphaNova’s 20-day breakout screen.”

Workspace permissions may control custom server creation. These steps follow the [OpenAI plugin quickstart](https://developers.openai.com/plugins/quickstart). The server endpoint is public, but the personal ChatGPT connection and public directory publication are separate actions. The available browser was signed out during setup; account installation has not been verified.

## Capabilities

| Tool | Data and scope |
| --- | --- |
| `search_instruments` | Refreshed NSE directory plus AlphaNova's curated global instruments; exact exchange tickers |
| `get_quotes` | Up to 16 symbols, currencies, quote times, delays and per-symbol failures |
| `get_price_history` | Actual OHLCV; latest 1–600 bars, explicit truncation and adjusted-price option |
| `get_fundamentals` | Available company statements and valuation metrics with provider metadata |
| `get_company_research` | Dated published Lodestar six-pillar assessments; no on-demand Python analysis |
| `get_news` | Company/market headlines, original links, dates and source failures |
| `screen_stocks` | Existing Nifty 500 presets, descending sort, bounded results and match count |
| `get_delivery` | A single NSE equity's delivered quantity, percentage and session history |
| `get_market_overview` | Latest available Nifty 500 breadth, coverage and setup candidates |
| `get_institutional_flows` | NSE FII/DII cash activity and participant positioning, including partial errors |

Browser-local holdings, watchlists, alerts and trade journals are unavailable to the server. It has no order, broker, signup or authentication tools. Its fixed upstream is AlphaNova's public `/api/market`; callers cannot supply a URL, path, token or arbitrary operation. The research instruction skill distinguishes retrieval time from source time, preserves null values and labels research signals as descriptive.

## Implementation

- `api/mcp.js`: stateless JSON MCP transport using the official SDK. Accepts POST and CORS preflight; GET/SSE and session deletion are not used. Validates Origin when present, requires JSON, caps request bodies at 64 KiB and limits each client to 60 POSTs/minute per warm process. Production-wide rate limiting remains the hosting provider's responsibility; the in-memory limiter is not a distributed quota.
- `lib/chatgptTools.js`: strict tool schemas, source-preserving transformations, existing shared screen rules, fixed HTTPS upstream, 45-second timeout, 4 MiB upstream response cap and sanitized failure messages.
- `scripts/chatgpt-server.mjs`: local server on `127.0.0.1:8787`, with `/mcp`, `/api/mcp` and `/health` routes.
- `plugins/alphanova/`: portable manifest, remote MCP configuration and research skill. `npm run chatgpt:package` produces `outputs/chatgpt/alphanova-1.0.0.zip`.

Serverless instances are created per request. No sessions, user records or market results are stored by the integration. Hosting access logs may retain request metadata; upstream caching remains in the existing AlphaNova market service. No secret environment variables are needed. Future private account tools would require a separate authenticated, user-scoped design.

## Run and verify

```sh
npm ci
npm run chatgpt:test
npm run chatgpt
```

From another terminal:

```sh
node scripts/check-chatgpt.mjs http://127.0.0.1:8787/mcp
node scripts/check-chatgpt.mjs https://alphanova-chatgpt.vercel.app/api/mcp --live
```

The smoke check uses the official MCP client to initialize and discover all ten tools. `--live` additionally reads each tool's public source and prints only status, dates, counts and source errors. A tool data failure sets exit code 2; protocol/connection failures abort. Market-source failures should be diagnosed separately from MCP failures. Never present stale or missing data as current.

The Vite development server also mounts `/api/mcp`. Its tools intentionally use the production public market API rather than local private services.

## Isolated deployment

The plugin has its own Vercel project, **alphanova-chatgpt**, so shipping it does not publish unrelated working-tree changes to the main website. The user approved this public deployment on 12 November 2026.

```sh
node scripts/prepare-chatgpt-deploy.mjs
cd outputs/chatgpt/server
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npx vercel deploy --prod
```

The preparation script copies an explicit allowlist of public research modules and pins the two dependencies to versions from the repository lockfile. It excludes account code, local administration, secrets, private research and the rest of the website. The generated directory keeps Vercel's local project link between deployments. No GitHub integration is required; deployment is from the staged directory. If deploying under a different hostname, update `plugins/alphanova/mcp.json` and these connection instructions, then repackage.

The root `vercel.json` also configures `/api/mcp` for a future normal website release; the current website was not redeployed for this task.

## Package and distribution

Registering the live server as a custom MCP plugin enables the tools immediately. For the public directory, upload the ZIP in the [OpenAI Platform Plugins dashboard](https://platform.openai.com/plugins) under the verified publisher's project. Connect the MCP server and serve the dashboard's exact verification token as plain text at `https://alphanova-chatgpt.vercel.app/.well-known/openai-apps-challenge`. Complete the automated checks, submit for review and publish the approved version. [OpenAI submission guide](https://developers.openai.com/plugins/deploy/submission)

The package includes the listing icon, the founder contact page as the support URL, five positive reviewer cases, three negative cases and release notes. Country availability is unrestricted in the package. Before review, supply the public terms URL and the accessible walkthrough recording. The linked privacy notice covers the website. Update it to describe plugin requests and hosting log retention once the operator confirms those details. Confirm that the market data providers authorize the uses described in the submission. [OpenAI plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)

Validation performed: 11 MCP integration tests (including official-client HTTP lifecycle, schema rejection, source preservation, screen filtering, rate limits and request limits), all 430 repository tests, and `npx vite build`. Live results and deployment identifiers are recorded separately in `docs/chatgpt-plugin-deployment-2026-11-12.json`.
