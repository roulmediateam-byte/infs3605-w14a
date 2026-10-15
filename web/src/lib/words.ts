// The app's words for statuses, reasons and roles (App Flow, Status language). Every status is a word first and a
// colour second (WCAG 1.4.1); the chip tone only picks the colour pair from the UI brief.
import { daysBetween, formatDate, overdueText, sydneyDate } from './dates.ts';

export type ChipTone = 'overdue' | 'due-soon' | 'paid' | 'neutral';

export type Tone = 'gentle' | 'standard' | 'firm';
export type CancelReason = 'invoice_paid' | 'invoice_closed' | 'amount_changed' | 'due_date_changed' | 'client_paused' | 'email_missing' | 'superseded';
export type RejectReason = 'already_paid' | 'wrong_amount_or_invoice' | 'will_call' | 'wrong_tone' | 'other';

export const TONE_LABEL: Record<Tone, string> = { gentle: 'Gentle', standard: 'Standard', firm: 'Firm' };

/** Short reasons, as they follow "Cancelled: ". */
export const CANCEL_REASON: Record<CancelReason, string> = {
  invoice_paid: 'marked paid',
  invoice_closed: 'not in your latest import',
  amount_changed: 'the amount changed',
  due_date_changed: 'the due date changed',
  client_paused: 'client paused',
  email_missing: 'no email address',
  superseded: "replaced by this week's draft",
};

/** What Review says when a draft gives way at approval (BR-05, AT-03). */
export const CANCELLED_IN_PLACE: Record<CancelReason, string> = {
  invoice_paid: 'Marked paid, so this draft was cancelled.',
  invoice_closed: "Cancelled: this invoice wasn't in your latest import, so it's closed.",
  amount_changed: "Cancelled: the amount changed in your latest import. It's under Needs attention.",
  due_date_changed: "Cancelled: the due date changed in your latest import. It's under Needs attention.",
  client_paused: 'Cancelled: client paused.',
  email_missing: "Cancelled: the client has no email address. It's under Needs attention.",
  superseded: "Cancelled: replaced by this week's draft.",
};

export const REJECT_REASONS: { value: RejectReason; label: string }[] = [
  { value: 'already_paid', label: 'Already paid' },
  { value: 'wrong_amount_or_invoice', label: 'Wrong amount or invoice' },
  { value: 'will_call', label: "I'll call them" },
  { value: 'wrong_tone', label: 'Wrong tone' },
  { value: 'other', label: 'Other' },
];

export const rejectReasonLabel = (reason: string): string => REJECT_REASONS.find((r) => r.value === reason)?.label ?? 'Other';

export interface Chip {
  label: string;
  tone: ChipTone;
}

export type DisplayStatus = 'overdue' | 'due_soon' | 'due' | 'paid' | 'closed';

/** The invoice chip (App Flow, Status language; BR-06): worked out in Sydney time, never stored. */
export const invoiceChip = (
  invoice: { display_status: DisplayStatus; due_date: string; paid_date: string | null },
  now: Date = new Date(),
): Chip => {
  const today = sydneyDate(now);
  switch (invoice.display_status) {
    case 'overdue':
      return { label: `Overdue · ${daysBetween(invoice.due_date, today)} ${daysBetween(invoice.due_date, today) === 1 ? 'day' : 'days'}`, tone: 'overdue' };
    case 'due_soon': {
      const days = daysBetween(today, invoice.due_date);
      return { label: days === 0 ? 'Due today' : `Due in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'due-soon' };
    }
    case 'paid':
      return { label: invoice.paid_date ? `Paid ${formatDate(invoice.paid_date, now)}` : 'Paid', tone: 'paid' };
    case 'closed':
      return { label: 'Closed: not in latest import', tone: 'neutral' };
    default:
      return { label: `Due ${formatDate(invoice.due_date, now)}`, tone: 'neutral' };
  }
};

/** A days-overdue chip for lists that already know the count (Home's biggest overdue). */
export const overdueChip = (days: number): Chip => ({ label: `Overdue · ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'overdue' });

/** "Steve" from "Steve Smith": the owner's first name, used in "Approved. Steve sends it." */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** "Drafted because invoice 1043 is 14 days overdue, ..." (App Flow, Labels and explanations; R-07). */
export const whyThisDraft = (draft: {
  invoice_number: string;
  days_overdue: number;
  reminders_sent_before: number;
  tone: Tone;
  source: 'ai' | 'template';
  cooldownDays: number;
}): string[] => {
  const lastReminder =
    draft.reminders_sent_before === 0 ? 'no reminder has been sent for it yet' : `no reminder went in the last ${draft.cooldownDays} days`;
  const lines = [
    `Drafted because invoice ${draft.invoice_number} is ${overdueText(draft.days_overdue)}, the client has an email and ${lastReminder}. Tone: ${TONE_LABEL[draft.tone]}, set for this client.`,
  ];
  if (draft.source === 'template') {
    lines.push(`Your apprentice couldn't write this one, so it used the ${TONE_LABEL[draft.tone]} template.`);
  }
  return lines;
};

export const pluralise = (count: number, one: string, many: string = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** "3 sent, 1 rejected and 1 waiting to send" style lists, leaving out zero counts. */
export const listCounts = (items: [number, string][]): string => {
  const parts = items.filter(([count]) => count > 0).map(([count, words]) => `${count} ${words}`);
  return parts.join(', ');
};
