// A local stand-in for a Supabase project, so the web app can be developed and tested without Docker.
// It runs the real PostgREST against the local database (every migration, row-level security policy and
// function) and answers the few Auth calls the app makes: email codes and links, sessions and sign-out. supabase-js
// talks to it unchanged, at http://127.0.0.1:54321.
//
// Development only. It signs tokens with a fixed, public secret and shows sign-in codes on a local URL, so it
// must never face the internet. Synthetic Test data only (RI-9).
//
// Usage (from the repository root, with a local PostgreSQL 15+ server):
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres node scripts/local-stack/gateway.ts
// Then: the app at web/ (npm run dev), codes at http://127.0.0.1:54321/__local/codes?email=owner@example.test
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const LOCAL_SECRET = 'local-development-secret-never-use-in-production-0001';
const POSTGREST_VERSION = 'v12.2.3';
// The release's own builds, pinned by checksum (read Thu 15 Oct 2026). CI runs the Linux one. The release has no
// self-contained Mac build (its Mac build expects Homebrew's postgresql@14 in one place), so on a Mac the stack uses a
// PostgREST that is already installed: brew install postgrest, or LOCAL_STACK_POSTGREST=<path>.
const POSTGREST_DOWNLOADS: Partial<Record<string, { asset: string; sha256: string }>> = {
  'linux-x64': { asset: 'linux-static-x64.tar.xz', sha256: '9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c' },
  // Needs the PostgreSQL client and GMP libraries, for example: sudo apt install libpq5 libgmp10
  'linux-arm64': { asset: 'ubuntu-aarch64.tar.xz', sha256: '4afb4d96aa77b35f7a079b5a692b6284ae4c99c066e9722f73f20fa9368dff8e' },
};

const config = {
  port: Number(process.env.LOCAL_STACK_PORT ?? 54321),
  restPort: Number(process.env.LOCAL_STACK_REST_PORT ?? 54320),
  database: process.env.LOCAL_DB ?? 'getpaid_dev',
  pgHost: process.env.PGHOST ?? '127.0.0.1',
  pgPort: process.env.PGPORT ?? '5432',
  pgUser: process.env.PGUSER ?? 'postgres',
  otpIntervalSeconds: Number(process.env.LOCAL_STACK_OTP_INTERVAL ?? 60),
  sessionSeconds: Number(process.env.LOCAL_STACK_SESSION_SECONDS ?? 3600),
  skipSetup: process.env.LOCAL_STACK_SKIP_SETUP === '1',
};

// ---------------------------------------------------------------------------------------------
// Tokens: HS256 JSON Web Tokens, as Supabase issues them
// ---------------------------------------------------------------------------------------------
type Claims = Record<string, unknown> & { exp?: number };

export const signToken = (claims: Claims): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', LOCAL_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
};

