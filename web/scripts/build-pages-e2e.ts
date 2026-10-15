// Builds the site the way .github/workflows/pages.yml does, into web/site-e2e: the owners' build at the root and the
// demonstration build under demo/, both under a repository path, but pointed at the local stack. The e2e-pages tests
// then check what GitHub Pages serves: deep links through 404.html, the two builds side by side, and load speed.
// Usage, with the local stack running: npm run build:pages-e2e
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

export const PAGES_BASE = '/getpaid-apprentice/';
const web = path.resolve(import.meta.dirname, '..');

let text = '';
try {
  text = readFileSync(path.join(web, '.env.development.local'), 'utf8');
} catch {
  console.error('Start the local stack first (npm run stack, from the repository root): it writes web/.env.development.local.');
  process.exit(1);
}
const value = (name: string): string => text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
const common = {
  ...process.env,
  VITE_SUPABASE_URL: value('VITE_SUPABASE_URL'),
  VITE_SUPABASE_PUBLISHABLE_KEY: value('VITE_SUPABASE_PUBLISHABLE_KEY'),
  VITE_SUPPORT_EMAIL: 'support@getpaid.example',
};
const run = (args: string[], env: NodeJS.ProcessEnv): void => {
  execFileSync('npx', args, { cwd: web, stdio: 'inherit', env });
};
run(['tsc', '-b'], common);
run(['vite', 'build', '--outDir', 'site-e2e', '--emptyOutDir'], { ...common, BASE_PATH: PAGES_BASE, SUB_APPS: 'demo/' });
run(['vite', 'build', '--outDir', 'site-e2e/demo', '--emptyOutDir'], {
  ...common,
  BASE_PATH: `${PAGES_BASE}demo/`,
  VITE_HIDE_SCREENS: 'invoices,clients,settings',
});
// As in pages.yml: one 404.html for the whole site, which routes demo/ addresses to the demonstration build.
rmSync(path.join(web, 'site-e2e', 'demo', '404.html'), { force: true });
