// The build's own guarantees (TRD, Web app): a Content Security Policy that allows connections only to the
// Supabase project, no third-party requests, and a service worker that never caches business data. Deep links
// through GitHub Pages' 404 page are tested against a Pages-shaped build in e2e-pages/.
import { expect, OWNER, signIn, STACK, test } from './support.ts';

test('the page carries a Content Security Policy limited to the Supabase project', async ({ page }) => {
  await page.goto('');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain(`connect-src 'self' ${new URL(STACK).origin}`);
  expect(policy).toContain("object-src 'none'");
});

test('nothing is fetched from any other site, and API responses are never cached', async ({ page, baseURL }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  await signIn(page, OWNER);
  await expect(page.getByText('Owed to you')).toBeVisible();
  await page.goto('review');
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  const allowed = new Set([new URL(baseURL ?? 'http://127.0.0.1:4173/').origin, new URL(STACK).origin]);
  expect([...origins].filter((origin) => !allowed.has(origin))).toEqual([]);

  // The service worker caches only the app's own files.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || caches.keys().then((k) => k.length > 0), null, { timeout: 15_000 });
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((url) => url.includes('/rest/v1') || url.includes('/auth/v1'))).toEqual([]);
});
