// Shared by the final version's Edge Functions: who is asking, and are they the active owner of the business?
// Read as that person (their token), so row-level security applies, before any service-role call (NFR-05, NFR-06).
// No Deno globals here, so Node can test it with a stand-in fetch.

export type Env = Readonly<Record<string, string | undefined>>;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** A refusal the app shows as it is: plain words for the owner, a code for the app and the tests. */
export const refuse = (status: number, code: string, error: string): Response => reply(status, { error, code });

export interface Owner {
  userId: string;
  token: string;
  email: string | null;
  url: string;
  serviceKey: string;
  publicKey: string;
}

/** The signed-in active owner of the business, or a Response that says why not. */
export async function requireOwner(request: Request, env: Env, businessId: string, fetchImpl: typeof fetch): Promise<Owner | Response> {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const publicKey = env.SUPABASE_ANON_KEY?.trim() || serviceKey;
  if (!url || !serviceKey || !publicKey) return refuse(500, 'settings', 'This service is missing its Supabase settings.');
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return refuse(401, 'signed_out', 'Your session ended. Sign in again to carry on.');
  if (!UUID.test(businessId)) return refuse(400, 'business', 'Choose a business first.');
  const userResponse = await fetchImpl(`${url}/auth/v1/user`, {
    headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const user = userResponse.ok ? ((await userResponse.json()) as { id?: unknown; email?: unknown }) : null;
  const userId = typeof user?.id === 'string' && UUID.test(user.id) ? user.id : null;
  if (!userId) return refuse(401, 'signed_out', 'Your session ended. Sign in again to carry on.');
  const members = await fetchImpl(`${url}/rest/v1/memberships?select=role,status&business_id=eq.${businessId}&user_id=eq.${userId}`, {
    headers: { apikey: publicKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!members.ok) return refuse(502, 'read_failed', "Couldn't check who you are. Try again.");
  const rows = (await members.json()) as { role?: string; status?: string }[];
  if (!rows.some((m) => m.role === 'owner' && m.status === 'active')) return refuse(403, 'not_owner', 'Only the owner can do that.');
  return { userId, token, email: typeof user?.email === 'string' ? user.email : null, url, serviceKey, publicKey };
}

/** An app function called as the person who asked, so it checks their role itself. */
export async function personRpc<T>(owner: Owner, fn: string, args: Record<string, unknown>, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(`${owner.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: owner.publicKey, Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${fn} failed with ${response.status}`);
  return (await response.json()) as T;
}

/** A database function called with the service role key (job_* functions). */
export async function serviceRpc<T>(owner: Owner, fn: string, args: Record<string, unknown>, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(`${owner.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: owner.serviceKey, Authorization: `Bearer ${owner.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${fn} failed with ${response.status}`);
  return (await response.json()) as T;
}

export const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export const denoServe = (handle: (request: Request, env: Env) => Promise<Response>): void => {
  type DenoLike = { serve(handler: (request: Request) => Response | Promise<Response>): unknown; env: { toObject(): Record<string, string> } };
  const deno = (globalThis as unknown as { Deno: DenoLike }).Deno;
  deno.serve((request) => handle(request, deno.env.toObject()));
};
