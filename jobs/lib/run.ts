// Shared plumbing for the job entry points: exit codes, safe logging and a small concurrency pool.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redact } from './db.ts';

export type DueRow = { business_id: string | null; period_key: string };
export type StartResult = { run_id: string; proceed: boolean; reason: string };

// Logs one JSON line per event. Callers pass ids and counts only, never names, emails or message text (NFR-04).
export function log(job: string, event: string, data: Record<string, string | number | boolean | null> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), job, event, ...data }));
}

export function safeMessage(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export async function runMain(job: string, body: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await body();
  } catch (error) {
    log(job, 'crashed', { error: safeMessage(error) });
    process.exitCode = 1;
  }
}

// Runs fn over items with at most `limit` in flight, keeping the input order in the results.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

// True when the file was started with `node jobs/<name>.ts`, false when a test imports it.
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && metaUrl === pathToFileURL(resolve(entry)).href;
}
