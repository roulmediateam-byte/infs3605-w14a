// Build-time pieces of the app shell that GitHub Pages cannot provide with response headers (TRD, Web app):
//   * a Content Security Policy meta tag that only allows connections to the Supabase project;
//   * a service worker that caches the app shell only, never business data;
//   * a 404.html that sends deep links (such as /review?draft=...) back into the right build.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin, ResolvedConfig } from 'vite';

export interface AppShellOptions {
  /** The Supabase project URL the app talks to; the only other origin it may connect to. */
  supabaseUrl: string | undefined;
  /** Builds published under this one, such as "demo/" for the demonstration build. */
  subApps: string[];
}

const originOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

export const contentSecurityPolicy = (supabaseUrl: string | undefined): string => {
  const supabase = originOf(supabaseUrl);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${supabase ? ` ${supabase}` : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
};

const sha256Base64 = (text: string): string => createHash('sha256').update(text).digest('base64');

/** The redirect script in 404.html. Kept tiny, in plain ES5, and hashed into its own policy. */
export const notFoundScript = (base: string, subApps: string[]): string =>
  [
    '(function () {',
    `  var base = ${JSON.stringify(base)};`,
    `  var apps = ${JSON.stringify(subApps)};`,
    '  var path = window.location.pathname;',
    '  var target = base;',
    '  for (var i = 0; i < apps.length; i++) {',
    '    if (path.indexOf(base + apps[i]) === 0) target = base + apps[i];',
    '  }',
    '  if (path.indexOf(target) !== 0) target = base;',
    '  var rest = path.slice(target.length) + window.location.search;',
    "  window.location.replace(target + '?p=' + encodeURIComponent(rest) + window.location.hash);",
    '})();',
  ].join('\n');

const notFoundPage = (base: string, subApps: string[]): string => {
  const script = notFoundScript(base, subApps);
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${sha256Base64(script)}'; base-uri 'none'" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Payprentice</title>
    <script>${script}</script>
  </head>
  <body>
    <p><a href="${base}">Open Payprentice</a></p>
  </body>
</html>
`;
};

const serviceWorker = (cacheName: string, cachePrefix: string, files: string[], subApps: string[]): string => `// Generated at build time. Caches the app shell only (TRD, Web app): never API responses or business data.
// Each build (the site root and /demo/) shares the origin's cache storage, so each keeps to caches named for its
// own path, reads only its own cache, and on update deletes only its own older caches.
const CACHE = ${JSON.stringify(cacheName)};
const PREFIX = ${JSON.stringify(cachePrefix)};
const SHELL = ${JSON.stringify(files)};
const SUB_APPS = ${JSON.stringify(subApps)};
const scope = new URL(self.registration.scope);

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never stores the previous index.html.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((file) => new Request(new URL(file, scope).toString(), { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  // On a first visit, take charge of the open page too, so screens not yet opened still load offline.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const fromShell = (request) => caches.open(CACHE).then((cache) => cache.match(request));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Only this build's own files. Supabase and every other origin go straight to the network.
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const relative = url.pathname.slice(scope.pathname.length);
  if (SUB_APPS.some((app) => relative.startsWith(app))) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => fromShell(new URL('index.html', scope).toString())));
    return;
  }
  event.respondWith(fromShell(request).then((hit) => hit || fetch(request)));
});
`;

const listPublicFiles = (dir: string, prefix = ''): string[] => {
  let files: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(listPublicFiles(full, `${prefix}${entry}/`));
    else files.push(`${prefix}${entry}`);
  }
  return files;
};

export const appShell = (options: AppShellOptions): Plugin => {
  let config: ResolvedConfig;
  return {
    name: 'getpaid-app-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) {
      config = resolved;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(options.supabaseUrl)}" />`;
        return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${meta}`);
      },
    },
    generateBundle(_outputOptions, bundle) {
      const base = config.base;
      const notFound = notFoundPage(base, options.subApps);
      this.emitFile({ type: 'asset', fileName: '404.html', source: notFound });

      const fromPublic = listPublicFiles(config.publicDir).filter((file) => !file.endsWith('.csv') && file !== 'robots.txt');
      const built = Object.keys(bundle).filter((file) => file !== '404.html' && !file.endsWith('.map'));
      const files = [...new Set(['index.html', ...built, ...fromPublic])].sort();
      const fingerprint = createHash('sha256');
      for (const file of files) {
        const item = bundle[file];
        fingerprint.update(file);
        if (item && item.type === 'asset') fingerprint.update(typeof item.source === 'string' ? item.source : Buffer.from(item.source));
        else if (item && item.type === 'chunk') fingerprint.update(item.code);
        else if (fromPublic.includes(file)) fingerprint.update(readFileSync(path.join(config.publicDir, file)));
      }
      // "gpa-shell:/getpaid-apprentice/:" and "gpa-shell:/getpaid-apprentice/demo/:": the closing colon keeps one
      // build's prefix from matching the other's caches.
      const cachePrefix = `gpa-shell:${base}:`;
      const cacheName = `${cachePrefix}${fingerprint.digest('hex').slice(0, 12)}`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(cacheName, cachePrefix, files, options.subApps) });
    },
  };
};

/**
 * The preview build's database engine: PGlite's WebAssembly and file-system bundle, copied next to the page under
 * plain names, which the preview loads itself (src/backend/preview.ts):
 *   * pglite/pglite.wasm and pglite/initdb.wasm, as they are;
 *   * pglite/pglite-data.json, the file-system bundle compressed with gzip and written as base64 in JSON, because
 *     artifact hosting serves web file types only (no .bin or .data), and it is a third of the size this way.
 */
export const PREVIEW_BUNDLE_ENCODING = 'gzip+base64';

export const previewEngine = (): Plugin => ({
  name: 'getpaid-preview-engine',
  apply: 'build',
  generateBundle(_outputOptions, bundle) {
    // Vite also copies the engine under hashed names because PGlite's code mentions them, but the preview hands
    // PGlite the compiled modules itself (src/backend/preview.ts), so those copies are never fetched: drop them.
    for (const fileName of Object.keys(bundle)) {
      if (/^assets\/(pglite|initdb)-[\w-]+\.(wasm|data)$/.test(fileName)) delete bundle[fileName];
    }
    const dist = path.resolve(import.meta.dirname, '..', 'node_modules', '@electric-sql', 'pglite', 'dist');
    for (const name of ['pglite.wasm', 'initdb.wasm']) {
      this.emitFile({ type: 'asset', fileName: `pglite/${name}`, source: readFileSync(path.join(dist, name)) });
    }
    const bundleData = gzipSync(readFileSync(path.join(dist, 'pglite.data')), { level: 9 }).toString('base64');
    this.emitFile({
      type: 'asset',
      fileName: 'pglite/pglite-data.json',
      source: JSON.stringify({ about: "PGlite's file-system bundle (pglite.data)", encoding: PREVIEW_BUNDLE_ENCODING, data: bundleData }),
    });
  },
});
