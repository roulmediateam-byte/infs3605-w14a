-- Sets up one owner for owner testing (PoV): a Test data business holding a copy of the sample invoices, and an
-- invitation for the owner (OPS-01, D7). In the proof of concept the team runs setup; the first-run wizard (APP-01)
-- comes after the course. Run it on the pilot project, once per owner:
--
--   psql "<pilot connection string>" -v business_name='<business name>' -v owner_name='<owner name>' \
--        -v owner_email='<owner email>' [-v xero=on|off|unknown] -f scripts/onboard-owner.sql
--
-- Then invite the same address in Supabase (Authentication > Invite user). The invitation email carries the
-- sign-in link and the 6-digit code (runbook, "Set up a project"). On first sign-in the owner lands on Home.
-- Names and addresses are passed in and never committed (NFR-04). The sample matches supabase/seed.sql: keep
-- the two in step. Real invoices replace the sample only after a written agreement (runbook, "Onboard an owner").

\set ON_ERROR_STOP on
\if :{?business_name}
\else
  \echo 'Pass -v business_name=... -v owner_name=... -v owner_email=...'
  \quit
\endif
\if :{?owner_name}
\else
  \echo 'Pass -v business_name=... -v owner_name=... -v owner_email=...'
  \quit
\endif
\if :{?owner_email}
\else
  \echo 'Pass -v business_name=... -v owner_name=... -v owner_email=...'
  \quit
\endif
\if :{?xero}
\else
  \set xero unknown
\endif

select set_config('onboard.business_name', :'business_name', false) is not null as name_set,
       set_config('onboard.owner_name', :'owner_name', false) is not null as owner_set,
       set_config('onboard.owner_email', :'owner_email', false) is not null as email_set,
       set_config('onboard.xero', :'xero', false) is not null as xero_set \gset

do $$
declare
  business_name constant text := btrim(current_setting('onboard.business_name'));
  owner_name constant text := btrim(current_setting('onboard.owner_name'));
  owner_email constant text := lower(btrim(current_setting('onboard.owner_email')));
  xero constant public.xero_reminders_status := current_setting('onboard.xero')::public.xero_reminders_status;
  today constant date := (now() at time zone 'Australia/Sydney')::date;
  team_uploader constant uuid := '0d5e0000-0000-4000-8000-0000000000ff';
  biz uuid;
  sample_import uuid;
  bayside uuid;
  northshore uuid;
  chen uuid;
  coastline uuid;
  greenway uuid;
  ridgeway uuid;
begin
  if exists (
    select 1 from public.memberships m
    where lower(m.invited_email) = owner_email and m.role = 'owner' and m.status <> 'removed'
  ) then
    raise exception 'This address already owns a business here. Nothing was changed.';
  end if;

  insert into public.businesses (name, owner_name, reply_to_email, xero_reminders, is_test_data)
  values (business_name || ' (Test data)', owner_name, owner_email, xero, true)
  returning id into biz;

  insert into public.memberships (business_id, invited_email, display_name, role, status)
  values (biz, owner_email, owner_name, 'owner', 'invited');

  insert into public.clients (business_id, name, contact_name, email, tone, client_group) values
    (biz, 'Bayside Builders (Test data)', 'Sam', 'accounts@bayside-builders.example', 'gentle', 'head_contractor')
    returning id into bayside;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group) values
    (biz, 'Northshore Homes (Test data)', 'Priya', 'pay@northshore-homes.example', 'standard', 'head_contractor')
    returning id into northshore;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group) values
    (biz, 'M. Chen Renovation (Test data)', 'Mei', 'mei@chen-reno.example', 'standard', 'homeowner')
    returning id into chen;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group) values
    (biz, 'Coastline Fitouts (Test data)', null, null, 'standard', 'other')
    returning id into coastline;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group) values
    (biz, 'Greenway Strata (Test data)', 'Tom', 'tom@greenway-strata.example', 'firm', 'other')
    returning id into greenway;
  -- Ridgeway is paused, as in the seed, so the owner sees the paused-client branch.
  insert into public.clients (business_id, name, contact_name, email, tone, client_group, paused, paused_at) values
    (biz, 'Ridgeway Developments (Test data)', 'Lee', 'lee@ridgeway-dev.example', 'standard', 'head_contractor', true, now())
    returning id into ridgeway;

  insert into public.imports (business_id, uploaded_by, file_name, source_format, column_mapping, rows_read, rows_saved,
                              rows_skipped, file_total_cents, saved_total_cents, invoices_added)
  values (biz, team_uploader, 'test-data-open-invoices.csv', 'team_template',
          '{"client":"Client","email":"Email","contact":"Contact","invoice_number":"Invoice number","issue_date":"Issue date","due_date":"Due date","amount_due":"Amount due"}',
          12, 12, 0, 6244000, 6244000, 12)
  returning id into sample_import;

  -- The same 12 open invoices as the seed: A$62,440.00 owed, A$42,790.00 overdue, A$7,050.00 due in 7 days.
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

  -- Greenway was reminded 8 days ago, so its first draft says "following up" (AI-08), as in the seed.
  update public.invoices set last_reminder_sent_at = now() - interval '8 days', reminders_sent_count = 1
   where business_id = biz and invoice_number = '1062';

  raise notice 'Business % created with 12 sample invoices and an owner invitation. Next: invite the owner in Authentication, then run "Weekly run" by hand for this business id.', biz;
end;
$$;
