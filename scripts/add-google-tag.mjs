import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const tag = '<script defer src="/google-tag.js"></script>';
const files = await readdir('dist', { recursive: true, withFileTypes: true });

for (const file of files) {
  if (!file.isFile() || !file.name.endsWith('.html') || file.name === 'broker-return.html') continue;
  const path = join(file.parentPath, file.name);
  const html = await readFile(path, 'utf8');
  if (html.includes(tag)) continue;
  if (!html.includes('</head>')) throw new Error(`Missing </head> in ${path}`);
  await writeFile(path, html.replace('</head>', `  ${tag}\n</head>`));
}
