-- Permissions and privacy: AT-09 (checker limits), NFR-05 (server-side checks and isolation between businesses),
-- team admins on test data only, FR-21 (append-only log), FR-01 (invitations), FR-03 (export and delete).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(29);

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
create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;
create function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

-- Fixture: business X (owner, checker, team admin) and business Y (another owner); one outsider.
select tests.create_user('a0000000-0000-4000-8000-000000000051', 'owner.x@example.test');
select tests.create_user('a0000000-0000-4000-8000-000000000052', 'checker.x@example.test');
select tests.create_user('a0000000-0000-4000-8000-000000000053', 'admin@team.example.test');
select tests.create_user('a0000000-0000-4000-8000-000000000054', 'owner.y@example.test');
select tests.create_user('a0000000-0000-4000-8000-000000000055', 'outsider@example.test');
insert into public.businesses (id, name, owner_name, reply_to_email) values
  ('b0000000-0000-4000-8000-000000000051', 'Business X (Test data)', 'Owner X', 'owner.x@example.test'),
  ('b0000000-0000-4000-8000-000000000052', 'Business Y (Test data)', 'Owner Y', 'owner.y@example.test');
insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, accepted_at) values
  ('b0000000-0000-4000-8000-000000000051', 'a0000000-0000-4000-8000-000000000051', 'owner.x@example.test', 'Owner X', 'owner', 'active', now()),
  ('b0000000-0000-4000-8000-000000000051', 'a0000000-0000-4000-8000-000000000052', 'checker.x@example.test', 'Checker X', 'checker', 'active', now()),
  ('b0000000-0000-4000-8000-000000000051', 'a0000000-0000-4000-8000-000000000053', 'admin@team.example.test', 'Team admin', 'admin', 'active', now()),
  ('b0000000-0000-4000-8000-000000000052', 'a0000000-0000-4000-8000-000000000054', 'owner.y@example.test', 'Owner Y', 'owner', 'active', now());
insert into public.clients (id, business_id, name, email) values
  ('c0000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000051', 'Client of X (Test data)', 'client@x.example'),
  ('c0000000-0000-4000-8000-000000000052', 'b0000000-0000-4000-8000-000000000052', 'Client of Y (Test data)', 'client@y.example');
insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents) values
  ('b0000000-0000-4000-8000-000000000051', 'c0000000-0000-4000-8000-000000000051', 'X-1', '2026-09-01', '2026-10-01', 100000),
  ('b0000000-0000-4000-8000-000000000052', 'c0000000-0000-4000-8000-000000000052', 'Y-1', '2026-09-01', '2026-10-01', 200000);
