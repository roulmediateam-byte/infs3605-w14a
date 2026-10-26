-- Payprentice · migration 2 of 7 · tables
-- Ten tables. Every business-owned row carries business_id, so one database can hold many businesses and a
-- bookkeeper can later check for several builders (PRD section 17). Money is whole cents (BR-14); times are UTC
-- and shown in Sydney time; "overdue" is calculated, never stored (BR-06).

-- ---------------------------------------------------------------------------------------------
-- businesses: one row per business; holds the settings the PRD calls the job card (FR-02, FR-29)
-- ---------------------------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  owner_name text not null check (char_length(btrim(owner_name)) between 1 and 80),
  sign_off text not null default 'Thanks,' check (char_length(btrim(sign_off)) between 1 and 60),
  reply_to_email text not null check (reply_to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  overdue_threshold_days smallint not null default 7 check (overdue_threshold_days between 1 and 60),
  cooldown_days smallint not null default 6 check (cooldown_days between 1 and 28),
  briefing_weekday smallint not null default 1 check (briefing_weekday between 1 and 5),
  briefing_time time not null default '07:00' check (briefing_time in ('07:00', '18:00')),
  time_zone text not null default 'Australia/Sydney' check (time_zone = 'Australia/Sydney'),
  trust_level public.trust_level not null default 'drafts_only' check (trust_level = 'drafts_only'),
  checker_may_send boolean not null default false,
  style_note text check (
    char_length(style_note) <= 300
    and regexp_replace(style_note, '\{[a-z_]+\}', '', 'g') !~ '[0-9@$]'
  ),
  example_reminder text check (
    char_length(example_reminder) <= 1200
    and regexp_replace(example_reminder, '\{[a-z_]+\}', '', 'g') !~ '[0-9@$]'
  ),
  call_first_threshold_cents bigint check (call_first_threshold_cents > 0),
  xero_reminders public.xero_reminders_status not null default 'unknown',
  column_mapping jsonb check (column_mapping is null or jsonb_typeof(column_mapping) = 'object'),
  is_test_data boolean not null default true,
  real_data_agreed_at timestamptz,
  delete_after date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_data_needs_written_agreement check (
    is_test_data or (real_data_agreed_at is not null and delete_after is not null)
  ),
  constraint delete_by_end_of_course check (delete_after is null or delete_after <= date '2026-12-31')
);

comment on table public.businesses is 'One row per business, with the settings the PRD calls the job card (FR-02, FR-29).';
comment on column public.businesses.name is 'Business name, used in reminders and the briefing.';
comment on column public.businesses.owner_name is 'Fills {owner_name} and the signature.';
comment on column public.businesses.sign_off is 'First line of the signature the app adds below every reminder, for example "Thanks,".';
comment on column public.businesses.reply_to_email is 'Where client replies go; shown on the Send screen.';
comment on column public.businesses.overdue_threshold_days is 'Days past due before a reminder is drafted (BR-01). Default 7; 1 to 60.';
comment on column public.businesses.cooldown_days is 'No new draft within this many Sydney days of a confirmed send (BR-04). Default 6 (decision D6, proposed).';
comment on column public.businesses.briefing_weekday is 'ISO weekday of the briefing, 1 = Monday to 5 = Friday (FR-02). Drafting runs on Sunday at 9:00 pm.';
comment on column public.businesses.briefing_time is 'Briefing slot in Sydney time: 07:00 or 18:00. The briefing job is due from 45 minutes before it (BR-13).';
comment on column public.businesses.time_zone is 'Fixed to Australia/Sydney for the PoC.';
comment on column public.businesses.trust_level is 'Trust ladder rung. Fixed at drafts_only until FR-30 is built.';
comment on column public.businesses.checker_may_send is 'Decision D3 (proposed): the owner sends; set true when the checker uses the business mailbox.';
comment on column public.businesses.style_note is 'Owner''s voice (FR-27): up to 300 characters, no digits, @ or $ outside placeholders, so it is safe to send to the AI (AI-03).';
comment on column public.businesses.example_reminder is 'One past reminder in the owner''s words (FR-27), with names replaced by placeholders; no digits, @ or $.';
comment on column public.businesses.call_first_threshold_cents is 'Invoices at or above this amount show "Consider a call" (FR-33). Null turns it off.';
comment on column public.businesses.xero_reminders is 'Answer to the setup check (FR-32): are Xero''s own invoice reminders on?';
comment on column public.businesses.column_mapping is 'Remembered CSV column mapping (FR-04).';
comment on column public.businesses.is_test_data is 'True for synthetic "Test data" (RI-9). Real data needs written agreement (D7, NFR-02).';
comment on column public.businesses.real_data_agreed_at is 'When the owner agreed in writing to test with real data.';
comment on column public.businesses.delete_after is 'Retention date (NFR-03, PD-7). The retention job deletes the business after this Sydney date.';

