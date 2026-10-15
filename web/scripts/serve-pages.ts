// A small stand-in for GitHub Pages, for the e2e-pages tests. It serves web/site-e2e under /getpaid-apprentice/
// and behaves as Pages does where it matters to the app: a missing path gets the site's 404.html with status 404,
// a folder without its slash is redirected, text is compressed with gzip, and files carry "max-age=600".
// Usage: node scripts/serve-pages.ts (port PAGES_PORT, default 4180)
import { readFile, stat } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const port = Number(process.env.PAGES_PORT ?? 4180);
const base = '/getpaid-apprentice/';
const root = path.resolve(import.meta.dirname, '..', 'site-e2e');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg)/;

const isFile = async (file: string): Promise<boolean> => (await stat(file).catch(() => null))?.isFile() ?? false;
const isFolder = async (file: string): Promise<boolean> => (await stat(file).catch(() => null))?.isDirectory() ?? false;

const send = async (res: ServerResponse, status: number, file: string, gzip: boolean): Promise<void> => {
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  let body = await readFile(file);
  const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'max-age=600' };
  if (gzip && COMPRESSIBLE.test(type)) {
    body = gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers.vary = 'Accept-Encoding';
  }
  res.writeHead(status, headers);
  res.end(body);
};

createServer((req, res) => {
  const respond = async (): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const pathname = decodeURIComponent(url.pathname);
    const notFound = (): Promise<void> => send(res, 404, path.join(root, '404.html'), gzip);
    if (!pathname.startsWith(base)) return notFound();
    const relative = pathname.slice(base.length);
    const file = path.join(root, path.normalize(relative.endsWith('/') || relative === '' ? `${relative}index.html` : relative));
    if (!file.startsWith(root)) return notFound();
    if (await isFile(file)) return send(res, 200, file, gzip);
    if (await isFolder(file)) {
      res.writeHead(301, { location: `${pathname}/${url.search}` });
      res.end();
      return;
    }
    return notFound();
  };
  respond().catch((error: unknown) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(error instanceof Error ? error.message : 'Server error');
  });
}).listen(port, '127.0.0.1', () => console.log(`GitHub Pages stand-in: http://127.0.0.1:${port}${base}`));
