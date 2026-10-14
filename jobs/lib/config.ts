// Environment for the scheduled jobs. Secrets come only from GitHub Actions secrets or a local .env file
// that git ignores (NFR-06). Nothing here is ever logged.

export type Config = {
  supabaseUrl: string;
  serviceKey: string;
  anthropicKey: string | null;
  aiModel: string;
  aiTemperature: number | null;
  aiTimeoutMs: number;
  resendKey: string | null;
  emailFrom: string;
  appUrl: string;
  alertEmail: string | null;
  githubRunUrl: string | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) missing.push(name);
    return value ?? '';
  };
  const optional = (name: string): string | null => env[name]?.trim() || null;

  const config: Config = {
    supabaseUrl: required('SUPABASE_URL').replace(/\/+$/, ''),
    serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    anthropicKey: optional('ANTHROPIC_API_KEY'),
    aiModel: optional('AI_MODEL') ?? 'claude-haiku-5-5',
    aiTemperature: parseTemperature(env.AI_TEMPERATURE),
    aiTimeoutMs: 20_000,
    resendKey: optional('RESEND_API_KEY'),
    emailFrom: optional('EMAIL_FROM') ?? 'Get-Paid Apprentice <briefing@example.com>',
    appUrl: (optional('APP_URL') ?? 'http://localhost:5173').replace(/\/+$/, ''),
    alertEmail: optional('ALERT_EMAIL'),
    githubRunUrl:
      env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
  };
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}. See .env.example.`);
  }
  return config;
}

// AI-09: low randomness by default. AI_TEMPERATURE=off leaves it to the model's default.
export function parseTemperature(value: string | undefined): number | null {
  if (value === undefined) return 0.3;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'off') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('AI_TEMPERATURE must be a number from 0 to 1, or "off".');
  }
  return parsed;
}

// Flags shared by every job: --force, --business=<uuid>, --as-of=<ISO time>. GitHub's "Run workflow" form passes
// them as JOB_FORCE and JOB_BUSINESS_ID environment variables, so inputs are never pasted into a shell command.
export type Flags = { force: boolean; businessId: string | null; asOf: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFlags(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Flags {
  const value = (name: string): string | null => {
    const match = argv.find((arg) => arg.startsWith(`--${name}=`));
    return match ? match.slice(name.length + 3) : null;
  };
  const businessId = value('business') ?? (env.JOB_BUSINESS_ID?.trim() || null);
  if (businessId !== null && !UUID.test(businessId)) {
    throw new Error('The business id must be a UUID, as shown in the businesses table.');
  }
  const asOf = value('as-of');
  if (asOf !== null && Number.isNaN(Date.parse(asOf))) {
    throw new Error('--as-of must be an ISO date and time, for example 2026-11-08T21:00:00+11:00.');
  }
  return { force: argv.includes('--force') || env.JOB_FORCE === 'true', businessId, asOf };
}
