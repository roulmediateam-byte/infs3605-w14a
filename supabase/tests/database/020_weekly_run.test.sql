-- The weekly drafting run: AT-04 (who gets drafted), AT-05 (cool-down), AT-08 (safe to repeat),
-- BR-10 (last week's drafts replaced), BR-11 (pause), AI-03 (what the AI may see), AI-06 at save time.
-- The run is pinned to Sun 8 Nov 2026, 9:00 pm Sydney time, so the results never depend on today's date.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

create schema tests;
grant usage on schema tests to public;
create function tests.create_user(p_id uuid, p_email text) returns uuid language sql as
  $$ insert into auth.users (id, email) values (p_id, p_email) returning id $$;
create function tests.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function tests.run_id(p_period text) returns uuid language sql stable as
  $$ select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000020' and job = 'weekly_run' and period_key = p_period $$;
create function tests.invoice(p_number text) returns uuid language sql stable as
  $$ select id from public.invoices where business_id = 'b0000000-0000-4000-8000-000000000020' and invoice_number = p_number $$;

-- Fixture: one business, threshold 7 days, cool-down 6 days (D6); an active, a paused and a no-email client.
select tests.create_user('a0000000-0000-4000-8000-000000000020', 'owner.weekly@example.test');
insert into public.businesses (id, name, owner_name, reply_to_email)
values ('b0000000-0000-4000-8000-000000000020', 'Weekly Run Test (Test data)', 'Owner W', 'owner.weekly@example.test');
insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, accepted_at)
values ('b0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000020', 'owner.weekly@example.test', 'Owner W', 'owner', 'active', now());
insert into public.clients (id, business_id, name, email, paused, paused_at) values
  ('c0000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000020', 'Active Client (Test data)', 'active@client.example', false, null),
  ('c0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000020', 'Paused Client (Test data)', 'paused@client.example', true, now()),
  ('c0000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000020', 'No Email Client (Test data)', null, false, null);
insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents) values
  ('b0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000021', 'W-06', '2026-10-01', '2026-11-02', 60000),
  ('b0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000021', 'W-07', '2026-10-01', '2026-11-01', 70000),
  ('b0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000021', 'W-30', '2026-09-01', '2026-10-09', 300000),
  ('b0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000022', 'W-P', '2026-09-01', '2026-10-09', 50000),
  ('b0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000023', 'W-N', '2026-09-01', '2026-10-09', 40000),
  ('b0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000021', 'W-C', '2026-09-01', '2026-10-01', 90000);
-- W-C was reminded on Mon 2 Nov 2026 at 10:00 am Sydney time, 6 days 11 hours before the run.
update public.invoices set last_reminder_sent_at = '2026-11-02 10:00:00+11', reminders_sent_count = 1 where invoice_number = 'W-C';

