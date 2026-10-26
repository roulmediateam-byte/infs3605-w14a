// See the app in one command, with no database: builds the click-through preview (PGlite runs the real migrations and
// the Test data seed inside the browser tab), then serves it on http://127.0.0.1:4174. Ctrl+C stops it.
// Usage, in web/: npm ci (once), then npm run demo
// It runs Vite's own script with this Node, not through npx or a shell, so it works the same on Windows, macOS and Linux.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const web = path.resolve(import.meta.dirname, '..');
const vitePackage = createRequire(import.meta.url).resolve('vite/package.json');
const viteBin = (JSON.parse(readFileSync(vitePackage, 'utf8')) as { bin: { vite: string } }).bin.vite;
const vite = path.join(path.dirname(vitePackage), viteBin);

// The same switch as VITE_BACKEND=preview on the command line (web/README.md, "The click-through preview").
process.env.VITE_BACKEND = 'preview';

// Runs Vite and resolves with its exit code, or null if Ctrl+C (or another signal) stopped it.
const run = (args: string[]): Promise<number | null> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vite, ...args], { cwd: web, stdio: 'inherit', env: process.env });
    const stop = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      resolve(signal ? null : (code ?? 1));
    });
  });

const built = await run(['build', '--outDir', 'dist-preview', '--emptyOutDir']);
if (built !== 0) process.exit(built ?? 130);

console.log('\nOpen http://127.0.0.1:4174 and sign in as owner@example.test: the code appears on screen. Ctrl+C stops it.\n');
const served = await run(['preview', '--outDir', 'dist-preview', '--port', '4174', '--strictPort']);
process.exit(served ?? 0);
