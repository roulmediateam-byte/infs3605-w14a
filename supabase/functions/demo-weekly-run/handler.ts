// Demonstration build only (Week 7): the owner of a Test data business runs Sunday's drafting now, from the app's
// "Run it now". It is the scheduled job's own run (jobs/lib/weekly.ts), forced for one business, with the service
// key Supabase gives every Edge Function (SUPABASE_SERVICE_ROLE_KEY), so the browser never holds it (NFR-06).
// Claude writes each draft when the secret ANTHROPIC_API_KEY is set (Edge Functions > Secrets); without it the
// job's fixed templates do (FR-09). AI-03 holds: only the five fields in jobs/lib/drafting.ts leave the system.
//
// Who may run it: a signed-in person whose membership of the business is the active owner, and only while the
// business is Test data. Both are read as that person, through row-level security, before any job function runs.
// Real businesses keep the Sunday 9:07 pm schedule (weekly-run.yml).
//
// No Deno globals here, so the job tests run it on Node with a stand-in fetch (jobs/test/edge-function.test.ts).

import { askClaude } from '../../../jobs/lib/claude.ts';
import { parseTemperature } from '../../../jobs/lib/config.ts';
import { createRpc } from '../../../jobs/lib/db.ts';
import { log, safeMessage } from '../../../jobs/lib/run.ts';
import { runWeekly, type WeeklyOutcome } from '../../../jobs/lib/weekly.ts';
import { OUTPUT_SCHEMA, SYSTEM_PROMPT } from './prompt.ts';

export type Env = Readonly<Record<string, string | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The app sends the person's access token in Authorization, so no cookie is involved and any origin may ask: a page
// elsewhere can't read anyone's token.
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** What the app gets back. Messages are written for the owner; codes are for the app and the tests. */
export type RunNowReply =
  | { drafted: number; ai: number; template: number; planned: number; skipped: number; claude: boolean }
  | { error: string; code: string };

const reply = (status: number, body: RunNowReply): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const refuse = (status: number, code: string, error: string): Response => reply(status, { error, code });

/** Rows from the Data API, read as the person who asked (their token, so row-level security applies). */
const readAs = async <T>(fetchImpl: typeof fetch, url: string, headers: Record<string, string>): Promise<T[] | null> => {
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  return (await response.json()) as T[];
};

export async function handle(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return refuse(405, 'method', 'Use POST.');

  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const publicKey = env.SUPABASE_ANON_KEY?.trim() || serviceKey;
  if (!url || !serviceKey || !publicKey) return refuse(500, 'settings', 'The drafting service is missing its Supabase settings.');

  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return refuse(401, 'signed_out', 'Your session ended. Sign in again to carry on.');

  try {
    // Who is asking: Supabase Auth checks the access token and names its person.
    const userResponse = await fetchImpl(`${url}/auth/v1/user`, {
      headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const user = userResponse.ok ? ((await userResponse.json()) as { id?: unknown }) : null;
    const userId = typeof user?.id === 'string' && UUID.test(user.id) ? user.id : null;
    if (!userId) return refuse(401, 'signed_out', 'Your session ended. Sign in again to carry on.');

    let businessId = '';
    try {
      const body = (await request.json()) as { business_id?: unknown } | null;
      businessId = typeof body?.business_id === 'string' ? body.business_id : '';
    } catch {
      businessId = '';
    }
    if (!UUID.test(businessId)) return refuse(400, 'business', 'Choose a business first.');

    // As that person: their own membership, and whether the business is Test data.
    const asPerson = { apikey: publicKey, Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const [memberships, businesses] = await Promise.all([
      readAs<{ role?: string; status?: string }>(
        fetchImpl,
        `${url}/rest/v1/memberships?select=role,status&business_id=eq.${businessId}&user_id=eq.${userId}`,
        asPerson,
      ),
      readAs<{ is_test_data?: boolean }>(fetchImpl, `${url}/rest/v1/businesses?select=is_test_data&id=eq.${businessId}`, asPerson),
    ]);
    if (memberships === null || businesses === null) return refuse(502, 'read_failed', "Couldn't check who you are. Try again.");
    if (!memberships.some((m) => m.role === 'owner' && m.status === 'active')) {
      return refuse(403, 'not_owner', 'Only the owner can run the drafting now.');
    }
    if (businesses[0]?.is_test_data !== true) {
      return refuse(403, 'not_test_data', "Run it now is for Test data only. Real businesses' drafts arrive on Sunday at 9:07 pm.");
    }

    const apiKey = env.ANTHROPIC_API_KEY?.trim() || null;
    const model = env.AI_MODEL?.trim() || 'claude-haiku-5-5';
    const temperature = parseTemperature(env.AI_TEMPERATURE);
    const seen: { outcome: WeeklyOutcome | null } = { outcome: null };
    await runWeekly({
      rpc: createRpc(url, serviceKey, fetchImpl),
      ask: apiKey
        ? (input) => askClaude(input, { apiKey, model, temperature, timeoutMs: 20_000, system: SYSTEM_PROMPT, schema: OUTPUT_SCHEMA, fetchImpl })
        : null,
      model,
      flags: { force: true, businessId, asOf: null },
      githubRunUrl: null,
      concurrency: 3,
      onOutcome: (outcome) => {
        seen.outcome = outcome;
      },
    });

    const outcome = seen.outcome;
    if (outcome?.status === 'succeeded') {
      const { ai, template, planned, skipped } = outcome.stats;
      return reply(200, { drafted: ai + template, ai, template, planned, skipped, claude: apiKey !== null });
    }
    if (outcome?.status === 'skipped') return refuse(409, 'busy', 'A drafting run is going already. Try again in a minute.');
    return refuse(502, 'run_failed', "The drafting run didn't finish. Try again in a minute.");
  } catch (error) {
    log('demo-weekly-run', 'crashed', { error: safeMessage(error) });
    return refuse(502, 'run_failed', "The drafting run didn't finish. Try again in a minute.");
  }
}
