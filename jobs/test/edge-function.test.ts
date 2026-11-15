// The demonstration build's "Run it now" Edge Function (supabase/functions/demo-weekly-run), run on Node with a
// stand-in for Supabase: who may run it, that it reads as the person first, and that it is the job's own run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { edgePromptSource, EDGE_PROMPT_FILE } from '../../scripts/sync-edge-prompt.ts';
import { handle } from '../../supabase/functions/demo-weekly-run/handler.ts';

const URL_ = 'https://project.supabase.example';
const ENV = { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key' };
const USER = '11111111-1111-4111-8111-111111111111';
const BUSINESS = '0d5e0000-0000-4000-8000-000000000001';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** A stand-in for Auth, the Data API and the job functions. Each test changes only what it needs. */
const supabase = (options: {
  user?: number;
  role?: string;
  status?: string;
  testData?: boolean;
  planned?: number;
  rpcFails?: string;
} = {}) => {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, method: init?.method ?? 'GET', headers, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url === `${URL_}/auth/v1/user`) return options.user && options.user !== 200 ? json({ msg: 'bad jwt' }, options.user) : json({ id: USER });
    if (url.startsWith(`${URL_}/rest/v1/memberships?`)) return json([{ role: options.role ?? 'owner', status: options.status ?? 'active' }]);
    if (url.startsWith(`${URL_}/rest/v1/businesses?`)) return json([{ is_test_data: options.testData ?? true }]);
    const fn = url.startsWith(`${URL_}/rest/v1/rpc/`) ? url.slice(`${URL_}/rest/v1/rpc/`.length) : null;
    if (fn && fn === options.rpcFails) return json({ message: 'boom' }, 500);
    switch (fn) {
      case 'job_period_key':
        return json('2026-10-25');
      case 'job_get_templates':
        return json([{ tone: 'standard', version: 't1', subject: 'Invoice {invoice_number}', body: 'Body' }]);
      case 'job_start':
        return json({ run_id: 'run-1', proceed: true, reason: 'forced' });
      case 'job_plan_weekly_run':
        return json(
          Array.from({ length: options.planned ?? 1 }, (_, i) => ({
            invoice_id: `inv-${i}`,
            tone: 'standard',
            days_overdue: 20,
            reminders_sent_before: 0,
            style_note: null,
            example_reminder: null,
          })),
        );
      case 'job_save_draft':
        return json(`draft-${String(body?.p_invoice_id)}`);
      case 'job_finish':
        return new Response(null, { status: 204 });
      default:
        return json({ message: `unexpected ${url}` }, 404);
    }
  }) as typeof fetch;
  return { fetchImpl, calls };
};

