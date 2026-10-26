// UI-01 Sign in (FR-01). Invited people only, with no password: the email carries a 6-digit code and a link, and the
// screen leads with the code, because phones often open email links in the email app's own browser (TRD, Identity).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useBackend, useSession } from '../app/session.tsx';
import { toHref } from '../app/router.tsx';
import { AppError, MESSAGES, toAppError } from '../backend/errors.ts';
import type { AuthUser, PreviewStorage } from '../backend/types.ts';
import { KEYS, readItem, writeItem } from '../lib/storage.ts';
import { BrandFrame } from '../ui/BrandFrame.tsx';
import { Banner, Button, FormError, PageTitle, TextField } from '../ui/controls.tsx';

const RESEND_SECONDS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The preview's two Test people (supabase/seed.sql), one tap each. */
const PREVIEW_PEOPLE = [
  { email: 'owner@example.test', label: 'Sign in as the owner', hint: 'Alex reviews the drafts and sends them.' },
  { email: 'checker@example.test', label: 'Sign in as the checker', hint: 'Jo checks the drafts. Alex sends them.' },
] as const;

/** Why the preview can't keep the demo's data in this tab, said once, on the way in. */
const storageNotice = (storage: PreviewStorage): string | null => {
  if (storage.mode === 'stored') return null;
  return storage.reason === 'other-tab'
    ? "The demo is open in another tab, so this tab can't keep its changes. Close the other tab, then reload this one."
    : "This browser can't keep the demo's data, so a reload starts again.";
};

/** Preview only: sign in as a Test person in one tap, through the same code flow as the form below. */
const PreviewPeople = () => {
  const backend = useBackend();
  const { signedIn } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signInAs = async (email: string) => {
    if (busy) return;
    setBusy(email);
    setError(null);
    try {
      await backend.auth.sendCode(email, `${window.location.origin}${toHref('')}`);
      const code = backend.preview?.codeFor(email);
      if (!code) throw new AppError('unknown', MESSAGES.unknown);
      const user = await backend.auth.verifyCode(email, code);
      writeItem(KEYS.signInEmail, email);
      await signedIn(user);
    } catch (caught) {
      setError(toAppError(caught).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card stack" aria-labelledby="preview-people-heading">
      <h2 className="t-subheading" id="preview-people-heading">
        Try it with made-up Test data
      </h2>
      {PREVIEW_PEOPLE.map((person, index) => (
        <div className="stack-sm" key={person.email}>
          <Button
            variant={index === 0 ? 'primary' : 'secondary'}
            size="lg"
            block
            busy={busy === person.email}
            busyLabel="Signing in…"
            unavailable={busy !== null && busy !== person.email}
            aria-describedby={`preview-person-${index}`}
            onClick={() => void signInAs(person.email)}
          >
            {person.label}
          </Button>
          <p className="t-caption" id={`preview-person-${index}`}>
            {person.hint}
          </p>
        </div>
      ))}
      <FormError message={error} />
    </section>
  );
};

export const CodeSignIn = ({
  lockedEmail,
  onSignedIn,
  autoFocus = true,
  quietSubmit = false,
}: {
  lockedEmail?: string;
  onSignedIn: (user: AuthUser) => void | Promise<void>;
  autoFocus?: boolean;
  /** The preview's sign-in leads with its one-tap buttons, so the form's first button steps back to secondary. */
  quietSubmit?: boolean;
}) => {
  const backend = useBackend();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(lockedEmail ?? readItem(KEYS.signInEmail) ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const sendCode = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) {
      setError('Enter the email address your invitation went to.');
      emailRef.current?.focus();
      return;
    }
    setBusy('send');
    setError(null);
    try {
      await backend.auth.sendCode(address, `${window.location.origin}${toHref('')}`);
      writeItem(KEYS.signInEmail, address);
      setEmail(address);
      setCode('');
      setStep('code');
      setWait(RESEND_SECONDS);
    } catch (caught) {
      const appError = toAppError(caught);
      setError(appError.message);
      if (appError.kind === 'rate-limit') {
        setStep('code');
        setWait(RESEND_SECONDS);
      }
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value: string) => {
    if (busy) return;
    if (!/^[0-9]{6}$/.test(value)) {
      setError('Type the 6 digits from your email.');
      codeRef.current?.focus();
      return;
    }
    setBusy('verify');
    setError(null);
    try {
      const user = await backend.auth.verifyCode(email, value);
      await onSignedIn(user);
    } catch (caught) {
      setError(toAppError(caught).message);
      codeRef.current?.focus();
      codeRef.current?.select();
    } finally {
      setBusy(null);
    }
  };

  if (step === 'email') {
    return (
      <form className="stack" onSubmit={sendCode} noValidate>
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
          error={error}
          hint="We use your email only to sign you in."
        />
        <Button type="submit" variant={quietSubmit ? 'secondary' : 'primary'} size="lg" block busy={busy === 'send'} busyLabel="Sending…">
          Email me a code
        </Button>
      </form>
    );
  }

  const previewCode = backend.preview?.codeFor(email) ?? null;

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
    >
      <p>
        Type the 6-digit code from your email. It works once, for 1 hour. We sent it to <strong>{email}</strong>.
      </p>
      {previewCode ? (
        <Banner>
          <div className="stack-sm">
            <p>
              Preview: no email is sent, so here is the code: <strong className="num">{previewCode}</strong>.
            </p>
            <Button variant="secondary" unavailable={busy !== null} onClick={() => void verify(previewCode)}>
              Use it
            </Button>
          </div>
        </Banner>
      ) : null}
      <TextField
        ref={codeRef}
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        inputClassName="input-code"
        value={code}
        error={error}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          // A pasted or autofilled code signs in at once; typing the last digit by hand waits for "Sign in".
          if (digits.length === 6 && digits !== code && digits.length - code.length !== 1) void verify(digits);
        }}
      />
      <Button type="submit" variant="primary" size="lg" block busy={busy === 'verify'} busyLabel="Signing in…">
        Sign in
      </Button>
      <div className="row-wrap">
        <Button variant="quiet" unavailable={wait > 0 || busy !== null} onClick={() => void sendCode()} aria-describedby="resend-wait">
          Send a new code
        </Button>
        {!lockedEmail ? (
          <Button
            variant="quiet"
            onClick={() => {
              setStep('email');
              setError(null);
            }}
          >
            Use a different email
          </Button>
        ) : null}
      </div>
      {wait > 0 ? (
        <p id="resend-wait" className="t-caption" aria-live="off">
          You can ask for a new code in {wait} {wait === 1 ? 'second' : 'seconds'}.
        </p>
      ) : null}
      <p className="t-caption">The link in the same email works too, if you open it on this device.</p>
    </form>
  );
};

