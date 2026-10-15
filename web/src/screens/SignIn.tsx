// UI-01 Sign in (FR-01). Invited people only, with no password: the email carries a 6-digit code and a link, and the
// screen leads with the code, because phones often open email links in the email app's own browser (TRD, Identity).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useBackend, useSession } from '../app/session.tsx';
import { toHref } from '../app/router.tsx';
import { toAppError } from '../backend/errors.ts';
import type { AuthUser } from '../backend/types.ts';
import { KEYS, readItem, writeItem } from '../lib/storage.ts';
import { Banner, Button, PageTitle, TextField } from '../ui/controls.tsx';
import { AppMark } from '../ui/AppMark.tsx';

const RESEND_SECONDS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CodeSignIn = ({
  lockedEmail,
  onSignedIn,
  autoFocus = true,
}: {
  lockedEmail?: string;
  onSignedIn: (user: AuthUser) => void | Promise<void>;
  autoFocus?: boolean;
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
        <Button type="submit" variant="primary" size="lg" block busy={busy === 'send'} busyLabel="Sending…">
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
          Preview: no email is sent, so here is the code: <strong className="num">{previewCode}</strong>.{' '}
          <button type="button" className="btn btn-quiet" style={{ minHeight: 24, padding: 0 }} onClick={() => void verify(previewCode)}>
            Use it
          </button>
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
  return (
    <main className="sign-in" id="main">
      <div className="brand">
        <AppMark />
        <span>Get-Paid Apprentice</span>
      </div>
      <div className="stack-lg">
        <PageTitle documentTitle="Sign in">Sign in</PageTitle>
        {notice ? <Banner>{notice}</Banner> : null}
        {linkProblem ? (
          <Banner tone="warning" role="alert">
            {linkProblem}
          </Banner>
        ) : null}
        {backend.preview ? (
          <Banner>
            Preview with Test data. Sign in as <strong>owner@example.test</strong> to review and send, or as <strong>checker@example.test</strong> to see
            the checker's view.
          </Banner>
        ) : null}
        <CodeSignIn onSignedIn={(user) => signedIn(user)} />
      </div>
    </main>
  );
};
