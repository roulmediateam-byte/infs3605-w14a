-- Scheduled jobs: AT-10 (Sydney schedule), NFR-09 (safe to repeat), NFR-10 (late-briefing alert), FR-25 nudge,
-- NFR-03 and PD-7 (retention). All moments are pinned in Sydney time (AEDT, UTC+11).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

create schema tests;
grant usage on schema tests to public;
create function tests.due(p_job public.job_name, p_at timestamptz, p_business uuid) returns boolean language sql stable as
  $$ select exists (select 1 from public.job_due(p_job, p_at) d where d.business_id is not distinct from p_business) $$;

-- Fixture: M briefs Monday 7:00 am and has an active checker; E briefs Monday 6:00 pm; R holds real data.
insert into auth.users (id, email, created_at) values
  ('a0000000-0000-4000-8000-000000000071', 'owner.m@example.test', now()),
  ('a0000000-0000-4000-8000-000000000072', 'checker.m@example.test', now()),
  ('a0000000-0000-4000-8000-000000000073', 'orphan@example.test', now() - interval '20 days'),
  ('a0000000-0000-4000-8000-000000000074', 'invited.later@example.test', now() - interval '20 days');
insert into public.businesses (id, name, owner_name, reply_to_email, briefing_weekday, briefing_time) values
  ('b0000000-0000-4000-8000-000000000071', 'Morning Brief (Test data)', 'Owner M', 'owner.m@example.test', 1, '07:00'),
  ('b0000000-0000-4000-8000-000000000072', 'Evening Brief (Test data)', 'Owner E', 'owner.e@example.test', 1, '18:00');
insert into public.businesses (id, name, owner_name, reply_to_email, is_test_data, real_data_agreed_at, delete_after)
values ('b0000000-0000-4000-8000-000000000073', 'Real Data Pilot', 'Owner P', 'owner.p@example.test', false, now(), '2026-11-20');
insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, accepted_at) values
  ('b0000000-0000-4000-8000-000000000071', 'a0000000-0000-4000-8000-000000000071', 'owner.m@example.test', 'Owner M', 'owner', 'active', now()),
  ('b0000000-0000-4000-8000-000000000071', 'a0000000-0000-4000-8000-000000000072', 'checker.m@example.test', 'Checker M', 'checker', 'active', now());
insert into public.memberships (business_id, invited_email, display_name, role, status)
values ('b0000000-0000-4000-8000-000000000072', 'invited.later@example.test', 'Owner E', 'owner', 'invited');
insert into public.clients (id, business_id, name, email)
values ('c0000000-0000-4000-8000-000000000071', 'b0000000-0000-4000-8000-000000000071', 'Client M (Test data)', 'client@m.example');
insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents)
values ('b0000000-0000-4000-8000-000000000071', 'c0000000-0000-4000-8000-000000000071', 'M-1', '2026-09-01', '2026-10-01', 100000);

-- Which week a moment belongs to.
select is(private.weekly_period('2026-11-08 21:10:00+11'), date '2026-11-08', 'Sun 9:10 pm belongs to that Sunday''s run');
select is(private.weekly_period('2026-11-08 20:50:00+11'), date '2026-11-01', 'Sun 8:50 pm still belongs to the previous week');
select is(private.weekly_period('2026-11-10 07:00:00+11'), date '2026-11-08', 'Tuesday belongs to the Sunday before');

-- AT-10: the weekly run is due from Sunday 9:00 pm, with a catch-up window into Monday morning.
select ok(tests.due('weekly_run', '2026-11-08 21:10:00+11', 'b0000000-0000-4000-8000-000000000071'), 'AT-10: the weekly run is due at Sun 9:10 pm');
select ok(not tests.due('weekly_run', '2026-11-08 20:50:00+11', 'b0000000-0000-4000-8000-000000000071'), 'AT-10: ...not at 8:50 pm');
select ok(tests.due('weekly_run', '2026-11-09 05:10:00+11', 'b0000000-0000-4000-8000-000000000071'), 'NFR-09: the Monday 5:10 am catch-up still runs it if Sunday''s run was dropped');
select ok(not tests.due('weekly_run', '2026-11-09 22:00:00+11', 'b0000000-0000-4000-8000-000000000071'), 'A day later it is no longer due');

