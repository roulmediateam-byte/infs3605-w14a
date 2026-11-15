-- Sign-up for the demonstration build (migration 8): each demonstration account gets its own copy of the seed's
-- Test data business (RI-9), safely repeated (NFR-09), isolated from every other business (NFR-05), never able to
-- claim an invitation (FR-01), within caps, and closed after Wed 25 Nov 2026 (PD-7).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

create schema tests;
grant usage on schema tests to public;
create function tests.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function tests.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Fixture. Demonstration accounts carry app_metadata demo_sign_up, as the Auth admin API sets it; C and E don't.
insert into auth.users (id, email, raw_app_meta_data, created_at) values
  ('a0000000-0000-4000-8000-000000000081', 'sam@demo.test', '{"provider": "email", "demo_sign_up": true}', now()),
  ('a0000000-0000-4000-8000-000000000082', 'jo@demo.test', '{"provider": "email", "demo_sign_up": true}', now()),
  ('a0000000-0000-4000-8000-000000000083', 'plain.person@example.test', '{"provider": "email"}', now()),
  ('a0000000-0000-4000-8000-000000000084', 'invited.person@example.test', '{"provider": "email", "demo_sign_up": true}', now()),
  ('a0000000-0000-4000-8000-000000000085', 'invited.other@example.test', '{"provider": "email"}', now()),
  ('a0000000-0000-4000-8000-000000000086', 'many.copies@demo.test', '{"provider": "email", "demo_sign_up": true}', now());
insert into public.businesses (id, name, owner_name, reply_to_email)
values ('b0000000-0000-4000-8000-000000000081', 'Invited Business (Test data)', 'Owner X', 'owner.x@example.test');
insert into public.memberships (business_id, invited_email, display_name, role, status) values
  ('b0000000-0000-4000-8000-000000000081', 'invited.other@example.test', 'Owner X', 'owner', 'invited'),
  ('b0000000-0000-4000-8000-000000000081', 'invited.person@example.test', 'Checker X', 'checker', 'invited');

-- A demonstration account's business: the seed's, with the account as its active owner.
create temp table made_a as select public.job_demo_provision('a0000000-0000-4000-8000-000000000081') as r;
create temp table biz_a as select (r ->> 'business_id')::uuid as id from made_a;
select is((select r ->> 'outcome' from made_a), 'created', 'A demonstration account gets a business of its own');
select is(
  (select b.name || ' | ' || b.is_test_data || ' | ' || b.delete_after from public.businesses b join biz_a on b.id = biz_a.id),
  'Harbour Line Electrical (Test data) | true | 2026-11-25',
  'It is the seed''s Test data business, deleted by Thu 26 Nov 2026 (RI-9, PD-7)'
);
select is(
  (select m.role || ' ' || m.status from public.memberships m join biz_a on m.business_id = biz_a.id where m.user_id = 'a0000000-0000-4000-8000-000000000081'),
  'owner active',
  'The account is its active owner, with nothing to accept'
);
select is((select count(*)::int from public.memberships m join biz_a on m.business_id = biz_a.id), 1,
  'It has no other member and no invitation, so no shared address can join it');
select is(
  (select count(*)::int || ' ' || sum(i.amount_due_cents) || ' ' || sum(i.amount_due_cents) filter (where i.due_date < private.sydney_date(now()))
   from public.invoices i join biz_a on i.business_id = biz_a.id where i.status = 'open'),
  '12 6244000 4279000',
  '12 open invoices: A$62,440.00 owed and A$42,790.00 overdue, as in the seed'
);
select is(
  (select string_agg(i.invoice_number || ':' || d.source, ',' order by i.invoice_number)
   from public.reminder_drafts d join public.invoices i on i.id = d.invoice_id join biz_a on d.business_id = biz_a.id
   where d.status = 'waiting'),
  '1043:template,1051:template,1056:template,1062:template,1066:template',
  '5 drafts wait for the owner, from the fallback templates, as in the seed'
);

-- Safe to repeat (NFR-09), and one business per account.
select is((select public.job_demo_provision('a0000000-0000-4000-8000-000000000081') ->> 'business_id'), (select id::text from biz_a),
  'Asking again returns the same business (NFR-09)');
