// UI-07 Invoices, UI-09 Clients, UI-10 Activity log, UI-11 Settings and More: the supporting flows that keep the
// records true between Mondays (App Flow, Supporting flows).
import { readFileSync } from 'node:fs';
import { expect, OWNER, signIn, test } from './support.ts';

test.beforeEach(async ({ page }) => {
  await signIn(page, OWNER);
  await expect(page.getByText('Owed to you')).toBeVisible();
});

test('invoices: status chips, search by number and by client, and filters', async ({ page }) => {
  await page.goto('invoices');
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  await expect(page.getByText('12 invoices', { exact: true })).toBeVisible();
  const search = page.getByLabel('Search by client or invoice number');
  await search.fill('1051');
  await expect(page.getByText('1 invoice', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Northshore Homes \(Test data\).*Invoice 1051.*\$8,450\.00.*Overdue · 21 days/ })).toBeVisible();
  await search.fill('northshore');
  await expect(page.getByText('3 invoices', { exact: true })).toBeVisible();
  await search.fill('');
  await page.getByRole('radio', { name: /^Due soon \(\d+\)$/ }).check();
  await expect(page).toHaveURL(/filter=due_soon/);
  await expect(page.getByText(/^Due in \d+ days?$/).first()).toBeVisible();
  await expect(page.getByText(/^Overdue · /)).toHaveCount(0);
});

test('offline, a screen that has not loaded yet says so instead of looking empty', async ({ page, context }) => {
  // Home has loaded; Clients and Review have not, so offline they can't show anything yet (App Flow, No signal on site).
  // The app shell, every screen's code included, is cached once the service worker takes charge.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page.getByText("You're offline. This will load when you're back online.")).toBeVisible();
  await expect(page.getByText('No clients yet')).toHaveCount(0);
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('link', { name: 'Review drafts' }).click();
  await expect(page.getByText("You're offline. This will load when you're back online.")).toBeVisible();
  await expect(page.getByText('All caught up')).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
});

test('mark paid, with Undo in the message and on the invoice', async ({ page }) => {
  await page.goto('invoices?filter=overdue');
  await page.getByRole('button', { name: /Invoice 1056/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Invoice 1056' });
  await expect(sheet.getByText('Reminders sent')).toBeVisible();
  await sheet.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.getByText('Marked paid. 1 reminder cancelled.')).toBeVisible();
  await expect(sheet.getByText(/^Paid /)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/^Open again\./)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Mark paid' })).toBeVisible();
  await expect(sheet.getByText('The reminder for invoice 1056 was cancelled: marked paid')).toBeVisible();
});

test('clients: adding a missing email clears its Needs attention item', async ({ page }) => {
  await expect(page.getByText('Coastline Fitouts (Test data)').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add an email' }).click();
  const sheet = page.getByRole('dialog', { name: 'Coastline Fitouts (Test data)' });
  await sheet.getByLabel('Email', { exact: true }).fill('not an email');
  await sheet.getByRole('button', { name: 'Add the email' }).click();
  await expect(sheet.getByText('Enter one valid email address, such as accounts@example.com.')).toBeVisible();
  await sheet.getByLabel('Email', { exact: true }).fill('accounts@coastline-fitouts.example');
  await sheet.getByRole('button', { name: 'Add the email' }).click();
  await expect(page.getByText("Saved. Your apprentice drafts for this client from Sunday's run.")).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: /^Needs attention/ })).toHaveCount(0);
});

