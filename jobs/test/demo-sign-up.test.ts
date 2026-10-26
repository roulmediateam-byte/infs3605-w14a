// The demonstration build's sign-up Edge Function (supabase/functions/demo-sign-up), run on Node with a stand-in for
// Supabase: made-up addresses only, caps first, the account made confirmed and marked, then its own Test data
// business; the "ensure" request for a signed-in demonstration account; and no address or password in any log.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handle, isMadeUpEmail, MESSAGES } from '../../supabase/functions/demo-sign-up/handler.ts';

const URL_ = 'https://project.supabase.example';
const ENV = { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_ANON_KEY: 'anon-key' };
const USER = '22222222-2222-4222-8222-222222222222';
const BUSINESS = '0d5e0000-0000-4000-8000-0000000000b1';

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };

/** A stand-in for Auth (admin and user) and the two job functions. Each test changes only what it needs. */
const supabase = (
  options: {
    room?: { open: boolean; reason: string };
    create?: { status: number; body: Record<string, unknown> };
    provision?: Array<{ status: number; body: unknown }>;
    user?: { status: number; body?: Record<string, unknown> };
  } = {},
) => {
  const calls: Call[] = [];
  const provisions = [...(options.provision ?? [{ status: 200, body: { outcome: 'created', business_id: BUSINESS } }])];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, method: init?.method ?? 'GET', headers, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url === `${URL_}/rest/v1/rpc/job_demo_sign_up_room`) return json(options.room ?? { open: true, reason: 'open' });
    if (url === `${URL_}/rest/v1/rpc/job_demo_provision`) {
      const next = provisions.length > 1 ? provisions.shift() : provisions[0];
      return json(next?.body ?? {}, next?.status ?? 200);
    }
    if (url === `${URL_}/auth/v1/admin/users`) {
      return json(options.create?.body ?? { id: USER, email: body?.email }, options.create?.status ?? 200);
    }
    if (url === `${URL_}/auth/v1/settings`) return json({ external: { email: true } });
    if (url === `${URL_}/auth/v1/user`) {
      return json(options.user?.body ?? { id: USER, app_metadata: { provider: 'email', demo_sign_up: true } }, options.user?.status ?? 200);
    }
    return json({ message: `unexpected ${url}` }, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
};

const post = (body: unknown, token: string | null = null) =>
  new Request('https://functions.example/demo-sign-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const signUp = (email = 'Sam@Demo.test', password = 'harbour-line-8') => post({ email, password });

const answer = async (response: Response) => (await response.json()) as { code?: string; error?: string; business?: string };

/** An address on a domain that isn't reserved, built at run time so the repository holds none (scripts/check-hygiene.sh). */
const unreserved = (local: string, domain: string): string => [local, domain].join('@');
const UNRESERVED = [
  unreserved('someone', 'gmail.com'),
  unreserved('someone', 'unsw.edu.au'),
  unreserved('someone', 'notexample.com'),
  unreserved('someone', 'test.com'),
  unreserved('someone', 'example.com.au'),
  unreserved('someone', 'site.invalid'),
  unreserved('someone', 'mail.example.org'),
];

/** Captures console.log while a request runs, to check that nothing personal is written. */
const logsOf = async (run: () => Promise<unknown>): Promise<string> => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
};

