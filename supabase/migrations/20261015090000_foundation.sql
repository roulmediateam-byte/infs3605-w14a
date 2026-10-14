-- Get-Paid Apprentice · migration 1 of 7 · foundation
-- Schemas, enumerated types and the function-grant convention.
-- Requirements: NFR-05 (the server checks every request), FR-21 (every action logged), BR-14 (cents and UTC).
-- Conventions (docs/adr/0003-writes-through-functions.md):
--   * Tables live in public, with row-level security (RLS) on every table. Members read through RLS.
--   * Every write goes through a public function that checks the caller's role and writes the activity log
--     in the same transaction. Signed-in users have SELECT only on tables.
--   * public.job_* functions are for the scheduled jobs and are executable by service_role only.
--   * private holds helpers and trigger functions. It is not exposed through the API.
--   * Every function sets search_path = '' and uses fully qualified names.

create schema if not exists private;
comment on schema private is 'Helpers and trigger functions for Get-Paid Apprentice. Not exposed through the API.';
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Roles in a business. One owner, at most one named checker, and team admins who may see test data only.
create type public.member_role as enum ('owner', 'checker', 'admin');
create type public.member_status as enum ('invited', 'active', 'removed');

-- Clients and their settings (FR-23 tone, FR-34 client groups).
create type public.tone as enum ('gentle', 'standard', 'firm');
create type public.client_group as enum ('head_contractor', 'homeowner', 'other');

-- Business settings (the job card). The proof of concept (PoC) stays on drafts_only (FR-29, FR-30).
create type public.trust_level as enum ('drafts_only', 'batch_approve', 'auto_send_small');
create type public.xero_reminders_status as enum ('unknown', 'on', 'off');

-- Invoices. "Overdue" is calculated from the due date and never stored (BR-06).
create type public.invoice_status as enum ('open', 'paid', 'closed');
create type public.close_reason as enum ('not_in_latest_import', 'closed_by_user');
create type public.import_format as enum ('xero_export', 'team_template', 'myob_export', 'other_csv');

-- Reminder drafts and their lifecycle (docs/state-machines.md).
create type public.draft_status as enum ('waiting', 'approved', 'rejected', 'sent', 'cancelled');
create type public.draft_source as enum ('ai', 'template');
create type public.reject_reason as enum ('already_paid', 'wrong_amount_or_invoice', 'will_call', 'wrong_tone', 'other');
create type public.cancel_reason as enum (
  'invoice_paid',       -- BR-03, FR-24
  'invoice_closed',     -- BR-03: not in the latest import
  'amount_changed',     -- BR-05, AT-03
  'due_date_changed',   -- BR-05 applied to the due date
  'client_paused',      -- BR-11, FR-26
  'email_missing',      -- BR-05, checked again at approval
  'superseded'          -- BR-10: replaced by the next weekly run
);
create type public.send_method as enum ('email_app', 'copy_paste');
create type public.attention_kind as enum ('amount_changed', 'due_date_changed');
create type public.quote_status as enum ('open', 'won', 'lost');

-- Activity log actions. The first nine match the PRD analytics events (PRD section 15).
create type public.activity_action as enum (
  'import_completed', 'draft_created', 'draft_flagged', 'draft_approved', 'draft_rejected',
  'reminder_sent', 'invoice_paid', 'briefing_sent', 'review_session',
  'draft_edited', 'draft_cancelled', 'send_refused', 'invoice_reopened', 'invoice_closed',
  'nudge_sent', 'weekly_run_completed', 'business_created', 'settings_changed',
  'client_updated', 'client_paused', 'client_unpaused', 'member_invited', 'member_joined',
  'member_removed', 'attention_dismissed', 'data_exported'
);

-- Scheduled jobs (BR-13, NFR-09, NFR-10).
create type public.job_name as enum ('weekly_run', 'briefing', 'briefing_check', 'nudge', 'health_check', 'retention');
create type public.job_status as enum ('running', 'succeeded', 'failed', 'skipped');
create type public.job_trigger as enum ('schedule', 'manual');

-- Grants for functions follow one rule, applied after every migration that creates functions:
--   public.job_*                      -> service_role only
--   other public functions            -> authenticated and service_role
--   private helpers used by RLS/views -> authenticated (pure or membership lookups only)
--   other private functions           -> nobody (called only from security definer functions)
-- anon never executes anything. tests/database/001_conventions.test.sql enforces this.
create or replace function private.apply_function_grants()
returns void
language plpgsql
set search_path = ''
as $$
declare
  f record;
  policy_helpers constant text[] := array['my_business_ids', 'sydney_date', 'days_overdue'];
begin
  for f in
    select p.oid::regprocedure as signature, n.nspname as schema_name, p.proname as function_name
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    if f.schema_name = 'public' and f.function_name like 'job\_%' then
      execute format('grant execute on function %s to service_role', f.signature);
    elsif f.schema_name = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.signature);
    elsif f.function_name = any (policy_helpers) then
      execute format('grant execute on function %s to authenticated, service_role', f.signature);
    end if;
  end loop;
end;
$$;

comment on function private.apply_function_grants() is
  'Applies the function-grant convention to every function in public and private. Run at the end of each migration that creates functions.';

select private.apply_function_grants();
