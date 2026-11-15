// UI-01 Sign in, the demonstration build's way (config.demoSignUp). Anyone can create an account with a made-up email
// and a password. It comes with its own copy of the Test data business (supabase/functions/demo-sign-up), so nobody's
// practice changes anyone else's. No email is ever sent; signing in again uses the same email and password.
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { config } from '../app/config.ts';
import { useBackend } from '../app/session.tsx';
import { toAppError } from '../backend/errors.ts';
import type { AuthUser, Backend } from '../backend/types.ts';
import { MIN_PASSWORD, signInProblem, signUpProblem } from '../lib/sign-up.ts';
import { KEYS, readItem, writeItem } from '../lib/storage.ts';
import { Button, Choices, FormError, TextField } from '../ui/controls.tsx';

export type PasswordMode = 'create' | 'sign-in';

/** Whether this build signs in with a password: the demonstration build, on a real project (not the preview). */
export const usesPasswordSignIn = (backend: Backend): boolean =>
  config.demoSignUp && !backend.preview && typeof backend.auth.signUp === 'function' && typeof backend.auth.signInWithPassword === 'function';

/** The tab to open on: Sign in for someone who has used an account on this device, otherwise Create an account. */
export const firstPasswordMode = (): PasswordMode => (readItem(KEYS.signInEmail) ? 'sign-in' : 'create');

type Problem = { field: 'email' | 'password' | 'form'; message: string };

export const PasswordSignIn = ({
  mode,
  onModeChange,
  lockedEmail,
  onSignedIn,
  autoFocus = true,
  passwordInputRef,
}: {
  mode: PasswordMode;
  /** Absent in the session sheet, which only signs the same person back in. */
  onModeChange?: (mode: PasswordMode) => void;
  lockedEmail?: string;
  onSignedIn: (user: AuthUser) => void | Promise<void>;
  autoFocus?: boolean;
  /** The password field, for a sheet that starts there (the email is locked). */
  passwordInputRef?: RefObject<HTMLInputElement | null>;
}) => {
  const backend = useBackend();
  const [email, setEmail] = useState(lockedEmail ?? readItem(KEYS.signInEmail) ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const ownPasswordRef = useRef<HTMLInputElement>(null);
  const passwordRef = passwordInputRef ?? ownPasswordRef;
  const creating = mode === 'create';

  // Each tab asks its own questions, so it starts without the other tab's message.
  useEffect(() => setProblem(null), [mode]);

  const show = (found: Problem) => {
    setProblem(found);
    if (found.field === 'email') emailRef.current?.focus();
    if (found.field === 'password') {
      passwordRef.current?.focus();
      passwordRef.current?.select();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { signUp, signInWithPassword } = backend.auth;
    if (busy || !signUp || !signInWithPassword) return;
    const address = email.trim().toLowerCase();
    const found = creating ? signUpProblem(address, password) : signInProblem(address, password);
    if (found) {
      show(found);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const user = creating ? await signUp(address, password) : await signInWithPassword(address, password);
      writeItem(KEYS.signInEmail, address);
      await onSignedIn(user);
    } catch (caught) {
      const appError = toAppError(caught);
      if (appError.kind === 'exists' || appError.code === 'email' || appError.code === 'real_email') show({ field: 'email', message: appError.message });
      else if (appError.kind === 'code' || appError.code === 'password') show({ field: 'password', message: appError.message });
      else show({ field: 'form', message: appError.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      {onModeChange ? (
        <Choices
          legend="Create an account or sign in"
          hideLegend
          name="sign-in-mode"
          segmented
          value={mode}
          options={[
            { value: 'create', label: 'Create an account' },
            { value: 'sign-in', label: 'Sign in' },
          ]}
          onChange={onModeChange}
        />
      ) : null}
      {creating ? <p>Your account comes with its own copy of the Test data business, so what you do won't change anyone else's.</p> : null}
      <TextField
        ref={emailRef}
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        readOnly={Boolean(lockedEmail)}
        autoFocus={autoFocus && !lockedEmail}
        onChange={(event) => setEmail(event.target.value)}
        error={problem?.field === 'email' ? problem.message : null}
        hint={creating ? 'Make one up, ending in .test, like sam@demo.test. We never send email to it.' : undefined}
      />
      <TextField
        ref={passwordRef}
        label="Password"
        type={showPassword ? 'text' : 'password'}
        name="password"
        autoComplete={creating ? 'new-password' : 'current-password'}
        autoCapitalize="none"
        spellCheck={false}
        value={password}
        autoFocus={autoFocus && Boolean(lockedEmail)}
        onChange={(event) => setPassword(event.target.value)}
        error={problem?.field === 'password' ? problem.message : null}
        hint={creating ? `At least ${MIN_PASSWORD} characters. There's no reset, so keep it somewhere safe.` : undefined}
      />
      <label className="check">
        <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
        <span>Show password</span>
      </label>
      <FormError message={problem?.field === 'form' ? problem.message : null} />
      <Button type="submit" variant="primary" size="lg" block busy={busy} busyLabel={creating ? 'Creating your account…' : 'Signing in…'}>
        {creating ? 'Create account' : 'Sign in'}
      </Button>
      {!creating && !lockedEmail ? (
        <p className="t-caption">Forgot your password? Create a new account. There's no reset, because we never send email.</p>
      ) : null}
    </form>
  );
};