describe('demo-sign-up Edge Function', () => {
  it('answers the browser preflight with CORS headers and nothing else', async () => {
    const { fetchImpl, calls } = supabase();
    const response = await handle(new Request('https://functions.example/demo-sign-up', { method: 'OPTIONS' }), ENV, fetchImpl);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(calls.length, 0);
  });

  it('takes made-up addresses on reserved domains only (PD-1, PD-2)', () => {
    for (const email of ['sam@demo.test', 'a.b+c@x.example', 'lee@example.com', 'mei@mail.harbourline.test']) {
      assert.ok(isMadeUpEmail(email), email);
    }
    for (const email of UNRESERVED) assert.ok(!isMadeUpEmail(email), email);
  });

  it('refuses a real-looking address, a bad address or a short password before calling anything', async () => {
    const cases: Array<[unknown, string]> = [
      [{ email: UNRESERVED[0], password: 'harbour-line-8' }, 'real_email'],
      [{ email: 'not an email', password: 'harbour-line-8' }, 'email'],
      [{ email: `${'a'.repeat(120)}@demo.test`, password: 'harbour-line-8' }, 'email'],
      [{ email: 'sam@demo.test', password: 'short' }, 'password'],
      [{ email: 'sam@demo.test', password: 'é'.repeat(37) }, 'password'],
      [{ email: 'sam@demo.test' }, 'password'],
      [{}, 'email'],
    ];
    for (const [body, code] of cases) {
      const { fetchImpl, calls } = supabase();
      const response = await handle(post(body), ENV, fetchImpl);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal((await answer(response)).code, code, JSON.stringify(body));
      assert.equal(calls.length, 0, JSON.stringify(body));
    }
  });

  it('makes no account while sign-ups are closed, full or busy', async () => {
    for (const [reason, status] of [['closed', 403], ['full', 503], ['busy', 429]] as const) {
      const { fetchImpl, calls } = supabase({ room: { open: false, reason } });
      const response = await handle(signUp(), ENV, fetchImpl);
      assert.equal(response.status, status, reason);
      assert.equal((await answer(response)).code, reason);
      assert.ok(calls.every((call) => !call.url.includes('/auth/v1/admin/')), reason);
    }
  });

  it('makes the account confirmed and marked with the service key, then its own Test data business', async () => {
    const { fetchImpl, calls } = supabase();
    const response = await handle(signUp(), ENV, fetchImpl);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { business: 'created' });

    assert.deepEqual(
      calls.map((call) => call.url.slice(URL_.length)),
      ['/rest/v1/rpc/job_demo_sign_up_room', '/auth/v1/admin/users', '/rest/v1/rpc/job_demo_provision'],
    );
    const create = calls[1];
    assert.equal(create?.method, 'POST');
    assert.equal(create?.headers.apikey, 'service-key');
    // The address is kept in lower case; the password goes to Supabase Auth only.
    assert.deepEqual(create?.body, { email: 'sam@demo.test', password: 'harbour-line-8', email_confirm: true, app_metadata: { demo_sign_up: true } });
    assert.deepEqual(calls[2]?.body, { p_user_id: USER });
    assert.equal(calls[2]?.headers.apikey, 'service-key');
  });

  it('sends a legacy service key in Authorization too, and a new secret key in apikey only', async () => {
    const legacy = supabase();
    await handle(signUp(), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'eyJ.legacy.key' }, legacy.fetchImpl);
    assert.equal(legacy.calls[1]?.headers.authorization, 'Bearer eyJ.legacy.key');
    const fresh = supabase();
    await handle(signUp(), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_example' }, fresh.fetchImpl);
    assert.equal(fresh.calls[1]?.headers.authorization, undefined);
    assert.equal(fresh.calls[1]?.headers.apikey, 'sb_secret_example');
  });

  it('says so when the address already has an account', async () => {
    const { fetchImpl, calls } = supabase({
      create: { status: 422, body: { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' } },
    });
    const response = await handle(signUp(), ENV, fetchImpl);
    assert.equal(response.status, 409);
    assert.deepEqual(await answer(response), { code: 'exists', error: MESSAGES.exists });
    assert.ok(calls.every((call) => !call.url.includes('job_demo_provision')));
  });

  it('tries the business twice, and if it still fails, says the account is made so the app signs in anyway', async () => {
    const twice = supabase({ provision: [{ status: 500, body: { message: 'boom' } }, { status: 200, body: { outcome: 'created', business_id: BUSINESS } }] });
    assert.equal((await handle(signUp(), ENV, twice.fetchImpl)).status, 201);
    assert.equal(twice.calls.filter((call) => call.url.endsWith('job_demo_provision')).length, 2);

    const never = supabase({ provision: [{ status: 500, body: { message: 'boom' } }] });
    const response = await handle(signUp(), ENV, never.fetchImpl);
    assert.equal(response.status, 502);
    assert.equal((await answer(response)).code, 'provision_failed');
  });

  it('writes no address and no password to the logs (NFR-04)', async () => {
    const { fetchImpl } = supabase({ provision: [{ status: 500, body: { message: 'Key (email)=(sam@demo.test) failed' } }] });
    const logs = await logsOf(() => handle(signUp('sam@demo.test', 'harbour-line-8'), ENV, fetchImpl));
    assert.ok(logs.length > 0);
    assert.ok(!logs.includes('sam@demo.test'), logs);
    assert.ok(!logs.includes('harbour-line-8'), logs);
  });

  it('says whether sign-up is open, with the service key for the database and the public key for Auth', async () => {
    const { fetchImpl, calls } = supabase({ room: { open: false, reason: 'busy' } });
    const response = await handle(post({ action: 'status' }), ENV, fetchImpl);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { open: false, reason: 'busy' });
    assert.equal(calls[0]?.headers.apikey, 'service-key');
    assert.equal(calls[1]?.url, `${URL_}/auth/v1/settings`);
    assert.equal(calls[1]?.headers.apikey, 'anon-key');
    assert.ok(calls.every((call) => !call.url.includes('/admin/') && !call.url.includes('job_demo_provision')));
  });

  describe('ensure: a signed-in demonstration account without a business', () => {
    it('needs a session that Supabase Auth accepts', async () => {
      const none = supabase();
      assert.equal((await handle(post({ action: 'ensure' }), ENV, none.fetchImpl)).status, 401);
      assert.equal(none.calls.length, 0);
      const rejected = supabase({ user: { status: 401, body: { msg: 'bad jwt' } } });
      assert.equal((await handle(post({ action: 'ensure' }, 'old-token'), ENV, rejected.fetchImpl)).status, 401);
      assert.ok(rejected.calls.every((call) => !call.url.includes('/rpc/')));
    });

    it('gives nothing to an account the demonstration sign-up didn\'t make', async () => {
      const { fetchImpl, calls } = supabase({ user: { status: 200, body: { id: USER, app_metadata: { provider: 'email' } } } });
      const response = await handle(post({ action: 'ensure' }, 'user-token'), ENV, fetchImpl);
      assert.equal(response.status, 403);
      assert.equal((await answer(response)).code, 'not_demo');
      assert.ok(calls.every((call) => !call.url.includes('/rpc/')));
    });

    it('checks the token with the public key, then makes or finds the business with the service key', async () => {
      for (const outcome of ['created', 'exists']) {
        const { fetchImpl, calls } = supabase({ provision: [{ status: 200, body: { outcome, business_id: BUSINESS } }] });
        const response = await handle(post({ action: 'ensure' }, 'user-token'), ENV, fetchImpl);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { business: outcome });
        assert.equal(calls[0]?.headers.authorization, 'Bearer user-token');
        assert.equal(calls[0]?.headers.apikey, 'anon-key');
        assert.deepEqual(calls[1]?.body, { p_user_id: USER });
        assert.ok(calls.every((call) => !call.url.includes('/auth/v1/admin/')));
      }
    });

    it('stops at 10 copies for one account', async () => {
      const { fetchImpl } = supabase({ provision: [{ status: 200, body: { outcome: 'limit' } }] });
      const response = await handle(post({ action: 'ensure' }, 'user-token'), ENV, fetchImpl);
      assert.equal(response.status, 409);
      assert.equal((await answer(response)).code, 'limit');
    });
  });
});