const verifyToken = (token: string): Claims | null => {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) return null;
  const expected = createHmac('sha256', LOCAL_SECRET).update(`${header}.${body}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims;
  if (typeof claims.exp === 'number' && claims.exp < Date.now() / 1000) return null;
  return claims;
};

// Fixed issue and expiry times keep the keys stable between runs, so .env files need writing only once.
export const ANON_KEY = signToken({ iss: 'supabase-local', role: 'anon', iat: 1760000000, exp: 2000000000 });
export const SERVICE_ROLE_KEY = signToken({ iss: 'supabase-local', role: 'service_role', iat: 1760000000, exp: 2000000000 });

// ---------------------------------------------------------------------------------------------
// The database, through psql (no driver dependency)
// ---------------------------------------------------------------------------------------------
const pgEnv = { ...process.env, PGHOST: config.pgHost, PGPORT: config.pgPort, PGUSER: config.pgUser };
const psql = (sql: string): string =>
  execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', config.database, '-c', sql], {
    encoding: 'utf8',
    env: pgEnv,
  }).trim();

const EMAIL_PATTERN = /^[^\s@$'"\\]+@[^\s@$'"\\]+\.[^\s@$'"\\]+$/;

interface LocalUser {
  id: string;
  email: string;
  created_at: string;
}

const findUser = (email: string): LocalUser | null => {
  const row = psql(`select coalesce(row_to_json(u)::text, '') from (select id, email, created_at from auth.users where lower(email) = lower('${email}')) u`);
  return row ? (JSON.parse(row) as LocalUser) : null;
};

// On Supabase the team invites people from the dashboard, which creates their sign-in account. Locally, anyone
// with an invitation (a membership row) gets an account on their first code request. Nobody else does.
const findOrInviteUser = (email: string): LocalUser | null => {
  const existing = findUser(email);
  if (existing) return existing;
  const invited = psql(`select exists (select 1 from public.memberships where lower(invited_email) = lower('${email}') and status <> 'removed')`);
  if (invited !== 't') return null;
  psql(`insert into auth.users (id, email) values ('${randomUUID()}', lower('${email}')) on conflict (email) do nothing`);
  return findUser(email);
};

const userById = (id: string): LocalUser | null => {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = psql(`select coalesce(row_to_json(u)::text, '') from (select id, email, created_at from auth.users where id = '${id}') u`);
  return row ? (JSON.parse(row) as LocalUser) : null;
};

// ---------------------------------------------------------------------------------------------
// Auth state: one-time codes and refresh tokens, in memory
// ---------------------------------------------------------------------------------------------
interface PendingCode {
  code: string;
  /** The emailed link's token. The code and the link come in one email and share one use, as on Supabase. */
  linkToken: string;
  redirectTo: string;
  sentAt: number;
  expiresAt: number;
  used: boolean;
}

// Sign-in links may only return to the app on this computer, as Supabase only returns to its listed addresses.
const DEFAULT_REDIRECT = 'http://127.0.0.1:5173/';
const safeRedirect = (value: string | null): string => {
  if (!value) return DEFAULT_REDIRECT;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) ? url.toString() : DEFAULT_REDIRECT;
  } catch {
    return DEFAULT_REDIRECT;
  }
};
const codes = new Map<string, PendingCode>();
const refreshTokens = new Map<string, string>(); // refresh token -> user id
// Tokens issued before this moment are refused, as Supabase refuses expired ones (POST /__local/end-sessions).
let revokedBefore = 0;

const userJson = (user: LocalUser) => ({
  id: user.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: user.email,
  email_confirmed_at: user.created_at,
  phone: '',
  confirmed_at: user.created_at,
  last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: user.created_at,
  updated_at: user.created_at,
  is_anonymous: false,
});

const sessionFor = (user: LocalUser) => {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signToken({
    aud: 'authenticated',
    exp: now + config.sessionSeconds,
    iat: now,
    iss: `http://127.0.0.1:${config.port}/auth/v1`,
    sub: user.id,
    email: user.email,
    phone: '',
    role: 'authenticated',
    aal: 'aal1',
    session_id: randomUUID(),
    is_anonymous: false,
  });
  const refreshToken = randomUUID().replaceAll('-', '');
  refreshTokens.set(refreshToken, user.id);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: config.sessionSeconds,
    expires_at: now + config.sessionSeconds,
    refresh_token: refreshToken,
    user: userJson(user),
  };
};

// ---------------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------------
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD',
  'access-control-allow-headers':
    'authorization, apikey, content-type, prefer, range, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version, x-retry-count',
  'access-control-expose-headers': 'content-range, content-location, range-unit, x-supabase-api-version',
  'access-control-max-age': '600',
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { ...corsHeaders, 'content-type': 'application/json' });
  res.end(status === 204 ? undefined : JSON.stringify(body));
};

