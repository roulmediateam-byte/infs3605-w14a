// UI-06 Send (FR-18, FR-20, D2). The server hands over only the approved text, exactly; a pre-filled email opens
// in the person's own email app, and the sheet asks "Did it send?" straight after the tap, because no browser reports
// whether an email app opened. The question stays on that draft, even after a reload, until it is answered.
import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMessages } from '../../app/messages.tsx';
import { useAction } from '../../app/queries.ts';
import { useBackend } from '../../app/session.tsx';
import { toAppError } from '../../backend/errors.ts';
import type { SendPayload } from '../../backend/types.ts';
import { buildMailto, MAILTO_COMFORT_LIMIT } from '../../lib/drafts.ts';
import { KEYS, pendingSends, readItem, setPendingSend, writeItem } from '../../lib/storage.ts';
import { Banner, Button, ErrorPanel, FormError, Skeleton } from '../../ui/controls.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

/** Sheets currently showing a draft, so the reload prompt never asks about the same draft twice. */
export const openSendSheets = new Set<string>();

type Phase = 'loading' | 'ready' | 'asking' | 'refused' | 'error';

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers: a hidden text area and the copy command.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
};

export const SendSheet = ({
  draftId,
  onClose,
  onDone,
}: {
  draftId: string | null;
  onClose: () => void;
  onDone: (outcome: 'sent' | 'not-yet', draftId: string) => void;
}) => {
  const backend = useBackend();
  const { run, busy } = useAction();
  const { announce } = useMessages();
  const [phase, setPhase] = useState<Phase>('loading');
  const [payload, setPayload] = useState<Extract<SendPayload, { ok: true }> | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCopy, setShowCopy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showTip, setShowTip] = useState(false);
  const [previewNote, setPreviewNote] = useState(false);
  const usedCopy = useRef(false);
  const sentRef = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!draftId) return;
    openSendSheets.add(draftId);
    let active = true;
    setPhase('loading');
    setError(null);
    setRefusal(null);
    setShowCopy(false);
    setCopied(null);
    usedCopy.current = false;
    backend
      .getSendPayload(draftId)
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setRefusal(result.message);
          setPhase('refused');
          if (result.code === 'already_sent') setPendingSend(draftId, false);
          return;
        }
        setPayload(result);
        setPhase(pendingSends()[draftId] ? 'asking' : 'ready');
        if (readItem(KEYS.fromLineTipSeen) !== 'yes') {
          setShowTip(true);
          writeItem(KEYS.fromLineTipSeen, 'yes');
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toAppError(caught).message);
        setPhase('error');
      });
    return () => {
      active = false;
      openSendSheets.delete(draftId);
    };
  }, [backend, draftId, attempt]);

  useEffect(() => {
    if (phase === 'asking') sentRef.current?.focus();
  }, [phase]);

  if (!draftId) return null;

  const mailto = payload?.to ? buildMailto(payload.to, payload.subject, payload.body) : null;
  const longLink = mailto !== null && mailto.length > MAILTO_COMFORT_LIMIT;

  const copy = async (label: string, text: string) => {
    usedCopy.current = true;
    const ok = await copyText(text);
    setCopied(ok ? label : null);
    announce(ok ? `${label} copied.` : "Copying didn't work here. Select the text and copy it yourself.");
    if (phase === 'ready') {
      setPendingSend(draftId, true);
      setPhase('asking');
    }
  };

  const confirm = async () => {
    const result = await run('sent', () => backend.confirmSent(draftId, usedCopy.current ? 'copy_paste' : 'email_app'));
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (!result.value.ok) {
      setError(result.value.message);
      return;
    }
    setPendingSend(draftId, false);
    onDone('sent', draftId);
  };

  const notYet = () => {
    setPendingSend(draftId, false);
    onDone('not-yet', draftId);
  };

  const copyPanel = payload?.to ? (
    <div className="card card-muted stack-sm" aria-label="Copy the reminder">
      <p className="t-caption">Copy each part into a new email, send it, then come back and tap Sent.</p>
      <div className="row-wrap">
        <Button variant="secondary" onClick={() => void copy('Address', payload.to ?? '')}>
          <Copy size={18} strokeWidth={1.5} aria-hidden="true" /> Copy address
        </Button>
        <Button variant="secondary" onClick={() => void copy('Subject', payload.subject)}>
          <Copy size={18} strokeWidth={1.5} aria-hidden="true" /> Copy subject
        </Button>
        <Button variant="secondary" onClick={() => void copy('Message', payload.body)}>
          <Copy size={18} strokeWidth={1.5} aria-hidden="true" /> Copy message
        </Button>
      </div>
      {copied ? <p className="t-caption">{copied} copied.</p> : null}
    </div>
  ) : null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={phase === 'asking' ? 'Did it send?' : 'Send this reminder'}
      busy={busy !== null}
      dismissible={phase !== 'asking'}
      footer={
        phase === 'asking' ? (
          <div className="action-pair" style={{ width: '100%' }}>
            <Button ref={sentRef} variant="secondary" size="lg" busy={busy === 'sent'} busyLabel="Saving…" onClick={() => void confirm()}>
              Sent
            </Button>
            <Button variant="secondary" size="lg" unavailable={busy !== null} onClick={notYet}>
              Not yet
            </Button>
          </div>
        ) : phase === 'ready' && mailto && backend.preview ? (
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => {
              setPendingSend(draftId, true);
              setPreviewNote(true);
              setPhase('asking');
            }}
          >
            Send from my email
          </Button>
        ) : phase === 'ready' && mailto && !longLink ? (
          <a
            className="btn btn-primary btn-lg btn-block"
            href={mailto}
            onClick={() => {
              setPendingSend(draftId, true);
              window.dispatchEvent(new CustomEvent('gpa:email-trip'));
              // The email app opens from the link itself; the question appears straight away.
              window.setTimeout(() => setPhase('asking'), 0);
            }}
          >
            Send from my email
          </a>
        ) : phase === 'refused' || phase === 'error' ? (
          <Button variant="secondary" size="lg" block onClick={onClose}>
            Close
          </Button>
        ) : null
      }
    >
      {phase === 'loading' ? (
        <div className="stack-sm" role="status" aria-label="Loading the approved text">
          <Skeleton width="60%" />
          <Skeleton height={120} />
        </div>
      ) : null}
      {phase === 'refused' ? <p role="alert">{refusal}</p> : null}
      {phase === 'error' ? <ErrorPanel message={error ?? ''} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {(phase === 'ready' || phase === 'asking') && payload ? (
        <div className="stack">
          {phase === 'asking' && previewNote ? (
            <Banner>Preview: nothing opens here. In the app, your email app opens with this text, ready to send.</Banner>
          ) : null}
          {phase === 'asking' ? (
            <p>Tap Sent once the email has gone from your email app. Tap Not yet if you'll send it later: it waits under Ready to send.</p>
          ) : null}
          {showTip && phase === 'ready' ? <Banner>This opens your email app. Check it sends from your business address.</Banner> : null}
          {payload.to ? (
            <dl className="stack-sm">
              <div>
                <dt className="t-caption">To</dt>
                <dd className="list-title">{payload.to}</dd>
              </div>
              <div>
                <dt className="t-caption">Replies go to</dt>
                <dd>{payload.reply_to}</dd>
              </div>
            </dl>
          ) : (
            <p role="alert">This client has no email address, so the reminder can't be sent. Add an email for them first.</p>
          )}
          <div className="draft-surface approved">
            <p className="surface-label">Approved text</p>
            <p className="draft-subject">{payload.subject}</p>
            <p className="draft-text t-draft">{payload.body}</p>
          </div>
          {longLink && phase === 'ready' ? (
            <>
              <p>This reminder is long, so copy it into your email instead.</p>
              {copyPanel}
              <a
                className="btn btn-quiet"
                href={mailto ?? undefined}
                onClick={() => {
                  setPendingSend(draftId, true);
                  window.setTimeout(() => setPhase('asking'), 0);
                }}
              >
                Try my email app anyway
              </a>
            </>
          ) : showCopy || phase === 'asking' ? (
            copyPanel
          ) : payload.to ? (
            <Button variant="quiet" onClick={() => setShowCopy(true)}>
              Didn't open? Copy instead
            </Button>
          ) : null}
          <FormError message={error} />
        </div>
      ) : null}
    </Sheet>
  );
};