const post = (body: unknown = { business_id: BUSINESS }, token: string | null = 'user-token') =>
  new Request('https://functions.example/demo-weekly-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe('demo-weekly-run Edge Function', () => {
  it('carries the reminder prompt exactly as the prompt files have it', () => {
    assert.equal(readFileSync(EDGE_PROMPT_FILE, 'utf8'), edgePromptSource(), 'Run node scripts/sync-edge-prompt.ts');
  });

  it('answers the browser preflight with CORS headers and nothing else', async () => {
    const { fetchImpl, calls } = supabase();
    const response = await handle(new Request('https://functions.example/demo-weekly-run', { method: 'OPTIONS' }), ENV, fetchImpl);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.match(response.headers.get('Access-Control-Allow-Headers') ?? '', /authorization/);
    assert.equal(calls.length, 0);
  });

  it('refuses a request with no session before calling anything', async () => {
    const { fetchImpl, calls } = supabase();
    const response = await handle(post(undefined, null), ENV, fetchImpl);
    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as { code: string }).code, 'signed_out');
    assert.equal(calls.length, 0);
  });

  it('refuses a token Supabase Auth rejects, and runs no job function', async () => {
    const { fetchImpl, calls } = supabase({ user: 401 });
    const response = await handle(post(), ENV, fetchImpl);
    assert.equal(response.status, 401);
    assert.ok(calls.every((call) => !call.url.includes('/rpc/')));
  });

  it('refuses a missing or malformed business id', async () => {
    const { fetchImpl } = supabase();
    assert.equal((await handle(post({ business_id: 'not-a-uuid' }), ENV, fetchImpl)).status, 400);
    assert.equal((await handle(post({}), ENV, fetchImpl)).status, 400);
  });

  it('lets only the active owner run it', async () => {
    for (const options of [{ role: 'checker' }, { role: 'admin' }, { role: 'owner', status: 'invited' }]) {
      const { fetchImpl, calls } = supabase(options);
      const response = await handle(post(), ENV, fetchImpl);
      assert.equal(response.status, 403, JSON.stringify(options));
      assert.equal(((await response.json()) as { code: string }).code, 'not_owner');
      assert.ok(calls.every((call) => !call.url.includes('/rpc/')));
    }
  });

  it('works on Test data only', async () => {
    const { fetchImpl, calls } = supabase({ testData: false });
    const response = await handle(post(), ENV, fetchImpl);
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { code: string }).code, 'not_test_data');
    assert.ok(calls.every((call) => !call.url.includes('/rpc/')));
  });

  it('checks the person with their own token, then runs the job forced for that business with the service key', async () => {
    const { fetchImpl, calls } = supabase({ planned: 2 });
    const response = await handle(post(), ENV, fetchImpl);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { drafted: 2, ai: 0, template: 2, planned: 2, skipped: 0, claude: false });

    const reads = calls.filter((call) => call.url.startsWith(`${URL_}/rest/v1/`) && !call.url.includes('/rpc/'));
    assert.equal(reads.length, 2);
    for (const read of reads) {
      assert.equal(read.headers.authorization, 'Bearer user-token');
      assert.equal(read.headers.apikey, 'anon-key');
    }
    assert.ok(reads.some((read) => read.url.includes(`business_id=eq.${BUSINESS}`) && read.url.includes(`user_id=eq.${USER}`)));

    const rpcs = calls.filter((call) => call.url.includes('/rpc/'));
    assert.ok(rpcs.length > 0);
    for (const rpc of rpcs) {
      assert.equal(rpc.headers.apikey, 'service-key');
      assert.equal(rpc.headers.authorization, undefined, 'a non-JWT service key goes in apikey only');
    }
    const start = rpcs.find((call) => call.url.endsWith('/job_start'));
    assert.deepEqual(start?.body, {
      p_job: 'weekly_run',
      p_business_id: BUSINESS,
      p_period_key: '2026-10-25',
      p_trigger: 'manual',
      p_github_run_url: null,
      p_force: true,
    });
    assert.ok(rpcs.some((call) => call.url.endsWith('/job_finish') && (call.body as { p_status: string }).p_status === 'succeeded'));
    assert.ok(calls.every((call) => !call.url.startsWith('https://api.anthropic.com')), 'no Claude call without a key');
  });

  it('asks Claude when the key is set, with only the five allowed fields', async () => {
    const { fetchImpl, calls } = supabase();
    const withClaude = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://api.anthropic.com/v1/messages') {
        calls.push({ url: String(input), method: 'POST', headers: {}, body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ subject: 'S', body: 'B' }) }] }),
          { status: 200 },
        );
      }
      if (String(input).endsWith('/rpc/job_check_template')) return new Response('[]', { status: 200 });
      return fetchImpl(input, init);
    }) as typeof fetch;
    const response = await handle(post(), { ...ENV, ANTHROPIC_API_KEY: 'test-key' }, withClaude);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { drafted: 1, ai: 1, template: 0, planned: 1, skipped: 0, claude: true });
    const ask = calls.find((call) => call.url === 'https://api.anthropic.com/v1/messages');
    const sent = JSON.parse((ask?.body as { messages: { content: string }[] }).messages[0]?.content ?? '{}') as Record<string, unknown>;
    assert.deepEqual(Object.keys(sent).sort(), ['days_overdue', 'example_reminder', 'reminders_sent_before', 'style_note', 'tone']);
  });

  it('says the run failed, in plain words, when a job function fails', async () => {
    const { fetchImpl } = supabase({ rpcFails: 'job_plan_weekly_run' });
    const response = await handle(post(), ENV, fetchImpl);
    assert.equal(response.status, 502);
    assert.equal(((await response.json()) as { code: string }).code, 'run_failed');
  });
});
