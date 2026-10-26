// "Paste the link" sign-in: reads what someone pasted from a sign-in email, so the app can finish signing in on this
// device whatever page the link opened. Two shapes work:
//   - the link in the email: https://<project>.supabase.co/auth/v1/verify?token=<hash>&type=magiclink&redirect_to=...
//     (also inside a mail app's safe-link wrapper, such as google.com/url?q=... or safelinks ...?url=...);
//   - the address the link opened, with the session after "#": ...#access_token=...&refresh_token=...
//     This is what a phone's email app or a wrong Site URL (Supabase's default is http://localhost:3000) leaves.
// Nothing here talks to the network: the caller hands the result to Supabase Auth.

/** The kinds of emailed link that sign someone in. Recovery and email-change links are not sign-ins. */
export type SignInLinkType = 'magiclink' | 'signup' | 'invite' | 'email';

export type SignInLink =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'token'; tokenHash: string; type: SignInLinkType }
  | { kind: 'expired' };

const TYPES: ReadonlySet<string> = new Set<SignInLinkType>(['magiclink', 'signup', 'invite', 'email']);

/** Query parameters that safe-link wrappers put the real address in. */
const WRAPPERS = ['q', 'url', 'u', 'target', 'link', 'redirect'];

const TOKEN = /^[A-Za-z0-9_.-]{16,}$/;

const firstUrl = (text: string): URL | null => {
  const trimmed = text.trim();
  const match = /https?:\/\/[^\s<>"']+/i.exec(trimmed);
  const candidate = match ? match[0] : trimmed;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
};

const fromParams = (params: URLSearchParams): SignInLink | null => {
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken };
  if (params.get('error') || params.get('error_code')) return { kind: 'expired' };
  const token = params.get('token') ?? params.get('token_hash');
  const type = params.get('type');
  if (token && type && TOKEN.test(token) && TYPES.has(type)) return { kind: 'token', tokenHash: token, type: type as SignInLinkType };
  return null;
};

/** What the pasted text holds, or null when it isn't a sign-in link at all. */
export const readSignInLink = (text: string, depth = 0): SignInLink | null => {
  const url = firstUrl(text);
  if (!url) return null;
  const found = fromParams(new URLSearchParams(url.hash.replace(/^#/, ''))) ?? fromParams(url.searchParams);
  if (found) return found;
  if (depth >= 3) return null;
  for (const name of WRAPPERS) {
    const inner = url.searchParams.get(name);
    if (inner && /^https?:\/\//i.test(inner)) {
      const unwrapped = readSignInLink(inner, depth + 1);
      if (unwrapped) return unwrapped;
    }
  }
  return null;
};