-- ---------------------------------------------------------------------------------------------
-- memberships: who may act for a business, in which role (FR-01, FR-25; Design Requirements v0.1 section 4)
-- ---------------------------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  invited_email text not null check (invited_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  role public.member_role not null,
  status public.member_status not null default 'invited',
  invited_by uuid,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  removed_at timestamptz,
  constraint active_member_has_user check (status <> 'active' or (user_id is not null and accepted_at is not null)),
  constraint removed_member_has_time check ((status = 'removed') = (removed_at is not null))
);

create unique index memberships_one_owner on public.memberships (business_id) where role = 'owner' and status <> 'removed';
create unique index memberships_one_checker on public.memberships (business_id) where role = 'checker' and status <> 'removed';
create unique index memberships_email_once on public.memberships (business_id, lower(invited_email)) where status <> 'removed';
create unique index memberships_user_once on public.memberships (business_id, user_id) where status <> 'removed';
create index memberships_user_id on public.memberships (user_id);
create index memberships_business_id on public.memberships (business_id);

comment on table public.memberships is 'Who may act for a business: one owner, at most one named checker, and team admins (test data only).';
comment on column public.memberships.user_id is 'Set when the invited person first signs in (accept_invitations).';
comment on column public.memberships.invited_email is 'The email the invitation was sent to; matched at first sign-in.';
comment on column public.memberships.role is 'owner, checker or admin. Admins see test data only and never approve.';

-- ---------------------------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  contact_name text check (contact_name is null or char_length(btrim(contact_name)) between 1 and 120),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  tone public.tone not null default 'standard',
  client_group public.client_group,
  paused boolean not null default false,
  paused_at timestamptz,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paused_client_has_time check (paused = (paused_at is not null))
);

create unique index clients_name_once on public.clients (business_id, lower(btrim(name)));

comment on table public.clients is 'The businesses and people who owe money. Tone and pause are relationship decisions kept by the owner (FR-23, FR-26).';
comment on column public.clients.name is 'Unique per business, ignoring capitals and outer spaces.';
comment on column public.clients.contact_name is 'Fills {client_name}; falls back to name.';
comment on column public.clients.email is 'Missing means flagged under Needs attention, never drafted (BR-05, FR-10).';
comment on column public.clients.tone is 'gentle, standard or firm; default standard (FR-23).';
comment on column public.clients.client_group is 'Head contractor, homeowner or other (FR-34, Could). Head contractors never auto-send.';
comment on column public.clients.paused is 'Paused clients get no new drafts and their live drafts are cancelled (BR-11).';
comment on column public.clients.external_ref is 'Reserved for the Xero ContactID (FR-31, minimum viable product).';

