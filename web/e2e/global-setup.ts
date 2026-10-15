// Checks the local stack is running and writes the test files: the Week 7 demonstration import (built from the seed
// by scripts/make-demo-csv.sql, so its dates match today's seed), a two-row file and a file that isn't a CSV.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_CSV, NOT_CSV, SHORT_CSV, STACK } from './support.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function globalSetup(): Promise<void> {
  const health = await fetch(`${STACK}/__local/health`).catch(() => null);
  if (!health?.ok) throw new Error(`The local stack isn't running at ${STACK}. Start it with: node scripts/local-stack/gateway.ts`);
  await fetch(`${STACK}/__local/reset`, { method: 'POST' });
  mkdirSync(path.dirname(DEMO_CSV), { recursive: true });
  const csv = execFileSync('psql', ['-X', '-q', '-d', process.env.LOCAL_DB ?? 'getpaid_dev', '-f', path.join(root, 'scripts', 'make-demo-csv.sql')], {
    encoding: 'utf8',
  });
  writeFileSync(DEMO_CSV, csv);
  const [header = '', first = '', second = ''] = csv.trim().split('\n');
  writeFileSync(SHORT_CSV, [header, first, second, ''].join('\n'));
  writeFileSync(NOT_CSV, '%PDF-1.7\n%âãÏÓ\n1 0 obj\n');
}
