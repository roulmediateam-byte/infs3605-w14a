// UI-04 Edit (FR-15, AT-07): change the wording without touching the facts. The locked facts stay pinned above the
// text; "Save and approve" checks them and explains any refusal in place. Edits stay pending until saved.
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { QueueItem } from '../../backend/types.ts';
import { charactersLeft, checkLockedFacts, diffWords } from '../../lib/drafts.ts';
import { Button, PageTitle, TextAreaField, TextField } from '../../ui/controls.tsx';
import { useInsetRef } from '../../ui/insets.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { LockedFacts } from './DraftView.tsx';

const subjectProblem = (message: string): boolean => /subject/i.test(message);

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
  const [error, setError] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const topInset = useInsetRef('top');
  const pinnedInset = useInsetRef('pinned');
  const bottomInset = useInsetRef('bottom');
  const dirty = subject !== item.subject || body !== item.body;
  const shown = error ?? serverError;
  const left = charactersLeft(subject, body);

  useEffect(() => {
    if (!serverError) return;
    (subjectProblem(serverError) ? subjectRef : bodyRef).current?.focus();
  }, [serverError]);

  const save = () => {
    const problem = checkLockedFacts(subject, body, item.invoice_number, item.amount_due_cents);
    if (problem) {
      setError(problem);
      (subjectProblem(problem) ? subjectRef : bodyRef).current?.focus();
      return;
    }
    setError(null);
    onSave(subject.trim(), body.trim());
  };

  const close = () => (dirty ? setConfirmDiscard(true) : onCancel());

  return (
    <div className="review">
      <div className="review-top" ref={topInset}>
        <div className="review-top-inner">
          <button type="button" className="icon-button" aria-label="Close the editor" onClick={close}>
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <PageTitle documentTitle={`Edit invoice ${item.invoice_number}`} className="t-heading" focusOnMount>
            Edit draft
          </PageTitle>
        </div>
      </div>
      <div className="review-body stack">
        <LockedFacts item={item} compact pinnedRef={pinnedInset} />
        <p className="t-caption">Change the words as you like. Keep the amount and invoice number exactly as they are.</p>
        <TextField
          ref={subjectRef}
          label="Subject"
          value={subject}
          maxLength={200}
          onChange={(event) => {
            setSubject(event.target.value);
            setError(null);
          }}
          error={shown && subjectProblem(shown) ? shown : null}
        />
        {showChanges ? (
          <div className="stack-sm">
            <p className="field-label t-label">Changes to the message</p>
            <p className="draft-text t-draft card" aria-label="The message with your changes marked">
              {diffWords(item.body, body).map((part, index) =>
                part.kind === 'same' ? (
                  <span key={index}>{part.text}</span>
                ) : part.kind === 'added' ? (
                  <ins key={index} className="diff-added">
                    <span className="visually-hidden">added: </span>
                    {part.text}
                  </ins>
                ) : (
                  <del key={index} className="diff-removed">
                    <span className="visually-hidden">removed: </span>
                    {part.text}
                  </del>
                ),
              )}
            </p>
          </div>
        ) : (
          <TextAreaField
            ref={bodyRef}
            label="Message"
            value={body}
            textareaClassName="editor-text"
            rows={12}
            onChange={(event) => {
              setBody(event.target.value);
              setError(null);
            }}
            error={shown && !subjectProblem(shown) ? shown : null}
            hint={left >= 0 ? `${left.toLocaleString('en-AU')} characters left` : `${(-left).toLocaleString('en-AU')} characters too many`}
          />
        )}
        <Button variant="quiet" aria-pressed={showChanges} onClick={() => setShowChanges((v) => !v)}>
          {showChanges ? 'Back to editing' : 'Show changes'}
        </Button>
      </div>
      <div className="action-bar" ref={bottomInset}>
        <div className="action-bar-inner">
          <Button variant="primary" size="lg" block busy={busy} busyLabel="Saving…" onClick={save}>
            Save and approve
          </Button>
          <Button variant="secondary" block unavailable={busy} onClick={close}>
            Cancel
          </Button>
        </div>
      </div>
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