-- ---------------------------------------------------------------------------------------------
-- imports: one row per confirmed CSV upload (FR-04 to FR-06). Previews never reach the database.
-- ---------------------------------------------------------------------------------------------
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now(),
  file_name text not null check (char_length(file_name) between 1 and 255),
  source_format public.import_format not null,
  column_mapping jsonb not null check (jsonb_typeof(column_mapping) = 'object'),
  rows_read integer not null check (rows_read between 1 and 2000),
  rows_saved integer not null check (rows_saved >= 0),
  rows_skipped integer not null check (rows_skipped >= 0),
  file_total_cents bigint not null,
  saved_total_cents bigint not null check (saved_total_cents >= 0),
  invoices_added integer not null default 0 check (invoices_added >= 0),
  invoices_updated integer not null default 0 check (invoices_updated >= 0),
  invoices_reopened integer not null default 0 check (invoices_reopened >= 0),
  invoices_kept_paid integer not null default 0 check (invoices_kept_paid >= 0),
  invoices_closed integer not null default 0 check (invoices_closed >= 0),
  drafts_cancelled integer not null default 0 check (drafts_cancelled >= 0),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  constraint import_rows_add_up check (rows_read = rows_saved + rows_skipped)
);

create index imports_business_uploaded on public.imports (business_id, uploaded_at desc);

comment on table public.imports is 'One row per confirmed CSV import (FR-04 to FR-06). Nothing is saved until the user confirms (FR-05).';
comment on column public.imports.rows_read is 'Data rows in the file, 1 to 2,000; equals rows_saved + rows_skipped.';
comment on column public.imports.file_total_cents is 'Sum of every readable amount in the file; must match the preview the user confirmed.';
comment on column public.imports.saved_total_cents is 'Sum of the amounts saved.';
comment on column public.imports.errors is 'Skipped rows: [{"row": file line, "reason": text}]. No client names or emails.';

-- ---------------------------------------------------------------------------------------------
-- invoices: amounts and dates live only here (Design Requirements v0.1 section 10)
-- ---------------------------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.clients (id),
  invoice_number text not null check (invoice_number = btrim(invoice_number) and char_length(invoice_number) between 1 and 50),
  issue_date date not null,
  due_date date not null,
  amount_due_cents bigint not null check (amount_due_cents > 0 and amount_due_cents < 100000000000),
  currency text not null default 'AUD' check (currency = 'AUD'),
  status public.invoice_status not null default 'open',
  paid_date date,
  closed_at timestamptz,
  close_reason public.close_reason,
  last_reminder_sent_at timestamptz,
  reminders_sent_count integer not null default 0 check (reminders_sent_count >= 0),
  first_seen_import_id uuid references public.imports (id),
  last_seen_import_id uuid references public.imports (id),
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_number_once unique (business_id, invoice_number),
  constraint due_on_or_after_issue check (due_date >= issue_date),
  constraint paid_invoice_has_date check ((status = 'paid') = (paid_date is not null)),
  constraint paid_on_or_after_issue check (paid_date is null or paid_date >= issue_date),
  constraint closed_invoice_has_reason check ((status = 'closed') = (closed_at is not null) and (closed_at is null) = (close_reason is null))
);

create index invoices_business_status_due on public.invoices (business_id, status, due_date);
create index invoices_client_id on public.invoices (client_id);
create index invoices_first_seen_import on public.invoices (first_seen_import_id);
create index invoices_last_seen_import on public.invoices (last_seen_import_id);

comment on table public.invoices is 'Open, paid and closed invoices. "Overdue" is calculated from due_date in Sydney time (BR-06).';
comment on column public.invoices.invoice_number is 'Matched exactly after trimming spaces (BR-15). Unique per business.';
comment on column public.invoices.amount_due_cents is 'Outstanding amount in whole cents (BR-14), greater than 0.';
comment on column public.invoices.status is 'open, paid or closed. Paid by a person (FR-24); closed when missing from the latest import (BR-03).';
comment on column public.invoices.last_reminder_sent_at is 'Set when a send is confirmed (FR-20); starts the cool-down (BR-04).';
comment on column public.invoices.reminders_sent_count is 'Confirmed sends; tells the AI how many reminders came before (AI-03, AI-08).';
comment on column public.invoices.external_ref is 'Reserved for the Xero InvoiceID (FR-31, minimum viable product).';

