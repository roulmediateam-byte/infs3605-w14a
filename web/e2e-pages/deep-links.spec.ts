// What GitHub Pages serves (TRD, Environments and release): Pages answers an address it has no file for with the
// site's 404.html, whose script sends the address on to the right build (the owners' build at the root, or the
// demonstration build under demo/) as ?p=, and the app puts it back. Emailed links such as /review?draft=... depend
// on it. Run against the Pages-shaped build (npm run build:pages-e2e) and the Pages stand-in.
import type { Page } from '@playwright/test';
import { expect, latestCode, OWNER, sql, test } from '../e2e/support.ts';

const signInHere = async (page: Page): Promise<void> => {
  await page.getByLabel('Email').fill(OWNER);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('Type the 6-digit code from your email.')).toBeVisible();
  await page.getByLabel('6-digit code').fill(await latestCode(OWNER));
  await expect(page.getByLabel('6-digit code')).toBeHidden();
};

const waitingDraft = (invoiceNumber: string): string =>
  sql(`select d.id from public.reminder_drafts d join public.invoices i on i.id = d.invoice_id
       where i.invoice_number = '${invoiceNumber}' and d.status = 'waiting'`);

test("an emailed link to a draft opens that draft after sign-in, through Pages' 404 page", async ({ page }) => {
  const draft = waitingDraft('1051');
  const response = await page.goto(`review?draft=${draft}`);
  expect(response?.status(), 'Pages has no file at /review, so it answers with 404.html').toBe(404);
  await expect(page).toHaveURL(/\/getpaid-apprentice\/sign-in\?next=review%3Fdraft%3D/);
  await signInHere(page);
  await expect(page).toHaveURL(new RegExp(`/getpaid-apprentice/review\\?draft=${draft}$`));
  await expect(page.getByRole('region', { name: /^Invoice 1051,/ })).toBeVisible();
});

test('an address the app does not know shows its own not-found screen', async ({ page }) => {
  await page.goto('');
  await signInHere(page);
  await page.goto('nowhere-here');
  await expect(page.getByRole('heading', { name: "This page isn't here" })).toBeVisible();
});

test('the demonstration build answers under demo/, with sign-up and only the screens it shows', async ({ page }) => {
  await page.goto('demo/review');
  await expect(page).toHaveURL(/\/getpaid-apprentice\/demo\/sign-in\?next=review$/);
  // Its sign-up: a made-up email and a password make an account with its own copy of the Test data business.
  await expect(page.getByRole('heading', { name: 'Try Payprentice' })).toBeVisible();
  await page.getByLabel('Email').fill('pages.check@demo.test');
  await page.getByLabel('Password', { exact: true }).fill('harbour-line-8');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/getpaid-apprentice\/demo\/review$/);
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  expect(sql(`select count(*) from public.businesses where name = 'Harbour Line Electrical (Test data)'`), "the seed's business and this account's own").toBe('2');
  await page.getByRole('button', { name: 'Close review' }).click();
  await expect(page.getByText('Owed to you')).toBeVisible();
  // DEMO_HIDE_SCREENS leaves Invoices, Clients and Settings out of the demonstration build until they ship.
  await expect(page.getByRole('link', { name: 'Invoices', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Clients', exact: true })).toHaveCount(0);
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("connect-src 'self' http://127.0.0.1:54321");
});

test('the two builds keep separate app-shell caches on the one web address', async ({ page }) => {
  const cachesNow = (): Promise<string[]> => page.evaluate(() => caches.keys());
  await page.goto('');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.goto('demo/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(cachesNow).toEqual(
    expect.arrayContaining([expect.stringMatching(/^gpa-shell:\/getpaid-apprentice\/:/), expect.stringMatching(/^gpa-shell:\/getpaid-apprentice\/demo\/:/)]),
  );
  // Opening the root build again must not delete the demonstration build's cache, or the reverse.
  await page.goto('');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  expect((await cachesNow()).filter((key) => key.startsWith('gpa-shell:/getpaid-apprentice/demo/:'))).toHaveLength(1);
});
