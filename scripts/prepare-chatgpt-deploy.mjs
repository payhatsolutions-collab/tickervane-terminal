import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Stage only public research code. Never upload the main checkout or its secrets.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'outputs/chatgpt/server');
const files = ['api/mcp.js', 'lib/chatgptTools.js', 'src/data.js', 'src/stocks.js', 'src/stockCatalog.js', 'src/format.js', 'src/screens.js'];
for (const file of files) {
  await mkdir(path.dirname(path.join(output, file)), { recursive: true });
  await copyFile(path.join(root, file), path.join(output, file));
}
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const dependencies = Object.fromEntries(['@modelcontextprotocol/sdk', 'zod'].map(name => [name, lock.packages[`node_modules/${name}`].version]));
await writeFile(path.join(output, 'package.json'), JSON.stringify({ name: 'alphanova-chatgpt', version: '1.0.0', private: true, type: 'module', engines: { node: '22.x' }, dependencies }, null, 2) + '\n');
await writeFile(path.join(output, 'vercel.json'), JSON.stringify({ framework: null, buildCommand: '', outputDirectory: 'public', regions: ['bom1'], functions: { 'api/mcp.js': { maxDuration: 60 } }, rewrites: [{ source: '/mcp', destination: '/api/mcp' }] }, null, 2) + '\n');
await mkdir(path.join(output, 'public'), { recursive: true });
await writeFile(path.join(output, 'public/index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AlphaNova for ChatGPT</title><main><h1>AlphaNova for ChatGPT</h1><p>Public stock-market research through ten read-only MCP tools.</p><p>In ChatGPT Plugins, add a custom MCP server using this site's URL followed by <code>/api/mcp</code>. Select No authentication.</p><p><a href="https://chatgpt.com/plugins">Open ChatGPT Plugins</a> · <a href="https://alphanova48.in">AlphaNova</a> · <a href="https://alphanova48.in/privacy.html">Privacy</a></p><p>Market data may be delayed or unavailable. No orders, brokerage connections or browser-local portfolio access.</p></main></html>`);
console.log(output);
