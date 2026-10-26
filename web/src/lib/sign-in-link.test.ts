import { describe, expect, it } from 'vitest';
import { readSignInLink } from './sign-in-link.ts';

const HASH = 'pkcf3a0c8e5d6b7a8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8';
const VERIFY = `https://project.supabase.example/auth/v1/verify?token=${HASH}&type=magiclink&redirect_to=https://team.example/app/`;

describe('readSignInLink', () => {
  it('reads the link in the email as a token to verify', () => {
    expect(readSignInLink(VERIFY)).toEqual({ kind: 'token', tokenHash: HASH, type: 'magiclink' });
  });

  it('reads the address a link opened, with the session after #', () => {
    expect(readSignInLink('http://localhost:3000/#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=magiclink')).toEqual({
      kind: 'session',
      accessToken: 'a.b.c',
      refreshToken: 'r1',
    });
  });

  it('finds the link inside surrounding text and spaces', () => {
    expect(readSignInLink(`  Log In <${VERIFY}>  `)).toEqual({ kind: 'token', tokenHash: HASH, type: 'magiclink' });
  });

  it('unwraps a mail app safe-link wrapper', () => {
    const google = `https://www.google.com/url?q=${encodeURIComponent(VERIFY)}&source=gmail&ust=1`;
    const outlook = `https://aus01.safelinks.protection.outlook.example/?url=${encodeURIComponent(VERIFY)}&data=05`;
    expect(readSignInLink(google)).toEqual({ kind: 'token', tokenHash: HASH, type: 'magiclink' });
    expect(readSignInLink(outlook)).toEqual({ kind: 'token', tokenHash: HASH, type: 'magiclink' });
  });

  it('says a link has expired when Supabase says so after #', () => {
    expect(readSignInLink('http://localhost:3000/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')).toEqual({
      kind: 'expired',
    });
  });

  it('accepts sign-in, sign-up and invite links only', () => {
    for (const type of ['signup', 'invite', 'email']) {
      expect(readSignInLink(VERIFY.replace('type=magiclink', `type=${type}`))).toMatchObject({ kind: 'token', type });
    }
    expect(readSignInLink(VERIFY.replace('type=magiclink', 'type=recovery'))).toBeNull();
    expect(readSignInLink(VERIFY.replace('type=magiclink', 'type=email_change'))).toBeNull();
  });

  it('returns null for text that is not a sign-in link', () => {
    expect(readSignInLink('')).toBeNull();
    expect(readSignInLink('123456')).toBeNull();
    expect(readSignInLink('https://team.example/app/')).toBeNull();
    expect(readSignInLink('https://project.supabase.example/auth/v1/verify?token=short&type=magiclink')).toBeNull();
    expect(readSignInLink('http://localhost:3000/#access_token=only-one')).toBeNull();
  });
});
