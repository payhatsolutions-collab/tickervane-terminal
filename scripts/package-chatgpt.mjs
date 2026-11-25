import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.join(root, 'plugins/alphanova');
const manifest = JSON.parse(await readFile(path.join(folder, 'plugin.json'), 'utf8'));
const mcp = JSON.parse(await readFile(path.join(folder, 'mcp.json'), 'utf8'));
if (manifest.name !== 'alphanova' || mcp.mcpServers.alphanova.type !== 'streamable-http') throw new Error('Invalid plugin package');
await readFile(path.join(folder, 'skills/market-research/SKILL.md'), 'utf8');
const output = path.join(root, 'outputs/chatgpt');
await mkdir(output, { recursive: true });
const archive = path.join(output, `alphanova-${manifest.version}.zip`);
const result = spawnSync('zip', ['-q', '-r', '-FS', archive, 'plugin.json', 'mcp.json', 'README.md', 'assets/icon.png', 'skills/market-research/SKILL.md'], { cwd: folder, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(archive);
