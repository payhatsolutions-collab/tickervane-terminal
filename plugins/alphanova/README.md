# AlphaNova for ChatGPT

AlphaNova market research tools plus a reusable research workflow. The MCP server runs separately from this plugin package.

## Connect in ChatGPT

The server is deployed separately at `https://alphanova-chatgpt.vercel.app/api/mcp`. Deployment and verification instructions are in the repository's `docs/CHATGPT-PLUGIN.md`.

In [ChatGPT Plugins](https://chatgpt.com/plugins), choose **+ → Add custom MCP server**, name it **AlphaNova**, enter `https://alphanova-chatgpt.vercel.app/api/mcp` and choose **No authentication**. Create it as a plugin, install it and select **@AlphaNova** in a new chat. For local testing use the public HTTPS URL of your tunnel followed by `/mcp`.

Example requests:

- Compare the latest available Reliance and TCS quotes, with timestamps.
- Find ten stocks in AlphaNova’s 20-day breakout screen.
- Show HDFC Bank’s financial fundamentals and latest company headlines.
- Summarize NSE institutional flows and market breadth, stating each dataset’s date.

The portable `plugin.json` and `mcp.json` declare the bundled skill and the deployed MCP server. Public directory publication uses the OpenAI Platform Plugins dashboard and requires approval before the listing goes live. See `docs/CHATGPT-PLUGIN.md` in the repository for submission details.

## Data and access

Public, read-only market data. No OpenAI API key, AlphaNova login or brokerage credentials are needed. The server calls only AlphaNova's public market API. It cannot read browser-local watchlists, portfolios, alerts, journals, registrations or login sessions. Market values can be delayed, dated, incomplete or unavailable. Published Lodestar coverage is narrower than the website's on-demand analysis.

Sources: [Connect a plugin](https://developers.openai.com/plugins/quickstart), [package a plugin](https://developers.openai.com/plugins/build/plugins).
