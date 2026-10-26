// UI-01 Sign in (FR-01, NFR-07): invited people only, with the 6-digit code first; deep links survive sign-in.
import { CHECKER, endSessions, expect, expireStoredSession, latestCode, latestLink, OWNER, personalStorage, signIn, sql, test } from './support.ts';

test('an uninvited email is told to ask the owner', async ({ page }) => {
  await page.goto('');
  await page.getByLabel('Email').fill('stranger@example.test');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('Ask the owner to invite you.')).toBeVisible();
});

test('a wrong code is refused, and the right one signs the owner in to Home', async ({ page }) => {
  await page.goto('');
  await expect(page).toHaveTitle('Sign in · Payprentice');
  await page.getByLabel('Email').fill(OWNER);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('It works once, for 1 hour.')).toBeVisible();
  const code = await latestCode(OWNER);
  const wrong = code === '000000' ? '111111' : '000000';
  await page.getByLabel('6-digit code').fill(wrong.slice(0, 5));
  await page.getByLabel('6-digit code').press(wrong.slice(5));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText("That code didn't work. Check the 6 digits, or ask for a new code.")).toBeVisible();
  // "Send a new code" waits a moment before it works again, and looks it: secondary text (slate-600), not link blue.
  const resend = page.getByRole('button', { name: 'Send a new code' });
  if ((await resend.getAttribute('aria-disabled')) === 'true') {
    await expect(resend).toHaveCSS('color', 'rgb(71, 85, 105)');
  }
  // Pasting the code signs in straight away (the phone's one-time-code autofill does the same).
  await page.getByLabel('6-digit code').fill(code);
  await expect(page.getByRole('heading', { level: 1, name: 'Harbour Line Electrical (Test data)' })).toBeVisible();
  await expect(page.getByText('$62,440.00')).toBeVisible();
  await expect(page.getByText('$42,790.00')).toBeVisible();
  await expect(page.getByText('$7,050.00 due in the next 7 days')).toBeVisible();
  await expect(page.getByRole('heading', { name: '5 drafts need your OK' })).toBeVisible();
});

test('a deep link from the briefing email survives sign-in', async ({ page }) => {
  await signIn(page, OWNER, 'review');
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Invoice 1066, $18,700.00, 8 days overdue' })).toBeVisible();
});

test('when the session ends mid-task, a sign-in sheet brings the person straight back', async ({ page }) => {
  await signIn(page);
  await expect(page.getByText('$62,440.00')).toBeVisible();
  await endSessions();
  await page.getByRole('link', { name: 'Review drafts' }).click();
  const sheet = page.getByRole('alertdialog', { name: 'Sign in again to carry on' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(1100); // the local stack allows one code a second in tests
  await sheet.getByRole('button', { name: 'Email me a code' }).click();
  // Read the code only once the new one has been sent, or the old, used one comes back.
  await expect(sheet.getByText('Type the 6-digit code from your email.')).toBeVisible();
  await sheet.getByLabel('6-digit code').fill(await latestCode(OWNER));
  await expect(sheet).toBeHidden();
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
});

test('signing out ends the session on this device and forgets the person', async ({ page }) => {
  await signIn(page);
  await page.goto('more');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // A deliberate sign-out starts again at sign-in, not at More, and the next person sees an empty email field.
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByLabel('Email')).toHaveValue('');
  expect(await personalStorage(page)).toEqual([]);
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // The next person lands on Home, not on the screen the last person left from.
  await page.getByLabel('Email').fill(CHECKER);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('Type the 6-digit code from your email.')).toBeVisible();
  await page.getByLabel('6-digit code').fill(await latestCode(CHECKER));
  await expect(page.getByText('Owed to you')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('signing out offline, with a session that needs refreshing, still forgets it on this device', async ({ page, context }) => {
  await signIn(page);
  await expect(page.getByText('Owed to you')).toBeVisible();
  // The access token runs out while the phone has no signal.
  await expireStoredSession(page);
  await context.setOffline(true);
  await page.getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await personalStorage(page)).toEqual([]);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue('');
});

test('offline with a session that needs refreshing, the app says it is offline, then carries on', async ({ page, context }) => {
  await signIn(page);
  await expect(page.getByText('Owed to you')).toBeVisible();
  // The app shell must be cached before the phone loses its signal, as it is after a first visit.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expireStoredSession(page);
  await context.setOffline(true);
  await page.reload();
  // The service worker opens the app shell; with no signal the session can't be refreshed, which is not a sign-out.
  await expect(page.getByText("You're offline. This will load when you're back online.")).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Owed to you')).toBeVisible();
});

test('the emailed link signs in, and its tokens are kept out of the browser history', async ({ page }) => {
  await page.goto('');
  await page.getByLabel('Email').fill(OWNER);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('Type the 6-digit code from your email.')).toBeVisible();
  const link = await latestLink(OWNER);
  await page.goto(link);
  await expect(page.getByText('Owed to you')).toBeVisible();
  expect(page.url()).not.toContain('access_token');
  await page.goBack();
  expect(page.url()).not.toContain('access_token');
  // The link works once: opened again after signing out, it says so and offers a new code.
  await page.goto('more');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.goto(link);
  await expect(page.getByText("That sign-in link didn't work. It may have expired or been used. Send a new code.")).toBeVisible();
  expect(page.url()).not.toContain('error_code');
});

test('switching business from More opens the chosen business on Home', async ({ page }) => {
  // A second business for the same owner (a bookkeeper would see several): Test data only.
  sql(`insert into public.businesses (id, name, owner_name, sign_off, reply_to_email, xero_reminders)
       values ('0d5e0000-0000-4000-8000-0000000000b2', 'Ridgeway Plumbing (Test data)', 'Alex Test', 'Thanks,', 'accounts@ridgeway.example', 'off');
       insert into public.memberships (business_id, invited_email, display_name, role, status)
       values ('0d5e0000-0000-4000-8000-0000000000b2', 'owner@example.test', 'Alex Test', 'owner', 'invited');`);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Choose a business' })).toBeVisible();
  await page.getByRole('button', { name: /Harbour Line Electrical/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Harbour Line Electrical (Test data)' })).toBeVisible();
  await page.getByRole('link', { name: 'More', exact: true }).click();
  await page.getByRole('link', { name: 'Switch business' }).click();
  await page.getByRole('button', { name: /Ridgeway Plumbing/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ridgeway Plumbing (Test data)' })).toBeVisible();
  await expect(page).not.toHaveURL(/choose=1/);
  await expect(page.getByRole('heading', { name: 'Choose a business' })).toHaveCount(0);
});
