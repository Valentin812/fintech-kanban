import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const htmlPath = process.argv[2] ?? 'index.html';
const html = await readFile(htmlPath, 'utf8');
const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
let count = 0;
let match;

while ((match = scriptTag.exec(html)) !== null) {
  if (/\bsrc\s*=/.test(match[1])) continue;
  const source = match[2].trim();
  if (!source) continue;

  const line = html.slice(0, match.index).split('\n').length;
  new vm.Script(source, { filename: `${htmlPath}:${line}` });
  count += 1;
}

if (count === 0) {
  throw new Error(`No inline scripts found in ${htmlPath}`);
}

console.log(`Syntax OK: ${count} inline script${count === 1 ? '' : 's'} in ${htmlPath}`);

