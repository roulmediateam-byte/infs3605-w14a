// The demonstration build's sign-up rules (config.demoSignUp), checked here so the person hears at once, and checked
// again by the server: supabase/functions/demo-sign-up/handler.ts. Keep the two in step.
//
// No email is ever sent, so the address only has to look like one, and it must be made up: a reserved domain such as
// .test can never receive email, so no real address is needed or kept (PD-1, PD-2).

export const MIN_PASSWORD = 8;
/** Supabase Auth hashes passwords with bcrypt, which reads at most 72 bytes. */
export const MAX_PASSWORD_BYTES = 72;

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export const SIGN_UP_MESSAGES = {
  email: 'Enter an email address, like sam@demo.test.',
  realEmail: "Use a made-up email ending in .test, like sam@demo.test. We never send email, so a real one isn't needed.",
  passwordShort: `Use at least ${MIN_PASSWORD} characters for the password.`,
  passwordLong: 'That password is too long. Use up to 72 letters or numbers.',
  passwordEmpty: 'Type your password.',
} as const;

/** A made-up address: its domain is reserved (.test, .example or example.com), so it can never receive email. */
export const isMadeUpEmail = (email: string): boolean => {
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return domain === 'example.com' || /\.(test|example)$/.test(domain);
};

export type SignUpProblem = { field: 'email' | 'password'; message: string };

/** What's wrong with a new account's email and password, in the app's words; null when both are fine. */
export const signUpProblem = (email: string, password: string): SignUpProblem | null => {
  const address = email.trim().toLowerCase();
  if (address.length > 120 || !EMAIL.test(address)) return { field: 'email', message: SIGN_UP_MESSAGES.email };
  if (!isMadeUpEmail(address)) return { field: 'email', message: SIGN_UP_MESSAGES.realEmail };
  if (password.length < MIN_PASSWORD) return { field: 'password', message: SIGN_UP_MESSAGES.passwordShort };
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return { field: 'password', message: SIGN_UP_MESSAGES.passwordLong };
  return null;
};

/** What's wrong with a sign-in's email and password; null when both can be sent. Any well-formed address may sign in. */
export const signInProblem = (email: string, password: string): SignUpProblem | null => {
  const address = email.trim().toLowerCase();
  if (address.length > 254 || !EMAIL.test(address)) return { field: 'email', message: SIGN_UP_MESSAGES.email };
  if (!password) return { field: 'password', message: SIGN_UP_MESSAGES.passwordEmpty };
  return null;
};
