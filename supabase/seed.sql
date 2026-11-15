-- Payprentice · seed: synthetic "Test data" for local development and the Week 7 demonstration.
-- Every business, client and person here is invented and labelled "Test data" (course rule RI-9; NFR-02).
-- Never add real businesses, clients or people to this file, to tests or to any GitHub issue (NFR-04, CM-3).
--
-- Dates are relative to today in Sydney, so the demo always shows overdue invoices.
-- After `supabase db reset`, add owner@example.test and checker@example.test as users in Supabase Studio
-- (Authentication > Add user) and sign in with a one-time link from the local mail viewer; their invitations
-- below are accepted on first sign-in (public.accept_invitations).

do $$
declare
  biz constant uuid := '0d5e0000-0000-4000-8000-000000000001';
  bayside constant uuid := '0d5e0000-0000-4000-8000-0000000000c1';
  northshore constant uuid := '0d5e0000-0000-4000-8000-0000000000c2';
  chen constant uuid := '0d5e0000-0000-4000-8000-0000000000c3';
  coastline constant uuid := '0d5e0000-0000-4000-8000-0000000000c4';
  greenway constant uuid := '0d5e0000-0000-4000-8000-0000000000c5';
  ridgeway constant uuid := '0d5e0000-0000-4000-8000-0000000000c6';
  seed_import constant uuid := '0d5e0000-0000-4000-8000-0000000000a1';
  today date := (now() at time zone 'Australia/Sydney')::date;
  run_id uuid;
  planned record;
  template record;
  drafted integer := 0;
begin
  insert into public.businesses (id, name, owner_name, sign_off, reply_to_email, call_first_threshold_cents, xero_reminders,
                                 style_note)
  values (biz, 'Harbour Line Electrical (Test data)', 'Alex Test', 'Thanks,', 'accounts@harbourline.example',
          1500000, 'off', 'Short and friendly. First names. No jargon.');

  insert into public.memberships (business_id, invited_email, display_name, role, status) values
    (biz, 'owner@example.test', 'Alex Test', 'owner', 'invited'),
    (biz, 'checker@example.test', 'Jo Test', 'checker', 'invited');

  insert into public.clients (id, business_id, name, contact_name, email, tone, client_group, paused, paused_at) values
    (bayside, biz, 'Bayside Builders (Test data)', 'Sam', 'accounts@bayside-builders.example', 'gentle', 'head_contractor', false, null),
    (northshore, biz, 'Northshore Homes (Test data)', 'Priya', 'pay@northshore-homes.example', 'standard', 'head_contractor', false, null),
    (chen, biz, 'M. Chen Renovation (Test data)', 'Mei', 'mei@chen-reno.example', 'standard', 'homeowner', false, null),
    (coastline, biz, 'Coastline Fitouts (Test data)', null, null, 'standard', 'other', false, null),
    (greenway, biz, 'Greenway Strata (Test data)', 'Tom', 'tom@greenway-strata.example', 'firm', 'other', false, null),
    (ridgeway, biz, 'Ridgeway Developments (Test data)', 'Lee', 'lee@ridgeway-dev.example', 'standard', 'head_contractor', true, now());

  insert into public.imports (id, business_id, uploaded_by, file_name, source_format, column_mapping, rows_read, rows_saved,
                              rows_skipped, file_total_cents, saved_total_cents, invoices_added)
  values (seed_import, biz, '0d5e0000-0000-4000-8000-0000000000ff', 'test-data-open-invoices.csv', 'team_template',
          '{"client":"Client","email":"Email","contact":"Contact","invoice_number":"Invoice number","issue_date":"Issue date","due_date":"Due date","amount_due":"Amount due"}',
          12, 12, 0, 6244000, 6244000, 12);

  -- 12 open invoices: total owed $62,440.00; overdue $42,790.00; due in the next 7 days $7,050.00.
  insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents,
                               first_seen_import_id, last_seen_import_id) values
    (biz, bayside,    '1043', today - 44, today - 14,  125000, seed_import, seed_import),
    (biz, northshore, '1051', today - 51, today - 21,  845000, seed_import, seed_import),
    (biz, chen,       '1056', today - 44, today - 30,  320000, seed_import, seed_import),
    (biz, coastline,  '1060', today - 40, today - 10,  218000, seed_import, seed_import),
    (biz, greenway,   '1062', today - 75, today - 45,   64000, seed_import, seed_import),
    (biz, ridgeway,   '1064', today - 65, today - 35,  590000, seed_import, seed_import),
    (biz, bayside,    '1066', today - 38, today - 8,  1870000, seed_import, seed_import),
    (biz, northshore, '1068', today - 36, today - 6,   99000, seed_import, seed_import),
    (biz, chen,       '1070', today - 17, today - 3,   148000, seed_import, seed_import),
    (biz, greenway,   '1072', today - 28, today + 2,   275000, seed_import, seed_import),
    (biz, bayside,    '1074', today - 25, today + 5,   430000, seed_import, seed_import),
    (biz, northshore, '1076', today - 10, today + 20, 1260000, seed_import, seed_import);

  -- Greenway was reminded 8 days ago, so its new draft says "following up" (AI-08) and the cool-down has passed.
  update public.invoices set last_reminder_sent_at = now() - interval '8 days', reminders_sent_count = 1
   where invoices.business_id = biz and invoices.invoice_number = '1062';

  -- Make this week's drafts with the fallback templates, as the weekly run does when the AI is switched off.
  -- Expected: drafts for 1066, 1051, 1056, 1043 and 1062; 1060 flagged (no email); 1064 skipped (paused);
  -- 1068 and 1070 not yet 7 days overdue.
  run_id := (public.job_start('weekly_run', biz, (today - (extract(isodow from today)::integer % 7))::text, 'manual')) ->> 'run_id';
  for planned in select * from public.job_plan_weekly_run(run_id) loop
    select * into template from public.job_get_templates() t where t.tone = planned.tone;
    perform public.job_save_draft(run_id, planned.invoice_id, template.subject, template.body, 'template',
                                  template.version, null, 0::smallint, 'ai_disabled');
    drafted := drafted + 1;
  end loop;
  perform public.job_finish(run_id, 'succeeded', jsonb_build_object('drafts_created', drafted, 'source', 'seed'));
end;
$$;
