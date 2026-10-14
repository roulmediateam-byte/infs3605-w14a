-- The Monday briefing: FR-11 to FR-13, AT-06 (same numbers in the email and the app), BR-06 and BR-07,
-- Needs attention, paused clients and the call-first flag (FR-33). Pinned to Mon 9 Nov 2026, 6:30 am Sydney time.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

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
create function tests.briefing() returns jsonb language sql stable as
  $$ select private.build_briefing('b0000000-0000-4000-8000-000000000060', '2026-11-09 06:30:00+11') $$;

select tests.create_user('a0000000-0000-4000-8000-000000000060', 'owner.brief@example.test');
select tests.create_user('a0000000-0000-4000-8000-000000000061', 'checker.brief@example.test');
select tests.create_user('a0000000-0000-4000-8000-000000000062', 'outsider.brief@example.test');
insert into public.businesses (id, name, owner_name, reply_to_email)
values ('b0000000-0000-4000-8000-000000000060', 'Briefing Test (Test data)', 'Owner B', 'accounts@brief.example');
insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, accepted_at) values
  ('b0000000-0000-4000-8000-000000000060', 'a0000000-0000-4000-8000-000000000060', 'owner.brief@example.test', 'Owner B', 'owner', 'active', now()),
  ('b0000000-0000-4000-8000-000000000060', 'a0000000-0000-4000-8000-000000000061', 'checker.brief@example.test', 'Checker B', 'checker', 'active', now());
insert into public.clients (id, business_id, name, email, paused, paused_at) values
  ('c0000000-0000-4000-8000-000000000061', 'b0000000-0000-4000-8000-000000000060', 'Main Client (Test data)', 'main@client.example', false, null),
  ('c0000000-0000-4000-8000-000000000062', 'b0000000-0000-4000-8000-000000000060', 'Paused Client (Test data)', 'paused@client.example', true, now()),
  ('c0000000-0000-4000-8000-000000000063', 'b0000000-0000-4000-8000-000000000060', 'No Email Client (Test data)', null, false, null);
-- Open: $29,000.00. Overdue on Mon 9 Nov: B-1, B-2, B-3, B-7, B-8 = $26,300.00. Due in the next 7 days: B-4, B-5 = $1,600.00.
insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents, status, paid_date) values
  ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000061', 'B-1', '2026-09-01', '2026-10-10', 500000, 'open', null),
  ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000061', 'B-2', '2026-09-01', '2026-10-30', 500000, 'open', null),
  ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000061', 'B-3', '2026-09-01', '2026-11-01', 1200000, 'open', null),
  ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000061', 'B-4', '2026-09-01', '2026-11-09', 70000, 'open', null),
  ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000061', 'B-5', '2026-09-01', '2026-11-16', 90000, 'open', null),
  ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000061', 'B-6', '2026-09-01', '2026-11-17', 110000, 'open', null),
  ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000062', 'B-7', '2026-09-01', '2026-10-20', 250000, 'open', null),
  ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000063', 'B-8', '2026-09-01', '2026-10-25', 180000, 'open', null),
  ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000061', 'B-9', '2026-09-01', '2026-10-01', 300000, 'paid', '2026-10-05');
insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents, status, closed_at, close_reason)
values ('b0000000-0000-4000-8000-000000000060', 'c0000000-0000-4000-8000-000000000061', 'B-10', '2026-09-01', '2026-10-01', 400000, 'closed', now(), 'not_in_latest_import');

-- Sunday's run drafts B-3, B-1 and B-2 (B-7 is paused, B-8 has no email).
select public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000060', '2026-11-08', 'schedule');
select public.job_save_draft(r.id, p.invoice_id, t.subject, t.body, 'template', t.version, null, 0::smallint, 'ai_disabled')
from public.job_runs r
cross join lateral public.job_plan_weekly_run(r.id, '2026-11-08 21:00:00+11') p
cross join lateral (select * from public.job_get_templates() t where t.tone = p.tone) t
where r.business_id = 'b0000000-0000-4000-8000-000000000060';
-- An import on Monday morning changed B-2's amount while its draft waited.
insert into public.attention_items (business_id, invoice_id, kind, detail)
select business_id, id, 'amount_changed', '{"from_cents": 520000, "to_cents": 500000}' from public.invoices where invoice_number = 'B-2';

