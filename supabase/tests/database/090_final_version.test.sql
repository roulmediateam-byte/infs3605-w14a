-- The final version (migration 9): plans with the 3-month intro, Stripe test-mode checkouts, joining with a code,
-- promises to pay, tone presets, firmer by itself, and setting up a business with sample Test data.
-- These features have no PRD IDs yet, so the tests are named by feature.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(51);

create schema tests;
grant usage on schema tests to public;
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
create function tests.biz(p_key text) returns uuid language sql stable as
  $$ select current_setting('tests.' || p_key)::uuid $$;
create function tests.inv(p_number text) returns uuid language sql stable security definer set search_path = '' as
  $$ select i.id from public.invoices i where i.business_id = current_setting('tests.biz_a')::uuid and i.invoice_number = p_number $$;
grant execute on all functions in schema tests to public;

insert into auth.users (id, email, raw_app_meta_data) values
  ('a0000000-0000-4000-8000-000000000091', 'owner@demo.test', '{"demo_sign_up": true}'),
  ('a0000000-0000-4000-8000-000000000092', 'joiner@demo.test', '{"demo_sign_up": true}'),
  ('a0000000-0000-4000-8000-000000000093', 'pat@plain-owner.example', '{}'),
  ('a0000000-0000-4000-8000-000000000094', 'invited.checker@example.test', '{}'),
  ('a0000000-0000-4000-8000-000000000095', 'outsider@example.test', '{}');
select set_config('tests.biz_a', (public.job_demo_provision('a0000000-0000-4000-8000-000000000091') ->> 'business_id'), false);
select set_config('tests.today', private.sydney_date(now())::text, false);

-- ---------------------------------------------------------------------------------------------
-- Plans: prices and dates
-- ---------------------------------------------------------------------------------------------
select is((select string_agg((p ->> 'id') || ':' || (p ->> 'price_cents') || ':' || (p ->> 'intro_price_cents'), ',')
           from jsonb_array_elements(private.plan_catalogue() -> 'plans') p),
  'solo:2900:580,crew:4900:980,company:7900:1580',
  'Plans: Solo A$29, Crew A$49 and Company A$79 a month, each 80% off for the first 3 months');
select is(array[private.next_charge_on('2026-11-13', '2026-11-13'), private.next_charge_on('2026-11-13', '2026-12-13'),
                private.next_charge_on('2027-01-31', '2027-02-28')],
  array['2026-12-13', '2027-01-13', '2027-03-31']::date[],
  'Plans: charges fall monthly on the start day, or the last day of a shorter month');
select is(array[private.intro_months_left('2027-02-13', '2026-11-13'), private.intro_months_left('2027-02-13', '2026-12-20'),
                private.intro_months_left('2027-02-13', '2027-02-13')], array[3, 2, 0],
  'Plans: a card checkout gets only the intro months still left');
select is((select plan || ' ' || (intro_ends_on = (started_on + interval '3 months')::date) || ' ' || payment_mode
           from public.subscriptions where business_id = tests.biz('biz_a')),
  'crew true none', 'Plans: a demonstration copy starts on Crew''s 3-month intro, with nothing charged');

select tests.as_user('a0000000-0000-4000-8000-000000000091');
create temp table bill as select public.get_billing(tests.biz('biz_a')) as b;
grant select on bill to public;
select is((select (b ->> 'phase') || ' ' || (b ->> 'price_now_cents') || ' ' || (b ->> 'next_charge_cents') || ' ' || (b ->> 'next_charge_on') from bill),
  'intro 980 980 ' || ((current_setting('tests.today')::date + interval '1 month')::date)::text,
  'Plans: the owner sees the intro price now and the date and amount of the next charge');
select is((select (b -> 'usage' ->> 'active_clients') || ' of ' || (b -> 'usage' ->> 'clients_limit') || ' ' || (b ->> 'over_limit') from bill),
  '6 of 100 false', 'Plans: usage counts clients with open invoices against the plan''s limit');
select is((public.choose_plan(tests.biz('biz_a'), 'solo') ->> 'price_now_cents'), '580', 'Plans: moving to Solo keeps the intro');
select throws_ok($$ select public.invite_checker(tests.biz('biz_a'), 'checker@example.test', 'Casey Checker') $$, '22023',
  'Solo is for one person. Move to Crew to add a checker.', 'Plans: Solo allows no checker');
