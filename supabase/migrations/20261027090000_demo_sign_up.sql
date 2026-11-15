-- Payprentice · migration 8 · sign-up for the demonstration build (dev project only)
-- In the demonstration build anyone can make an account with a made-up email and a password, and gets their own copy
-- of the seed's Test data business (supabase/functions/demo-sign-up). No email is sent: the Auth admin API makes the
-- account already confirmed and marks it in app_metadata (demo_sign_up = true), which only the service role can set.
--
--   * public.job_demo_sign_up_room: whether sign-ups are open (caps, and closed after Wed 25 Nov 2026 for PD-7).
--   * public.job_demo_provision: gives one demo account its Test data business. Safe to repeat (NFR-09).
--   * public.accept_invitations: a demo account never accepts an invitation, because nobody checked its address.
--     Without this, anyone could claim an invitation by making an account with the invited address.
--
-- The business matches supabase/seed.sql: 12 open invoices, A$62,440.00 owed, A$42,790.00 overdue and 5 drafts.
-- Keep the three copies in step: supabase/seed.sql, scripts/onboard-owner.sql and this file. Test data only (RI-9).

-- ---------------------------------------------------------------------------------------------
-- Which accounts the demonstration sign-up made, and how many businesses each has had
-- ---------------------------------------------------------------------------------------------
create or replace function private.is_demo_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (u.raw_app_meta_data ->> 'demo_sign_up') = 'true' from auth.users u where u.id = p_user_id), false);
$$;
comment on function private.is_demo_account(uuid) is
  'True for an account made by the demonstration sign-up: app_metadata demo_sign_up, which only the service role can set.';

create table private.demo_provisions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- No link to the business, so the count survives the owner deleting it. The rows go with the account.
  business_id uuid not null,
  made_at timestamptz not null default now()
);
create index demo_provisions_user on private.demo_provisions (user_id);
alter table private.demo_provisions enable row level security;
revoke all on private.demo_provisions from public, anon, authenticated;
comment on table private.demo_provisions is
  'Each Test data business made for a demonstration account (job_demo_provision), so one account can''t make endless copies.';

