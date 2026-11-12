// The final version: plans with the 3-month intro, promises to pay, tone presets and firmer by itself.
import { expect, OWNER, signIn, test } from './support.ts';

test.beforeEach(async ({ page }) => {
  await signIn(page, OWNER);
  await expect(page.getByText('Owed to you')).toBeVisible();
});

test('plans: the owner starts Crew at 80% off, cannot move to Solo with a checker, and can cancel and keep it', async ({ page }) => {
  await page.goto('plans');
  await expect(page.getByRole('heading', { name: 'Plans and billing' })).toBeVisible();
  await expect(page.getByText('No plan yet. Every plan starts with 3 months at 80% off.')).toBeVisible();
  await expect(page.getByText('$9.80 a month for 3 months, then $49')).toBeVisible();
  await page.getByRole('button', { name: 'Start Crew' }).click();
  await expect(page.getByText("You're on Crew. 80% off until the intro ends.")).toBeVisible();
  await expect(page.getByText(/^Intro price: \d+ days left at 80% off$/)).toBeVisible();
  await page.getByRole('button', { name: 'Move to Solo' }).click();
  await expect(page.getByText('Solo is for one person. Remove your checker first, or choose Crew.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel my plan' }).click();
  await expect(page.getByText(/^Cancelled\. Your plan runs until /)).toBeVisible();
  await page.getByRole('button', { name: 'Keep my plan' }).click();
  await expect(page.getByText('Your plan keeps going.')).toBeVisible();
});

test('promise to pay: recording one cancels the waiting draft and shows on Home', async ({ page }) => {
  await page.goto('invoices');
  await page.getByLabel('Search by client or invoice number').fill('1066');
  await page.getByRole('button', { name: /Invoice 1066/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('What they said (optional)').fill('Paying after their progress claim');
  await sheet.getByRole('button', { name: 'Record the promise' }).click();
  await expect(page.getByText(/^Saved\. No reminders until .+\. The waiting draft was cancelled\.$/)).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Promised to pay' })).toBeVisible();
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Promised to pay' })).toBeVisible();
  await expect(page.getByText(/^Invoice 1066: by /)).toBeVisible();
});

test('tone presets: starter presets are saved, a client remembers one, and firmer by itself turns on', async ({ page }) => {
  await page.goto('settings');
  await page.getByRole('button', { name: 'Add the three starter presets' }).click();
  await expect(page.getByText('Added Good payers, Head contractors and Slow payers.')).toBeVisible();
  await page.getByRole('radio', { name: '2 unpaid reminders' }).check();
  await expect(page.getByText('From the next run, clients get one tone firmer after 2 unpaid reminders.')).toBeVisible();
  await page.goto('clients');
  await page.getByRole('button', { name: /^Greenway Strata/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Greenway Strata (Test data)' });
  await sheet.getByRole('button', { name: 'Good payers: Gentle' }).click();
  await expect(page.getByText('Saved. This client remembers "Good payers" (Gentle).')).toBeVisible();
  await expect(sheet.getByText('Remembers the preset "Good payers".')).toBeVisible();
});
