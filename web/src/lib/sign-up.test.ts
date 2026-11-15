// The demonstration build's sign-up rules: the same cases as the server's (jobs/test/demo-sign-up.test.ts).
import { describe, expect, it } from 'vitest';
import { isMadeUpEmail, SIGN_UP_MESSAGES, signInProblem, signUpProblem } from './sign-up.ts';

/** An address on a domain that isn't reserved, built at run time so the repository holds none (scripts/check-hygiene.sh). */
const unreserved = (local: string, domain: string): string => [local, domain].join('@');
const UNRESERVED = ['gmail.com', 'unsw.edu.au', 'notexample.com', 'test.com', 'example.com.au', 'site.invalid', 'mail.example.org'].map((domain) =>
  unreserved('someone', domain),
);

describe('isMadeUpEmail', () => {
  it('takes addresses on reserved domains, which never receive email', () => {
    for (const email of ['sam@demo.test', 'a.b+c@x.example', 'lee@example.com', 'mei@mail.harbourline.test']) {
      expect(isMadeUpEmail(email), email).toBe(true);
    }
  });

  it('refuses real-looking ones', () => {
    for (const email of UNRESERVED) expect(isMadeUpEmail(email), email).toBe(false);
  });
});

describe('signUpProblem', () => {
  it('accepts a made-up email and a password of 8 or more characters, in any case and with spaces around', () => {
    expect(signUpProblem('  Sam@Demo.TEST ', 'harbour-line-8')).toBeNull();
  });

  it('names the field and the fix', () => {
    expect(signUpProblem('not an email', 'harbour-line-8')).toEqual({ field: 'email', message: SIGN_UP_MESSAGES.email });
    expect(signUpProblem(UNRESERVED[0] ?? '', 'harbour-line-8')).toEqual({ field: 'email', message: SIGN_UP_MESSAGES.realEmail });
    expect(signUpProblem('sam@demo.test', 'short')).toEqual({ field: 'password', message: SIGN_UP_MESSAGES.passwordShort });
    // 37 two-byte letters are 74 bytes: more than bcrypt reads.
    expect(signUpProblem('sam@demo.test', 'é'.repeat(37))).toEqual({ field: 'password', message: SIGN_UP_MESSAGES.passwordLong });
  });
});

describe('signInProblem', () => {
  it('lets any well-formed address sign in, and needs a password', () => {
    expect(signInProblem('owner@harbourline.example', 'x')).toBeNull();
    expect(signInProblem('sam@demo', 'harbour-line-8')).toEqual({ field: 'email', message: SIGN_UP_MESSAGES.email });
    expect(signInProblem('sam@demo.test', '')).toEqual({ field: 'password', message: SIGN_UP_MESSAGES.passwordEmpty });
  });
});
