// Journey 3 (FR-25, D3): the checker approves while the owner is on site; the owner sends later. The checker never
// sees Settings, tones or pausing, and the server refuses those actions anyway (AT-09).
import { CHECKER, expect, OWNER, signIn, test } from './support.ts';

test('the checker approves, and the owner sends from Ready to send', async ({ page, browser }) => {
  await signIn(page, CHECKER, 'review');
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  await expect(page.getByText('Approving hands this to Alex to send.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved. Alex sends it.')).toBeVisible();
  await expect(page.getByText('2 of 5', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Send this reminder' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Close review' }).click();
  await expect(page.getByText('1 approved reminder is waiting for Alex to send.')).toBeVisible();
  await page.getByRole('link', { name: 'More', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);

  // The owner, on another device, sees who approved it and sends it.
  const owner = await browser.newPage();
  await signIn(owner, OWNER);
  await expect(owner.getByRole('heading', { name: 'Ready to send (1)' })).toBeVisible();
  await expect(owner.getByText('Approved by Jo Test.')).toBeVisible();
  const ready = owner.locator('section', { has: owner.getByRole('heading', { name: 'Ready to send (1)' }) });
  await expect(ready).toContainText('Bayside Builders (Test data)');
  await ready.getByRole('button', { name: 'Send the reminder for invoice 1066' }).click();
  await owner.getByRole('link', { name: 'Send from my email' }).click();
  await owner.getByRole('button', { name: 'Sent', exact: true }).click();
  await expect(owner.getByText('Sent. None left to send.')).toBeVisible();
  await owner.goto('log?invoice=1066');
  await expect(owner.getByText('Jo Test approved the reminder for invoice 1066')).toBeVisible();
  await expect(owner.getByText('Alex Test sent the reminder for invoice 1066 from their email')).toBeVisible();
  await owner.close();
});

test('when the checker has approved everything, both Homes say the reminders are not sent yet', async ({ page, browser }) => {
  await signIn(page, CHECKER, 'review');
  for (let i = 1; i <= 5; i += 1) {
    await expect(page.getByText(`${i} of 5`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
  }
  // The checker's summary says who sends, not "All caught up".
  await expect(page.getByRole('heading', { name: '5 approved for Alex to send' })).toBeVisible();
  await expect(page.getByText("Waiting for Alex to send them by Sun 9:00 pm, when Sunday's run replaces them.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send the next one' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Home' }).click();
  const card = page.locator('.action-card');
  await expect(card.getByRole('heading', { name: '5 reminders approved, not sent yet' })).toBeVisible();
  await expect(card.getByText("Waiting for Alex to send them by Sun 9:00 pm, when Sunday's run replaces them.")).toBeVisible();
  await expect(card.getByRole('button')).toHaveCount(0);

  // The owner's Home leads with sending them, not with "All caught up" (Journey 3).
  const owner = await browser.newPage();
  await signIn(owner, OWNER);
  const ownerCard = owner.locator('.action-card');
  await expect(ownerCard.getByRole('heading', { name: '5 reminders approved, not sent yet' })).toBeVisible();
  await expect(ownerCard.getByText("Send by Sun 9:00 pm, when Sunday's run replaces them.")).toBeVisible();
  await ownerCard.getByRole('button', { name: 'Send the next one' }).click();
  // The largest first, as Review orders them.
  await expect(owner.getByRole('dialog', { name: 'Send this reminder' }).getByText('Quick reminder: invoice 1066')).toBeVisible();
  await owner.close();
});

test('when both decide the same draft, the second sees who decided it', async ({ page, browser }) => {
  await signIn(page, CHECKER, 'review');
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  const owner = await browser.newPage();
  await signIn(owner, OWNER, 'review');
  await owner.getByRole('button', { name: 'Reject', exact: true }).click();
  await owner.getByRole('radio', { name: 'Already paid' }).check();
  await owner.getByRole('button', { name: 'Reject draft' }).click();
  await expect(owner.getByText('2 of 5', { exact: true })).toBeVisible();
  await owner.close();

  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  if (await approve.isVisible()) await approve.click();
  await expect(page.getByText(/^Already rejected by Alex at \d{1,2}:\d{2} [ap]m\.$/)).toBeVisible();
});

test('a checker who may not send is refused by the server too', async ({ page }) => {
  await signIn(page, CHECKER);
  const refusal = await page.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('gpa.auth.') && !k.endsWith('-user'));
    const session = JSON.parse(localStorage.getItem(key ?? '') ?? '{}') as { access_token: string };
    const base = 'http://127.0.0.1:54321/rest/v1/rpc';
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` };
    const queue = (await (await fetch(`${base}/review_queue`, { method: 'POST', headers, body: JSON.stringify({ p_business_id: '0d5e0000-0000-4000-8000-000000000001' }) })).json()) as {
      draft_id: string;
    }[];
    const draftId = queue[0]?.draft_id;
    await fetch(`${base}/approve_draft`, { method: 'POST', headers, body: JSON.stringify({ p_draft_id: draftId }) });
    const payload = await fetch(`${base}/get_send_payload`, { method: 'POST', headers, body: JSON.stringify({ p_draft_id: draftId }) });
    const settings = await fetch(`${base}/update_settings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_business_id: '0d5e0000-0000-4000-8000-000000000001', p_changes: { briefing_time: '18:00' } }),
    });
    return { payload: await payload.json(), settings: await settings.json() };
  });
  expect(refusal.payload).toMatchObject({ ok: false, code: 'checker_may_not_send', message: 'Only the owner sends reminders for this business.' });
  expect(refusal.settings).toMatchObject({ code: '42501', message: "You don't have permission to do that." });
});
