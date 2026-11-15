// Demonstration build only (Week 7): anyone can make an account with an email and a password, and gets their own copy
// of the seed's Test data business, so people can practise without touching each other's data. The account is made
// with the Auth admin API and the service key Supabase gives every Edge Function (SUPABASE_SERVICE_ROLE_KEY), so the
// browser never holds it (NFR-06). No email is sent: the account is made already confirmed, and it is marked with
// app_metadata.demo_sign_up, which only the service role can set.
//
// Nobody checks the address, so it must be a made-up one on a reserved domain (.test, .example or example.com, the
// repository's own rule in scripts/check-hygiene.sh), which can never receive email. No real address is needed or kept
// (PD-1, PD-2), and the database never lets these accounts claim an invitation (migration 20261027090000_demo_sign_up).
//
// Three requests, all POST:
//   {email, password}                    makes the account, then its business (job_demo_provision)
//   {action: "ensure"}, with the token    gives a signed-in demonstration account a business if it has none: after a
//                                         first try that didn't finish, or after the owner deleted it in Settings
//   {action: "status"}                   whether sign-up is open; also a check after deploying that the keys work
// The app then signs in with the password itself: this function never hands out a session.
//
// No Deno globals here, so the job tests run it on Node with a stand-in fetch (jobs/test/demo-sign-up.test.ts).

import { createRpc } from '../../../jobs/lib/db.ts';
import { log, safeMessage } from '../../../jobs/lib/run.ts';

export type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
export const MIN_PASSWORD = 8;
/** Supabase Auth hashes passwords with bcrypt, which reads at most 72 bytes. */
export const MAX_PASSWORD_BYTES = 72;

/** A made-up address: its domain is reserved (RFC 2606, RFC 6761), so it can never receive email. */
export const isMadeUpEmail = (email: string): boolean => {
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return domain === 'example.com' || /\.(test|example)$/.test(domain);
};

// The app sends no cookie, so any origin may ask: the answers carry nothing secret.
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** What the app gets back. Messages are written for the person; codes are for the app and the tests. */
export type SignUpReply = { business: 'created' | 'exists' } | { open: boolean; reason: string } | { error: string; code: string };

const reply = (status: number, body: SignUpReply): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const refuse = (status: number, code: string, error: string): Response => reply(status, { error, code });

export const MESSAGES = {
  settings: 'The sign-up service is missing its Supabase settings.',
  email: 'Enter an email address, like sam@demo.test.',
  realEmail: "Use a made-up email ending in .test, like sam@demo.test. We never send email, so a real one isn't needed.",
  passwordShort: `Use at least ${MIN_PASSWORD} characters for the password.`,
  passwordLong: 'That password is too long. Use up to 72 letters or numbers.',
  exists: "There's already an account for that email. Sign in, or make up a different email.",
  closed: 'Sign-ups for the demonstration closed on Wed 25 Nov 2026, when its Test data was deleted.',
  full: 'The demonstration has all the accounts it can take. Ask the team for help.',
  busy: 'Lots of people are signing up right now. Try again in a few minutes.',
  createFailed: "Couldn't make the account. Try again in a minute.",
  provisionFailed: "Your account is made, but its Test data didn't load. Sign in to try again.",
  signedOut: 'Your session ended. Sign in again to carry on.',
  notDemo: "This account wasn't made here, so it gets no Test data business. Ask the owner to invite you.",
  limit: 'This account has had 10 fresh copies of the Test data. Create a new account instead.',
} as const;

type Outcome = { outcome?: string; business_id?: string };