-- ---------------------------------------------------------------------------------------------
-- job_runs: one row per scheduled job per period; the unique key makes every job safe to repeat (NFR-09)
-- ---------------------------------------------------------------------------------------------
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete cascade,
  job public.job_name not null,
  period_key text not null check (period_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  status public.job_status not null default 'running',
  trigger public.job_trigger not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  attempts integer not null default 1 check (attempts >= 1),
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  error text check (char_length(error) <= 2000),
  github_run_url text check (github_run_url is null or github_run_url ~ '^https://github\.com/'),
  constraint finished_unless_running check ((status = 'running') = (finished_at is null)),
  constraint one_run_per_period unique nulls not distinct (business_id, job, period_key)
);

create index job_runs_business_job on public.job_runs (business_id, job, started_at desc);

comment on table public.job_runs is 'One row per job, business and Sydney date. The unique key makes reruns safe (NFR-09); failures are visible (NFR-10).';
comment on column public.job_runs.period_key is 'Sydney date the run belongs to, YYYY-MM-DD. For weekly_run, the Sunday.';
comment on column public.job_runs.error is 'Short error text. Never personal data (NFR-04).';

-- ---------------------------------------------------------------------------------------------
-- reminder_drafts: one reminder for one invoice, with its facts copied at creation (BR-05)
-- ---------------------------------------------------------------------------------------------
create table public.reminder_drafts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id),
  run_id uuid references public.job_runs (id),
  tone_used public.tone not null,
  subject_template text not null check (char_length(subject_template) between 1 and 200),
  body_template text not null check (char_length(body_template) between 1 and 4000),
  invoice_number_shown text not null,
  amount_shown_cents bigint not null check (amount_shown_cents > 0),
  due_date_shown date not null,
  source public.draft_source not null,
  prompt_version text,
  model text,
  ai_attempts smallint not null default 0 check (ai_attempts between 0 and 2),
  fallback_reason text check (fallback_reason in ('ai_disabled', 'timeout', 'api_error', 'failed_checks', 'invalid_reply')),
  status public.draft_status not null default 'waiting',
  edited boolean not null default false,
  final_subject text,
  final_body text,
  approved_by uuid,
  approver_role public.member_role,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  reject_reason public.reject_reason,
  reject_note text check (char_length(reject_note) <= 500),
  sent_confirmed_by uuid,
  sent_confirmed_at timestamptz,
  send_method public.send_method,
  cancelled_at timestamptz,
  cancel_reason public.cancel_reason,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_draft_has_provenance check (source <> 'ai' or (prompt_version is not null and model is not null and ai_attempts >= 1)),
  constraint template_draft_has_reason check (source <> 'template' or fallback_reason is not null),
  constraint approval_fields_together check (
    (approved_at is null and approved_by is null and approver_role is null and final_subject is null and final_body is null)
    or (approved_at is not null and approved_by is not null and approver_role is not null and final_subject is not null and final_body is not null)
  ),
  constraint approved_or_sent_was_approved check (status not in ('approved', 'sent') or approved_at is not null),
  constraint waiting_has_no_outcome check (
    status <> 'waiting' or (approved_at is null and rejected_at is null and sent_confirmed_at is null and cancelled_at is null)
  ),
  constraint rejected_fields_together check (
    (status = 'rejected') = (rejected_at is not null)
    and (rejected_at is null) = (rejected_by is null)
    and (rejected_at is null) = (reject_reason is null)
    and (rejected_at is null or approved_at is null)
  ),
  constraint other_reason_needs_note check (reject_reason is distinct from 'other' or char_length(btrim(coalesce(reject_note, ''))) > 0),
  constraint sent_fields_together check (
    (status = 'sent') = (sent_confirmed_at is not null)
    and (sent_confirmed_at is null) = (sent_confirmed_by is null)
    and (sent_confirmed_at is null) = (send_method is null)
  ),
  constraint cancelled_fields_together check (
    (status = 'cancelled') = (cancelled_at is not null) and (cancelled_at is null) = (cancel_reason is null)
  ),
  constraint edited_only_when_approved check (not edited or approved_at is not null)
);