export const SignInScreen = ({ next }: { next: string | null }) => {
  const { signedIn, notice } = useSession();
  const backend = useBackend();
  // An emailed link that had expired or was used lands here: say so once (App Flow, flow rule 5: no dead ends).
  const [linkProblem] = useState(() => backend.auth.takeLinkProblem?.() ?? null);
  useEffect(() => {
    // Keep the deep link for a sign-in that finishes through the emailed link instead of the code.
    if (next) writeItem(KEYS.nextAfterSignIn, next);
  }, [next]);
  const storageLine = backend.preview ? storageNotice(backend.preview.storage) : null;
  return (
    <BrandFrame>
      <div className="stack-lg">
        <PageTitle documentTitle="Sign in">Sign in</PageTitle>
        {notice ? <Banner>{notice}</Banner> : null}
        {linkProblem ? (
          <Banner tone="warning" role="alert">
            {linkProblem}
          </Banner>
        ) : null}
        {storageLine ? (
          <Banner tone={backend.preview?.storage.reason === 'other-tab' ? 'warning' : 'info'} role="status">
            {storageLine}
          </Banner>
        ) : null}
        {backend.preview ? (
          <>
            <PreviewPeople />
            <p className="t-secondary">
              Or sign in with an email: <strong>owner@example.test</strong> or <strong>checker@example.test</strong>.
            </p>
          </>
        ) : null}
        <CodeSignIn onSignedIn={(user) => signedIn(user)} autoFocus={!backend.preview} quietSubmit={Boolean(backend.preview)} />
      </div>
    </BrandFrame>
  );
};
