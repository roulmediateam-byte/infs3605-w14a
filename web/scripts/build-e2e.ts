// Builds the app against the local stack, exactly as CI does before the end-to-end tests. A production build reads
// no .env.development* file, so this passes on the address and key the stack wrote to web/.env.development.local,
// plus a placeholder support address so "Contact the team" can be tested.
// Usage, with the local stack running: npm run build:e2e
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let text = '';
try {
  text = readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8');
} catch {
  console.error('Start the local stack first (npm run stack, from the repository root): it writes web/.env.development.local.');
  process.exit(1);
}
const value = (name: string): string => text.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
const env = {
  ...process.env,
  VITE_SUPABASE_URL: value('VITE_SUPABASE_URL'),
  VITE_SUPABASE_PUBLISHABLE_KEY: value('VITE_SUPABASE_PUBLISHABLE_KEY'),
  VITE_SUPPORT_EMAIL: process.env.VITE_SUPPORT_EMAIL ?? 'support@getpaid.example',
};
execFileSync('npx', ['tsc', '-b'], { stdio: 'inherit', env });
execFileSync('npx', ['vite', 'build'], { stdio: 'inherit', env });
