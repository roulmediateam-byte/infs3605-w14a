// Generated at build time. Caches the app shell only (TRD, Web app): never API responses or business data.
// Each build (the site root and /demo/) shares the origin's cache storage, so each keeps to caches named for its
// own path, reads only its own cache, and on update deletes only its own older caches.
const CACHE = "gpa-shell:/infs3605-w14a/demo/:96ac4e16f991";
const PREFIX = "gpa-shell:/infs3605-w14a/demo/:";
const SHELL = ["apple-touch-icon.png","assets/Clients-cJLurgIn.js","assets/Import-KElbfp29.css","assets/Import-iGJ7Y6wC.js","assets/Invoices-XElnqz4o.js","assets/Log-D0EoMNYG.js","assets/Settings-Bb5Jvm56.js","assets/csv.worker-CwIKCNb5.js","assets/download-B7boIZtV.js","assets/index-CnOVatVf.js","assets/index-DYICVQta.css","assets/inter-latin-wght-normal-Dx4kXJAl.woff2","fonts/OFL.txt","icon-192.png","icon-512.png","icon-maskable-512.png","icon.svg","index.html","manifest.webmanifest"];
const SUB_APPS = [];
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
