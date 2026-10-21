// The parts of a draft on screen (UI brief, Key screen: Review): who and how, the locked facts from the record,
// the apprentice's words on a tinted Draft surface, "Why this draft?" and the consequence line above Approve.
import { Lock } from 'lucide-react';
import { useBackend } from '../../app/session.tsx';
import type { QueueItem } from '../../backend/types.ts';
import { formatDate, formatTime, overdueText, sydneyDate } from '../../lib/dates.ts';
import { formatAud } from '../../lib/money.ts';
import { TONE_LABEL, whyThisDraft } from '../../lib/words.ts';
import { Chip } from '../../ui/controls.tsx';

/** "From your latest import, Wed 21 Oct, 4:05 pm": when the facts were last read from the owner's records. */
export const importedLine = (uploadedAt: string): string => `From your latest import, ${formatDate(sydneyDate(new Date(uploadedAt)))}, ${formatTime(uploadedAt)}`;

export const LockedFacts = ({
  item,
  onOpenInvoice,
  compact = false,
  pinnedRef,
  importedAt,
}: {
  item: QueueItem;
  onOpenInvoice?: () => void;
  compact?: boolean;
  /** For the pinned strip, so the page keeps focused fields clear of it (src/ui/insets.ts). */
  pinnedRef?: (element: HTMLElement | null) => void;
  /** When the latest import was uploaded, if known. */
  importedAt?: string | null;
}) => {
  if (compact) {
    // Pinned above the editor: the same four facts, in the same order as Review, marked "Locked" in words as well as
    // by the icon (WCAG 1.4.1; App Flow, Accessibility).
    const short = [formatAud(item.amount_due_cents), overdueText(item.days_overdue), `Invoice ${item.invoice_number}`, `Due ${formatDate(item.due_date)}`];
    return (
      <section ref={pinnedRef} className="locked locked-pinned" aria-label="Locked facts">
        <p className="locked-label" aria-hidden="true">
          <Lock size={14} strokeWidth={1.5} />
          Locked facts
        </p>
        <ul className="locked-facts">
          {short.map((text) => (
            <li key={text} className="fact fact-value">
              <Lock size={14} strokeWidth={1.5} aria-hidden="true" />
              <span className="visually-hidden">Locked: </span>
              {text}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  // In the order the owner decides by: how much, how late, then which invoice and when it was due (UI brief: days
  // overdue is the second fact, after the amount).
  const amount = formatAud(item.amount_due_cents);
  const facts = [
    { key: 'amount', value: amount, spoken: `Amount ${amount}`, className: 'fact-amount' },
    { key: 'overdue', value: overdueText(item.days_overdue), spoken: overdueText(item.days_overdue), className: 'fact-overdue' },
    { key: 'invoice', value: `Invoice ${item.invoice_number}`, spoken: `Invoice ${item.invoice_number}`, className: 'fact-minor' },
    { key: 'due', value: `Due ${formatDate(item.due_date)}`, spoken: `Due ${formatDate(item.due_date)}`, className: 'fact-minor' },
  ];
  const fact = (entry: (typeof facts)[number]) => {
    const content = (
      <>
        <Lock size={entry.key === 'amount' ? 16 : 14} strokeWidth={1.5} aria-hidden="true" className="fact-lock" />
        <span className="fact-value">{entry.value}</span>
      </>
    );
    return onOpenInvoice ? (
      <button type="button" className={`fact ${entry.className}`} onClick={onOpenInvoice} aria-label={`${entry.spoken}, locked. Open the invoice`}>
        {content}
      </button>
    ) : (
      <div className={`fact ${entry.className}`}>
        {entry.key === 'amount' ? <span className="visually-hidden">Amount </span> : null}
        {content}
        <span className="visually-hidden">, locked</span>
      </div>
    );
  };
  return (
    <section className="locked" aria-label="Locked facts">
      <p className="locked-label">
        <Lock size={16} strokeWidth={1.5} aria-hidden="true" />
        Locked facts, from your records
      </p>
      <ul className="locked-lead">
        {facts.slice(0, 2).map((entry) => (
          <li key={entry.key}>{fact(entry)}</li>
        ))}
      </ul>
      <ul className="locked-minor">
        {facts.slice(2).map((entry) => (
          <li key={entry.key}>{fact(entry)}</li>
        ))}
      </ul>
      {importedAt ? <p className="t-caption locked-source">{importedLine(importedAt)}</p> : null}
    </section>
  );
};

export const WhoAndHow = ({ item, contactName }: { item: QueueItem; contactName?: string | null }) => (
  <div className="stack-sm">
    <p className="list-title t-heading">{item.client_name}</p>
    <div className="who">
      {contactName ? <span className="t-caption">To {contactName}</span> : null}
      <Chip>{TONE_LABEL[item.tone]}</Chip>
      {item.source === 'template' ? <Chip>Template</Chip> : null}
    </div>
  </div>
);

/**
 * The apprentice's words, marked as a draft that hasn't gone anywhere (a coloured edge and a chip, not tint alone,
 * so it reads in sunlight); once approved, a plain surface with "Approved text" (UI brief, Review).
 */
export const DraftWords = ({ subject, body, approved = false }: { subject: string; body: string; approved?: boolean }) => (
  <div className={`draft-surface${approved ? ' approved' : ''}`}>
    <Chip className={`surface-chip${approved ? '' : ' chip-draft'}`}>{approved ? 'Approved text' : 'Draft · not sent yet'}</Chip>
    <p className="draft-subject">{subject}</p>
    <p className="draft-text t-draft">{body}</p>
  </div>
);

export const WhyThisDraft = ({ item, cooldownDays }: { item: QueueItem; cooldownDays: number }) => {
  const backend = useBackend();
  return (
    <details className="why">
      <summary>Why this draft?</summary>
      {whyThisDraft(
        {
          invoice_number: item.invoice_number,
          days_overdue: item.days_overdue,
          reminders_sent_before: item.reminders_sent_before,
          tone: item.tone,
          source: item.source,
          cooldownDays,
        },
        { preview: Boolean(backend.preview) },
      ).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </details>
  );
};

/** "Invoice 1043, $1,250.00, 14 days overdue": how each draft is announced as a region (App Flow, Accessibility). */
export const draftHeading = (item: QueueItem): string =>
  `Invoice ${item.invoice_number}, ${formatAud(item.amount_due_cents)}, ${overdueText(item.days_overdue)}`;
