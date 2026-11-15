import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run the built app against the local stack (scripts/local-stack): the real migrations, row-level
// security and functions behind PostgREST, with a stand-in for Supabase Auth's email codes. Start the stack first:
//   PGHOST=... node ../scripts/local-stack/gateway.ts      (LOCAL_STACK_OTP_INTERVAL=1 for tests)
// then build with VITE_SUPABASE_URL=http://127.0.0.1:54321 and the stack's anon key, and run: npx playwright test
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // On CI, a broken run stops after 5 failed tests or 12 minutes instead of using up the job's time limit.
  maxFailures: process.env.CI ? 5 : 0,
  globalTimeout: process.env.CI ? 12 * 60_000 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173/',
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, launchOptions: { executablePath } },
    },
    {
      name: 'computer',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 }, launchOptions: { executablePath } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173/',
        reuseExistingServer: true,
        timeout: 30_000,
      },
});
