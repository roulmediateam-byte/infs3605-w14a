// What the app reads and sends, matching docs/api.md and the migrations at supabase/migrations/.
// Reads come from tables and the invoice_list view through row-level security; every change goes through a
// named database function that checks the caller's role first (TRD, API contract).
import type { ActivityAction, LogEntry } from '../lib/activity.ts';
import type { ColumnMapping, ImportFormat, ImportRowInput } from '../lib/import-rows.ts';
import type { CancelReason, DisplayStatus, RejectReason, Tone } from '../lib/words.ts';

export type { ActivityAction, LogEntry, CancelReason, RejectReason, Tone, DisplayStatus };
export type Role = 'owner' | 'checker' | 'admin';
export type DraftStatus = 'waiting' | 'approved' | 'rejected' | 'sent' | 'cancelled';
export type XeroReminders = 'unknown' | 'on' | 'off';

export interface AuthUser {
  id: string;
  email: string;
}

export interface Membership {
  business_id: string;
  role: Role;
}

export interface Business {
  id: string;
  name: string;
  owner_name: string;
  sign_off: string;
  reply_to_email: string;
  overdue_threshold_days: number;
  cooldown_days: number;
  briefing_weekday: number;
  briefing_time: string;
  checker_may_send: boolean;
  style_note: string | null;
  example_reminder: string | null;
  call_first_threshold_cents: number | null;
  xero_reminders: XeroReminders;
  column_mapping: ColumnMapping | null;
  is_test_data: boolean;
  delete_after: string | null;
  created_at: string;
}

export interface Member {
  id: string;
  user_id: string | null;
  invited_email: string;
  display_name: string;
  role: Role;
  status: 'invited' | 'active' | 'removed';
}

export interface BriefingInvoice {
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  client_name: string;
  amount_due_cents: number;
  due_date: string;
  days_overdue: number;
  has_waiting_draft: boolean;
  client_paused: boolean;
  call_first: boolean;
  reminders_sent: number;
}

export interface AttentionEntry {
  kind: 'email_missing' | 'amount_changed' | 'due_date_changed';
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  client_name: string;
  amount_due_cents: number;
  detail: { days_overdue?: number; from_cents?: number; to_cents?: number; from?: string; to?: string };
}

export interface Briefing {
  business: { id: string; name: string; owner_name: string; is_test_data: boolean; overdue_threshold_days: number };
  as_of: string;
  as_of_date: string;
  totals: {
    owed_cents: number;
    overdue_cents: number;
    open_count: number;
    overdue_count: number;
    due_this_week_cents: number;
    due_this_week_count: number;
  };
  drafts_waiting: number;
  first_draft_id: string | null;
  overdue: BriefingInvoice[];
  needs_attention: AttentionEntry[];
  paused_clients: { client_id: string; name: string; open_invoices: number; overdue_cents: number }[];
}

/** One waiting draft from review_queue: the facts filled in and the signature added, exactly as approval freezes. */
export interface QueueItem {
  draft_id: string;
  queue_position: number;
  queue_total: number;
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  client_name: string;
  client_email: string | null;
  amount_due_cents: number;
  due_date: string;
  days_overdue: number;
  tone: Tone;
  source: 'ai' | 'template';
  subject: string;
  body: string;
  call_first: boolean;
  reminders_sent_before: number;
  created_at: string;
}

export type ApproveResult =
  | { status: 'approved'; changed: true; edited: boolean; draft_id: string; next_draft_id: string | null }
  | { status: 'cancelled'; changed: true; reason: CancelReason; draft_id: string }
  | { status: DraftStatus; changed: false; draft_id: string };

export type RejectResult = { status: DraftStatus; changed: boolean; draft_id: string };

export type SendPayload =
  | { ok: true; draft_id: string; to: string | null; reply_to: string; subject: string; body: string }
  | { ok: false; code: 'already_sent' | 'checker_may_not_send' | 'not_approved'; message: string };