select is((public.choose_plan(tests.biz('biz_a'), 'crew') ->> 'plan'), 'crew', 'Plans: the owner moves back to Crew');

-- ---------------------------------------------------------------------------------------------
-- Joining with a code
-- ---------------------------------------------------------------------------------------------
select set_config('tests.membership', public.invite_checker(tests.biz('biz_a'), 'checker@example.test', 'Casey Checker')::text, false);
select set_config('tests.code', (select join_code from public.memberships where id = current_setting('tests.membership')::uuid), false);
select ok(current_setting('tests.code') ~ '^[A-HJKMNP-Z2-9]{8}$'
          and (select join_code_expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute'
               from public.memberships where id = current_setting('tests.membership')::uuid),
  'Join code: an invitation carries an 8-character code that works for 7 days');
select throws_ok($$ select public.choose_plan(tests.biz('biz_a'), 'solo') $$, '22023', null, 'Plans: Solo is refused while there is a checker');

select tests.as_user('a0000000-0000-4000-8000-000000000092');
select is(public.accept_invitations(), '[]'::jsonb, 'Join code: a demonstration account still can''t claim an invitation by email');
select throws_ok($$ select public.join_with_code('ABC') $$, '22023', null, 'Join code: a malformed code is refused with a clear message');
select is(public.join_with_code(lower(substr(current_setting('tests.code'), 1, 4) || '-' || substr(current_setting('tests.code'), 5))) ->> 'role',
  'checker', 'Join code: the code works typed in lower case with a dash, and the account joins as the checker');
select throws_ok($$ select public.choose_plan(tests.biz('biz_a'), 'company') $$, '42501', null, 'Plans: only the owner chooses the plan');
select lives_ok($$ select public.get_billing(tests.biz('biz_a')) $$, 'Plans: the checker can see the plan');
reset role;
select is((select status || ' ' || (user_id = 'a0000000-0000-4000-8000-000000000092') || ' ' || (join_code is null)
           from public.memberships where id = current_setting('tests.membership')::uuid),
  'active true true', 'Join code: the membership is active and the code is retired');
select tests.as_user('a0000000-0000-4000-8000-000000000095');
select throws_ok(format('select public.join_with_code(%L)', current_setting('tests.code')), 'P0002', null,
  'Join code: a used code works only once');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Setting up a business, sample Test data, and joining by email
-- ---------------------------------------------------------------------------------------------
select tests.as_user('a0000000-0000-4000-8000-000000000093');
select set_config('tests.biz_b', public.create_business('Plain Owner Co (Test data)', 'Pat Plain', 'pat@plain-owner.example')::text, false);
select is((public.add_sample_invoices(tests.biz('biz_b')))::text, '{"drafts": 5, "invoices": 12}',
  'Setup: a new business can start with the 12 sample invoices and this week''s 5 drafts');
select throws_ok($$ select public.add_sample_invoices(tests.biz('biz_b')) $$, '23505', null, 'Setup: sample invoices are added only once');
select throws_ok($$ select public.create_business('', 'Pat Plain', 'pat@plain-owner.example') $$, '22023', 'Enter the business name.',
  'Setup: a missing name gets a plain-words message');
select lives_ok($$ select public.create_business('Extra ' || n || ' (Test data)', 'Pat Plain', 'pat@plain-owner.example') from generate_series(1, 4) n $$,
  'Setup: an account can own up to 5 businesses');
select throws_ok($$ select public.create_business('Sixth (Test data)', 'Pat Plain', 'pat@plain-owner.example') $$, '22023', null,
  'Setup: a sixth business is refused');
select set_config('tests.membership_b', public.invite_checker(tests.biz('biz_b'), 'invited.checker@example.test', 'Ivy Invited')::text, false);
reset role;
select is((select delete_after from public.businesses where id = tests.biz('biz_b')), null::date,
  'Setup: an ordinary account''s business has no early deletion date');
select tests.as_user('a0000000-0000-4000-8000-000000000094');
select is(public.accept_invitations() -> 0 ->> 'role', 'checker', 'Join code: an ordinary account still joins by email');
reset role;
select is((select join_code from public.memberships where id = current_setting('tests.membership_b')::uuid), null,
  'Join code: joining by email retires the code too');
