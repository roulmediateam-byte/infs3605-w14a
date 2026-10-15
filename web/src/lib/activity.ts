// The activity log as sentences (FR-21, UI-10): "Linda approved the reminder for invoice 1051". The log keeps ids
// and counts only (NFR-04), so names come from the records the person can already read.
import { formatDate } from './dates.ts';
import { formatAud } from './money.ts';
import { CANCEL_REASON, TONE_LABEL, listCounts, rejectReasonLabel, type CancelReason, type Tone } from './words.ts';

export type ActivityAction =
  | 'import_completed'
  | 'draft_created'
  | 'draft_flagged'
  | 'draft_approved'
  | 'draft_rejected'
  | 'reminder_sent'
  | 'invoice_paid'
  | 'briefing_sent'
  | 'review_session'
  | 'draft_edited'
  | 'draft_cancelled'
  | 'send_refused'
  | 'invoice_reopened'
  | 'invoice_closed'
  | 'nudge_sent'
  | 'weekly_run_completed'
  | 'business_created'
  | 'settings_changed'
  | 'client_updated'
  | 'client_paused'
  | 'client_unpaused'
  | 'member_invited'
  | 'member_joined'
  | 'member_removed'
  | 'attention_dismissed'
  | 'data_exported';

export interface LogEntry {
  id: number;
  at: string;
  actor_user_id: string | null;
  actor_role: 'owner' | 'checker' | 'admin' | 'system';
  action: ActivityAction;
  invoice_id: string | null;
  draft_id: string | null;
  client_id: string | null;
  import_id: string | null;
  run_id: string | null;
  details: Record<string, unknown>;
}

export interface LogLookups {
  memberName: (userId: string) => string | undefined;
  invoiceNumber: (invoiceId: string) => string | undefined;
  clientName: (clientId: string) => string | undefined;
}

export type LogCategory = 'imports' | 'drafts' | 'decisions' | 'sends' | 'payments' | 'emails' | 'settings';

export const LOG_CATEGORIES: { value: LogCategory; label: string }[] = [
  { value: 'imports', label: 'Imports' },
  { value: 'drafts', label: 'Drafts and flags' },
  { value: 'decisions', label: 'Approvals and rejections' },
  { value: 'sends', label: 'Sends' },
  { value: 'payments', label: 'Payments' },
  { value: 'emails', label: 'Briefings' },
  { value: 'settings', label: 'Settings, clients and team' },
];

const CATEGORY: Record<ActivityAction, LogCategory> = {
  import_completed: 'imports',
  invoice_closed: 'imports',
  draft_created: 'drafts',
  draft_flagged: 'drafts',
  draft_cancelled: 'drafts',
  weekly_run_completed: 'drafts',
  draft_approved: 'decisions',
  draft_edited: 'decisions',
  draft_rejected: 'decisions',
  review_session: 'decisions',
  reminder_sent: 'sends',
  send_refused: 'sends',
  invoice_paid: 'payments',
  invoice_reopened: 'payments',
  briefing_sent: 'emails',
  nudge_sent: 'emails',
  business_created: 'settings',
  settings_changed: 'settings',
  client_updated: 'settings',
  client_paused: 'settings',
  client_unpaused: 'settings',
  member_invited: 'settings',
  member_joined: 'settings',
  member_removed: 'settings',
  attention_dismissed: 'settings',
  data_exported: 'settings',
};

export const categoryOf = (action: ActivityAction): LogCategory => CATEGORY[action] ?? 'settings';

const SETTING_WORDS: Record<string, string> = {
  name: 'business name',
  owner_name: 'owner name',
  sign_off: 'sign-off',
  reply_to_email: 'reply-to email',
  overdue_threshold_days: 'overdue threshold',
  cooldown_days: 'cool-down',
  briefing_weekday: 'briefing day',
  briefing_time: 'briefing time',
  checker_may_send: 'who sends reminders',
  style_note: 'style note',
  example_reminder: 'example reminder',
  call_first_threshold_cents: 'call-first amount',
  xero_reminders: 'Xero reminders answer',
  column_mapping: 'import columns',
};

const CLIENT_FIELD_WORDS: Record<string, string> = { email: 'email', contact_name: 'contact name', tone: 'tone', client_group: 'group' };

const ROLE_WORDS: Record<string, string> = { owner: 'The owner', checker: 'The checker', admin: 'The team' };

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const joinWords = (words: string[]): string =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

const capitalise = (text: string): string => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

export const actorName = (entry: LogEntry, lookups: LogLookups): string => {
  if (entry.actor_role === 'system' || !entry.actor_user_id) return 'Your apprentice';
  return lookups.memberName(entry.actor_user_id) ?? ROLE_WORDS[entry.actor_role] ?? 'Someone';
};