export type ConfirmSentResult = { ok: true; changed: boolean; draft_id: string } | { ok: false; code: string; message: string };

export interface MarkPaidResult {
  status: 'paid';
  changed: boolean;
  drafts_cancelled?: number;
}

/** A reminder draft as the table holds it (for Ready to send, decided-elsewhere notes and history). */
export interface DraftRecord {
  id: string;
  invoice_id: string;
  status: DraftStatus;
  source: 'ai' | 'template';
  tone_used: Tone;
  invoice_number_shown: string;
  amount_shown_cents: number;
  due_date_shown: string;
  edited: boolean;
  final_subject: string | null;
  /** The body exactly as approved, signature included; null until approval (FR-15). */
  final_body: string | null;
  approved_by: string | null;
  approver_role: Role | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  reject_reason: RejectReason | null;
  sent_confirmed_by: string | null;
  sent_confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: CancelReason | null;
  created_at: string;
}

/** A row of the invoice_list view (UI-07). */
export interface InvoiceListRow {
  id: string;
  business_id: string;
  client_id: string;
  client_name: string;
  client_has_email: boolean;
  client_paused: boolean;
  client_tone: Tone;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  amount_due_cents: number;
  status: 'open' | 'paid' | 'closed';
  paid_date: string | null;
  close_reason: 'not_in_latest_import' | 'closed_by_user' | null;
  last_reminder_sent_at: string | null;
  reminders_sent_count: number;
  days_past_due: number;
  display_status: DisplayStatus;
}

export interface Client {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  tone: Tone;
  client_group: 'head_contractor' | 'homeowner' | 'other' | null;
  paused: boolean;
  paused_at: string | null;
}

export interface OpenAttentionItem {
  id: string;
  invoice_id: string;
  kind: 'amount_changed' | 'due_date_changed';
}

export interface ImportSummary {
  id: string;
  uploaded_at: string;
  file_name: string;
  rows_read: number;
  rows_saved: number;
  rows_skipped: number;
}

export interface WeeklyRun {
  period_key: string;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  started_at: string;
  finished_at: string | null;
}

export interface ImportRequest {
  businessId: string;
  fileName: string;
  format: ImportFormat;
  mapping: ColumnMapping;
  rows: ImportRowInput[];
  expectedRows: number;
  expectedTotalCents: number | string;
  allowMassClose: boolean;
}

export interface ImportResult {
  import_id: string;
  rows_read: number;
  rows_saved: number;
  rows_skipped: number;
  file_total_cents: number;
  saved_total_cents: number;
  invoices_added: number;
  invoices_updated: number;
  invoices_reopened: number;
  invoices_kept_paid: number;
  invoices_closed: number;
  drafts_cancelled: number;
  errors: { row: number; reason: string }[];
}

export interface TrustSummary {
  this_week: { approved_clean: number; approved_edited: number; rejected: number };
  overall: { approved_clean: number; approved_edited: number; rejected: number };
}

export interface ReviewStats {
  approved: number;
  edited: number;
  rejected: number;
  sent: number;
  not_yet: number;
  waiting: number;
  seconds: number;
}

export type SettingsChanges = Partial<
  Pick<
    Business,
    | 'name'
    | 'owner_name'
    | 'sign_off'
    | 'reply_to_email'
    | 'overdue_threshold_days'
    | 'cooldown_days'
    | 'briefing_weekday'
    | 'briefing_time'
    | 'checker_may_send'
    | 'style_note'
    | 'example_reminder'
    | 'call_first_threshold_cents'
    | 'xero_reminders'
    | 'column_mapping'
  >
>;

