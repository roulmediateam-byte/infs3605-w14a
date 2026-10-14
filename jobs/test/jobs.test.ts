import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runBriefings } from '../briefing.ts';
import { parseFlags, parseTemperature } from '../lib/config.ts';
import { createRpc, redact, summariseError } from '../lib/db.ts';
import { mapLimit } from '../lib/run.ts';
import { runWeekly } from '../weekly-run.ts';

type Call = { fn: string; args: Record<string, unknown> };

// A fake database that answers each job function from a table of canned replies and records every call.
function fakeRpc(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const calls: Call[] = [];
  const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    calls.push({ fn, args });
    const answer = answers[fn];
    if (answer instanceof Error) throw answer;
    return (typeof answer === 'function' ? (answer as (a: Record<string, unknown>) => unknown)(args) : answer) as T;
  };
  return { rpc, calls };
}

const templates = [{ tone: 'standard', version: 'template/v1', subject: 'S {invoice_number}', body: 'B' }];
const flags = { force: false, businessId: null, asOf: '2026-11-08T21:07:00+11:00' };

describe('Weekly run (FR-07, NFR-09)', () => {
  it('drafts each planned invoice, then finishes the run with counts', async () => {
    const { rpc, calls } = fakeRpc({
      job_due: [{ business_id: 'b1', period_key: '2026-11-08' }],
      job_get_templates: templates,
      job_start: { run_id: 'r1', proceed: true, reason: 'new' },
      job_plan_weekly_run: [
        { invoice_id: 'i1', tone: 'standard', days_overdue: 9, reminders_sent_before: 0, style_note: null, example_reminder: null },
        { invoice_id: 'i2', tone: 'standard', days_overdue: 30, reminders_sent_before: 2, style_note: null, example_reminder: null },
      ],
      job_check_template: [],
      job_save_draft: (args: Record<string, unknown>) => (args.p_invoice_id === 'i2' ? null : 'd1'),
      job_finish: null,
    });
    const code = await runWeekly({ rpc, ask: async () => ({ subject: 'S', body: 'B' }), model: 'claude-haiku-5-5', flags, githubRunUrl: null });
    assert.equal(code, 0);
    const finish = calls.find((call) => call.fn === 'job_finish');
    assert.deepEqual(finish?.args, { p_run_id: 'r1', p_status: 'succeeded', p_stats: { planned: 2, ai: 1, template: 0, skipped: 1 } });
    const save = calls.find((call) => call.fn === 'job_save_draft');
    assert.equal(save?.args.p_source, 'ai');
    assert.equal(save?.args.p_prompt_version, 'reminder-draft/v1');
  });

  it('skips a business whose run already succeeded', async () => {
    const { rpc, calls } = fakeRpc({
      job_due: [{ business_id: 'b1', period_key: '2026-11-08' }],
      job_get_templates: templates,
      job_start: { run_id: 'r1', proceed: false, reason: 'already_succeeded' },
    });
    assert.equal(await runWeekly({ rpc, ask: null, model: 'm', flags, githubRunUrl: null }), 0);
    assert.equal(calls.some((call) => call.fn === 'job_plan_weekly_run'), false);
  });

  it('marks the run failed, with a short error, when saving breaks', async () => {
    const { rpc, calls } = fakeRpc({
      job_due: [{ business_id: 'b1', period_key: '2026-11-08' }],
      job_get_templates: templates,
      job_start: { run_id: 'r1', proceed: true, reason: 'new' },
      job_plan_weekly_run: [{ invoice_id: 'i1', tone: 'standard', days_overdue: 9, reminders_sent_before: 0, style_note: null, example_reminder: null }],
      job_check_template: [],
      job_save_draft: new Error('The draft failed the checks: body_length'),
      job_finish: null,
    });
    assert.equal(await runWeekly({ rpc, ask: null, model: 'm', flags, githubRunUrl: null }), 1);
    const finish = calls.find((call) => call.fn === 'job_finish');
    assert.equal(finish?.args.p_status, 'failed');
    assert.match(String(finish?.args.p_error), /body_length/);
  });

  it('asks for the period itself when run by hand for one business', async () => {
    const { rpc, calls } = fakeRpc({
      job_period_key: '2026-11-08',
      job_get_templates: templates,
      job_start: { run_id: 'r1', proceed: false, reason: 'already_succeeded' },
    });
    await runWeekly({ rpc, ask: null, model: 'm', flags: { ...flags, businessId: 'b9', force: true }, githubRunUrl: null });
    const start = calls.find((call) => call.fn === 'job_start');
    assert.equal(calls.some((call) => call.fn === 'job_due'), false);
    assert.deepEqual([start?.args.p_business_id, start?.args.p_trigger, start?.args.p_force], ['b9', 'manual', true]);
  });
});

