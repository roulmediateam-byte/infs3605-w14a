// UI-03 to UI-06, Journey 2: approve, edit with the facts locked, reject with a reason and send from the person's own
// email, one decision at a time, with every step confirmed by the server and written to the activity log.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEMO_CSV, expect, isPhone, OWNER, signIn, test } from './support.ts';

test.beforeEach(async ({ page }) => {
  await signIn(page, OWNER, 'review');
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
});

test('approve, then send from my email, and the count moves on', async ({ page }) => {
  const draft = page.getByRole('region', { name: 'Invoice 1066, $18,700.00, 8 days overdue' });
  await expect(draft.getByText('Locked facts, from your records')).toBeVisible();
  await expect(draft.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByText('Approving lets you send this to accounts@bayside-builders.example from your own email.')).toBeVisible();

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Send this reminder' });
  await expect(sheet).toBeVisible();
  await expect(page.getByText('Approved. Now send it from your email.')).toBeVisible();
  await expect(sheet.getByText('This opens your email app. Check it sends from your business address.')).toBeVisible();
  await expect(sheet.getByText('Approved text')).toBeVisible();

  // The pre-filled email: encodeURIComponent, so spaces are %20 and line breaks %0D%0A (TRD, Sending reminders).
  const link = sheet.getByRole('link', { name: 'Send from my email' });
  const href = (await link.getAttribute('href')) ?? '';
  expect(href).toMatch(/^mailto:accounts@bayside-builders\.example\?subject=Quick%20reminder%3A%20invoice%201066&body=Hi%20Sam%2C%0D%0A%0D%0AHope/);
  expect(href).not.toContain('+');
  await link.click();

  const question = page.getByRole('dialog', { name: 'Did it send?' });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Sent', exact: true }).click();
  await expect(page.getByText('Sent. 4 left.')).toBeVisible();
  await expect(page.getByText('2 of 5', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Invoice 1051,/ })).toBeVisible();

  await page.goto('log?invoice=1066');
  await expect(page.getByText('Alex Test sent the reminder for invoice 1066 from their email')).toBeVisible();
  await expect(page.getByText('Alex Test approved the reminder for invoice 1066')).toBeVisible();
});

test('an edit that changes the amount is refused; a reworded one is saved and approved', async ({ page }) => {
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('link', { name: 'Send from my email' }).click();
  await page.getByRole('button', { name: 'Not yet', exact: true }).click();
  await expect(page.getByText('2 of 5', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Locked facts' })).toContainText('$8,450.00');
  const message = page.getByLabel('Message');
  const original = await message.inputValue();
  await message.fill(original.replace('$8,450.00', '$8,000.00'));
  await page.getByRole('button', { name: 'Save and approve' }).click();
  await expect(page.getByText('Keep $8,450.00 and invoice 1051 as they are.')).toBeVisible();

  await message.fill(original.replace('Hi Priya,', 'Hi Priya, hope the week is going well.'));
  await page.getByRole('button', { name: 'Show changes' }).click();
  await expect(page.getByText('hope the week is going well.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to editing' }).click();
  await page.getByRole('button', { name: 'Save and approve' }).click();
  const sheet = page.getByRole('dialog', { name: 'Send this reminder' });
  await expect(sheet.getByText('Hi Priya, hope the week is going well.')).toBeVisible();
  // Behind the sheet, the draft now shows the frozen text, edit included, as "Approved text" (UI brief, Review).
  const approved = page.locator('main .draft-surface.approved');
  await expect(approved).toContainText('Approved text');
  await expect(approved).toContainText('Hi Priya, hope the week is going well.');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('3 of 5', { exact: true })).toBeVisible();

  await page.goto('log?invoice=1051');
  await expect(page.getByText('Alex Test approved the reminder for invoice 1051 after editing it')).toBeVisible();
  await expect(page.getByText('Alex Test edited the reminder for invoice 1051')).toBeVisible();
});

test('closing the editor with changes asks first', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  // Focus moves to the editor's title, and the pinned facts say "Locked" in words too.
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeFocused();
  await expect(page.locator('.locked-pinned')).toContainText('Locked facts');
  await page.getByLabel('Subject').fill('A new subject for invoice 1066');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Discard your changes?' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
});

