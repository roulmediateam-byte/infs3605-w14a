// The JavaScript budget (TRD, Web app: under 200 KB compressed at first load). It adds up the entry script and every
// module the page preloads, gzipped, from web/dist after `npm run build`. Screens loaded later don't count.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 200;
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');

const assets = new Set<string>();
for (const match of html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) assets.add(match[1] ?? '');
for (const match of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) assets.add(match[1] ?? '');

const base = (html.match(/src="(.*?)assets\//)?.[1] ?? '/').replace(/^https?:\/\/[^/]+/, '');
let total = 0;
for (const asset of assets) {
  const file = path.join(dist, asset.startsWith(base) ? asset.slice(base.length) : asset);
  const size = gzipSync(readFileSync(file), { level: 9 }).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${path.relative(dist, file)}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  JavaScript at first load (budget ${BUDGET_KB} KB)`);
if (total > BUDGET_KB * 1024) {
  console.error('Over budget: split a screen out with lazy() or drop a dependency.');
  process.exit(1);
}