select tests.as_user('a0000000-0000-4000-8000-000000000091');
select set_config('tests.biz_c', public.create_business('Second Demo (Test data)', 'Alex Test', 'alex@demo.test')::text, false);
select is((select delete_after from public.businesses where id = tests.biz('biz_c')),
  date '2026-11-25', 'Setup: a demonstration account''s new business is deleted with the Test data (PD-7)');

-- ---------------------------------------------------------------------------------------------
-- Cancelling, resuming and the months after the intro
-- ---------------------------------------------------------------------------------------------
select set_config('tests.cancelled', public.cancel_plan(tests.biz('biz_a')) ->> 'phase', false);
select is(current_setting('tests.cancelled') || ' ' || (select ends_on::text from public.subscriptions where business_id = tests.biz('biz_a')),
  'cancelling ' || ((current_setting('tests.today')::date + interval '1 month')::date)::text,
  'Plans: a cancelled plan runs to the end of the month already paid for');
select is(public.resume_plan(tests.biz('biz_a')) ->> 'phase', 'intro', 'Plans: the owner can keep it going before it ends');
reset role;
select is((select (b ->> 'phase') || ' ' || (b ->> 'price_now_cents') from (select private.billing_state(tests.biz('biz_a'), now() + interval '100 days') as b) x),
  'full 4900', 'Plans: after 3 months the full price applies');
update public.subscriptions set started_on = current_date - 120, intro_ends_on = current_date - 30, cancelled_at = now() - interval '9 days',
                                ends_on = current_date - 1
 where business_id = tests.biz('biz_a');
select tests.as_user('a0000000-0000-4000-8000-000000000091');
select is((select (b ->> 'phase') || ' ' || (b ->> 'price_now_cents') || ' ' || (b ->> 'had_intro') from (select public.choose_plan(tests.biz('biz_a'), 'company') as b) x),
  'full 7900 false', 'Plans: a plan chosen again after it ended starts at the full price: the intro is once per business');

-- ---------------------------------------------------------------------------------------------
-- Stripe checkouts, test mode only
-- ---------------------------------------------------------------------------------------------
select throws_ok($$ select public.job_record_checkout(tests.biz('biz_b'), 'crew', 'cs_test_A1', 'cus_T1', 'sub_T1', 3) $$, '42501', null,
  'Stripe: signed-in users cannot record a payment');
select tests.as_service();
select is((select (b ->> 'phase') || ' ' || (b -> 'payment' ->> 'mode') || ' ' || (b ->> 'intro_days_left' > '0')
           from (select public.job_record_checkout(tests.biz('biz_b'), 'crew', 'cs_test_A1', 'cus_T1', 'sub_T1', 3) as b) x),
  'intro stripe_test true', 'Stripe: a confirmed test-mode checkout starts the plan with its intro');
select lives_ok($$ select public.job_record_checkout(tests.biz('biz_b'), 'crew', 'cs_test_A1', 'cus_T1', 'sub_T1', 3) $$,
  'Stripe: confirming the same checkout again is safe');
select throws_ok($$ select public.job_record_checkout(tests.biz('biz_b'), 'crew', 'cs_live_A2', 'cus_T1', 'sub_T1', 3) $$, '23514', null,
  'Stripe: a live-mode checkout is refused by the database');
select is((select (b ->> 'had_intro') from (select public.job_record_checkout(tests.biz('biz_a'), 'company', 'cs_test_B1', 'cus_T2', 'sub_T2', 3) as b) x),
  'false', 'Stripe: a checkout never gives more intro months than are left');
reset role;
select is((select count(*)::int from public.activity_log where business_id = tests.biz('biz_b') and action = 'payment_recorded'), 1,
  'Stripe: the payment is logged once');
select tests.as_user('a0000000-0000-4000-8000-000000000093');
select is(public.choose_plan(tests.biz('biz_b'), 'company') -> 'payment' ->> 'verified_at', null,
  'Stripe: a new plan needs the card added again at its price');
select tests.as_user('a0000000-0000-4000-8000-000000000095');
select is((select count(*)::int from public.subscriptions), 0, 'Plans: nobody outside the business can see its plan');