select public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000051', '2026-11-08', 'manual');
select public.job_plan_weekly_run((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000051'), '2026-11-08 21:00:00+11');
select public.job_save_draft((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000051'),
  (select id from public.invoices where invoice_number = 'X-1'), t.subject, t.body, 'template', t.version, null, 0::smallint, 'ai_disabled')
from public.job_get_templates() t where t.tone = 'standard';

select set_config('tests.x_draft', (select id::text from public.reminder_drafts where business_id = 'b0000000-0000-4000-8000-000000000051'), true);

-- AT-09: the checker cannot make relationship or settings decisions.
select tests.as_user('a0000000-0000-4000-8000-000000000052');
select throws_ok($$ select public.set_client_tone('c0000000-0000-4000-8000-000000000051', 'firm') $$, '42501', null, 'AT-09: the checker cannot change a tone');
select throws_ok($$ select public.update_settings('b0000000-0000-4000-8000-000000000051', '{"overdue_threshold_days": 14}') $$, '42501', null,
  'AT-09: the checker cannot change a setting');
select throws_ok($$ select public.set_client_paused('c0000000-0000-4000-8000-000000000051', true) $$, '42501', null, 'The checker cannot pause a client');
select throws_ok($$ select public.export_business_data('b0000000-0000-4000-8000-000000000051') $$, '42501', null, 'The checker cannot export everything');
select lives_ok($$ select public.update_client_contact('c0000000-0000-4000-8000-000000000051', 'accounts@x.example') $$,
  'The checker can fix a client''s email');

-- NFR-05: one business never sees or touches another's data.
select tests.as_user('a0000000-0000-4000-8000-000000000054');
select is((select count(*)::integer from public.invoices where business_id = 'b0000000-0000-4000-8000-000000000051'), 0,
  'NFR-05: an owner cannot read another business''s invoices');
select is((select count(*)::integer from public.activity_log where business_id = 'b0000000-0000-4000-8000-000000000051'), 0,
  'NFR-05: ...or its activity log');
select throws_ok($$ select public.approve_draft(current_setting('tests.x_draft')::uuid) $$, '42501', null,
  'NFR-05: an owner cannot approve another business''s draft, even knowing its id');
select throws_ok($$ select public.get_briefing('b0000000-0000-4000-8000-000000000051') $$, '42501', null,
  'NFR-05: another business''s briefing is refused');
select throws_ok($$ insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents)
                   values ('b0000000-0000-4000-8000-000000000052', 'c0000000-0000-4000-8000-000000000052', 'Y-2', '2026-09-01', '2026-10-01', 100) $$,
  '42501', null, 'Signed-in users cannot write to tables directly, even their own');

-- Anonymous visitors see nothing; signed-in people without a business see nothing.
select tests.as_anon();
select throws_ok($$ select count(*) from public.invoices $$, '42501', null, 'anon cannot read invoices');
select tests.as_user('a0000000-0000-4000-8000-000000000055');
select is(public.accept_invitations(), '[]'::jsonb, 'FR-01: someone uninvited has no business ("Ask the owner to invite you")');
select is((select count(*)::integer from public.businesses), 0, 'FR-01: ...and can read nothing');

-- Team admins: read and import test data, never approve, and lose access when a business holds real data.
select tests.as_user('a0000000-0000-4000-8000-000000000053');
select is((select count(*)::integer from public.invoices where business_id = 'b0000000-0000-4000-8000-000000000051'), 1,
  'A team admin can read a test business''s invoices');
select throws_ok($$ select public.approve_draft((select id from public.reminder_drafts where business_id = 'b0000000-0000-4000-8000-000000000051')) $$,
  '42501', null, 'A team admin can never approve a draft');
reset role;
update public.businesses set is_test_data = false, real_data_agreed_at = now(), delete_after = '2026-11-26'
 where id = 'b0000000-0000-4000-8000-000000000051';
select tests.as_user('a0000000-0000-4000-8000-000000000053');
select is((select count(*)::integer from public.invoices where business_id = 'b0000000-0000-4000-8000-000000000051'), 0,
  'Once a business holds real data (D7), the team admin can no longer read it');
reset role;
select throws_like($$ insert into public.memberships (business_id, invited_email, display_name, role)
                      values ('b0000000-0000-4000-8000-000000000051', 'admin2@team.example.test', 'Admin 2', 'admin') $$,
  '%test businesses only%', 'A team admin cannot be added to a business with real data');
select throws_like($$ update public.businesses set delete_after = '2027-01-31' where id = 'b0000000-0000-4000-8000-000000000051' $$,
  '%delete_by_end_of_course%', 'NFR-03: real data cannot be kept past Thu 31 Dec 2026');

-- FR-21: the activity log is append-only, for everyone.
select throws_ok($$ update public.activity_log set details = '{}' where business_id = 'b0000000-0000-4000-8000-000000000051' $$, '42501', null,
  'FR-21: log entries cannot be edited, even by the database owner');
select throws_ok($$ delete from public.activity_log where business_id = 'b0000000-0000-4000-8000-000000000051' $$, '42501', null,
  'FR-21: log entries cannot be deleted, even by the database owner');
select tests.as_service();
select throws_ok($$ delete from public.activity_log $$, '42501', null, 'FR-21: the service role cannot delete log entries');

-- FR-25: the owner invites one checker; the invitation is accepted at first sign-in.
select tests.as_user('a0000000-0000-4000-8000-000000000054');
select ok(public.invite_checker('b0000000-0000-4000-8000-000000000052', 'new.checker@example.test', 'New Checker') is not null,
  'FR-25: the owner invites a checker');
select throws_ok($$ select public.invite_checker('b0000000-0000-4000-8000-000000000052', 'second@example.test', 'Second') $$, '23505', null,
  'Only one named checker at a time');
reset role;
select tests.create_user('a0000000-0000-4000-8000-000000000056', 'new.checker@example.test');
select tests.as_user('a0000000-0000-4000-8000-000000000056');
select is(public.accept_invitations() -> 0 ->> 'role', 'checker', 'FR-01: the invited checker joins at first sign-in');

-- FR-03: export and delete.
select tests.as_user('a0000000-0000-4000-8000-000000000054');
select ok(public.export_business_data('b0000000-0000-4000-8000-000000000052') ?& array['business', 'clients', 'invoices', 'activity_log'],
  'FR-03: the owner exports every record');
select throws_ok($$ select public.delete_business('b0000000-0000-4000-8000-000000000052', 'Business Why') $$, '22023', null,
  'FR-03: deleting needs the business name typed exactly');
select is(public.delete_business('b0000000-0000-4000-8000-000000000052', ' business y (test data) ') ->> 'deleted', 'true',
  'FR-03: the owner deletes the business after typing its name');
reset role;
select is((select array[count(*) filter (where business_id = 'b0000000-0000-4000-8000-000000000052'),
                        count(*) filter (where business_id = 'b0000000-0000-4000-8000-000000000051')] from public.activity_log)::text,
  (select array[0, (select count(*) from public.activity_log where business_id = 'b0000000-0000-4000-8000-000000000051')])::text,
  'FR-03: the deleted business''s log goes with it; other businesses are untouched');
select is((select (row_counts ->> 'invoices')::integer from public.deletion_receipts where business_id = 'b0000000-0000-4000-8000-000000000052'), 1,
  'NFR-03: a receipt records what was deleted, with counts only');

select * from finish();
rollback;