select is((tests.briefing() -> 'totals' ->> 'owed_cents')::bigint, 2900000::bigint, 'FR-11: total owed counts every open invoice, paid and closed ones excluded');
select is((tests.briefing() -> 'totals' ->> 'overdue_cents')::bigint, 2630000::bigint, 'BR-06: total overdue counts open invoices past their due date');
select is(array[(tests.briefing() -> 'totals' ->> 'open_count')::integer, (tests.briefing() -> 'totals' ->> 'overdue_count')::integer], array[8, 5],
  'FR-11: 8 open invoices, 5 overdue');
select is((tests.briefing() -> 'totals' ->> 'due_this_week_cents')::bigint, 160000::bigint, 'BR-06: due this week means due in the next 7 days');
select is((select sum((x ->> 'amount_due_cents')::bigint) from jsonb_array_elements(tests.briefing() -> 'overdue') x),
  (tests.briefing() -> 'totals' ->> 'overdue_cents')::numeric, 'FR-12: the overdue total equals the sum of the overdue list');
select is((select array_agg(x ->> 'invoice_number' order by n) from jsonb_array_elements(tests.briefing() -> 'overdue') with ordinality as t(x, n)),
  array['B-3', 'B-1', 'B-2', 'B-7', 'B-8'], 'BR-07: largest first; equal amounts by days overdue, most first');
select is((select (x ->> 'days_overdue')::integer from jsonb_array_elements(tests.briefing() -> 'overdue') x where x ->> 'invoice_number' = 'B-1'), 30,
  'FR-11: each overdue invoice shows its days overdue');
select is((tests.briefing() ->> 'drafts_waiting')::integer, 3, 'FR-11: drafts waiting');
select is((tests.briefing() ->> 'first_draft_id')::uuid,
  (select d.id from public.reminder_drafts d join public.invoices i on i.id = d.invoice_id where i.invoice_number = 'B-3'),
  'FR-11: "Review drafts" opens the largest draft first');
select is((select array_agg((x ->> 'kind') || ':' || (x ->> 'invoice_number') order by n) from jsonb_array_elements(tests.briefing() -> 'needs_attention') with ordinality as t(x, n)),
  array['amount_changed:B-2', 'email_missing:B-8'], 'FR-10 and BR-05: Needs attention lists the changed amount and the missing email, largest first');
select is(tests.briefing() -> 'paused_clients',
  '[{"client_id": "c0000000-0000-4000-8000-000000000062", "name": "Paused Client (Test data)", "open_invoices": 1, "overdue_cents": 250000}]'::jsonb,
  'FR-26: paused clients are listed with what they owe');
select is((tests.briefing() -> 'business' ->> 'is_test_data')::boolean, true, 'RI-9: the briefing says when it shows test data');
update public.businesses set call_first_threshold_cents = 1000000 where id = 'b0000000-0000-4000-8000-000000000060';
select is((select array_agg(x ->> 'invoice_number') from jsonb_array_elements(tests.briefing() -> 'overdue') x where (x ->> 'call_first')::boolean),
  array['B-3'], 'FR-33: invoices at or above the owner''s amount suggest a call first');

-- AT-06 and FR-13: the Home screen and the email are built by the same function.
select tests.as_user('a0000000-0000-4000-8000-000000000060');
select set_config('tests.app_briefing', public.get_briefing('b0000000-0000-4000-8000-000000000060', '2026-11-09 06:30:00+11')::text, true) is not null;
reset role;
select is(public.job_get_briefing('b0000000-0000-4000-8000-000000000060', '2026-11-09 06:30:00+11') - 'recipient' - 'reply_to',
  current_setting('tests.app_briefing')::jsonb, 'AT-06: the email shows exactly what the Home screen shows');
select is(public.job_get_briefing('b0000000-0000-4000-8000-000000000060', '2026-11-09 06:30:00+11') -> 'recipient' ->> 'email', 'owner.brief@example.test',
  'FR-11: the briefing goes to the owner');
select tests.as_user('a0000000-0000-4000-8000-000000000061');
select lives_ok($$ select public.get_briefing('b0000000-0000-4000-8000-000000000060') $$, 'The checker sees the briefing too');
select tests.as_user('a0000000-0000-4000-8000-000000000062');
select throws_ok($$ select public.get_briefing('b0000000-0000-4000-8000-000000000060') $$, '42501', null, 'Someone outside the business cannot');

select * from finish();
rollback;
