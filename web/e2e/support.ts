// Shared steps for the end-to-end tests. Every test starts from the seed: Harbour Line Electrical (Test data), with
// 12 open invoices (A$62,440.00 owed, A$42,790.00 overdue) and 5 waiting drafts (1066, 1051, 1056, 1043, 1062).
import { expect, test as base, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const STACK = process.env.E2E_STACK_URL ?? 'http://127.0.0.1:54321';
export const OWNER = 'owner@example.test';
export const CHECKER = 'checker@example.test';
export const DEMO_CSV = path.join(tmpdir(), 'getpaid-e2e', 'demo-import.csv');
export const SHORT_CSV = path.join(tmpdir(), 'getpaid-e2e', 'two-rows.csv');
export const NOT_CSV = path.join(tmpdir(), 'getpaid-e2e', 'invoices.pdf');

export const resetStack = async (): Promise<void> => {
  const response = await fetch(`${STACK}/__local/reset`, { method: 'POST' });
  expect(response.ok, 'the local stack resets to the seed').toBe(true);
};

export const latestCode = async (email: string): Promise<string> => {
  const response = await fetch(`${STACK}/__local/codes?email=${encodeURIComponent(email)}`);
  expect(response.ok, `a code was requested for ${email}`).toBe(true);
  return ((await response.json()) as { code: string }).code;
};

/** The emailed sign-in link from the latest request, as Supabase's email carries it. */
export const latestLink = async (email: string): Promise<string> => {
  const response = await fetch(`${STACK}/__local/codes?email=${encodeURIComponent(email)}`);
  expect(response.ok, `a link was requested for ${email}`).toBe(true);
  return ((await response.json()) as { link: string }).link;
};

/** Runs SQL against the local stack's database as its owner. Synthetic Test data only (RI-9). */
export const sql = (statement: string): string =>
  execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', process.env.LOCAL_DB ?? 'getpaid_dev', '-c', statement], {
    encoding: 'utf8',
  }).trim();

/** Makes the stored session's access token look expired, as after an hour away, so the next use must refresh it. */
export const expireStoredSession = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((item) => item.startsWith('gpa.auth.') && !item.endsWith('-user'));
    const session = key ? (JSON.parse(window.localStorage.getItem(key) ?? 'null') as { expires_at: number } | null) : null;
    if (!key || !session) throw new Error('No stored session');
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    window.localStorage.setItem(key, JSON.stringify(session));
  });

/** What this app keeps in localStorage, apart from the device's own settings (src/lib/storage.ts). */
export const personalStorage = (page: Page): Promise<string[]> =>
  page.evaluate(() => Object.keys(window.localStorage).filter((key) => key.startsWith('gpa.') && !['gpa.shortcuts', 'gpa.fromLineTipSeen'].includes(key)));

export const endSessions = async (): Promise<void> => {
  const response = await fetch(`${STACK}/__local/end-sessions`, { method: 'POST' });
  expect(response.ok).toBe(true);
};

/** Signs in with the emailed code, starting from a path, and waits until the app is past sign-in. */
export const signIn = async (page: Page, email: string = OWNER, start = ''): Promise<void> => {
  await page.goto(start);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('Type the 6-digit code from your email.')).toBeVisible();
  await page.getByLabel('6-digit code').fill(await latestCode(email));
  await expect(page.getByLabel('6-digit code')).toBeHidden();
};

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 768;

/** Each test starts from a freshly seeded database. */
export const test = base.extend<{ fresh: void }>({
  fresh: [
    async ({}, use) => {
      await resetStack();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
