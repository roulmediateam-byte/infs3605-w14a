// The TRD's speed budgets (Web app, Budgets; NFR-11, NFR-14), measured in Chromium with Lighthouse's mobile
// throttling: a mid-range phone (processor 4 times slower) on slow 4G (150 ms round trip, 1.6 Mbit/s down). The site
// is served as Pages serves it, compressed. Locally the "server" is close, so the network delay is all simulated.
import type { Page } from '@playwright/test';
import { expect, latestCode, OWNER, test } from '../e2e/support.ts';

const throttle = async (page: Page): Promise<void> => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
};

/** Largest contentful paint and the sum of every layout shift not caused by input, since the page opened. */
const vitals = (page: Page): Promise<{ lcp: number; cls: number }> =>
  page.evaluate(
    () =>
      new Promise<{ lcp: number; cls: number }>((resolve) => {
        let lcp = 0;
        let cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) lcp = Math.max(lcp, entry.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!entry.hadRecentInput) cls += entry.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => resolve({ lcp, cls }), 1000);
      }),
  );

test('first load: largest content within 2.5 s, and layout shift under 0.1 through to Home', async ({ page }) => {
  await throttle(page);
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const first = await vitals(page);
  console.log(`Sign-in: largest content at ${Math.round(first.lcp)} ms, layout shift ${first.cls.toFixed(3)}`);
  expect(first.lcp).toBeLessThan(2500);
  expect(first.cls).toBeLessThan(0.1);

  await page.getByLabel('Email').fill(OWNER);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('Type the 6-digit code from your email.')).toBeVisible();
  await page.getByLabel('6-digit code').fill(await latestCode(OWNER));
  await expect(page.getByText('$62,440.00')).toBeVisible();
  const home = await vitals(page);
  console.log(`Through Home: layout shift ${home.cls.toFixed(3)}`);
  expect(home.cls).toBeLessThan(0.1);
});

test('a tap shows progress within 200 ms, and an approval comes back within 1 s', async ({ page }) => {
  await page.goto('review');
  await page.getByLabel('Email').fill(OWNER);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('Type the 6-digit code from your email.')).toBeVisible();
  await page.getByLabel('6-digit code').fill(await latestCode(OWNER));
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  await throttle(page);
  const timing = await page.evaluate(
    () =>
      new Promise<{ progress: number; approved: number }>((resolve, reject) => {
        const button = Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.trim() === 'Approve');
        if (!button) {
          reject(new Error('No Approve button'));
          return;
        }
        let progress = -1;
        const start = performance.now();
        const observer = new MutationObserver(() => {
          const text = document.body.textContent ?? '';
          if (progress < 0 && text.includes('Approving…')) progress = performance.now() - start;
          if (text.includes('Approved. Now send it from your email.')) {
            observer.disconnect();
            resolve({ progress, approved: performance.now() - start });
          }
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        button.click();
      }),
  );
  console.log(`Approve: progress shown at ${Math.round(timing.progress)} ms, approved at ${Math.round(timing.approved)} ms`);
  expect(timing.progress).toBeGreaterThanOrEqual(0);
  expect(timing.progress).toBeLessThan(200);
  expect(timing.approved).toBeLessThan(1000);
});
