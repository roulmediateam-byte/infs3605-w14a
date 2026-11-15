-- Migration 11: on a new demonstration account, "Run it now" (a forced weekly run for this week) is a new run on any
-- day, replaces the sign-up's drafts, drafts again and applies firmer by itself. Before the fix this failed from
-- Sunday 9 pm to the next Sunday: the run reused the sign-up's run and found "nothing new to draft".
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);

insert into public.businesses (name, owner_name, sign_off, reply_to_email, is_test_data, delete_after)
values ('Run it now check (Test data)', 'Alex Test', 'Thanks,', 'accounts@run-it-now.example', true, date '2026-12-31');
select set_config('tests.biz', (select id::text from public.businesses where name = 'Run it now check (Test data)'), true);

select is(private.add_sample_data(current_setting('tests.biz')::uuid, 'demo_sign_up'), 5,
  'the sample data starts with 5 drafts');

select is((select period_key from public.job_runs where business_id = current_setting('tests.biz')::uuid and job = 'weekly_run'),
          (private.weekly_period(now()) - 7)::text,
  'the starting drafts belong to last week''s run');

-- The owner sets Greenway to Standard and turns on firmer by itself after 1 unpaid reminder, as in the video.
update public.clients set tone = 'standard' where business_id = current_setting('tests.biz')::uuid and name like 'Greenway%';
update public.businesses set auto_firm_after = 1 where id = current_setting('tests.biz')::uuid;

select is((public.job_start('weekly_run', current_setting('tests.biz')::uuid, private.weekly_period(now())::text,
                            'manual', null, true)) ->> 'reason', 'new',
  '"Run it now" this week is a new run, whatever the day');
select set_config('tests.run', (select id::text from public.job_runs
                                 where business_id = current_setting('tests.biz')::uuid and job = 'weekly_run'
                                   and period_key = private.weekly_period(now())::text), true);

select is((select count(*)::integer from public.job_plan_weekly_run(current_setting('tests.run')::uuid)), 5,
  'it plans 5 reminders again: 1066, 1051, 1056, 1043 and 1062');

select is((select count(*)::integer from public.reminder_drafts
            where business_id = current_setting('tests.biz')::uuid and status = 'waiting'), 0,
  'the sign-up''s waiting drafts were replaced');

select is((select tone::text from public.clients where business_id = current_setting('tests.biz')::uuid and name like 'Greenway%'),
          'firm', 'firmer by itself moved Greenway from Standard to Firm');

select ok(exists (select 1 from public.activity_log
                   where run_id = current_setting('tests.run')::uuid and action = 'tone_stepped_up'),
  'the step up is in the activity log for this run');

select * from finish();
rollback;