-- ---------------------------------------------------------------------------------------------
-- Sign-ups are open while under the caps, and until Wed 25 Nov 2026 (Test data is deleted by Thu 26 Nov, PD-7)
-- ---------------------------------------------------------------------------------------------
create or replace function public.job_demo_sign_up_room(p_as_of timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with counts as (
    select count(*) as accounts,
           count(*) filter (where u.created_at > coalesce(p_as_of, now()) - interval '1 hour') as last_hour
    from auth.users u
    where (u.raw_app_meta_data ->> 'demo_sign_up') = 'true'
  )
  select jsonb_build_object(
    'open', r.reason = 'open',
    'reason', r.reason,
    'accounts', c.accounts,
    'last_hour', c.last_hour
  )
  from counts c,
  lateral (
    select case
      when private.sydney_date(coalesce(p_as_of, now())) > date '2026-11-25' then 'closed'
      when c.accounts >= 300 then 'full'
      when c.last_hour >= 60 then 'busy'
      else 'open'
    end as reason
  ) r;
$$;
comment on function public.job_demo_sign_up_room(timestamptz) is
  'Whether the demonstration sign-up is open: at most 300 accounts, 60 an hour, and none after Wed 25 Nov 2026 (PD-7).';

-- ---------------------------------------------------------------------------------------------
-- One demonstration account's Test data business: the seed's, with the account as its active owner
-- ---------------------------------------------------------------------------------------------
create or replace function public.job_demo_provision(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_email text;
  existing uuid;
  biz uuid;
  team_uploader constant uuid := '0d5e0000-0000-4000-8000-0000000000ff';
  today constant date := private.sydney_date(now());
  sample_import uuid;
  bayside uuid;
  northshore uuid;
  chen uuid;
  coastline uuid;
  greenway uuid;
  ridgeway uuid;
  run_id uuid;
  planned record;
  template record;
  drafted integer := 0;
begin
  select lower(u.email) into account_email from auth.users u where u.id = p_user_id;
  if account_email is null then
    return jsonb_build_object('outcome', 'no_account');
  end if;
  if not private.is_demo_account(p_user_id) then
    return jsonb_build_object('outcome', 'not_demo');
  end if;

  -- One at a time per account (a retry, or two tabs), so an account never gets two businesses at once.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job_demo_provision:' || p_user_id::text, 0));

  select m.business_id into existing
    from public.memberships m
   where m.user_id = p_user_id and m.status = 'active'
   order by m.accepted_at
   limit 1;
  if existing is not null then
    return jsonb_build_object('outcome', 'exists', 'business_id', existing);
  end if;
  if (select count(*) from private.demo_provisions d where d.user_id = p_user_id) >= 10 then
    return jsonb_build_object('outcome', 'limit');
  end if;

  insert into public.businesses (name, owner_name, sign_off, reply_to_email, call_first_threshold_cents, xero_reminders,
                                 style_note, is_test_data, delete_after)
  values ('Harbour Line Electrical (Test data)', 'Alex Test', 'Thanks,', 'accounts@harbourline.example', 1500000, 'off',
          'Short and friendly. First names. No jargon.', true, date '2026-11-25')
  returning id into biz;

  insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, accepted_at)
  values (biz, p_user_id, account_email, 'Alex Test', 'owner', 'active', now());

  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (biz, 'Bayside Builders (Test data)', 'Sam', 'accounts@bayside-builders.example', 'gentle', 'head_contractor')
  returning id into bayside;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (biz, 'Northshore Homes (Test data)', 'Priya', 'pay@northshore-homes.example', 'standard', 'head_contractor')
  returning id into northshore;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (biz, 'M. Chen Renovation (Test data)', 'Mei', 'mei@chen-reno.example', 'standard', 'homeowner')
  returning id into chen;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (biz, 'Coastline Fitouts (Test data)', null, null, 'standard', 'other')
  returning id into coastline;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (biz, 'Greenway Strata (Test data)', 'Tom', 'tom@greenway-strata.example', 'firm', 'other')
  returning id into greenway;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group, paused, paused_at)
  values (biz, 'Ridgeway Developments (Test data)', 'Lee', 'lee@ridgeway-dev.example', 'standard', 'head_contractor', true, now())
  returning id into ridgeway;

  insert into public.imports (business_id, uploaded_by, file_name, source_format, column_mapping, rows_read, rows_saved,
                              rows_skipped, file_total_cents, saved_total_cents, invoices_added)
  values (biz, team_uploader, 'test-data-open-invoices.csv', 'team_template',
          '{"client":"Client","email":"Email","contact":"Contact","invoice_number":"Invoice number","issue_date":"Issue date","due_date":"Due date","amount_due":"Amount due"}',
          12, 12, 0, 6244000, 6244000, 12)
  returning id into sample_import;

  -- The seed's 12 open invoices, dated from today in Sydney: A$62,440.00 owed, A$42,790.00 overdue.
  insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents,
                               first_seen_import_id, last_seen_import_id) values
    (biz, bayside,    '1043', today - 44, today - 14,  125000, sample_import, sample_import),
    (biz, northshore, '1051', today - 51, today - 21,  845000, sample_import, sample_import),
    (biz, chen,       '1056', today - 44, today - 30,  320000, sample_import, sample_import),
    (biz, coastline,  '1060', today - 40, today - 10,  218000, sample_import, sample_import),
    (biz, greenway,   '1062', today - 75, today - 45,   64000, sample_import, sample_import),
    (biz, ridgeway,   '1064', today - 65, today - 35,  590000, sample_import, sample_import),
    (biz, bayside,    '1066', today - 38, today - 8,  1870000, sample_import, sample_import),
    (biz, northshore, '1068', today - 36, today - 6,   99000, sample_import, sample_import),
    (biz, chen,       '1070', today - 17, today - 3,   148000, sample_import, sample_import),
    (biz, greenway,   '1072', today - 28, today + 2,   275000, sample_import, sample_import),
    (biz, bayside,    '1074', today - 25, today + 5,   430000, sample_import, sample_import),
    (biz, northshore, '1076', today - 10, today + 20, 1260000, sample_import, sample_import);

  -- Greenway was reminded 8 days ago, so its draft says "following up" (AI-08), as in the seed.
  update public.invoices set last_reminder_sent_at = now() - interval '8 days', reminders_sent_count = 1
   where invoices.business_id = biz and invoices.invoice_number = '1062';

  -- This week's drafts with the fallback templates, as the seed makes them: 1066, 1051, 1056, 1043 and 1062.
  run_id := (public.job_start('weekly_run', biz, (today - (extract(isodow from today)::integer % 7))::text, 'manual')) ->> 'run_id';
  for planned in select * from public.job_plan_weekly_run(run_id) loop
    select * into template from public.job_get_templates() t where t.tone = planned.tone;
    perform public.job_save_draft(run_id, planned.invoice_id, template.subject, template.body, 'template',
                                  template.version, null, 0::smallint, 'ai_disabled');
    drafted := drafted + 1;
  end loop;
  perform public.job_finish(run_id, 'succeeded', jsonb_build_object('drafts_created', drafted, 'source', 'demo_sign_up'));

  insert into private.demo_provisions (user_id, business_id) values (p_user_id, biz);
  return jsonb_build_object('outcome', 'created', 'business_id', biz, 'drafts', drafted);
end;
$$;
comment on function public.job_demo_provision(uuid) is
  'Gives a demonstration account its own copy of the seed''s Test data business, as the active owner. Returns the business it already has, if any; at most 10 copies per account.';

-- ---------------------------------------------------------------------------------------------
-- Invitations: as before (migration 6), except that a demonstration account never accepts one
-- ---------------------------------------------------------------------------------------------
create or replace function public.accept_invitations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text;
  invitation record;
begin
  if caller is null then
    raise exception 'Sign in to continue.' using errcode = '28000';
  end if;
  select lower(u.email) into caller_email from auth.users u where u.id = caller;
  -- Nobody checked a demonstration account's address (no email is sent), so it can't prove an invitation is its own.
  if not private.is_demo_account(caller) then
    for invitation in
      select m.id, m.business_id, m.role from public.memberships m
      where m.status = 'invited' and lower(m.invited_email) = caller_email
      for update
    loop
      update public.memberships set user_id = caller, status = 'active', accepted_at = now() where id = invitation.id;
      perform private.log(invitation.business_id, 'member_joined', jsonb_build_object('role', invitation.role));
    end loop;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('business_id', m.business_id, 'role', m.role) order by m.accepted_at)
    from public.memberships m
    where m.user_id = caller and m.status = 'active'
  ), '[]'::jsonb);
end;
$$;
comment on function public.accept_invitations() is 'Called after every sign-in. Activates invitations for the caller''s email and returns their businesses. An empty list means "Ask the owner to invite you" (FR-01). Accounts made by the demonstration sign-up never accept invitations (migration 8).';

select private.apply_function_grants();