const serviceHeaders = (serviceKey: string): Record<string, string> => ({
  apikey: serviceKey,
  'Content-Type': 'application/json',
  // Legacy service_role keys are JSON Web Tokens and also go in Authorization; new secret keys go in apikey only.
  ...(serviceKey.startsWith('eyJ') ? { Authorization: `Bearer ${serviceKey}` } : {}),
});

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export async function handle(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return refuse(405, 'method', 'Use POST.');

  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const publicKey = env.SUPABASE_ANON_KEY?.trim() || serviceKey;
  if (!url || !serviceKey || !publicKey) return refuse(500, 'settings', MESSAGES.settings);
  const rpc = createRpc(url, serviceKey, fetchImpl);

  /** job_demo_provision, tried twice: it is safe to repeat (NFR-09). */
  const provision = async (userId: string): Promise<Outcome> => {
    try {
      return await rpc<Outcome>('job_demo_provision', { p_user_id: userId });
    } catch (first) {
      log('demo-sign-up', 'provision_retry', { error: safeMessage(first) });
      return rpc<Outcome>('job_demo_provision', { p_user_id: userId });
    }
  };

  const body = await readBody(request);
  try {
    if (body.action === 'status') {
      // Reads nothing personal. The log says whether the public key works too, as "ensure" and the drafting need it.
      const room = await rpc<{ open?: boolean; reason?: string }>('job_demo_sign_up_room', {});
      const auth = await fetchImpl(`${url}/auth/v1/settings`, { headers: { apikey: publicKey }, signal: AbortSignal.timeout(10_000) });
      log('demo-sign-up', 'status', { open: room.open === true, public_key_ok: auth.ok });
      return reply(200, { open: room.open === true, reason: typeof room.reason === 'string' ? room.reason : 'unknown' });
    }

    if (body.action === 'ensure') {
      // A signed-in demonstration account without a business: Supabase Auth checks the token and names its person.
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
      if (!token) return refuse(401, 'signed_out', MESSAGES.signedOut);
      const userResponse = await fetchImpl(`${url}/auth/v1/user`, {
        headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!userResponse.ok) log('demo-sign-up', 'user_check_refused', { status: userResponse.status });
      const user = userResponse.ok ? ((await userResponse.json()) as { id?: unknown; app_metadata?: { demo_sign_up?: unknown } }) : null;
      const userId = typeof user?.id === 'string' && UUID.test(user.id) ? user.id : null;
      if (!userId) return refuse(401, 'signed_out', MESSAGES.signedOut);
      if (user?.app_metadata?.demo_sign_up !== true) return refuse(403, 'not_demo', MESSAGES.notDemo);
      const result = await provision(userId);
      if (result.outcome === 'created' || result.outcome === 'exists') {
        log('demo-sign-up', 'ensured', { outcome: result.outcome });
        return reply(200, { business: result.outcome });
      }
      if (result.outcome === 'limit') return refuse(409, 'limit', MESSAGES.limit);
      if (result.outcome === 'not_demo') return refuse(403, 'not_demo', MESSAGES.notDemo);
      return refuse(401, 'signed_out', MESSAGES.signedOut);
    }

    // A new account: check what was typed before anything else.
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (email.length > 120 || !EMAIL.test(email)) return refuse(400, 'email', MESSAGES.email);
    if (!isMadeUpEmail(email)) return refuse(400, 'real_email', MESSAGES.realEmail);
    if (password.length < MIN_PASSWORD) return refuse(400, 'password', MESSAGES.passwordShort);
    if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return refuse(400, 'password', MESSAGES.passwordLong);

    const room = await rpc<{ open?: boolean; reason?: string }>('job_demo_sign_up_room', {});
    if (room.open !== true) {
      if (room.reason === 'closed') return refuse(403, 'closed', MESSAGES.closed);
      if (room.reason === 'busy') return refuse(429, 'busy', MESSAGES.busy);
      return refuse(503, 'full', MESSAGES.full);
    }

    const created = await fetchImpl(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: serviceHeaders(serviceKey),
      body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { demo_sign_up: true } }),
      signal: AbortSignal.timeout(10_000),
    });
    const account = (await created.json().catch(() => ({}))) as { id?: unknown; error_code?: unknown; code?: unknown; msg?: unknown };
    if (!created.ok) {
      const code = String(account.error_code ?? account.code ?? '');
      if (code === 'email_exists' || code === 'user_already_exists' || /already been registered/i.test(String(account.msg ?? ''))) {
        return refuse(409, 'exists', MESSAGES.exists);
      }
      if (code === 'weak_password') return refuse(400, 'password', MESSAGES.passwordShort);
      if (created.status === 429) return refuse(429, 'busy', MESSAGES.busy);
      log('demo-sign-up', 'create_refused', { status: created.status, code });
      return refuse(502, 'create_failed', MESSAGES.createFailed);
    }
    const userId = typeof account.id === 'string' && UUID.test(account.id) ? account.id : null;
    if (!userId) return refuse(502, 'create_failed', MESSAGES.createFailed);

    try {
      const result = await provision(userId);
      if (result.outcome !== 'created' && result.outcome !== 'exists') throw new Error(`job_demo_provision said ${String(result.outcome)}`);
      log('demo-sign-up', 'created', { outcome: result.outcome });
      return reply(201, { business: result.outcome });
    } catch (error) {
      // The account exists, so the app signs in anyway, and asks again then ("ensure").
      log('demo-sign-up', 'provision_failed', { error: safeMessage(error) });
      return refuse(502, 'provision_failed', MESSAGES.provisionFailed);
    }
  } catch (error) {
    log('demo-sign-up', 'crashed', { error: safeMessage(error) });
    return refuse(502, 'create_failed', MESSAGES.createFailed);
  }
}
