-- Migration 11: "Run it now" works on a new demonstration account on any day.
--
-- The sample Test data filed its starting drafts under the run for the most recent Sunday by date, while the weekly run
-- (scheduled, or "Run it now") belongs to the most recent Sunday 9 pm (private.weekly_period). From Sunday 9 pm until the
-- next Sunday the two were the same run, so "Run it now" reran the sign-up's own run: its drafts were not replaced,
-- every invoice still had a live draft, nothing was drafted and firmer by itself never applied ("nothing new to draft").
-- Now the starting drafts belong to the run of the week before, so this week's run is always a new run.
-- Existing demonstration businesses whose only weekly run is that sign-up run are moved the same way. All Test data.

-- The seed's sample clients and 12 open invoices, dated from today, then drafts from the templates under last week's run.
-- Shared by the demonstration sign-up and "Start with sample Test data" in setup. Keep in step with supabase/seed.sql.
create or replace function private.add_sample_data(p_business_id uuid, p_source text default 'sample_data')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'Bayside Builders (Test data)', 'Sam', 'accounts@bayside-builders.example', 'gentle', 'head_contractor')
  returning id into bayside;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'Northshore Homes (Test data)', 'Priya', 'pay@northshore-homes.example', 'standard', 'head_contractor')
  returning id into northshore;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'M. Chen Renovation (Test data)', 'Mei', 'mei@chen-reno.example', 'standard', 'homeowner')
  returning id into chen;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'Coastline Fitouts (Test data)', null, null, 'standard', 'other')
  returning id into coastline;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'Greenway Strata (Test data)', 'Tom', 'tom@greenway-strata.example', 'firm', 'other')
  returning id into greenway;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group, paused, paused_at)
  values (p_business_id, 'Ridgeway Developments (Test data)', 'Lee', 'lee@ridgeway-dev.example', 'standard', 'head_contractor', true, now())
  returning id into ridgeway;

  insert into public.imports (business_id, uploaded_by, file_name, source_format, column_mapping, rows_read, rows_saved,
                              rows_skipped, file_total_cents, saved_total_cents, invoices_added)
  values (p_business_id, team_uploader, 'test-data-open-invoices.csv', 'team_template',
          '{"client":"Client","email":"Email","contact":"Contact","invoice_number":"Invoice number","issue_date":"Issue date","due_date":"Due date","amount_due":"Amount due"}',
          12, 12, 0, 6244000, 6244000, 12)
  returning id into sample_import;

  insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents,
                               first_seen_import_id, last_seen_import_id) values
    (p_business_id, bayside,    '1043', today - 44, today - 14,  125000, sample_import, sample_import),
    (p_business_id, northshore, '1051', today - 51, today - 21,  845000, sample_import, sample_import),
    (p_business_id, chen,       '1056', today - 44, today - 30,  320000, sample_import, sample_import),
    (p_business_id, coastline,  '1060', today - 40, today - 10,  218000, sample_import, sample_import),
    (p_business_id, greenway,   '1062', today - 75, today - 45,   64000, sample_import, sample_import),
    (p_business_id, ridgeway,   '1064', today - 65, today - 35,  590000, sample_import, sample_import),
    (p_business_id, bayside,    '1066', today - 38, today - 8,  1870000, sample_import, sample_import),
    (p_business_id, northshore, '1068', today - 36, today - 6,   99000, sample_import, sample_import),
    (p_business_id, chen,       '1070', today - 17, today - 3,   148000, sample_import, sample_import),
    (p_business_id, greenway,   '1072', today - 28, today + 2,   275000, sample_import, sample_import),
    (p_business_id, bayside,    '1074', today - 25, today + 5,   430000, sample_import, sample_import),
    (p_business_id, northshore, '1076', today - 10, today + 20, 1260000, sample_import, sample_import);

  update public.invoices set last_reminder_sent_at = now() - interval '8 days', reminders_sent_count = 1
   where invoices.business_id = p_business_id and invoices.invoice_number = '1062';

  -- The drafts waiting at sign-up, with the fallback templates, as the seed makes them: 1066, 1051, 1056, 1043 and 1062.
  -- They belong to LAST week's run (the Sunday before the run this moment belongs to), so this week's run, scheduled or
  -- "Run it now", is a new run that replaces them and makes its own decisions (firmer by itself included).
  -- Forced, in case that week already has a run for this business.
  run_id := (public.job_start('weekly_run', p_business_id, (private.weekly_period(now()) - 7)::text,
                              'manual', null, true)) ->> 'run_id';
  for planned in select * from public.job_plan_weekly_run(run_id) loop
    select * into template from public.job_get_templates() t where t.tone = planned.tone;
    perform public.job_save_draft(run_id, planned.invoice_id, template.subject, template.body, 'template',
                                  template.version, null, 0::smallint, 'ai_disabled');
    drafted := drafted + 1;
  end loop;
  perform public.job_finish(run_id, 'succeeded', jsonb_build_object('drafts_created', drafted, 'source', p_source));
  return drafted;
end;
$$;
comment on function private.add_sample_data(uuid, text) is
  'The seed''s 6 clients and 12 open invoices (A$62,440.00 owed, A$42,790.00 overdue) dated from today, and template drafts filed under last week''s run, so this week''s run replaces them.';

-- Existing Test data businesses: a weekly run for this week whose drafts came from the sample data, and no run for the
-- week before, moves to the week before. Runs that "Run it now" already made for another week are left alone.
update public.job_runs r
   set period_key = (r.period_key::date - 7)::text
  from public.businesses b
 where b.id = r.business_id
   and b.is_test_data
   and r.job = 'weekly_run'
   and r.stats ? 'source'
   and r.period_key = private.weekly_period(now())::text
   and not exists (select 1 from public.job_runs o
                    where o.business_id = r.business_id and o.job = 'weekly_run'
                      and o.period_key = (r.period_key::date - 7)::text);

select private.apply_function_grants();