const authError = (res: ServerResponse, status: number, errorCode: string, message: string): void =>
  sendJson(res, status, { code: status, error_code: errorCode, msg: message });

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const text = await readBody(req);
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const bearer = (req: IncomingMessage): string | null => {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

// ---------------------------------------------------------------------------------------------
// /auth/v1: the calls supabase-js makes for email-code sign-in
// ---------------------------------------------------------------------------------------------
const handleAuth = async (req: IncomingMessage, res: ServerResponse, route: string, query: URLSearchParams): Promise<void> => {
  if (req.method === 'GET' && route === '/settings') {
    sendJson(res, 200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: false });
    return;
  }

  if (req.method === 'POST' && route === '/otp') {
    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      authError(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
      return;
    }
    const user = findOrInviteUser(email);
    if (!user) {
      authError(res, 422, 'otp_disabled', 'Signups not allowed for otp');
      return;
    }
    const previous = codes.get(email);
    const waitSeconds = previous ? Math.ceil(config.otpIntervalSeconds - (Date.now() - previous.sentAt) / 1000) : 0;
    if (waitSeconds > 0) {
      authError(res, 429, 'over_email_send_rate_limit', `For security purposes, you can only request this after ${waitSeconds} seconds.`);
      return;
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const linkToken = randomUUID().replaceAll('-', '');
    codes.set(email, { code, linkToken, redirectTo: safeRedirect(query.get('redirect_to')), sentAt: Date.now(), expiresAt: Date.now() + 3600_000, used: false });
    console.log(`[local-auth] Sign-in code for ${email}: ${code} (the email Supabase would send)`);
    sendJson(res, 200, {});
    return;
  }

  if (req.method === 'POST' && route === '/verify') {
    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const token = String(body.token ?? '').trim();
    const pending = codes.get(email);
    const user = EMAIL_PATTERN.test(email) ? findUser(email) : null;
    if (!pending || !user || pending.used || pending.expiresAt < Date.now() || pending.code !== token) {
      authError(res, 403, 'otp_expired', 'Token has expired or is invalid');
      return;
    }
    pending.used = true;
    sendJson(res, 200, sessionFor(user));
    return;
  }

  // The emailed link: like Supabase, it redirects to the app with the session (or the error) in the fragment.
  if (req.method === 'GET' && route === '/verify') {
    const token = query.get('token') ?? '';
    const entry = [...codes.entries()].find(([, pending]) => pending.linkToken === token);
    const user = entry ? findUser(entry[0]) : null;
    const pending = entry?.[1];
    if (!pending || !user || pending.used || pending.expiresAt < Date.now()) {
      const target = pending?.redirectTo ?? safeRedirect(query.get('redirect_to'));
      res.writeHead(303, { location: `${target}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired` });
      res.end();
      return;
    }
    pending.used = true;
    const session = sessionFor(user);
    const fragment = new URLSearchParams({
      access_token: session.access_token,
      expires_at: String(session.expires_at),
      expires_in: String(session.expires_in),
      refresh_token: session.refresh_token,
      token_type: 'bearer',
      type: 'magiclink',
    });
    res.writeHead(303, { location: `${pending.redirectTo}#${fragment.toString()}` });
    res.end();
    return;
  }

  if (req.method === 'GET' && route === '/user') {
    const claims = verifyToken(bearer(req) ?? '');
    const live = claims && !(typeof claims.iat === 'number' && claims.iat < revokedBefore);
    const user = live && claims && typeof claims.sub === 'string' ? userById(claims.sub) : null;
    if (!user) {
      authError(res, 401, 'bad_jwt', 'invalid JWT: unable to parse or verify signature');
      return;
    }
    sendJson(res, 200, userJson(user));
    return;
  }

  if (req.method === 'POST' && route === '/token' && query.get('grant_type') === 'refresh_token') {
    const body = await readJson(req);
    const token = String(body.refresh_token ?? '');
    const userId = refreshTokens.get(token);
    const user = userId ? userById(userId) : null;
    if (!user) {
      authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      return;
    }
    refreshTokens.delete(token);
    sendJson(res, 200, sessionFor(user));
    return;
  }

  if (req.method === 'POST' && route === '/logout') {
    sendJson(res, 204, null);
    return;
  }

  authError(res, 404, 'not_found', `The local stack does not emulate ${req.method} /auth/v1${route}`);
};

// ---------------------------------------------------------------------------------------------
// /rest/v1: PostgREST, as on Supabase
// ---------------------------------------------------------------------------------------------
const proxyRest = (req: IncomingMessage, res: ServerResponse, pathAndQuery: string): void => {
  const token = bearer(req);
  if (token && token !== ANON_KEY) {
    const claims = verifyToken(token);
    if (!claims || (typeof claims.iat === 'number' && claims.iat < revokedBefore)) {
      // PostgREST's answer to an expired token.
      sendJson(res, 401, { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' });
      return;
    }
  }
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.apikey;
  if (!headers.authorization) headers.authorization = `Bearer ${ANON_KEY}`;
  const upstream = httpRequest(
    { host: '127.0.0.1', port: config.restPort, method: req.method, path: pathAndQuery, headers },
    (response) => {
      const responseHeaders: Record<string, string | string[]> = { ...corsHeaders };
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined && !name.startsWith('access-control-')) responseHeaders[name] = value;
      }
      res.writeHead(response.statusCode ?? 502, responseHeaders);
      response.pipe(res);
    },
  );
  upstream.on('error', (error) => sendJson(res, 502, { message: `PostgREST is not reachable: ${error.message}` }));
  req.pipe(upstream);
};

// ---------------------------------------------------------------------------------------------
// PostgREST process
// ---------------------------------------------------------------------------------------------
const binDir = path.join(root, '.local-stack', 'bin');
const downloadedBin = path.join(binDir, 'postgrest');
let postgrestBin = downloadedBin;
let postgrest: ChildProcess | null = null;

/** Finds PostgREST: LOCAL_STACK_POSTGREST, an earlier download, a pinned download for this platform, or the PATH. */
const ensurePostgrest = async (): Promise<void> => {
  if (process.env.LOCAL_STACK_POSTGREST) {
    postgrestBin = process.env.LOCAL_STACK_POSTGREST;
    return;
  }
  if (existsSync(downloadedBin)) return;
  const build = POSTGREST_DOWNLOADS[`${process.platform}-${process.arch}`];
  if (!build) {
    try {
      execFileSync('postgrest', ['--version'], { stdio: 'ignore' });
      postgrestBin = 'postgrest';
      return;
    } catch {
      throw new Error(
        `PostgREST is needed. On a Mac: brew install postgrest. Otherwise set LOCAL_STACK_POSTGREST to a PostgREST ${POSTGREST_VERSION} binary. (On Windows, run the stack in WSL.)`,
      );
    }
  }
  mkdirSync(binDir, { recursive: true });
  const archive = path.join(root, '.local-stack', 'postgrest.tar.xz');
  const url = `https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-${build.asset}`;
  console.log(`[local-stack] Downloading PostgREST ${POSTGREST_VERSION}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`PostgREST download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(`${archive}.part`));
  const digest = createHash('sha256').update(readFileSync(`${archive}.part`)).digest('hex');
  if (digest !== build.sha256) throw new Error(`PostgREST download has an unexpected checksum: ${digest}`);
  renameSync(`${archive}.part`, archive);
  execFileSync('tar', ['-xJf', archive, '-C', binDir]);
};

const dbUri = (): string => {
  const host = config.pgHost.startsWith('/') ? `?host=${encodeURIComponent(config.pgHost)}` : '';
  const hostPart = config.pgHost.startsWith('/') ? '' : config.pgHost;
  return `postgres://authenticator:authenticator-local-only@${hostPart}:${config.pgPort}/${config.database}${host}`;
};

const waitForPostgrest = async (): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${config.restPort}/`, { headers: { authorization: `Bearer ${ANON_KEY}` } });
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('PostgREST did not start');
};

const startPostgrest = async (): Promise<void> => {
  postgrest = spawn(postgrestBin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: dbUri(),
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: LOCAL_SECRET,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(config.restPort),
      PGRST_DB_POOL: '10',
      PGRST_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitForPostgrest();
};

const stopPostgrest = async (): Promise<void> => {
  if (!postgrest) return;
  const child = postgrest;
  postgrest = null;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
};

const setupDatabase = (): void => {
  execFileSync('bash', [path.join(root, 'scripts', 'local-stack', 'setup-db.sh')], {
    env: { ...pgEnv, LOCAL_DB: config.database },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
};

let resetting: Promise<void> | null = null;
const reset = async (): Promise<void> => {
  await stopPostgrest();
  setupDatabase();
  codes.clear();
  refreshTokens.clear();
  revokedBefore = 0;
  await startPostgrest();
};

// ---------------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------------
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.port}`);
  const pathname = url.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  const respond = async (): Promise<void> => {
    if (resetting) await resetting;
    if (pathname.startsWith('/rest/v1')) {
      proxyRest(req, res, `${pathname.slice('/rest/v1'.length) || '/'}${url.search}`);
      return;
    }
    if (pathname.startsWith('/auth/v1')) {
      await handleAuth(req, res, pathname.slice('/auth/v1'.length) || '/', url.searchParams);
      return;
    }
    if (pathname === '/__local/codes' && req.method === 'GET') {
      const email = (url.searchParams.get('email') ?? '').toLowerCase();
      const pending = codes.get(email);
      const link = pending ? `http://127.0.0.1:${config.port}/auth/v1/verify?token=${pending.linkToken}&type=magiclink` : null;
      sendJson(res, pending ? 200 : 404, pending ? { email, code: pending.code, link, used: pending.used } : { message: 'No code requested for that address.' });
      return;
    }
    if (pathname === '/__local/reset' && req.method === 'POST') {
      resetting = reset();
      try {
        await resetting;
      } finally {
        resetting = null;
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (pathname === '/__local/end-sessions' && req.method === 'POST') {
      // Ends every session, as a long absence or a revoked sign-in would: tests use it for the sign-in sheet.
      revokedBefore = Math.floor(Date.now() / 1000) + 1;
      refreshTokens.clear();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (pathname === '/__local/health') {
      sendJson(res, 200, { ok: true, database: config.database });
      return;
    }
    sendJson(res, 404, { message: 'Not found' });
  };
  respond().catch((error: unknown) => {
    console.error('[local-stack]', error);
    if (!res.headersSent) sendJson(res, 500, { message: error instanceof Error ? error.message : 'Local stack error' });
  });
});

const writeEnvFile = (): void => {
  const file = path.join(root, 'web', '.env.development.local');
  const content = [
    '# Written by scripts/local-stack/gateway.ts: the local stack, development only. Never commit (NFR-06).',
    `VITE_SUPABASE_URL=http://127.0.0.1:${config.port}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}`,
    '',
  ].join('\n');
  if (existsSync(path.dirname(file)) && (!existsSync(file) || readFileSync(file, 'utf8') !== content)) writeFileSync(file, content);
};

const main = async (): Promise<void> => {
  await ensurePostgrest();
  if (!config.skipSetup) setupDatabase();
  await startPostgrest();
  writeEnvFile();
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`[local-stack] Supabase stand-in on http://127.0.0.1:${config.port} (database ${config.database})`);
    console.log(`[local-stack] Sign-in codes: http://127.0.0.1:${config.port}/__local/codes?email=owner@example.test`);
  });
  const shutdown = (): void => {
    void stopPostgrest().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error('[local-stack]', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
