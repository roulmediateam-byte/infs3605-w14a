// One error type for every screen. Database functions raise plain-words messages with a code that says what kind
// of problem it is (docs/api.md); this turns those, sign-in errors and network failures into what the app shows.

export type AppErrorKind = 'signed-out' | 'permission' | 'rule' | 'mass-close' | 'not-found' | 'exists' | 'offline' | 'network' | 'rate-limit' | 'uninvited' | 'code' | 'unknown';

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly hint: string | null;
  readonly code: string | null;

  constructor(kind: AppErrorKind, message: string, options: { hint?: string | null; code?: string | null } = {}) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.hint = options.hint ?? null;
    this.code = options.code ?? null;
  }
}

export const MESSAGES = {
  permission: "You don't have permission to do that.",
  notFound: 'This item is no longer available.',
  offline: "You're offline. Your place is saved.",
  offlineNoData: "You're offline. This will load when you're back online.",
  network: "Couldn't reach the server. Check your connection, then try again.",
  unknown: 'Something went wrong. Try again, or contact the team.',
  signedOut: 'Your session ended. Sign in again to carry on.',
  uninvited: 'Ask the owner to invite you.',
  rateLimit: 'Wait a minute, then ask again.',
  badCode: "That code didn't work. It may have expired. Send a new one.",
  badLink: "That sign-in link didn't work. It may have expired or been used. Send a new code.",
  notAllowedValue: "That value isn't allowed. Check the field, then try again.",
} as const;

interface DatabaseErrorLike {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
  details?: string | null;
  status?: number;
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

/** A Postgres or PostgREST error (from supabase-js or the preview database) as an AppError. */
export const fromDatabaseError = (error: DatabaseErrorLike): AppError => {
  const code = error.code ?? null;
  const message = error.message ?? '';
  const hint = error.hint ?? null;
  switch (code) {
    case '28000':
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
      return new AppError('signed-out', MESSAGES.signedOut, { code });
    case '42501':
      return new AppError('permission', MESSAGES.permission, { code });
    case '22023':
      return new AppError('rule', message, { hint, code });
    case 'P0001':
      return hint === 'confirm_mass_close' ? new AppError('mass-close', message, { hint, code }) : new AppError('rule', message, { hint, code });
    case 'P0002':
      return new AppError('not-found', MESSAGES.notFound, { code });
    case '23505':
      return new AppError('exists', message, { code });
    case '23514':
    case '22P02':
    case '22003':
    case '22007':
    case '22008':
      return new AppError('rule', MESSAGES.notAllowedValue, { code });
    default:
      break;
  }
  if (!code && (error.status === 0 || /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message))) {
    return isOffline() ? new AppError('offline', MESSAGES.offline) : new AppError('network', MESSAGES.network);
  }
  return new AppError('unknown', MESSAGES.unknown, { code });
};

interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
  name?: string;
}

/** A Supabase Auth error (sign-in with a code) as an AppError. */
export const fromAuthError = (error: AuthErrorLike): AppError => {
  const message = error.message ?? '';
  if (error.code === 'otp_disabled' || error.code === 'signup_disabled' || /signups not allowed/i.test(message)) {
    return new AppError('uninvited', MESSAGES.uninvited, { code: error.code ?? null });
  }
  if (error.status === 429 || error.code === 'over_email_send_rate_limit' || /rate limit|security purposes/i.test(message)) {
    return new AppError('rate-limit', MESSAGES.rateLimit, { code: error.code ?? null });
  }
  if (error.code === 'otp_expired' || /expired|invalid/i.test(message)) {
    return new AppError('code', MESSAGES.badCode, { code: error.code ?? null });
  }
  if (error.name === 'AuthRetryableFetchError' || /Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return isOffline() ? new AppError('offline', MESSAGES.offline) : new AppError('network', MESSAGES.network);
  }
  return new AppError('unknown', MESSAGES.unknown, { code: error.code ?? null });
};

export const toAppError = (error: unknown): AppError => {
  if (error instanceof AppError) return error;
  if (error instanceof TypeError) return isOffline() ? new AppError('offline', MESSAGES.offline) : new AppError('network', MESSAGES.network);
  if (error && typeof error === 'object') return fromDatabaseError(error as DatabaseErrorLike);
  return new AppError('unknown', MESSAGES.unknown);
};
