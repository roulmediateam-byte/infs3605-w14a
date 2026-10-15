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
  await ready.getByRole('button', { name: /Bayside Builders \(Test data\)/ }).click();
  await owner.getByRole('link', { name: 'Send from my email' }).click();
  await owner.getByRole('button', { name: 'Sent', exact: true }).click();
  await expect(owner.getByText('Sent.')).toBeVisible();
  await owner.goto('log?invoice=1066');
  await expect(owner.getByText('Jo Test approved the reminder for invoice 1066')).toBeVisible();
  await expect(owner.getByText('Alex Test sent the reminder for invoice 1066 from their email')).toBeVisible();
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