export interface DeleteResult {
  deleted: boolean;
  receipt_id: number;
  row_counts: Record<string, number>;
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'INITIAL_SESSION' | 'PASSWORD_RECOVERY' | 'MFA_CHALLENGE_VERIFIED';

/**
 * Everything the screens need from the backend. The Supabase adapter is the real one; a preview adapter can run
 * the same migrations in the browser for a click-through with Test data.
 */
/** Extras only the in-browser preview has: there is no email, no file to hand and no scheduled job. */
export interface PreviewTools {
  /** The sign-in code, shown on screen because the preview sends no email. */
  codeFor(email: string): string | null;
  /** The Week 7 demonstration import, built from the preview's own seed (scripts/make-demo-csv.sql). */
  sampleImportFile(): Promise<File>;
  /** Sunday's drafting run, with the fallback templates (the preview has no AI). */
  runWeeklyRun(): Promise<{ drafted: number }>;
}

export interface Backend {
  readonly kind: 'supabase' | 'preview';
  readonly preview?: PreviewTools;
  auth: {
    currentUser(): Promise<AuthUser | null>;
    onChange(listener: (event: AuthEvent, user: AuthUser | null) => void): () => void;
    sendCode(email: string, redirectTo: string): Promise<void>;
    verifyCode(email: string, code: string): Promise<AuthUser>;
    /** Why the emailed sign-in link the page opened with didn't work, once; null if it worked or there was none. */
    takeLinkProblem?(): string | null;
    /** Forgets the session on this device, whatever the network does. */
    signOut(): Promise<void>;
  };
  acceptInvitations(): Promise<Membership[]>;
  getBriefing(businessId: string): Promise<Briefing>;
  getTrustSummary(businessId: string): Promise<TrustSummary>;
  reviewQueue(businessId: string): Promise<QueueItem[]>;
  approveDraft(draftId: string, edit?: { subject: string; body: string }): Promise<ApproveResult>;
  rejectDraft(draftId: string, reason: RejectReason, note?: string): Promise<RejectResult>;
  getSendPayload(draftId: string): Promise<SendPayload>;
  confirmSent(draftId: string, method: 'email_app' | 'copy_paste'): Promise<ConfirmSentResult>;
  markPaid(invoiceId: string, paidDate?: string): Promise<MarkPaidResult>;
  undoMarkPaid(invoiceId: string): Promise<void>;
  dismissAttention(itemId: string): Promise<void>;
  confirmImport(request: ImportRequest): Promise<ImportResult>;
  logReviewSession(businessId: string, stats: ReviewStats): Promise<void>;
  updateSettings(businessId: string, changes: SettingsChanges): Promise<void>;
  inviteChecker(businessId: string, email: string, displayName: string): Promise<string>;
  removeMember(membershipId: string): Promise<void>;
  updateClientContact(clientId: string, email: string, contactName?: string): Promise<void>;
  setClientTone(clientId: string, tone: Tone): Promise<void>;
  setClientPaused(clientId: string, paused: boolean): Promise<{ paused: boolean; drafts_cancelled: number }>;
  exportBusinessData(businessId: string): Promise<Record<string, unknown>>;
  deleteBusiness(businessId: string, confirmName: string): Promise<DeleteResult>;
  // Reads, filtered by row-level security.
  businesses(): Promise<{ id: string; name: string; is_test_data: boolean }[]>;
  business(businessId: string): Promise<Business>;
  members(businessId: string): Promise<Member[]>;
  invoices(businessId: string): Promise<InvoiceListRow[]>;
  clients(businessId: string): Promise<Client[]>;
  drafts(businessId: string, statuses: DraftStatus[]): Promise<DraftRecord[]>;
  draft(draftId: string): Promise<DraftRecord | null>;
  openAttention(businessId: string): Promise<OpenAttentionItem[]>;
  activity(businessId: string, options: { before?: number; limit: number; invoiceId?: string }): Promise<LogEntry[]>;
  lastImport(businessId: string): Promise<ImportSummary | null>;
  weeklyRuns(businessId: string, sinceDate: string): Promise<WeeklyRun[]>;
  recordCounts(businessId: string): Promise<Record<string, number>>;
}
