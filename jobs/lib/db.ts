// Calls the database's job functions through Supabase's REST endpoint (PostgREST) with the service key.
// The jobs never touch tables directly: every rule lives in the database and is covered by pgTAP tests.

export type Rpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;

export class DbError extends Error {
  readonly fn: string;
  readonly status: number;

  constructor(fn: string, status: number, body: string) {
    super(`Database function ${fn} failed with HTTP ${status}: ${summariseError(body)}`);
    this.name = 'DbError';
    this.fn = fn;
    this.status = status;
  }
}

export function createRpc(supabaseUrl: string, serviceKey: string, fetchImpl: typeof fetch = fetch): Rpc {
  const headers: Record<string, string> = {
    apikey: serviceKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  // Legacy service_role keys are JSON Web Tokens and also go in Authorization.
  // New secret keys (sb_secret_...) go in the apikey header only.
  if (serviceKey.startsWith('eyJ')) headers.Authorization = `Bearer ${serviceKey}`;

  return async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) throw new DbError(fn, response.status, text);
    return (text ? JSON.parse(text) : null) as T;
  };
}

// Keeps the database's own message (written for people) and drops anything that could echo inputs.
export function summariseError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: string; hint?: string | null };
    if (parsed.message) return redact(parsed.message) + (parsed.hint ? ` (${redact(parsed.hint)})` : '');
  } catch {
    // Not JSON: fall through.
  }
  return redact(body).slice(0, 300);
}

// NFR-04: no personal data in logs or error reports.
export function redact(text: string): string {
  return text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]').slice(0, 500);
}