-- NFR-09: job_start claims each period once.
select is(public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000071', '2026-11-08') ->> 'reason', 'new', 'The first start claims the period');
select is(public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000071', '2026-11-08') ->> 'reason', 'already_running', 'A second start while it runs does nothing');
select throws_ok($$ select public.job_finish((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000071'), 'running') $$,
  '22023', null, 'A run must finish as succeeded, failed or skipped');
select lives_ok($$ select public.job_finish((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000071'), 'failed', '{}', 'AI provider timeout') $$,
  'A failed run is recorded with a short error');
select is(public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000071', '2026-11-08') ->> 'reason', 'retry', 'NFR-09: a failed run can be retried');
select is((select attempts from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000071'), 2, 'The retry counts as attempt 2');
select lives_ok($$ select public.job_finish((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000071'), 'succeeded') $$, 'The retry succeeds');
select ok(not tests.due('weekly_run', '2026-11-09 05:10:00+11', 'b0000000-0000-4000-8000-000000000071'), 'NFR-09: once it succeeded, the catch-up skips it');

-- AT-10 and BR-13: briefings are due from 45 minutes before the business's slot, on its day.
select ok(tests.due('briefing', '2026-11-09 06:37:00+11', 'b0000000-0000-4000-8000-000000000071'), 'AT-10: the 7:00 am briefing is due at Mon 6:37 am');
select ok(not tests.due('briefing', '2026-11-09 06:10:00+11', 'b0000000-0000-4000-8000-000000000071'), '...not at 6:10 am');
select ok(not tests.due('briefing', '2026-11-10 06:37:00+11', 'b0000000-0000-4000-8000-000000000071'), '...and not on Tuesday');
select ok(not tests.due('briefing', '2026-11-09 06:37:00+11', 'b0000000-0000-4000-8000-000000000072'), 'FR-02: the 6:00 pm business is not briefed in the morning');
select ok(tests.due('briefing', '2026-11-09 17:37:00+11', 'b0000000-0000-4000-8000-000000000072'), 'FR-02: ...it is briefed from 5:15 pm');

-- NFR-10: the alert fires when the briefing has not gone 30 minutes after its slot.
select ok(tests.due('briefing_check', '2026-11-09 07:37:00+11', 'b0000000-0000-4000-8000-000000000071'), 'NFR-10: at 7:37 am an unsent briefing raises the alert');
select is(public.job_start('briefing', 'b0000000-0000-4000-8000-000000000071', '2026-11-09') ->> 'reason', 'new', 'The briefing run starts');
select lives_ok($$ select public.job_finish((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000071' and job = 'briefing'), 'succeeded') $$,
  'The briefing is sent');
select ok(not tests.due('briefing_check', '2026-11-09 07:37:00+11', 'b0000000-0000-4000-8000-000000000071'), 'NFR-10: no alert once it has gone');

-- FR-25 and BR-12: one noon nudge to the checker if drafts still wait.
insert into public.reminder_drafts (business_id, invoice_id, tone_used, subject_template, body_template, invoice_number_shown,
                                    amount_shown_cents, due_date_shown, source, fallback_reason)
select business_id, id, 'standard', 'Invoice {invoice_number}', 'Body', invoice_number, amount_due_cents, due_date, 'template', 'ai_disabled'
from public.invoices where invoice_number = 'M-1';
select ok(tests.due('nudge', '2026-11-09 12:07:00+11', 'b0000000-0000-4000-8000-000000000071'), 'FR-25: at noon, with drafts waiting, the checker is nudged');
select ok(not tests.due('nudge', '2026-11-09 12:07:00+11', 'b0000000-0000-4000-8000-000000000072'), 'No nudge for a business without a checker');

-- NFR-03 and PD-7: retention.
select is((public.job_retention_purge('2026-11-21 03:00:00+11') ->> 'businesses_deleted')::integer, 1, 'NFR-03: real data is deleted the day after its delete date');
select is((select reason from public.deletion_receipts where business_id = 'b0000000-0000-4000-8000-000000000073'), 'retention_date', 'A receipt records the reason');
select ok(exists (select 1 from public.businesses where id = 'b0000000-0000-4000-8000-000000000071'), 'Test businesses without a delete date are kept until the end of the course');
select set_eq($$ select user_id from public.job_orphan_users('2026-11-21 03:00:00+11') where user_id::text like 'a0000000-0000-4000-8000-00000000007%' $$,
  array['a0000000-0000-4000-8000-000000000073'::uuid], 'Sign-in accounts with no business for 14 days are listed for deletion; pending invitations are not');
select ok((public.job_retention_purge('2026-12-31 03:07:00+11') ->> 'businesses_deleted')::integer >= 2, 'PD-7: on Thu 31 Dec 2026 the purge deletes every business');
select is((select count(*)::integer from public.businesses), 0, 'PD-7: no business data is left');

select * from finish();
rollback;
