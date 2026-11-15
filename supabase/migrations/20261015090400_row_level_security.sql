-- Payprentice · migration 5 of 7 · row-level security (NFR-05)
-- Members read their own businesses' rows. Nobody writes to a table directly: every write goes through a
-- public function that checks the role (migration 6) or a job function run by the service role (migration 7).
-- Policies use the pattern Supabase recommends for team data: business_id in (select private.my_business_ids()).

alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.clients enable row level security;
alter table public.imports enable row level security;
alter table public.invoices enable row level security;
alter table public.job_runs enable row level security;
alter table public.reminder_drafts enable row level security;
alter table public.attention_items enable row level security;
alter table public.activity_log enable row level security;
alter table public.quotes enable row level security;
alter table public.deletion_receipts enable row level security;
alter table private.banned_phrases enable row level security;

create policy "Members read their business"
  on public.businesses for select to authenticated
  using (id in (select private.my_business_ids()));

create policy "Members read their team"
  on public.memberships for select to authenticated
  using (business_id in (select private.my_business_ids()));

create policy "Members read clients"
  on public.clients for select to authenticated
  using (business_id in (select private.my_business_ids()));

create policy "Members read imports"
  on public.imports for select to authenticated
  using (business_id in (select private.my_business_ids()));

create policy "Members read invoices"
  on public.invoices for select to authenticated
  using (business_id in (select private.my_business_ids()));

create policy "Members read job runs"
  on public.job_runs for select to authenticated
  using (business_id in (select private.my_business_ids()));

create policy "Members read drafts"
  on public.reminder_drafts for select to authenticated
  using (business_id in (select private.my_business_ids()));

create policy "Members read attention items"
  on public.attention_items for select to authenticated
  using (business_id in (select private.my_business_ids()));

create policy "Members read the activity log"
  on public.activity_log for select to authenticated
  using (business_id in (select private.my_business_ids()));

create policy "Members read quotes"
  on public.quotes for select to authenticated
  using (business_id in (select private.my_business_ids()));

-- deletion_receipts and private.banned_phrases have no policy: only the service role and the database owner read them.

-- Table privileges, belt and braces with RLS:
--   anon: nothing.
--   authenticated: SELECT only.
--   service_role: everything except changing or deleting the activity log.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
revoke select on public.deletion_receipts from authenticated;
revoke update, delete, truncate on public.activity_log from service_role;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on private.banned_phrases from public, anon, authenticated;

-- New tables must opt in to privileges explicitly.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from authenticated;

-- ---------------------------------------------------------------------------------------------
-- A read model for the Invoices screen (UI-07). security_invoker makes the view obey the caller's RLS.
-- Display status is derived, never stored: Due, Due soon, Overdue, Paid or Closed (BR-06).
-- ---------------------------------------------------------------------------------------------
create view public.invoice_list
with (security_invoker = true)
as
select
  i.id,
  i.business_id,
  i.client_id,
  c.name as client_name,
  c.email is not null as client_has_email,
  c.paused as client_paused,
  c.tone as client_tone,
  i.invoice_number,
  i.issue_date,
  i.due_date,
  i.amount_due_cents,
  i.status,
  i.paid_date,
  i.close_reason,
  i.last_reminder_sent_at,
  i.reminders_sent_count,
  private.days_overdue(i.due_date, now()) as days_past_due,
  case
    when i.status = 'paid' then 'paid'
    when i.status = 'closed' then 'closed'
    when private.days_overdue(i.due_date, now()) > 0 then 'overdue'
    when private.days_overdue(i.due_date, now()) >= -7 then 'due_soon'
    else 'due'
  end as display_status
from public.invoices i
join public.clients c on c.id = i.client_id;

comment on view public.invoice_list is 'Invoices with their client and derived display status for UI-07. Obeys the caller''s row-level security.';

revoke all on public.invoice_list from anon, authenticated;
grant select on public.invoice_list to authenticated;
