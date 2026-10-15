// UI-08, Journey 4 (FR-04 to FR-06): every row and the total are checked before anything is saved, a bad row is
// skipped with its reason, and a file that would close most open invoices is stopped. This is the demonstration's
// import beat: 13 rows, one skipped for a bad date; 1043 closes and 1051 drops by A$450.00.
import { DEMO_CSV, expect, NOT_CSV, OWNER, SHORT_CSV, signIn, test } from './support.ts';

test.beforeEach(async ({ page }) => {
  await signIn(page, OWNER, 'import');
  await expect(page.getByRole('heading', { name: 'Upload your open invoices' })).toBeVisible();
});

test('the demonstration file: preview, problems, what will change, then the result and Home', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles(DEMO_CSV);
  await expect(page.getByRole('heading', { name: 'Check what will change' })).toBeVisible();
  await expect(page.getByText('demo-import.csv: 13 rows, totalling $61,910.00.')).toBeVisible();
  await expect(page.getByText('Columns matched automatically.')).toBeVisible();
  await expect(
    page.getByText("12 invoices will be saved and 1 row skipped. 1 invoice isn't in this file and will be closed, and 2 reminders will be cancelled."),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: "1 row can't be imported" })).toBeVisible();
  await expect(page.getByText('Issue date is not a date (use DD/MM/YYYY)')).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Greenway Strata (Test data)');

  await page.getByRole('button', { name: 'Import 12 invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  await expect(page.getByText('1 added, 1 updated, 1 closed, 2 reminders cancelled.')).toBeVisible();
  await expect(page.getByText("1 row skipped, so $61,500.00 of the file's $61,910.00 was saved.")).toBeVisible();

  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByText('$61,500.00')).toBeVisible();
  await expect(page.getByText('$41,090.00')).toBeVisible();
  await expect(page.getByRole('heading', { name: '3 drafts need your OK' })).toBeVisible();
  const attention = page.getByRole('region', { name: /Needs attention/ }).or(page.locator('section', { hasText: 'Needs attention' }));
  await expect(attention.first()).toContainText('invoice 1051: the amount changed in your latest import, so its reminder was cancelled.');
  await expect(attention.first()).toContainText('It went from $8,450.00 to $8,000.00.');
  await attention.first().getByRole('button', { name: 'Checked, dismiss' }).click();
  await expect(page.getByText('Dismissed. The log keeps it.')).toBeVisible();
});

test('a file that would close most open invoices is stopped, with the safe choice first', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles(SHORT_CSV);
  await expect(page.getByRole('heading', { name: 'Check what will change' })).toBeVisible();
  await expect(page.getByText("That's most of your open invoices. Check this is your full list of unpaid invoices.")).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 invoices' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Check this is your full list' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('This file would close 10 of your 12 open invoices. Check it is your full list of unpaid invoices, then confirm again.');
  await expect(dialog.getByRole('button', { name: 'Choose another file' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Close them anyway' }).click();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  await expect(page.getByText(/10 closed/)).toBeVisible();
});

test('a file that is not a CSV is refused before anything is read', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles(NOT_CSV);
  await expect(page.getByText("This file isn't a CSV. In Xero, export your invoices as CSV and try again.")).toBeVisible();
});

test('columns that are not recognised are matched by hand', async ({ page }) => {
  await page.locator('input[type=file]').setInputFiles({
    name: 'odd-columns.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Customer name,Mail,Who,Ref,Raised,Pay by,Owing\n' +
        'Bayside Builders (Test data),accounts@bayside-builders.example,Sam,1066,07/09/2026,07/10/2026,"18700.00"\n',
    ),
  });
  await expect(page.getByRole('heading', { name: 'Match your columns' })).toBeVisible();
  await page.getByRole('button', { name: 'Check the file' }).click();
  await expect(page.getByText('Choose a column for Due date.')).toBeVisible();
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue('Customer name');
  await page.getByLabel('Email', { exact: true }).selectOption('Mail');
  await page.getByLabel('Invoice number').selectOption('Ref');
  await page.getByLabel('Issue date').selectOption('Raised');
  await page.getByLabel('Due date').selectOption('Pay by');
  await page.getByLabel('Amount due').selectOption('Owing');
  await page.getByRole('button', { name: 'Check the file' }).click();
  await expect(page.getByRole('heading', { name: 'Check what will change' })).toBeVisible();
  await expect(page.getByText('1 invoice will be saved.')).toBeVisible();
});