select is((select count(*)::int from public.memberships where user_id = 'a0000000-0000-4000-8000-000000000081'), 1,
  'and makes no second one');
create temp table biz_b as select (public.job_demo_provision('a0000000-0000-4000-8000-000000000082') ->> 'business_id')::uuid as id;
select isnt((select id from biz_b), (select id from biz_a), 'Each demonstration account gets a business of its own');

-- Signed in, an account sees only its own business (NFR-05).
select set_config('tests.biz_a', (select id::text from biz_a), true);
select tests.as_user('a0000000-0000-4000-8000-000000000081');
select is((select string_agg(b.id::text, ',') from public.businesses b), current_setting('tests.biz_a'),
  'Signed in, the account sees only its own business (NFR-05)');
select is((select count(*)::int from public.invoices), 12, 'and only its own 12 invoices');
reset role;
select tests.as_nobody();

-- Nobody checked a demonstration account's address, so it can't claim an invitation (FR-01).
select tests.as_user('a0000000-0000-4000-8000-000000000084');
select is(public.accept_invitations(), '[]'::jsonb, 'A demonstration account can''t claim an invitation sent to its address');
reset role;
select tests.as_nobody();
select is((select m.status::text from public.memberships m where m.invited_email = 'invited.person@example.test'), 'invited',
  'and the invitation still waits for its real owner');
select tests.as_user('a0000000-0000-4000-8000-000000000085');
select is((select public.accept_invitations() -> 0 ->> 'role'), 'owner', 'An ordinary account still accepts its invitation (FR-01)');
reset role;
select tests.as_nobody();

-- Only demonstration accounts get a business this way, at most 10 times each.
select is(public.job_demo_provision('a0000000-0000-4000-8000-000000000083') ->> 'outcome', 'not_demo',
  'An ordinary account gets no business from the demonstration sign-up');
select is((select count(*)::int from public.memberships where user_id = 'a0000000-0000-4000-8000-000000000083'), 0, 'and nothing is made for it');
select is(public.job_demo_provision('a0000000-0000-4000-8000-000000000099') ->> 'outcome', 'no_account', 'An unknown account gets nothing');
insert into private.demo_provisions (user_id, business_id)
select 'a0000000-0000-4000-8000-000000000086', gen_random_uuid() from generate_series(1, 10);
select is(public.job_demo_provision('a0000000-0000-4000-8000-000000000086') ->> 'outcome', 'limit',
  'One account gets at most 10 copies, even if it deletes them');

-- When sign-ups are open.
select is(public.job_demo_sign_up_room('2026-10-28 14:00+11') ->> 'reason', 'open', 'Sign-ups are open for the Week 7 demonstration');
select is(public.job_demo_sign_up_room('2026-11-26 00:30+11') ->> 'reason', 'closed',
  'Sign-ups close after Wed 25 Nov 2026, as Test data is deleted by Thu 26 Nov (PD-7)');
insert into auth.users (id, email, raw_app_meta_data, created_at)
select gen_random_uuid(), 'burst' || n || '@demo.test', '{"demo_sign_up": true}', timestamptz '2026-10-28 13:30+11'
from generate_series(1, 60) n;
select is(public.job_demo_sign_up_room('2026-10-28 14:00+11') ->> 'reason', 'busy', 'At most 60 new accounts an hour');
insert into auth.users (id, email, raw_app_meta_data, created_at)
select gen_random_uuid(), 'earlier' || n || '@demo.test', '{"demo_sign_up": true}', timestamptz '2026-10-20 09:00+11'
from generate_series(1, 300) n;
select is(public.job_demo_sign_up_room('2026-10-29 14:00+11') ->> 'reason', 'full', 'At most 300 demonstration accounts in all');

-- Only the service role (the Edge Function) can make one.
select ok(
  not has_function_privilege('authenticated', 'public.job_demo_provision(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.job_demo_provision(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.job_demo_provision(uuid)', 'execute'),
  'Only the service role can make a demonstration business'
);
select ok(not has_table_privilege('authenticated', 'private.demo_provisions', 'select'), 'Signed-in people can''t read the demonstration counts');

select * from finish();
rollback;