test('clients: the owner sets a tone and pauses a client, which cancels its waiting reminder', async ({ page }) => {
  await page.goto('clients');
  await page.getByRole('button', { name: /^Greenway Strata/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Greenway Strata (Test data)' });
  await sheet.getByRole('radio', { name: 'Gentle' }).check();
  await expect(page.getByText('Saved. New drafts use the Gentle tone from Sunday. Waiting drafts keep their wording.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Pause reminders' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Pause reminders for Greenway Strata (Test data)?' });
  await expect(confirm).toContainText('Pausing cancels 1 waiting reminder.');
  await expect(confirm.getByRole('button', { name: 'Keep them on' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Pause reminders' }).click();
  await expect(page.getByText('Paused. 1 reminder cancelled.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Resume reminders' })).toBeVisible();
});

test('settings: an evening briefing is saved, with the checker note', async ({ page }) => {
  await page.goto('settings');
  await expect(page.getByText('Your briefing email comes every Monday.')).toBeVisible();
  await page.getByRole('radio', { name: '6:00 pm' }).check();
  await expect(page.getByText("Evening briefings don't nudge your checker.")).toBeVisible();
  await page.getByLabel('Style note (optional)').fill('Call them $5 off');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Leave out numbers, @ and $. Your apprentice adds the facts itself.')).toBeVisible();
  await page.getByLabel('Style note (optional)').fill('Warm and brief. First names.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved. Changes apply from the next run.')).toBeVisible();
  await page.goto('log');
  await expect(page.getByText('Alex Test changed the briefing time and style note')).toBeVisible();
});

test('settings: when Xero sends reminders too, the app says how to turn them off (FR-32)', async ({ page }) => {
  await page.goto('settings');
  await page.getByRole('radio', { name: 'Yes' }).check();
  await expect(page.getByText('In Xero, go to Sales, then Invoices, then Invoice reminders.')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved. Changes apply from the next run.')).toBeVisible();
  // The standing banner carries the same steps, with Xero's own help.
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByText('Xero may send reminders too,')).toBeVisible();
  await expect(page.getByRole('link', { name: "Xero's help (opens in a new tab)" }).first()).toHaveAttribute('href', /^https:\/\/central\.xero\.com\//);
});

test('settings: export all downloads a zip of CSV files', async ({ page }) => {
  await page.goto('settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^get-paid-export-harbour-line-electrical-test-data-\d{4}-\d{2}-\d{2}\.zip$/);
  const bytes = readFileSync((await file.path()) ?? '');
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  const text = bytes.toString('latin1');
  for (const name of ['README.txt', 'business.csv', 'members.csv', 'clients.csv', 'invoices.csv', 'reminder_drafts.csv', 'activity_log.csv']) {
    expect(text).toContain(name);
  }
});

test('settings: delete all needs the typed name, then signs the owner out', async ({ page }) => {
  await page.goto('settings');
  await page.getByRole('button', { name: 'Delete all' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete everything for this business?' });
  await expect(dialog.getByText('12 invoices')).toBeVisible();
  await expect(dialog.getByText('The button works once the name matches.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Delete everything' })).toHaveAttribute('aria-disabled', 'true');
  await dialog.getByLabel(/^Type the business name to confirm/).fill('harbour line electrical (test data)');
  await dialog.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('Your business data has been deleted. Your sign-in goes within 14 days.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the activity log filters by person and by invoice', async ({ page }) => {
  await page.goto('log');
  await expect(page.getByText('Alex Test joined as the owner')).toBeVisible();
  await page.getByLabel('Person').selectOption({ label: 'Your apprentice' });
  await expect(page.getByText('Alex Test joined as the owner')).toHaveCount(0);
  await expect(page.getByText('Your apprentice drafted a reminder for invoice 1066 from the Gentle template')).toBeVisible();
  await page.getByLabel('Person').selectOption({ label: 'Everyone' });
  await page.getByLabel('Invoice number').fill('9999');
  await page.getByLabel('Invoice number').press('Enter');
  await expect(page.getByText("There's no invoice 9999.")).toBeVisible();
});

test('More: contact the team sends the business code and nothing else', async ({ page }) => {
  await page.goto('more');
  await expect(page.getByText('Your business code is 0D5E0000.')).toBeVisible();
  const contact = page.getByRole('link', { name: 'Contact the team' });
  if ((await contact.count()) > 0) {
    const href = (await contact.getAttribute('href')) ?? '';
    expect(href).toContain('body=Business%20code%3A%200D5E0000');
    expect(href).not.toContain('owner%40example.test');
  }
});