-- At most one live (waiting or approved) draft per invoice. This makes the weekly run idempotent (AT-08).
create unique index reminder_drafts_one_live on public.reminder_drafts (invoice_id) where status in ('waiting', 'approved');
create index reminder_drafts_invoice on public.reminder_drafts (invoice_id, created_at desc);
create index reminder_drafts_business_status on public.reminder_drafts (business_id, status);
create index reminder_drafts_run on public.reminder_drafts (run_id);

comment on table public.reminder_drafts is 'One reminder for one overdue invoice. Facts are copied at creation so any later change is caught before sending (BR-05).';
comment on column public.reminder_drafts.subject_template is 'Subject with placeholders, from the AI or the fallback template (AI-02).';
comment on column public.reminder_drafts.body_template is 'Body with placeholders, without the signature (the app adds it from settings).';
comment on column public.reminder_drafts.amount_shown_cents is 'Amount copied from the invoice when the draft was made; must still match at approval (BR-05).';
comment on column public.reminder_drafts.source is 'ai, or template when the AI failed or its reply failed the checks (FR-09, AI-07).';
comment on column public.reminder_drafts.prompt_version is 'Prompt version used (AI-09), for example reminder-draft/v1.';
comment on column public.reminder_drafts.model is 'Model used (AI-09), for example claude-haiku-5-5.';
comment on column public.reminder_drafts.final_subject is 'Subject exactly as approved; frozen once approved (FR-15).';
comment on column public.reminder_drafts.final_body is 'Body and signature exactly as approved; what the email app receives (FR-15, FR-18).';
comment on column public.reminder_drafts.edited is 'True when the approved text differs from the generated text; not a clean approval (BR-08, FR-22).';

-- ---------------------------------------------------------------------------------------------
-- attention_items: events that need a person, such as an amount changed by an import (AT-03).
-- Missing emails are calculated live in the briefing, so fixing an email clears them at once.
-- ---------------------------------------------------------------------------------------------
create table public.attention_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id),
  kind public.attention_kind not null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text check (resolution in ('redrafted', 'invoice_paid', 'invoice_closed', 'dismissed')),
  constraint resolved_fields_together check ((resolved_at is null) = (resolution is null))
);

create unique index attention_items_one_open on public.attention_items (invoice_id, kind) where resolved_at is null;
create index attention_items_business_open on public.attention_items (business_id) where resolved_at is null;
create index attention_items_invoice on public.attention_items (invoice_id);

comment on table public.attention_items is 'Things the system will not draft for until a person looks, such as an amount changed by an import (BR-05, AT-03).';

-- ---------------------------------------------------------------------------------------------
-- activity_log: append-only record of every action (FR-21). No foreign keys except business_id,
-- so entries outlive the drafts and people they mention.
-- ---------------------------------------------------------------------------------------------
create table public.activity_log (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  at timestamptz not null default now(),
  actor_user_id uuid,
  actor_role text not null check (actor_role in ('owner', 'checker', 'admin', 'system')),
  action public.activity_action not null,
  invoice_id uuid,
  draft_id uuid,
  client_id uuid,
  import_id uuid,
  run_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  constraint system_actor_has_no_user check ((actor_role = 'system') = (actor_user_id is null))
);

create index activity_log_business_at on public.activity_log (business_id, at desc);
create index activity_log_invoice on public.activity_log (invoice_id) where invoice_id is not null;
create index activity_log_draft on public.activity_log (draft_id) where draft_id is not null;
create index activity_log_run on public.activity_log (run_id) where run_id is not null;

comment on table public.activity_log is 'Append-only log of every import, draft, flag, approval, edit, rejection, send, cancellation and payment (FR-21).';
comment on column public.activity_log.at is 'Stored in UTC, shown in Sydney time (BR-14).';
comment on column public.activity_log.actor_role is 'owner, checker, admin or system (scheduled jobs).';
comment on column public.activity_log.details is 'Reasons and counts. Never names, emails or message text (NFR-04).';