-- Run 1: Sun 8 Nov 2026.
select is((public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000020', '2026-11-08', 'schedule') ->> 'proceed')::boolean, true,
  'The weekly run for Sun 8 Nov starts');
create temporary table planned as
  select * from public.job_plan_weekly_run(tests.run_id('2026-11-08'), '2026-11-08 21:00:00+11');

select set_eq('select invoice_id from planned', array[tests.invoice('W-07'), tests.invoice('W-30'), tests.invoice('W-C')],
  'AT-04 and AT-05: the 7- and 30-day invoices are drafted, and so is the invoice reminded 6 days ago; the 6-day one is not');
select is((select count(*)::integer from planned where invoice_id = tests.invoice('W-P')), 0, 'AT-04 and BR-11: the paused client gets no draft');
select is((select count(*)::integer from public.activity_log
           where run_id = tests.run_id('2026-11-08') and action = 'draft_flagged' and invoice_id = tests.invoice('W-N')), 1,
  'AT-04 and FR-10: the client without an email is flagged instead');
select is((select days_overdue from planned where invoice_id = tests.invoice('W-07')), 7, 'BR-06: days overdue counted in Sydney dates');
select is((select reminders_sent_before from planned where invoice_id = tests.invoice('W-C')), 1, 'AI-08: the AI is told a reminder went before');
select is((select array_agg(k order by k) from jsonb_object_keys((select to_jsonb(p) from planned p limit 1)) as k),
  array['days_overdue', 'example_reminder', 'invoice_id', 'reminders_sent_before', 'style_note', 'tone'],
  'AI-03: the AI request has no client name, email, amount or invoice number');

select throws_like(
  $$ select public.job_save_draft(tests.run_id('2026-11-08'), tests.invoice('W-07'), 'Pay now', 'Please pay $700 now.', 'ai', 'reminder-draft/v1', 'claude-haiku-5-5', 1::smallint) $$,
  '%failed the checks%', 'AI-06: a reply that fails the checks cannot be saved');

select is((select count(*)::integer from planned p
           cross join lateral (select * from public.job_get_templates() t where t.tone = p.tone) t
           where public.job_save_draft(tests.run_id('2026-11-08'), p.invoice_id, t.subject, t.body, 'template', t.version, null, 0::smallint, 'ai_disabled') is not null),
  3, 'FR-07: one draft is saved for each planned invoice');
select is((select count(*)::integer from public.reminder_drafts
           where business_id = 'b0000000-0000-4000-8000-000000000020' and status = 'waiting' and amount_shown_cents = 300000
             and invoice_number_shown = 'W-30' and due_date_shown = '2026-10-09'),
  1, 'FR-08 and BR-05: the draft copies the amount, number and due date from the record');
select lives_ok($$ select public.job_finish(tests.run_id('2026-11-08'), 'succeeded', '{"drafts_created":3}') $$, 'The run finishes');

-- AT-08 and NFR-09: repeating the run duplicates nothing.
select is(public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000020', '2026-11-08', 'schedule') ->> 'reason', 'already_succeeded',
  'NFR-09: a second scheduled start for the same week does nothing');
select is(public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000020', '2026-11-08', 'manual', null, true) ->> 'reason', 'forced',
  'NFR-09: the team can force a rerun by hand');
select is((select count(*)::integer from public.job_plan_weekly_run(tests.run_id('2026-11-08'), '2026-11-08 21:30:00+11')), 0,
  'AT-08: the rerun finds nothing new to draft');
select is((select count(*)::integer from public.reminder_drafts where business_id = 'b0000000-0000-4000-8000-000000000020' and status = 'waiting'), 3,
  'AT-08: no duplicate drafts');
select is(public.job_save_draft(tests.run_id('2026-11-08'), tests.invoice('W-07'), t.subject, t.body, 'template', t.version, null, 0::smallint, 'ai_disabled'), null,
  'AT-08: saving the same invoice again is ignored') from public.job_get_templates() t where t.tone = 'standard';
select lives_ok($$ select public.job_finish(tests.run_id('2026-11-08'), 'succeeded') $$, 'The rerun finishes');

-- AT-05 and BR-04 with the cool-down of decision D6.
update public.invoices set last_reminder_sent_at = '2026-11-10 10:00:00+11' where invoice_number = 'W-06';
select is(private.ineligibility(tests.invoice('W-06'), '2026-11-15 21:00:00+11'), 'cooldown',
  'AT-05: a reminder confirmed on Tuesday is not drafted again 5 days later (BR-04)');
select is(private.ineligibility(tests.invoice('W-06'), '2026-11-22 21:00:00+11'), null, 'AT-05: it is drafted the Sunday after');
update public.businesses set cooldown_days = 7 where id = 'b0000000-0000-4000-8000-000000000020';
update public.invoices set last_reminder_sent_at = '2026-11-09 10:00:00+11' where invoice_number = 'W-06';
select is(private.ineligibility(tests.invoice('W-06'), '2026-11-15 21:00:00+11'), 'cooldown',
  'D6: with the v0.1 cool-down of 7 days, a Monday send skips the next Sunday, which makes reminders fortnightly');
update public.businesses set cooldown_days = 6 where id = 'b0000000-0000-4000-8000-000000000020';

-- BR-10: next week's run replaces last week's waiting drafts.
select is((public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000020', '2026-11-15', 'schedule') ->> 'proceed')::boolean, true,
  'The run for Sun 15 Nov starts');
create temporary table planned_next as
  select * from public.job_plan_weekly_run(tests.run_id('2026-11-15'), '2026-11-15 21:00:00+11');
select is((select count(*)::integer from public.reminder_drafts
           where business_id = 'b0000000-0000-4000-8000-000000000020' and status = 'cancelled' and cancel_reason = 'superseded'), 3,
  'BR-10: last week''s waiting drafts are cancelled as superseded');
select ok((select count(*) from planned_next where invoice_id in (tests.invoice('W-07'), tests.invoice('W-30'))) = 2,
  'BR-10: those invoices are drafted again with the new days overdue');

-- BR-11: pausing a client cancels its live drafts.
select ok(public.job_save_draft(tests.run_id('2026-11-15'), tests.invoice('W-30'), t.subject, t.body, 'template', t.version, null, 0::smallint, 'ai_disabled') is not null,
  'A fresh draft is saved for W-30') from public.job_get_templates() t where t.tone = 'standard';
select tests.as_user('a0000000-0000-4000-8000-000000000020');
select is((public.set_client_paused('c0000000-0000-4000-8000-000000000021', true) ->> 'drafts_cancelled')::integer, 1,
  'BR-11 and FR-26: pausing the client cancels its waiting draft');

select * from finish();
rollback;
