// End-to-end check without Docker: runs the real job code against the real database functions, through a
// psql-backed stand-in for Supabase's REST endpoint (JSON keys become named arguments, set-returning functions
// become arrays). It proves the jobs and the SQL agree on every function name, argument and result.
// scripts/test-local.sh runs it after the pgTAP tests, against the seeded scratch database.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runBriefings } from '../jobs/briefing.ts';
import type { AiReply } from '../jobs/lib/claude.ts';
import { runWeekly } from '../jobs/weekly-run.ts';

const database = process.env.TEST_DB ?? 'getpaid_test';
const psql = (sql: string): string =>
  execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], { encoding: 'utf8' }).trim();
const literal = (value: unknown): string =>
  value === null || value === undefined ? 'null' : `$e2e$${typeof value === 'object' ? JSON.stringify(value) : String(value)}$e2e$`;

const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const setReturning = psql(`select bool_or(proretset) from pg_proc where proname = '${fn}' and pronamespace = 'public'::regnamespace`) === 't';
  const named = Object.entries(args).map(([name, value]) => `${name} => ${literal(value)}`).join(', ');
  const sql = setReturning
    ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.${fn}(${named}) r`
    : `select coalesce(to_jsonb(public.${fn}(${named})), 'null'::jsonb)`;
  return JSON.parse(psql(sql)) as T;
};

const business = '0d5e0000-0000-4000-8000-000000000001';
const quiet = () => undefined;
const consoleLog = console.log;
console.log = quiet;

// 1. The seed already drafted this week, so a forced rerun with the AI off finds nothing new (AT-08).
assert.equal(await runWeekly({ rpc, ask: null, model: 'claude-haiku-5-5', flags: { force: true, businessId: business, asOf: null }, githubRunUrl: null }), 0);
assert.equal(psql(`select count(*) from public.reminder_drafts where business_id = '${business}' and status = 'waiting'`), '5');

// 2. With last week's drafts cleared, a model that breaks the rules on every other reply is retried once
//    and otherwise replaced by the template (AI-06, AI-07).
psql(`update public.reminder_drafts set status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded' where business_id = '${business}' and status = 'waiting'`);
let replies = 0;
const good: AiReply = {
  subject: 'Invoice {invoice_number} is overdue',
  body: 'Hi {client_name}, just a quick note that invoice {invoice_number} for {amount_due} was due on {due_date} and is now {days_overdue} days overdue. Could you let me know when we can expect payment? If it has already gone through, thank you, and please ignore this email. Happy to help if anything is holding it up.',
};
const ask = async (): Promise<AiReply> => ((replies += 1) % 2 === 1 ? { subject: 'Pay $50 now', body: 'Pay now.' } : good);
assert.equal(await runWeekly({ rpc, ask, model: 'claude-haiku-5-5', flags: { force: true, businessId: business, asOf: null }, githubRunUrl: null }, ), 0);
const sources = psql(`select string_agg(source::text, ',' order by source) from public.reminder_drafts where business_id = '${business}' and status = 'waiting'`);
assert.equal(sources.split(',').length, 5, 'five fresh drafts');
assert.ok(sources.includes('ai'), 'at least one AI draft passed the checks');

// 3. The briefing goes once, with the same numbers as the Home screen, and is logged (FR-11, AT-06, NFR-09).
const subjects: string[] = [];
const send = async (email: { subject: string }): Promise<string> => {
  subjects.push(email.subject);
  return 'e2e-message';
};
const flags = { force: false, businessId: business, asOf: null };
assert.equal(await runBriefings({ rpc, send, appUrl: 'https://app.example', flags, githubRunUrl: null }), 0);
assert.equal(await runBriefings({ rpc, send, appUrl: 'https://app.example', flags, githubRunUrl: null }), 0);
assert.deepEqual(subjects, ['[Test data] This week: $42,790.00 overdue, 5 reminders to review'], 'one briefing, even when run twice');
assert.equal(psql(`select count(*) from public.activity_log where business_id = '${business}' and action = 'briefing_sent'`), '1');

console.log = consoleLog;
console.log('  ✓ e2e: weekly run, AI retry and fallback, and the briefing all work against the real database functions');