-- ---------------------------------------------------------------------------------------------
-- quotes: designed now, built later (FR-28, Could)
-- ---------------------------------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.clients (id),
  quote_number text not null check (quote_number = btrim(quote_number) and char_length(quote_number) between 1 and 50),
  amount_cents bigint not null check (amount_cents > 0),
  date_sent date not null,
  status public.quote_status not null default 'open',
  last_contact_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_number_once unique (business_id, quote_number)
);

create index quotes_client_id on public.quotes (client_id);

comment on table public.quotes is 'Open quotes for "quotes gone quiet" (FR-28, Could). Follow-ups are likely commercial messages under the Spam Act (R-02).';

-- ---------------------------------------------------------------------------------------------
-- deletion_receipts: proof that a business's data was deleted (FR-03, NFR-03, PD-7). Counts only.
-- ---------------------------------------------------------------------------------------------
create table public.deletion_receipts (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  reason text not null check (reason in ('owner_request', 'retention_date')),
  was_test_data boolean not null,
  row_counts jsonb not null check (jsonb_typeof(row_counts) = 'object')
);

comment on table public.deletion_receipts is 'Proof of deletion with row counts and no personal data. Readable by the team only (no row-level security policy).';

-- ---------------------------------------------------------------------------------------------
-- private.banned_phrases: words a reminder must never use (AI-05). One list for the AI checks.
-- ---------------------------------------------------------------------------------------------
create table private.banned_phrases (
  phrase text primary key check (phrase = lower(phrase) and phrase ~ '^[a-z'' ]+$'),
  why text not null
);

insert into private.banned_phrases (phrase, why) values
  ('legal', 'No legal steps (AI-05, R-04)'),
  ('lawyer', 'No legal steps'),
  ('solicitor', 'No legal steps'),
  ('court', 'No legal steps'),
  ('tribunal', 'No legal steps'),
  ('adjudication', 'No payment-law claims (R-04)'),
  ('security of payment', 'No payment-law claims (R-04, FR-35)'),
  ('statutory demand', 'No legal steps'),
  ('debt collector', 'No debt collectors (AI-05, R-05)'),
  ('debt collection', 'No debt collectors'),
  ('collection agency', 'No debt collectors'),
  ('collections', 'No debt collectors'),
  ('credit report', 'No credit reporting (AI-05)'),
  ('credit reporting', 'No credit reporting'),
  ('credit rating', 'No credit reporting'),
  ('credit score', 'No credit reporting'),
  ('interest', 'No interest (AI-05)'),
  ('fee', 'No fees (AI-05)'),
  ('fees', 'No fees'),
  ('late fee', 'No fees'),
  ('penalty', 'No fees'),
  ('penalties', 'No fees'),
  ('surcharge', 'No fees'),
  ('discount', 'No discounts (AI-05)'),
  ('payment plan', 'No payment plans (AI-05)'),
  ('instalment', 'No payment plans'),
  ('installment', 'No payment plans'),
  ('final notice', 'No false urgency (AI-05)'),
  ('final warning', 'No false urgency'),
  ('last chance', 'No false urgency'),
  ('immediately', 'No false urgency'),
  ('urgent', 'No false urgency'),
  ('urgently', 'No false urgency'),
  ('asap', 'No false urgency'),
  ('as discussed', 'No invented facts (AI-05)'),
  ('as we discussed', 'No invented facts'),
  ('as agreed', 'No invented facts'),
  ('failure to pay', 'No threats (AI-05)'),
  ('consequences', 'No threats'),
  ('blacklist', 'No threats'),
  ('disappointed', 'No guilt (AI-05)'),
  ('shame', 'No guilt');

comment on table private.banned_phrases is 'Phrases a reminder must never contain (AI-05). Checked by private.check_reminder_template for AI replies and templates alike.';
