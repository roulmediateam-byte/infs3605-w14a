// The parts of a draft on screen (UI brief, Key screen: Review): who and how, the locked facts from the record,
// the apprentice's words on a tinted Draft surface, "Why this draft?" and the consequence line above Approve.
import { Lock } from 'lucide-react';
import type { QueueItem } from '../../backend/types.ts';
import { formatDate, overdueText } from '../../lib/dates.ts';
import { formatAud } from '../../lib/money.ts';
import { TONE_LABEL, whyThisDraft } from '../../lib/words.ts';
import { Chip } from '../../ui/controls.tsx';

export const LockedFacts = ({
  item,
  onOpenInvoice,
  compact = false,
  pinnedRef,
}: {
  item: QueueItem;
  onOpenInvoice?: () => void;
  compact?: boolean;
  /** For the pinned strip, so the page keeps focused fields clear of it (src/ui/insets.ts). */
  pinnedRef?: (element: HTMLElement | null) => void;
}) => {
  if (compact) {
    // Pinned above the editor: the same four facts on one line, marked "Locked" in words as well as by the icon
    // (WCAG 1.4.1; App Flow, Accessibility).
    const short = [`Invoice ${item.invoice_number}`, formatAud(item.amount_due_cents), `Due ${formatDate(item.due_date)}`, overdueText(item.days_overdue)];
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
  const facts = [
    { name: 'Invoice', value: item.invoice_number },
    { name: 'Amount', value: formatAud(item.amount_due_cents) },
    { name: 'Due', value: formatDate(item.due_date) },
    { name: 'Overdue', value: overdueText(item.days_overdue).replace(' overdue', '') },
  ];
  return (
    <section className="locked" aria-label="Locked facts">
      <p className="locked-label">
        <Lock size={16} strokeWidth={1.5} aria-hidden="true" />
        Locked facts, from your records
      </p>
      <ul className="locked-facts">
        {facts.map((fact) => (
          <li key={fact.name}>
            {onOpenInvoice ? (
              <button type="button" className="fact" onClick={onOpenInvoice} aria-label={`${fact.name} ${fact.value}, locked. Open the invoice`}>
                <span className="fact-name">
                  <Lock size={14} strokeWidth={1.5} aria-hidden="true" />
                  {fact.name}
                </span>
                <span className="fact-value">{fact.value}</span>
              </button>
            ) : (
              <div className="fact">
                <span className="fact-name">
                  <Lock size={14} strokeWidth={1.5} aria-hidden="true" />
                  {fact.name}
                  <span className="visually-hidden">, locked:</span>
                </span>
                <span className="fact-value">{fact.value}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
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

export const DraftWords = ({ subject, body, approved = false }: { subject: string; body: string; approved?: boolean }) => (
  <div className={`draft-surface${approved ? ' approved' : ''}`}>
    <p className="surface-label">{approved ? 'Approved text' : 'Draft'}</p>
    <p className="draft-subject">{subject}</p>
    <p className="draft-text t-draft">{body}</p>
  </div>
);

export const WhyThisDraft = ({ item, cooldownDays }: { item: QueueItem; cooldownDays: number }) => (
  <details className="why">
    <summary>Why this draft?</summary>
    {whyThisDraft({
      invoice_number: item.invoice_number,
      days_overdue: item.days_overdue,
      reminders_sent_before: item.reminders_sent_before,
      tone: item.tone,
      source: item.source,
      cooldownDays,
    }).map((line) => (
      <p key={line}>{line}</p>
    ))}
  </details>
);

/** "Invoice 1043, $1,250.00, 14 days overdue": how each draft is announced as a region (App Flow, Accessibility). */
export const draftHeading = (item: QueueItem): string =>
  `Invoice ${item.invoice_number}, ${formatAud(item.amount_due_cents)}, ${overdueText(item.days_overdue)}`;