-- ---------------------------------------------------------------------------------------------
-- Promises to pay
-- ---------------------------------------------------------------------------------------------
select tests.as_user('a0000000-0000-4000-8000-000000000092');
select is((public.record_promise(tests.inv('1066'), current_setting('tests.today')::date + 7, 'Paying Friday') ->> 'drafts_cancelled'), '1',
  'Promise: the checker records a promise to pay, and the waiting draft is cancelled');
reset role;
select is((select cancel_reason::text from public.reminder_drafts where invoice_id = tests.inv('1066') order by created_at desc limit 1), 'promised',
  'Promise: the cancelled draft says why');
select is(array[private.ineligibility(tests.inv('1066'), now()), coalesce(private.ineligibility(tests.inv('1066'), now() + interval '8 days'), 'draft it')],
  array['promised', 'draft it'], 'Promise: no reminder until the promised date, then reminders start again');
select is(array[(private.build_briefing(tests.biz('biz_a'), now()) -> 'promises' -> 0 ->> 'missed'),
                (private.build_briefing(tests.biz('biz_a'), now() + interval '8 days') -> 'promises' -> 0 ->> 'missed')],
  array['false', 'true'], 'Promise: the briefing lists the promise, and says when it was missed');
select tests.as_user('a0000000-0000-4000-8000-000000000091');
select throws_ok($$ select public.record_promise(tests.inv('1051'), current_date + 61) $$, '22023', null,
  'Promise: a date more than 60 days away is refused (pause the client instead)');
select lives_ok($$ select public.clear_promise(tests.inv('1066')) $$, 'Promise: the owner can clear it');
select is((select promised_on from public.invoice_list where id = tests.inv('1066')), null::date, 'Promise: ...and the invoice shows no promise');

-- ---------------------------------------------------------------------------------------------
-- Tone presets and firmer by itself
-- ---------------------------------------------------------------------------------------------
select set_config('tests.preset', public.save_preset(tests.biz('biz_a'), 'Builders: gentle', 'gentle', 'They pay, just slowly', 'head_contractor')::text, false);
select is(public.apply_preset(current_setting('tests.preset')::uuid, array(select id from public.clients where business_id = tests.biz('biz_a') and name like 'Northshore%')), 1,
  'Presets: the owner gives a client a saved preset');
reset role;
insert into public.clients (business_id, name, email, client_group) values (tests.biz('biz_a'), 'New Builder (Test data)', 'new@builder.example', 'head_contractor');
select is((select tone || ' ' || (preset_id = current_setting('tests.preset')::uuid) from public.clients where name = 'New Builder (Test data)'),
  'gentle true', 'Presets: a new client in the group gets the preset by itself');
select tests.as_user('a0000000-0000-4000-8000-000000000091');
select public.save_preset(tests.biz('biz_a'), 'builders: GENTLE', 'standard', null, 'head_contractor');
reset role;
select is((select string_agg(tone::text, ',' order by name) from public.clients where preset_id = current_setting('tests.preset')::uuid),
  'standard,standard', 'Presets: changing a preset changes the clients that remember it');
select tests.as_user('a0000000-0000-4000-8000-000000000091');
select public.update_settings(tests.biz('biz_a'), '{"auto_firm_after": 1}');
reset role;
-- Greenway (1062) was reminded 8 days ago and its client is already firm; give Northshore's 1051 one reminder too.
update public.invoices set reminders_sent_count = 1, last_reminder_sent_at = now() - interval '8 days' where id = tests.inv('1051');
select set_config('tests.run', (public.job_start('weekly_run', tests.biz('biz_a'), (current_setting('tests.today')::date + 7)::text, 'manual') ->> 'run_id'), false);
select count(*) from public.job_plan_weekly_run(current_setting('tests.run')::uuid, now() + interval '7 days');
select is((select tone || ' ' || (preset_id is null) from public.clients where business_id = tests.biz('biz_a') and name like 'Northshore%'),
  'firm true', 'Firmer by itself: after the set number of unpaid reminders the client moves one tone firmer');
select is((select count(*)::int from public.activity_log where run_id = current_setting('tests.run')::uuid and action = 'tone_stepped_up'
           and details ->> 'to' = 'firm'), 1, 'Firmer by itself: the step is logged with the run, once');

select * from finish();
rollback;