test('a review opened again after an import counts only the drafts still waiting', async ({ page }) => {
  // Review was open (so its list was kept) before an import cancelled two drafts: nobody else decided them.
  await page.getByRole('button', { name: 'Close review' }).click();
  await expect(page.getByText('Owed to you')).toBeVisible();
  await page.getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('link', { name: 'Import invoices' }).click();
  await page.locator('input[type=file]').setInputFiles(DEMO_CSV);
  await page.getByRole('button', { name: 'Import 12 invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByRole('heading', { name: '3 drafts need your OK' })).toBeVisible();
  await page.getByRole('link', { name: 'Review drafts' }).click();
  await expect(page.getByText('1 of 3', { exact: true })).toBeVisible();
  await expect(page.getByText(/while you were reviewing/)).toHaveCount(0);
  // Home's "Owed to you" opens the open invoices it adds up, not the one the import closed.
  await page.getByRole('button', { name: 'Close review' }).click();
  await page.getByRole('link', { name: /^Owed to you/ }).click();
  await expect(page).toHaveURL(/filter=open/);
  await expect(page.getByText('12 invoices', { exact: true })).toBeVisible();
});

test('reject needs a reason, and "Other" needs a few words', async ({ page }) => {
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Reject the draft for invoice 1066?' });
  await sheet.getByRole('button', { name: 'Reject draft' }).click();
  await expect(sheet.getByText('Pick a reason.')).toBeVisible();
  await sheet.getByRole('radio', { name: 'Other' }).check();
  await sheet.getByRole('button', { name: 'Reject draft' }).click();
  await expect(sheet.getByText('Add a few words.')).toBeVisible();
  await sheet.getByRole('radio', { name: "I'll call them" }).check();
  await sheet.getByRole('button', { name: 'Reject draft' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Rejected. 4 left.')).toBeVisible();
  await expect(page.getByText('2 of 5', { exact: true })).toBeVisible();
  await page.goto('log?invoice=1066');
  await expect(page.getByText("Alex Test rejected the reminder for invoice 1066: I'll call them")).toBeVisible();
});

test('"Didn\'t open? Copy instead" sends by copying, and the log says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Send this reminder' });
  await sheet.getByRole('button', { name: "Didn't open? Copy instead" }).click();
  await sheet.getByRole('button', { name: 'Copy message' }).click();
  const question = page.getByRole('dialog', { name: 'Did it send?' });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Sent', exact: true }).click();
  await expect(page.getByText('2 of 5', { exact: true })).toBeVisible();
  await page.goto('log?invoice=1066');
  await expect(page.getByText('Alex Test sent the reminder for invoice 1066 by copying it into their email')).toBeVisible();
});

test('a reload while "Did it send?" is open asks again', async ({ page }) => {
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('link', { name: 'Send from my email' }).click();
  await expect(page.getByRole('dialog', { name: 'Did it send?' })).toBeVisible();
  await page.reload();
  const question = page.getByRole('dialog', { name: 'Did it send?' });
  await expect(question).toBeVisible();
  await expect(question.getByText('Quick reminder: invoice 1066')).toBeVisible();
  await question.getByRole('button', { name: 'Not yet', exact: true }).click();
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Ready to send (1)' })).toBeVisible();
  await expect(page.getByText('Invoice 1066 · Send by Sun 9:00 pm')).toBeVisible();
});

test('a full review ends with the summary and the review is logged', async ({ page }) => {
  for (let i = 0; i < 5; i += 1) {
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: /^Reject the draft/ });
    await sheet.getByRole('radio', { name: 'Wrong tone' }).check();
    await sheet.getByRole('button', { name: 'Reject draft' }).click();
    await expect(sheet).toBeHidden();
  }
  await expect(page.getByRole('heading', { name: 'All caught up: 5 rejected' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Home' }).click();
  await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
  await page.goto('log');
  await expect(page.getByText(/^Alex Test reviewed 5 drafts in \d+ min: 5 rejected$/)).toBeVisible();
});

test('a draft whose invoice changes during the review gives way, with the reason', async ({ page }) => {
  // In another tab, an import shows invoice 1066 part-paid (BR-05, AT-03); the import cancels its waiting draft.
  const file = path.join(tmpdir(), 'getpaid-e2e', 'part-paid.csv');
  writeFileSync(file, readFileSync(DEMO_CSV, 'utf8').replace('"18700.00"', '"17000.00"'));
  const other = await page.context().newPage();
  await other.goto('import');
  await other.locator('input[type=file]').setInputFiles(file);
  await other.getByRole('button', { name: /^Import \d+ invoices$/ }).click();
  await expect(other.getByRole('heading', { name: 'Done' })).toBeVisible();
  await other.close();

  await page.bringToFront();
  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  if (await approve.isVisible()) await approve.click();
  await expect(page.getByText("Cancelled: the amount changed in your latest import. It's under Needs attention.")).toBeVisible();
  await page.getByRole('button', { name: 'Next draft' }).click();
  await expect(page.getByRole('region', { name: /^Invoice 1056,/ })).toBeVisible();
});

test('on a computer the queue sits beside the draft, and keyboard shortcuts work once turned on', async ({ page }) => {
  test.skip(isPhone(page), 'The split view and shortcuts are for computers.');
  const queue = page.getByRole('navigation', { name: 'Drafts in this review' });
  await expect(queue).toBeVisible();
  await expect(queue.getByRole('button')).toHaveCount(5);
  await page.goto('more');
  await page.getByLabel('Use keyboard shortcuts in Review on this device').check();
  await page.goto('review');
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.getByRole('region', { name: /^Invoice 1051,/ })).toBeVisible();
  await page.keyboard.press('k');
  await expect(page.getByRole('region', { name: /^Invoice 1066,/ })).toBeVisible();
  await page.keyboard.press('Shift+A');
  await expect(page.getByRole('dialog', { name: 'Send this reminder' })).toBeVisible();
});
