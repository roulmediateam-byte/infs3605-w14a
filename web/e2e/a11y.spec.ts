// WCAG 2.2 AA checks with axe on every screen and sheet (NFR-13; TRD, Testing and quality gates). axe finds about a
// third of problems; keyboard and screen-reader passes on Home and Review stay manual (QA-04).
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { DEMO_CSV, expect, OWNER, signIn, test } from './support.ts';

const check = async (page: Page, label: string) => {
  // Sheets and messages fade in; check contrast once they have finished moving.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `${label} has no WCAG A or AA violations`).toEqual([]);
};

test('sign-in, both steps', async ({ page }) => {
  await page.goto('');
  await check(page, 'Sign in');
  await page.getByLabel('Email').fill('stranger@example.test');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('Ask the owner to invite you.')).toBeVisible();
  await check(page, 'Sign in with an error');
});

test('every signed-in screen', async ({ page }) => {
  await signIn(page, OWNER);
  await expect(page.getByText('Owed to you')).toBeVisible();
  await check(page, 'Home');
  for (const [path, heading] of [
    ['invoices', 'Invoices'],
    ['clients', 'Clients'],
    ['log', 'Activity log'],
    ['settings', 'Settings'],
    ['more', 'More'],
    ['import', 'Import invoices'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await check(page, heading);
  }
  await page.locator('input[type=file]').setInputFiles(DEMO_CSV);
  await expect(page.getByRole('heading', { name: 'Check what will change' })).toBeVisible();
  await check(page, 'Import check');
});

test('review and its sheets', async ({ page }) => {
  await signIn(page, OWNER, 'review');
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  await check(page, 'Review');
  await page.getByText('Why this draft?').click();
  await check(page, 'Review with Why this draft? open');
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /^Reject the draft/ })).toBeVisible();
  await check(page, 'Reject sheet');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeVisible();
  await check(page, 'Edit');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Send this reminder' })).toBeVisible();
  await check(page, 'Send sheet');
  await page.getByRole('link', { name: 'Send from my email' }).click();
  await expect(page.getByRole('dialog', { name: 'Did it send?' })).toBeVisible();
  await check(page, 'Did it send?');
});

test('Escape closes a sheet and focus returns to the button that opened it', async ({ page }) => {
  await signIn(page, OWNER, 'review');
  const reject = page.getByRole('button', { name: 'Reject', exact: true });
  await reject.click();
  await expect(page.getByRole('dialog', { name: /^Reject the draft/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /^Reject the draft/ })).toBeHidden();
  await expect(reject).toBeFocused();
});

test('the layout works at 320 px wide without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await signIn(page, OWNER);
  await expect(page.getByText('Owed to you')).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const path of ['', 'review', 'invoices', 'clients', 'log', 'more', 'import', 'settings']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await overflow(), `/${path} fits 320 px`).toBeLessThanOrEqual(0);
  }
  // The import's check step, the demonstration's 1:00 beat, with its file name and total.
  await page.goto('import');
  await page.locator('input[type=file]').setInputFiles(DEMO_CSV);
  await expect(page.getByRole('heading', { name: 'Check what will change' })).toBeVisible();
  expect(await overflow(), 'the import check step fits 320 px').toBeLessThanOrEqual(0);
});

/**
 * Tabs through the page and returns each focused control that a sticky or fixed bar covers, even in part: what is
 * drawn at its top, middle and bottom must be the control itself, not a bar laid over it.
 */
const focusHiddenByBars = async (page: Page, presses: number): Promise<string[]> => {
  const hidden: string[] = [];
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press('Tab');
    const problem = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body || element.closest('dialog')) return null;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;
      const bars = Array.from(document.querySelectorAll<HTMLElement>('.review-top, .action-bar, .sticky-save, .nav, .locked-pinned'));
      const x = box.left + box.width / 2;
      for (const y of [box.top + 3, box.top + box.height / 2, box.bottom - 3]) {
        if (y < 0 || y > window.innerHeight) continue;
        const drawn = document.elementFromPoint(x, y);
        const bar = drawn ? bars.find((candidate) => candidate.contains(drawn) && !candidate.contains(element)) : undefined;
        if (bar) return `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40)}" under .${bar.classList[0]}`;
      }
      return null;
    });
    if (problem) hidden.push(problem);
  }
  return hidden;
};

test('focus is never hidden behind a sticky bar (WCAG 2.4.11)', async ({ page }) => {
  await signIn(page, OWNER, 'review');
  await expect(page.getByText('1 of 5', { exact: true })).toBeVisible();
  expect(await focusHiddenByBars(page, 24), 'Review').toEqual([]);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeFocused();
  expect(await focusHiddenByBars(page, 10), 'Edit').toEqual([]);
  await page.goto('settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  expect(await focusHiddenByBars(page, 45), 'Settings').toEqual([]);
});
