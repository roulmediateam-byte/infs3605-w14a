import { defineConfig, devices } from '@playwright/test';

// Tests of the site as GitHub Pages serves it (e2e-pages/): the Pages-shaped build from `npm run build:pages-e2e`,
// served by a stand-in for Pages (scripts/serve-pages.ts), against the local stack. Phone only: the redirects
// don't depend on the screen, and load speed is measured on a phone.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e-pages',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-pages' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4180/getpaid-apprentice/',
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: 'node scripts/serve-pages.ts',
    url: 'http://127.0.0.1:4180/getpaid-apprentice/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
