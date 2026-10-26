// UI-04 Edit (FR-15, AT-07): change the wording without touching the facts. The locked facts stay pinned above the
// text; "Save and approve" checks them and explains any refusal in place, naming the wrong amount and offering to
// put the right one back. Edits stay pending until saved. The server checks again, and its answer is final.
import { CircleAlert, Lock, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { QueueItem } from '../../backend/types.ts';
import { charactersLeft, diffWords, lockedFactsProblem, markLockedChanges, putAmountBack, type LockedFactsProblem } from '../../lib/drafts.ts';
import { formatAud } from '../../lib/money.ts';
import { Button, Chip, FormError, PageTitle, TextAreaField, TextField } from '../../ui/controls.tsx';
import { useInsetRef } from '../../ui/insets.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { LockedFacts } from './DraftView.tsx';

const subjectProblem = (message: string): boolean => /subject/i.test(message);

const MESSAGE_ID = 'edit-message';
const FACT_ERROR_ID = 'edit-fact-error';

export const EditDraft = ({
  item,
  busy,
  serverError,
  onCancel,
  onSave,
}: {
  item: QueueItem;
  busy: boolean;
  serverError: string | null;
  onCancel: () => void;
  onSave: (subject: string, body: string) => void;
}) => {
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const [problem, setProblem] = useState<LockedFactsProblem | null>(null);
  /** Counts refusals in the browser, so each one brings its explanation into view. */
  const [refusals, setRefusals] = useState(0);
  const [putBackNote, setPutBackNote] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const factRef = useRef<HTMLDivElement>(null);
  const putBackRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const topInset = useInsetRef('top');
  const pinnedInset = useInsetRef('pinned');
  const bottomInset = useInsetRef('bottom');
  const dirty = subject !== item.subject || body !== item.body;
  const left = charactersLeft(subject, body);
  const amountText = formatAud(item.amount_due_cents);
  const keepMessage = `Keep ${amountText} and invoice ${item.invoice_number} as they are.`;

  // The browser's own check first; otherwise the server's refusal, word for word.
  const shown: LockedFactsProblem | null =
    problem ??
    (serverError
      ? { server: serverError, message: serverError, field: subjectProblem(serverError) ? 'subject' : 'body', wrong: null, right: amountText }
      : null);
  // A changed locked fact is explained above the fields, so it stays in view while editing and in "Show changes".
  const factError = shown && shown.server === keepMessage ? shown : null;
  const fieldError = shown && !factError ? shown : null;

  // Edit opens at its top, with the guidance and the Subject in view, wherever Review was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const bringFactErrorIntoView = (target: LockedFactsProblem) => {
    factRef.current?.scrollIntoView({ block: 'nearest' });
    if (target.wrong) putBackRef.current?.focus({ preventScroll: true });
    else if (target.field === 'subject') subjectRef.current?.focus({ preventScroll: true });
    else (bodyRef.current ?? factRef.current)?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (refusals === 0 || !problem) return;
    if (problem.server === keepMessage) bringFactErrorIntoView(problem);
    else (problem.field === 'subject' ? subjectRef : bodyRef).current?.focus();
    // Runs once per refusal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refusals]);

  useEffect(() => {
    if (!serverError) return;
    if (serverError === keepMessage) {
      factRef.current?.scrollIntoView({ block: 'nearest' });
      factRef.current?.focus({ preventScroll: true });
    } else (subjectProblem(serverError) ? subjectRef : bodyRef).current?.focus();
    // keepMessage follows the item, which doesn't change while Edit is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverError]);

  useEffect(() => {
    if (putBackNote) noteRef.current?.focus({ preventScroll: true });
  }, [putBackNote]);

  // Switching between editing and "Show changes" keeps a refusal in view rather than above the visible area.
  useEffect(() => {
    factRef.current?.scrollIntoView({ block: 'nearest' });
  }, [showChanges]);

  const refuse = (found: LockedFactsProblem) => {
    setProblem(found);
    setPutBackNote(null);
    setRefusals((n) => n + 1);
  };

  const save = () => {
    const found = lockedFactsProblem(subject, body, item.invoice_number, item.amount_due_cents);
    if (found) {
      refuse(found);
      return;
    }
    setProblem(null);
    setPutBackNote(null);
    onSave(subject.trim(), body.trim());
  };

  /** "Put $18,700.00 back": the locked amount replaces the wrong one, then the check runs again. */
  const putBack = () => {
    if (!factError?.wrong) return;
    const { wrong, right, field } = factError;
    const nextSubject = field === 'subject' ? putAmountBack(subject, wrong, right) : subject;
    const nextBody = field === 'body' ? putAmountBack(body, wrong, right) : body;
    setSubject(nextSubject);
    setBody(nextBody);
    const again = lockedFactsProblem(nextSubject, nextBody, item.invoice_number, item.amount_due_cents);
    if (again) {
      refuse(again);
      return;
    }
    setProblem(null);
    setPutBackNote(`${right} is back in the ${field === 'subject' ? 'subject' : 'message'}.`);
  };

  const edited = () => {
    setProblem(null);
    setPutBackNote(null);
  };

  const close = () => (dirty ? setConfirmDiscard(true) : onCancel());

  // While the edit breaks the locked facts, "Show changes" marks the changed facts apart from ordinary wording.
  const live = lockedFactsProblem(subject, body, item.invoice_number, item.amount_due_cents);
  const changes = showChanges
    ? live?.server === keepMessage
      ? markLockedChanges(diffWords(item.body, body), item.invoice_number, amountText)
      : diffWords(item.body, body)
    : [];

  return (
    <div className="review">
      <header className="review-top" ref={topInset}>
        <div className="review-top-inner is-narrow">
          <button type="button" className="icon-button" aria-label="Close the editor" onClick={close}>
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <PageTitle documentTitle={`Edit invoice ${item.invoice_number}`} className="t-heading" focusOnMount>
            Edit draft
          </PageTitle>
        </div>
      </header>
      <main className="review-body stack" id="main">
        <LockedFacts item={item} compact pinnedRef={pinnedInset} />
        {/* The apprentice's chip carries over from Review, so the draft keeps its identity while it changes. */}
        <div className="edit-intro">
          <Chip tone="apprentice">Draft · not sent yet</Chip>
          <p className="t-caption">Change the words as you like. Keep the amount and invoice number exactly as they are.</p>
        </div>
        {factError ? (
          <div className="fact-error stack-sm" id={FACT_ERROR_ID} ref={factRef} tabIndex={-1}>
            <p className="field-error" role="alert">
              <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />
              <span>{factError.message}</span>
            </p>
            {factError.wrong ? (
              <Button ref={putBackRef} variant="quiet" onClick={putBack}>
                Put {factError.right} back
              </Button>
            ) : null}
          </div>
        ) : putBackNote ? (
          <p className="put-back-note" role="status" ref={noteRef} tabIndex={-1}>
            {putBackNote}
          </p>
        ) : null}
        <TextField
          ref={subjectRef}
          label="Subject"
          value={subject}
          maxLength={200}
          onChange={(event) => {
            setSubject(event.target.value);
            edited();
          }}
          error={fieldError?.field === 'subject' ? fieldError.message : null}
          {...(factError?.field === 'subject' ? { 'aria-invalid': true, 'aria-describedby': FACT_ERROR_ID } : {})}
        />
        {showChanges ? (
          <div className="stack-sm">
            <p className="field-label t-label">Changes to the message</p>
            <p className="draft-text t-draft card" aria-label="The message with your changes marked">
              {changes.map((part, index) =>
                part.kind === 'same' ? (
                  <span key={index}>{part.text}</span>
                ) : part.kind === 'added' ? (
                  <ins key={index} className={`diff-added${part.locked ? ' diff-locked' : ''}`}>
                    {part.locked ? <Lock size={14} strokeWidth={2} aria-hidden="true" className="diff-lock" /> : null}
                    <span className="visually-hidden">{part.locked ? 'added, and not the locked amount: ' : 'added: '}</span>
                    {part.text}
                  </ins>
                ) : (
                  <del key={index} className={`diff-removed${part.locked ? ' diff-locked' : ''}`}>
                    {part.locked ? <Lock size={14} strokeWidth={2} aria-hidden="true" className="diff-lock" /> : null}
                    <span className="visually-hidden">{part.locked ? 'removed a locked fact: ' : 'removed: '}</span>
                    {part.text}
                  </del>
                ),
              )}
            </p>
            <FormError message={fieldError?.field === 'body' ? fieldError.message : null} />
          </div>
        ) : (
          <TextAreaField
            ref={bodyRef}
            id={MESSAGE_ID}
            label="Message"
            value={body}
            textareaClassName="editor-text"
            rows={12}
            onChange={(event) => {
              setBody(event.target.value);
              edited();
            }}
            error={fieldError?.field === 'body' ? fieldError.message : null}
            hint={left >= 0 ? `${left.toLocaleString('en-AU')} characters left` : `${(-left).toLocaleString('en-AU')} characters too many`}
            {...(factError?.field === 'body' ? { 'aria-invalid': true, 'aria-describedby': `${FACT_ERROR_ID} ${MESSAGE_ID}-hint` } : {})}
          />
        )}
        <Button variant="quiet" aria-pressed={showChanges} onClick={() => setShowChanges((v) => !v)}>
          {showChanges ? 'Back to editing' : 'Show changes'}
        </Button>
      </main>
      <footer className="action-bar" ref={bottomInset}>
        <div className="action-bar-inner">
          <Button variant="primary" size="lg" block busy={busy} busyLabel="Saving…" onClick={save}>
            Save and approve
          </Button>
          <Button variant="secondary" block unavailable={busy} onClick={close}>
            Cancel
          </Button>
        </div>
      </footer>
      <Sheet
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard your changes?"
        alert
        initialFocus={keepRef}
        footer={
          <>
            <Button ref={keepRef} variant="primary" block onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="secondary" block onClick={onCancel}>
              Discard changes
            </Button>
          </>
        }
      >
        <p>Your changes to this draft haven't been saved.</p>
      </Sheet>
    </div>
  );
};
