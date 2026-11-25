import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.argv[2] || 'http://127.0.0.1:8787/mcp');
const client = new Client({ name: 'alphanova-smoke-check', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(url));
  const { tools } = await client.listTools();
  if (tools.length !== 10 || tools.some(tool => !tool.annotations?.readOnlyHint)) throw new Error('Unexpected tool catalogue');
  console.log(JSON.stringify({ endpoint: url.href, server: client.getServerVersion(), tools: tools.map(tool => tool.name) }));
  if (process.argv.includes('--live')) {
    const checks = [
      ['search_instruments', { query: 'Reliance', limit: 2 }],
      ['get_quotes', { symbols: ['RELIANCE.NS', 'AAPL'] }],
      ['get_price_history', { symbol: 'RELIANCE.NS', range: '1mo', maxBars: 5 }],
      ['get_fundamentals', { symbol: 'RELIANCE.NS' }],
      ['get_company_research', { symbol: 'RELIANCE.NS' }],
      ['get_news', { symbol: 'RELIANCE.NS', limit: 2 }],
      ['screen_stocks', { preset: 'breakout20', limit: 2 }],
      ['get_delivery', { symbol: 'RELIANCE.NS' }],
      ['get_market_overview', {}],
      ['get_institutional_flows', {}],
    ];
    for (const [name, args] of checks) {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
      const data = result.structuredContent?.data;
      console.log(JSON.stringify({ tool: name, status: result.isError ? 'unavailable' : 'ok',
        ...(result.isError ? { error: result.content } : { source: data?.source, date: data?.date, fetchedAt: data?.fetchedAt, stale: data?.stale,
          items: data?.instruments?.length ?? data?.quotes?.length ?? data?.bars?.length ?? data?.rows?.length ?? data?.items?.length,
          partialErrors: data?.errors, cashError: data?.cashError, participantsError: data?.participantsError }) }));
      if (result.isError) process.exitCode = 2;
    }
  }
} finally {
  await client.close();
}
