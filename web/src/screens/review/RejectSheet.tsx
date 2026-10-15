// UI-05 Reject (FR-16, BR-09): record why, in one tap. Rejecting is safe, because Sunday's run can draft again, so
// "Reject draft" is the sheet's main button. "Other" needs a few words.
import { useRef, useState } from 'react';
import type { RejectReason } from '../../backend/types.ts';
import { REJECT_REASONS } from '../../lib/words.ts';
import { Button, Choices, FormError, TextAreaField } from '../../ui/controls.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

export const RejectSheet = ({
  open,
  invoiceNumber,
  busy,
  serverError,
  onClose,
  onReject,
}: {
  open: boolean;
  invoiceNumber: string;
  busy: boolean;
  serverError: string | null;
  onClose: () => void;
  onReject: (reason: RejectReason, note: string) => void;
}) => {
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<{ field: 'reason' | 'note'; message: string } | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const firstChoice = useRef<HTMLDivElement>(null);

  const submit = () => {
    if (!reason) {
      setError({ field: 'reason', message: 'Pick a reason.' });
      firstChoice.current?.querySelector('input')?.focus();
      return;
    }
    if (reason === 'other' && note.trim() === '') {
      setError({ field: 'note', message: 'Add a few words.' });
      noteRef.current?.focus();
      return;
    }
    setError(null);
    onReject(reason, note.trim());
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Reject the draft for invoice ${invoiceNumber}?`}
      busy={busy}
      footer={
        <Button variant="primary" size="lg" block busy={busy} busyLabel="Rejecting…" onClick={submit}>
          Reject draft
        </Button>
      }
    >
      <div className="stack">
        <p className="t-secondary">Nothing is sent. Your apprentice can draft this invoice again on Sunday.</p>
        <div ref={firstChoice}>
          <Choices
            legend="Why reject it?"
            name="reject-reason"
            value={reason}
            options={REJECT_REASONS}
            onChange={(value) => {
              setReason(value);
              setError(null);
            }}
            error={error?.field === 'reason' ? error.message : null}
          />
        </div>
        {reason === 'other' ? (
          <TextAreaField
            ref={noteRef}
            label="A few words about why"
            value={note}
            rows={3}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            error={error?.field === 'note' ? error.message : null}
          />
        ) : null}
        <FormError message={serverError} />
      </div>
    </Sheet>
  );
};