/** One plain sentence per entry, without a full stop (the feed shows the time beside it). */
export const describe = (entry: LogEntry, lookups: LogLookups): string => {
  const d = entry.details ?? {};
  const who = actorName(entry, lookups);
  const number = entry.invoice_id ? lookups.invoiceNumber(entry.invoice_id) : undefined;
  const inv = number ? `invoice ${number}` : 'an invoice';
  const client = entry.client_id ? (lookups.clientName(entry.client_id) ?? 'a client') : 'a client';

  switch (entry.action) {
    case 'import_completed': {
      const counts = listCounts([
        [num(d.invoices_added), 'added'],
        [num(d.invoices_updated), 'updated'],
        [num(d.invoices_reopened), 'reopened'],
        [num(d.invoices_closed), 'closed'],
        [num(d.rows_skipped), num(d.rows_skipped) === 1 ? 'row skipped' : 'rows skipped'],
      ]);
      return `${who} imported ${num(d.rows_read)} ${num(d.rows_read) === 1 ? 'row' : 'rows'}${counts ? `: ${counts}` : ''}`;
    }
    case 'draft_created':
      return str(d.source) === 'template'
        ? `Your apprentice drafted a reminder for ${inv} from the ${TONE_LABEL[str(d.tone) as Tone] ?? 'Standard'} template`
        : `Your apprentice drafted a reminder for ${inv}`;
    case 'draft_flagged': {
      const reason = str(d.reason);
      if (reason === 'email_missing') return `${capitalise(inv)} needs an email address before a reminder can be drafted`;
      if (reason === 'amount_changed' && typeof d.from_cents === 'number' && typeof d.to_cents === 'number') {
        return `The amount of ${inv} changed from ${formatAud(d.from_cents)} to ${formatAud(d.to_cents)}`;
      }
      if (reason === 'due_date_changed' && typeof d.from === 'string' && typeof d.to === 'string') {
        return `The due date of ${inv} changed from ${formatDate(d.from)} to ${formatDate(d.to)}`;
      }
      return `${capitalise(inv)} needs attention`;
    }
    case 'draft_approved':
      return `${who} approved the reminder for ${inv}${d.edited === true ? ' after editing it' : ''}`;
    case 'draft_edited':
      return `${who} edited the reminder for ${inv}`;
    case 'draft_rejected':
      return `${who} rejected the reminder for ${inv}: ${rejectReasonLabel(str(d.reason))}`;
    case 'reminder_sent':
      return `${who} sent the reminder for ${inv} ${str(d.method) === 'copy_paste' ? 'by copying it into their email' : 'from their email'}`;
    case 'invoice_paid': {
      const cancelled = num(d.drafts_cancelled);
      return `${who} marked ${inv} paid${typeof d.paid_date === 'string' ? ` on ${formatDate(d.paid_date)}` : ''}${
        cancelled ? `, which cancelled ${cancelled === 1 ? '1 reminder' : `${cancelled} reminders`}` : ''
      }`;
    }
    case 'invoice_reopened':
      return str(d.reason) === 'undo_mark_paid' ? `${who} marked ${inv} as unpaid` : `${capitalise(inv)} is open again: it was in the latest import`;
    case 'invoice_closed':
      return `${capitalise(inv)} was closed: not in the latest import`;
    case 'draft_cancelled':
      return `The reminder for ${inv} was cancelled: ${CANCEL_REASON[str(d.reason) as CancelReason] ?? 'no longer needed'}`;
    case 'send_refused':
      return str(d.reason) === 'checker_may_not_send'
        ? `${who} tried to send the reminder for ${inv}, but only the owner sends reminders for this business`
        : `${who} tried to send the reminder for ${inv} before it was approved, so it wasn't sent`;
    case 'briefing_sent':
      return 'Your apprentice emailed the Monday briefing';
    case 'nudge_sent':
      return 'Your apprentice emailed the checker about drafts waiting';
    case 'weekly_run_completed': {
      // Jobs record ai and template counts; the seed records drafts_created.
      const template = num(d.template);
      const total = num(d.ai) + template || num(d.drafts_created);
      if (total === 0) return 'Your apprentice checked every open invoice: nothing new to draft';
      return `Your apprentice drafted ${total === 1 ? '1 reminder' : `${total} reminders`}${template ? `, ${template} from templates` : ''}`;
    }
    case 'review_session': {
      const decided = num(d.approved) + num(d.rejected);
      const counts =
        entry.actor_role === 'checker'
          ? listCounts([
              [num(d.approved), 'approved'],
              [num(d.rejected), 'rejected'],
            ])
          : listCounts([
              [num(d.sent), 'sent'],
              [num(d.rejected), 'rejected'],
              [num(d.not_yet), 'waiting to send'],
            ]);
      const minutes = Math.max(1, Math.round(num(d.seconds) / 60));
      return `${who} reviewed ${decided === 1 ? '1 draft' : `${decided} drafts`} in ${minutes} min${counts ? `: ${counts}` : ''}`;
    }
    case 'business_created':
      return `${who} set up the business`;
    case 'settings_changed': {
      const fields = Array.isArray(d.fields) ? d.fields.map((field) => SETTING_WORDS[str(field)] ?? str(field)) : [];
      return `${who} changed the ${joinWords(fields) || 'settings'}`;
    }
    case 'client_updated': {
      if (Array.isArray(d.fields) && d.fields.includes('tone') && typeof d.tone === 'string') {
        return `${who} set the tone for ${client} to ${TONE_LABEL[d.tone as Tone] ?? d.tone}`;
      }
      const fields = Array.isArray(d.fields) ? d.fields.map((field) => CLIENT_FIELD_WORDS[str(field)] ?? str(field)) : [];
      return `${who} updated the ${joinWords(fields) || 'details'} for ${client}`;
    }
    case 'client_paused': {
      const cancelled = num(d.drafts_cancelled);
      return `${who} paused reminders for ${client}${cancelled ? `, which cancelled ${cancelled === 1 ? '1 reminder' : `${cancelled} reminders`}` : ''}`;
    }
    case 'client_unpaused':
      return `${who} resumed reminders for ${client}`;
    case 'member_invited':
      return `${who} invited a checker`;
    case 'member_joined':
      return `${who} joined as ${str(d.role) === 'owner' ? 'the owner' : str(d.role) === 'admin' ? 'a team admin' : 'the checker'}`;
    case 'member_removed':
      return `${who} removed the ${str(d.role) === 'admin' ? 'team admin' : 'checker'}`;
    case 'attention_dismissed':
      return `${who} checked ${inv} and dismissed its ${str(d.kind) === 'due_date_changed' ? 'due date' : 'amount'} change`;
    case 'data_exported':
      return `${who} exported all the business's data`;
    default:
      return `${who} made a change`;
  }
};
