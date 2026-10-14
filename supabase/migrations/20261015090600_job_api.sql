-- Get-Paid Apprentice · migration 7 of 7 · the scheduled jobs' API
-- Functions named job_* are executable by service_role only (the GitHub Actions jobs). They act as "system"
-- in the activity log. Schedules are in Sydney time (BR-13); every job is safe to repeat (NFR-09) because
-- job_runs has one row per job, business and period, and drafts have one live row per invoice.
--
-- Weekly run (FR-07): job_start -> job_plan_weekly_run -> for each invoice: AI call, job_check_template,
--   one retry, template fallback -> job_save_draft -> job_finish.
-- Briefing (FR-11): job_due -> job_start -> job_get_briefing -> send email -> job_record_email -> job_finish.

create or replace function private.local_time(p_at timestamptz)
returns time
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Australia/Sydney')::time;
$$;

create or replace function private.local_isodow(p_at timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select extract(isodow from (p_at at time zone 'Australia/Sydney'))::integer;
$$;

-- The Sunday whose 9:00 pm Sydney run the moment belongs to: the most recent Sunday 21:00 at or before it.
create or replace function private.weekly_period(p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when private.local_isodow(p_at) = 7 and private.local_time(p_at) >= time '21:00' then private.sydney_date(p_at)
    else private.sydney_date(p_at) - (private.local_isodow(p_at) % 7) - case when private.local_isodow(p_at) = 7 then 7 else 0 end
  end;
$$;
comment on function private.weekly_period(timestamptz) is 'The Sunday (Sydney date) of the weekly run a moment belongs to (FR-07, BR-13).';

-- ---------------------------------------------------------------------------------------------
-- What is due now (AT-10). The workflows run on fixed Sydney schedules and ask the database what to do,
-- so a late or repeated run catches up without doing anything twice.
-- ---------------------------------------------------------------------------------------------
create or replace function public.job_due(p_job public.job_name, p_as_of timestamptz default now())
returns table (business_id uuid, period_key text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  today date := private.sydney_date(p_as_of);
  now_local time := private.local_time(p_as_of);
  weekday integer := private.local_isodow(p_as_of);
  week_sunday date := private.weekly_period(p_as_of);
begin
  if p_job = 'weekly_run' then
    -- Due from Sunday 9:00 pm for 24 hours, so the Monday 5:00 am catch-up run can still make the drafts.
    if p_as_of < ((week_sunday + time '21:00') at time zone 'Australia/Sydney') + interval '24 hours' then
      return query
        select b.id, week_sunday::text from public.businesses b
        where not exists (select 1 from public.job_runs r
                          where r.business_id = b.id and r.job = 'weekly_run' and r.period_key = week_sunday::text and r.status = 'succeeded');
    end if;

  elsif p_job = 'briefing' then
    -- Due from 45 minutes before the slot until 5 hours after it, on the business's briefing day.
    return query
      select b.id, today::text from public.businesses b
      where b.briefing_weekday = weekday
        and now_local - b.briefing_time >= interval '-45 minutes'
        and now_local - b.briefing_time < interval '5 hours'
        and not exists (select 1 from public.job_runs r
                        where r.business_id = b.id and r.job = 'briefing' and r.period_key = today::text and r.status = 'succeeded');

  elsif p_job = 'briefing_check' then
    -- NFR-10: 30 minutes after the slot, the briefing has still not gone.
    return query
      select b.id, today::text from public.businesses b
      where b.briefing_weekday = weekday
        and now_local - b.briefing_time >= interval '30 minutes'
        and now_local - b.briefing_time < interval '5 hours'
        and not exists (select 1 from public.job_runs r
                        where r.business_id = b.id and r.job = 'briefing' and r.period_key = today::text and r.status = 'succeeded');

  elsif p_job = 'nudge' then
    -- FR-25, BR-12: at noon on a morning-briefing day, one email to the checker if drafts still wait.
    return query
      select b.id, today::text from public.businesses b
      where b.briefing_weekday = weekday
        and b.briefing_time = time '07:00'
        and now_local >= time '12:00' and now_local < time '18:00'
        and exists (select 1 from public.memberships m where m.business_id = b.id and m.role = 'checker' and m.status = 'active')
        and exists (select 1 from public.reminder_drafts d where d.business_id = b.id and d.status = 'waiting')
        and exists (select 1 from public.job_runs r
                    where r.business_id = b.id and r.job = 'briefing' and r.period_key = today::text and r.status = 'succeeded')
        and not exists (select 1 from public.job_runs r
                        where r.business_id = b.id and r.job = 'nudge' and r.period_key = today::text and r.status = 'succeeded');

  elsif p_job in ('health_check', 'retention') then
    if not exists (select 1 from public.job_runs r
                   where r.business_id is null and r.job = p_job and r.period_key = today::text and r.status = 'succeeded') then
      return query select null::uuid, today::text;
    end if;
  end if;
end;
$$;
comment on function public.job_due(public.job_name, timestamptz) is 'AT-10, NFR-09: the businesses and periods a job should handle now, in Sydney time.';

create or replace function public.job_period_key(p_job public.job_name, p_as_of timestamptz default now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_job = 'weekly_run' then private.weekly_period(coalesce(p_as_of, now()))
              else private.sydney_date(coalesce(p_as_of, now())) end::text;
$$;
comment on function public.job_period_key(public.job_name, timestamptz) is 'The period a manual run belongs to: the Sunday for weekly_run, otherwise the Sydney date.';

create or replace function public.job_start(
  p_job public.job_name,
  p_business_id uuid,
  p_period_key text,
  p_trigger public.job_trigger default 'schedule',
  p_github_run_url text default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.job_runs;
  new_id uuid;
begin
  insert into public.job_runs (business_id, job, period_key, trigger, github_run_url)
  values (p_business_id, p_job, p_period_key, p_trigger, p_github_run_url)
  on conflict on constraint one_run_per_period do nothing
  returning id into new_id;
  if new_id is not null then
    return jsonb_build_object('run_id', new_id, 'proceed', true, 'reason', 'new');
  end if;

  select * into run from public.job_runs r
   where r.business_id is not distinct from p_business_id and r.job = p_job and r.period_key = p_period_key
   for update;
  if run.status = 'succeeded' and not p_force then
    return jsonb_build_object('run_id', run.id, 'proceed', false, 'reason', 'already_succeeded');
  end if;
  if run.status = 'running' and run.started_at > now() - interval '30 minutes' and not p_force then
    return jsonb_build_object('run_id', run.id, 'proceed', false, 'reason', 'already_running');
  end if;
  update public.job_runs
     set status = 'running', started_at = now(), finished_at = null, error = null, attempts = attempts + 1,
         trigger = p_trigger, github_run_url = coalesce(p_github_run_url, github_run_url)
   where id = run.id;
  return jsonb_build_object('run_id', run.id, 'proceed', true, 'reason', case when p_force then 'forced' else 'retry' end);
end;
$$;
comment on function public.job_start(public.job_name, uuid, text, public.job_trigger, text, boolean) is
  'Claims a job for a business and period. Returns proceed=false when it already succeeded or is running (NFR-09). p_force reruns it.';

create or replace function public.job_finish(p_run_id uuid, p_status public.job_status, p_stats jsonb default '{}'::jsonb, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.job_runs;
begin
  if p_status = 'running' then
    raise exception 'Finish a run as succeeded, failed or skipped.' using errcode = '22023';
  end if;
  select * into run from public.job_runs where id = p_run_id for update;
  if not found then
    raise exception 'Run not found.' using errcode = 'P0002';
  end if;
  update public.job_runs
     set status = p_status, finished_at = now(), stats = stats || coalesce(p_stats, '{}'::jsonb), error = left(p_error, 2000)
   where id = p_run_id;
  if run.job = 'weekly_run' and p_status = 'succeeded' and run.business_id is not null then
    perform private.log(run.business_id, 'weekly_run_completed', coalesce(p_stats, '{}'::jsonb), null, null, null, null, p_run_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Weekly run (FR-07 to FR-10, BR-01, BR-04, BR-05, BR-10, BR-11; AI-03)
-- ---------------------------------------------------------------------------------------------
create or replace function public.job_plan_weekly_run(p_run_id uuid, p_as_of timestamptz default null)
returns table (
  invoice_id uuid,
  tone public.tone,
  days_overdue integer,
  reminders_sent_before integer,
  style_note text,
  example_reminder text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  run public.job_runs;
  business public.businesses;
  as_of timestamptz := coalesce(p_as_of, now());
  item record;
begin
  select * into run from public.job_runs where id = p_run_id for update;
  if not found or run.job <> 'weekly_run' or run.status <> 'running' or run.business_id is null then
    raise exception 'Start a weekly run with job_start first.' using errcode = '22023';
  end if;
  select * into business from public.businesses where id = run.business_id for update;
  update public.job_runs set stats = stats || jsonb_build_object('as_of', as_of) where id = p_run_id;

  -- BR-10: last week's waiting drafts, and approved drafts never sent, are replaced, because their
  -- days overdue would now be wrong. Drafts made by this run are kept, so a rerun duplicates nothing (AT-08).
  for item in
    select distinct d.invoice_id from public.reminder_drafts d
    where d.business_id = business.id and d.status in ('waiting', 'approved') and d.run_id is distinct from p_run_id
  loop
    perform private.cancel_live_drafts(item.invoice_id, 'superseded', p_run_id);
  end loop;

  -- FR-10: flag each invoice that would be drafted but has no client email, once per run.
  for item in
    select i.id from public.invoices i
    where i.business_id = business.id and i.status = 'open'
      and private.ineligibility(i.id, as_of) = 'email_missing'
      and not exists (select 1 from public.activity_log l
                      where l.run_id = p_run_id and l.invoice_id = i.id and l.action = 'draft_flagged')
  loop
    perform private.log(business.id, 'draft_flagged', jsonb_build_object('reason', 'email_missing'), item.id, null, null, null, p_run_id);
  end loop;

  -- AI-03: only tone, days overdue, reminders sent before and the owner's style. No names, emails or amounts.
  return query
    select i.id, c.tone, private.days_overdue(i.due_date, as_of), i.reminders_sent_count, business.style_note, business.example_reminder
    from public.invoices i
    join public.clients c on c.id = i.client_id
    where i.business_id = business.id and i.status = 'open' and private.ineligibility(i.id, as_of) is null
    order by i.amount_due_cents desc, i.due_date, i.invoice_number;
end;
$$;
comment on function public.job_plan_weekly_run(uuid, timestamptz) is
  'BR-10 replacement, FR-10 flags, then the invoices to draft (BR-01) with the only fields the AI may see (AI-03).';

create or replace function public.job_check_template(p_subject text, p_body text, p_tone public.tone)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select private.check_reminder_template(p_subject, p_body, p_tone);
$$;
comment on function public.job_check_template(text, text, public.tone) is 'AI-06 for the job: an empty array means the reply may be saved; otherwise retry once, then use the template (AI-07).';

create or replace function public.job_save_draft(
  p_run_id uuid,
  p_invoice_id uuid,
  p_subject text,
  p_body text,
  p_source public.draft_source,
  p_prompt_version text default null,
  p_model text default null,
  p_ai_attempts smallint default 0,
  p_fallback_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.job_runs;
  invoice public.invoices;
  client public.clients;
  as_of timestamptz;
  problems text[];
  new_id uuid;
begin
  select * into run from public.job_runs where id = p_run_id;
  if not found or run.job <> 'weekly_run' or run.status <> 'running' then
    raise exception 'This weekly run is not running.' using errcode = '22023';
  end if;
  select * into invoice from public.invoices where id = p_invoice_id for update;
  if not found or invoice.business_id <> run.business_id then
    raise exception 'The invoice does not belong to this run''s business.' using errcode = '42501';
  end if;
  as_of := coalesce((run.stats ->> 'as_of')::timestamptz, now());

  -- Re-check BR-01 at save time: the invoice may have been paid, or already drafted by an earlier attempt.
  if private.ineligibility(p_invoice_id, as_of) is not null then
    return null;
  end if;

  select * into client from public.clients where id = invoice.client_id;
  problems := private.check_reminder_template(p_subject, p_body, client.tone);
  if cardinality(problems) > 0 then
    raise exception 'The draft failed the checks: %', array_to_string(problems, ', ') using errcode = '22023';
  end if;

  insert into public.reminder_drafts (business_id, invoice_id, run_id, tone_used, subject_template, body_template,
                                      invoice_number_shown, amount_shown_cents, due_date_shown, source, prompt_version,
                                      model, ai_attempts, fallback_reason)
  values (invoice.business_id, invoice.id, p_run_id, client.tone, btrim(p_subject), btrim(p_body),
          invoice.invoice_number, invoice.amount_due_cents, invoice.due_date, p_source, p_prompt_version,
          p_model, coalesce(p_ai_attempts, 0), p_fallback_reason)
  on conflict (invoice_id) where status in ('waiting', 'approved') do nothing
  returning id into new_id;

  if new_id is null then
    return null;
  end if;
  perform private.resolve_attention(invoice.id, 'redrafted');
  perform private.log(invoice.business_id, 'draft_created',
                      jsonb_build_object('source', p_source, 'tone', client.tone, 'prompt_version', p_prompt_version,
                                         'model', p_model, 'ai_attempts', coalesce(p_ai_attempts, 0), 'fallback_reason', p_fallback_reason),
                      invoice.id, new_id, null, null, p_run_id);
  return new_id;
end;
$$;
comment on function public.job_save_draft(uuid, uuid, text, text, public.draft_source, text, text, smallint, text) is
  'Saves one draft with its facts copied from the invoice (FR-08, BR-05). Returns null when the invoice no longer qualifies or already has a live draft.';

-- ---------------------------------------------------------------------------------------------
-- Emails to the owner and checker (FR-11, FR-25, NFR-10). The system never emails clients (D2).
-- ---------------------------------------------------------------------------------------------
create or replace function private.member_email(p_business_id uuid, p_role public.member_role)
returns table (email text, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(u.email, m.invited_email), m.display_name
  from public.memberships m
  left join auth.users u on u.id = m.user_id
  where m.business_id = p_business_id and m.role = p_role
    and (m.status = 'active' or (p_role = 'owner' and m.status = 'invited'))
  order by m.status = 'active' desc
  limit 1;
$$;
comment on function private.member_email(uuid, public.member_role) is
  'Where to send EM-01 or EM-02. An owner the team invited gets the briefing before first sign-in; a checker must have joined.';

create or replace function public.job_get_briefing(p_business_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owner_contact record;
begin
  select * into owner_contact from private.member_email(p_business_id, 'owner');
  if owner_contact.email is null then
    raise exception 'This business has no active owner to brief.' using errcode = 'P0002';
  end if;
  return private.build_briefing(p_business_id, coalesce(p_as_of, now()))
         || jsonb_build_object('recipient', jsonb_build_object('email', owner_contact.email, 'name', owner_contact.display_name),
                               'reply_to', (select b.reply_to_email from public.businesses b where b.id = p_business_id));
end;
$$;
comment on function public.job_get_briefing(uuid, timestamptz) is 'EM-01 content: the same briefing as the Home screen plus the owner''s address (AT-06).';

create or replace function public.job_get_nudge(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  checker record;
begin
  select * into checker from private.member_email(p_business_id, 'checker');
  if checker.email is null then
    return null;
  end if;
  return jsonb_build_object(
    'recipient', jsonb_build_object('email', checker.email, 'name', checker.display_name),
    'business', (select jsonb_build_object('id', b.id, 'name', b.name, 'is_test_data', b.is_test_data) from public.businesses b where b.id = p_business_id),
    'drafts_waiting', (select count(*) from public.reminder_drafts d where d.business_id = p_business_id and d.status = 'waiting')
  );
end;
$$;
comment on function public.job_get_nudge(uuid) is 'EM-02 content: the checker''s address and how many drafts still wait (FR-25).';

create or replace function public.job_record_email(p_run_id uuid, p_provider_message_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.job_runs;
begin
  select * into run from public.job_runs where id = p_run_id;
  if not found or run.job not in ('briefing', 'nudge') or run.business_id is null then
    raise exception 'Record emails against a briefing or nudge run.' using errcode = '22023';
  end if;
  perform private.log(run.business_id, case when run.job = 'briefing' then 'briefing_sent' else 'nudge_sent' end::public.activity_action,
                      jsonb_build_object('period', run.period_key, 'provider_message_id', left(p_provider_message_id, 200)),
                      null, null, null, null, p_run_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Retention and health (NFR-03, PD-7, NFR-10)
-- ---------------------------------------------------------------------------------------------
create or replace function public.job_retention_purge(p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  course_end constant date := date '2026-12-31';
  today date := private.sydney_date(coalesce(p_as_of, now()));
  business public.businesses;
  deleted integer := 0;
begin
  for business in
    select * from public.businesses b
    where (b.delete_after is not null and b.delete_after < today) or today >= course_end
    for update
  loop
    insert into public.deletion_receipts (business_id, reason, was_test_data, row_counts)
    values (business.id, 'retention_date', business.is_test_data, private.business_row_counts(business.id));
    delete from public.businesses where id = business.id;
    deleted := deleted + 1;
  end loop;
  return jsonb_build_object('businesses_deleted', deleted, 'as_of_date', today);
end;
$$;
comment on function public.job_retention_purge(timestamptz) is
  'NFR-03 and PD-7: deletes businesses past their delete_after date, and every business from Thu 31 Dec 2026. Keeps receipts.';

create or replace function public.job_orphan_users(p_as_of timestamptz default now())
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where u.created_at < coalesce(p_as_of, now()) - interval '14 days'
    and not exists (
      select 1 from public.memberships m
      where (m.user_id = u.id or lower(m.invited_email) = lower(u.email)) and m.status <> 'removed'
    );
$$;
comment on function public.job_orphan_users(timestamptz) is 'Sign-in accounts with no current membership for 14 days; the retention job deletes them with the Auth admin API.';

create or replace function public.job_health(p_as_of timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'as_of', coalesce(p_as_of, now()),
    'businesses', (select count(*) from public.businesses),
    'failed_runs_7d', (select count(*) from public.job_runs r where r.status = 'failed' and r.started_at > coalesce(p_as_of, now()) - interval '7 days'),
    'stuck_runs', (select count(*) from public.job_runs r where r.status = 'running' and r.started_at < coalesce(p_as_of, now()) - interval '30 minutes'),
    'last_weekly_run', (select max(r.finished_at) from public.job_runs r where r.job = 'weekly_run' and r.status = 'succeeded'),
    'last_briefing', (select max(r.finished_at) from public.job_runs r where r.job = 'briefing' and r.status = 'succeeded')
  );
$$;
comment on function public.job_health(timestamptz) is 'Daily health check: proves the database is awake (free projects pause after a week idle) and counts failed or stuck runs.';

-- ---------------------------------------------------------------------------------------------
-- Fallback templates (FR-09, AI-07). Versioned in the repository (AI-09) and held to the same AI-06 checks
-- as AI replies. Version template/v1 adds one sentence to the Design Requirements v0.1 standard and firm
-- templates: without the signature (which the app now adds) they had 32 and 35 words, below AI-06's minimum of 40.
-- ---------------------------------------------------------------------------------------------
create table private.reminder_templates (
  tone public.tone not null,
  version text not null,
  subject text not null,
  body text not null,
  active boolean not null default false,
  primary key (tone, version)
);
create unique index reminder_templates_one_active on private.reminder_templates (tone) where active;
alter table private.reminder_templates enable row level security;
revoke all on private.reminder_templates from public, anon, authenticated;

insert into private.reminder_templates (tone, version, subject, body, active) values
  ('gentle', 'template/v1', 'Quick reminder: invoice {invoice_number}',
   E'Hi {client_name},\n\nHope the job''s going well. Just a friendly reminder that invoice {invoice_number} for {amount_due} was due on {due_date}. If it''s already on its way, thank you, and please ignore this. If anything''s holding it up, just let me know and I''m happy to help.',
   true),
  ('standard', 'template/v1', 'Invoice {invoice_number} is overdue',
   E'Hi {client_name},\n\nInvoice {invoice_number} for {amount_due} was due on {due_date} and is now {days_overdue} days overdue. Could you please arrange payment this week, or let me know when we can expect it? If it''s already been paid, thank you, and please ignore this email.',
   true),
  ('firm', 'template/v1', 'Overdue: invoice {invoice_number}',
   E'Hi {client_name},\n\nInvoice {invoice_number} for {amount_due} was due on {due_date} and is now {days_overdue} days overdue. Please pay it this week. If there''s a problem with the invoice, please call me and we''ll sort it out together. If you''ve already paid, thank you.',
   true);

comment on table private.reminder_templates is 'Fixed fallback reminders per tone (FR-09). One active version per tone; template drafts store the version in prompt_version.';

create or replace function public.job_get_templates()
returns table (tone public.tone, version text, subject text, body text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.tone, t.version, t.subject, t.body from private.reminder_templates t where t.active order by t.tone;
$$;
comment on function public.job_get_templates() is 'The active fallback template for each tone (FR-09).';

select private.apply_function_grants();