describe('Briefing (FR-11, NFR-09)', () => {
  it('sends one email per business with an idempotency key, then records it', async () => {
    const sent: Array<{ to: string; idempotencyKey: string }> = [];
    const { rpc, calls } = fakeRpc({
      job_due: [{ business_id: 'b1', period_key: '2026-11-09' }],
      job_start: { run_id: 'r2', proceed: true, reason: 'new' },
      job_get_briefing: {
        business: { id: 'b1', name: 'Test (Test data)', owner_name: 'Alex Test', is_test_data: true },
        as_of_date: '2026-11-09',
        totals: { owed_cents: 100, overdue_cents: 100, open_count: 1, overdue_count: 1, due_this_week_cents: 0, due_this_week_count: 0 },
        drafts_waiting: 1,
        first_draft_id: 'd1',
        overdue: [],
        needs_attention: [],
        paused_clients: [],
        recipient: { email: 'owner@example.test', name: 'Alex Test' },
      },
      job_record_email: null,
      job_finish: null,
    });
    const code = await runBriefings({
      rpc,
      send: async (email) => {
        sent.push(email);
        return 'msg-1';
      },
      appUrl: 'https://app.example',
      flags: { force: false, businessId: null, asOf: '2026-11-09T06:37:00+11:00' },
      githubRunUrl: null,
    });
    assert.equal(code, 0);
    assert.deepEqual(sent.map((email) => [email.to, email.idempotencyKey]), [['owner@example.test', 'briefing:b1:2026-11-09']]);
    assert.deepEqual(calls.find((call) => call.fn === 'job_record_email')?.args, { p_run_id: 'r2', p_provider_message_id: 'msg-1' });
  });
});

describe('Plumbing', () => {
  it('reads flags from the command line or from the workflow form', () => {
    const id = '0d5e0000-0000-4000-8000-000000000001';
    assert.deepEqual(parseFlags(['--force', `--business=${id}`, '--as-of=2026-11-08T21:00:00+11:00'], {}), {
      force: true,
      businessId: id,
      asOf: '2026-11-08T21:00:00+11:00',
    });
    assert.deepEqual(parseFlags([], { JOB_FORCE: 'true', JOB_BUSINESS_ID: id }), { force: true, businessId: id, asOf: null });
    assert.deepEqual(parseFlags([], { JOB_BUSINESS_ID: '' }), { force: false, businessId: null, asOf: null });
    assert.throws(() => parseFlags(['--as-of=next sunday'], {}));
    assert.throws(() => parseFlags([], { JOB_BUSINESS_ID: '1; rm -rf /' }), /must be a UUID/);
  });
  it('defaults the temperature to 0.3 (AI-09) and allows switching it off', () => {
    assert.equal(parseTemperature(undefined), 0.3);
    assert.equal(parseTemperature('off'), null);
    assert.throws(() => parseTemperature('2'));
  });
  it('keeps personal data out of error text (NFR-04)', () => {
    assert.equal(redact('sam@bayside.example could not be reached'), '[email] could not be reached');
    assert.equal(summariseError('{"message":"Draft not found.","hint":null}'), 'Draft not found.');
  });
  it('sends the service key as apikey, and as a bearer token only when it is a JSON Web Token', async () => {
    const seen: Array<Record<string, string>> = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response('[]', { status: 200 });
    }) as typeof fetch;
    await createRpc('https://x.supabase.co', 'sb_secret_abc', fakeFetch)('job_due', {});
    await createRpc('https://x.supabase.co', 'eyJhbGciOi.payload.sig', fakeFetch)('job_due', {});
    assert.equal(seen[0]?.Authorization, undefined);
    assert.equal(seen[1]?.Authorization, 'Bearer eyJhbGciOi.payload.sig');
  });
  it('runs a pool without losing order', async () => {
    const order = await mapLimit([30, 10, 20], 2, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    assert.deepEqual(order, [30, 10, 20]);
  });
});
