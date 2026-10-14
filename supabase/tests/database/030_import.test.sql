-- Import: FR-04 to FR-06, BR-03, BR-05 at import (AT-03), BR-15 duplicates, AT-06 totals, the mass-close guard.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

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
create function tests.invoice(p_number text) returns uuid language sql stable as
  $$ select id from public.invoices where business_id = 'b0000000-0000-4000-8000-000000000030' and invoice_number = p_number $$;
create function tests.result(p_name text) returns jsonb language sql stable as
  $$ select current_setting('tests.' || p_name)::jsonb $$;

select tests.create_user('a0000000-0000-4000-8000-000000000030', 'owner.import@example.test');
select tests.create_user('a0000000-0000-4000-8000-000000000031', 'checker.import@example.test');
insert into public.businesses (id, name, owner_name, reply_to_email)
values ('b0000000-0000-4000-8000-000000000030', 'Import Test (Test data)', 'Owner I', 'owner.import@example.test');
insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, accepted_at) values
  ('b0000000-0000-4000-8000-000000000030', 'a0000000-0000-4000-8000-000000000030', 'owner.import@example.test', 'Owner I', 'owner', 'active', now()),
  ('b0000000-0000-4000-8000-000000000030', 'a0000000-0000-4000-8000-000000000031', 'checker.import@example.test', 'Checker I', 'checker', 'active', now());

-- First import: 7 rows, 2 good and 5 bad. Readable amounts total $3,430.50.
select tests.as_user('a0000000-0000-4000-8000-000000000030');
select ok(set_config('tests.first', public.confirm_import(
  'b0000000-0000-4000-8000-000000000030', 'first.csv', 'team_template', '{"client":"Client","invoice_number":"Invoice"}',
  $j$[
    {"row":2,"client":"Alpha Builders (Test data)","email":"a@alpha.example","invoice_number":"INV-1","issue_date":"01/10/2026","due_date":"15/10/2026","amount_due":"$1,250.00"},
    {"row":3,"client":"Beta Homes (Test data)","email":"b@beta.example","invoice_number":"INV-2","issue_date":"01/10/2026","due_date":"14/10/2026","amount_due":"980.50"},
    {"row":4,"client":"Alpha Builders (Test data)","email":"","invoice_number":"INV-3","issue_date":"32/10/2026","due_date":"15/10/2026","amount_due":"500"},
    {"row":5,"client":"Gamma Strata (Test data)","email":"","invoice_number":"INV-4","issue_date":"01/10/2026","due_date":"20/10/2026","amount_due":"TBC"},
    {"row":6,"client":"Gamma Strata (Test data)","email":"c@gamma.example","invoice_number":"INV-5","issue_date":"01/10/2026","due_date":"20/10/2026","amount_due":"300"},
    {"row":7,"client":"Gamma Strata (Test data)","email":"c@gamma.example","invoice_number":" INV-5 ","issue_date":"01/10/2026","due_date":"20/10/2026","amount_due":"300"},
    {"row":8,"client":"Delta Fitouts (Test data)","email":"d@delta.example","invoice_number":"","issue_date":"01/10/2026","due_date":"20/10/2026","amount_due":"100"}
  ]$j$::jsonb, 7, 343050)::text, true) is not null, 'FR-04: the first import completes');

select is((tests.result('first') ->> 'rows_saved')::integer, 2, 'FR-05: the two good rows are saved');
select is((tests.result('first') ->> 'rows_skipped')::integer, 5, 'FR-05: the five bad rows are skipped');
select is(tests.result('first') -> 'errors', $j$[
    {"row":4,"reason":"Issue date is not a date (use DD/MM/YYYY)"},
    {"row":5,"reason":"Amount is not a number"},
    {"row":6,"reason":"Invoice number appears more than once in this file"},
    {"row":7,"reason":"Invoice number appears more than once in this file"},
    {"row":8,"reason":"Missing invoice number"}
  ]$j$::jsonb, 'FR-05 and BR-15: each skipped row has its reason; a number repeated after trimming spaces rejects both rows');
select is((tests.result('first') ->> 'saved_total_cents')::bigint, 223050::bigint, 'FR-05: the saved total is the sum of the saved rows');
select is((select count(*)::integer from public.invoices where business_id = 'b0000000-0000-4000-8000-000000000030' and status = 'open'), 2,
  'FR-06: the two good rows are now open invoices');
select is((select count(*)::integer from public.clients where business_id = 'b0000000-0000-4000-8000-000000000030'), 2,
  'FR-06: clients are created only from saved rows');
select is((select rows_read = rows_saved + rows_skipped from public.imports where id = (tests.result('first') ->> 'import_id')::uuid), true,
  'Rows read equal rows saved plus rows skipped');
select is((select column_mapping from public.businesses where id = 'b0000000-0000-4000-8000-000000000030'),
  '{"client":"Client","invoice_number":"Invoice"}'::jsonb, 'FR-04: the column mapping is remembered');
select is((public.get_briefing('b0000000-0000-4000-8000-000000000030', '2026-11-09 07:00:00+11') -> 'totals' ->> 'owed_cents')::bigint, 223050::bigint,
  'AT-06: the briefing''s total owed equals the sum of the imported file');
select is((select (details ->> 'rows_saved')::integer from public.activity_log
           where business_id = 'b0000000-0000-4000-8000-000000000030' and action = 'import_completed'), 2,
  'FR-21: the import is logged with its counts');

-- Nothing is saved when the preview and the server disagree.
select throws_like($q$ select public.confirm_import('b0000000-0000-4000-8000-000000000030', 'x.csv', 'team_template', '{}',
  '[{"row":2,"client":"Alpha Builders (Test data)","invoice_number":"INV-1","issue_date":"01/10/2026","due_date":"15/10/2026","amount_due":"1250"}]', 1, 999) $q$,
  '%Totals don''t match the file%', 'FR-05: a total that does not match the preview stops the import');
select throws_like($q$ select public.confirm_import('b0000000-0000-4000-8000-000000000030', 'x.csv', 'team_template', '{}',
  '[{"row":2,"client":"Alpha Builders (Test data)","invoice_number":"INV-1","issue_date":"01/10/2026","due_date":"15/10/2026","amount_due":"1250"}]', 2, 125000) $q$,
  '%number of rows doesn''t match%', 'FR-05: a row count that does not match the file stops the import');
select throws_like($q$ select public.confirm_import('b0000000-0000-4000-8000-000000000030', 'x.csv', 'team_template', '{}', '[]', 0, 0) $q$,
  '%no rows to import%', 'An empty file stops the import');

-- Drafts for both invoices, then the owner sets Alpha's tone.
reset role;
select ok((public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000030', '2026-11-08', 'manual') ->> 'proceed')::boolean, 'A weekly run starts');
select is((select count(*)::integer
           from public.job_plan_weekly_run((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000030'), '2026-11-08 21:00:00+11') p
           cross join lateral (select * from public.job_get_templates() t where t.tone = p.tone) t
           where public.job_save_draft((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000030'),
                                       p.invoice_id, t.subject, t.body, 'template', t.version, null, 0::smallint, 'ai_disabled') is not null),
  2, 'Both invoices get a waiting draft');
select tests.as_user('a0000000-0000-4000-8000-000000000030');
select lives_ok($$ select public.set_client_tone((select id from public.clients where name = 'Alpha Builders (Test data)'), 'gentle') $$,
  'The owner sets Alpha''s tone to gentle');

-- Second import: INV-1's amount changes to $1,000.00, INV-2 is missing, INV-6 is new.
select ok(set_config('tests.second', public.confirm_import(
  'b0000000-0000-4000-8000-000000000030', 'second.csv', 'xero_export', '{"client":"ContactName"}',
  $j$[
    {"row":2,"client":"Alpha Builders (Test data)","email":"a@alpha.example","invoice_number":"INV-1","issue_date":"01/10/2026","due_date":"15/10/2026","amount_due":"$1,000.00"},
    {"row":3,"client":"Gamma Strata (Test data)","email":"c@gamma.example","invoice_number":"INV-6","issue_date":"01/10/2026","due_date":"20/10/2026","amount_due":"750"}
  ]$j$::jsonb, 2, 175000)::text, true) is not null, 'The second import completes');
select is((select cancel_reason::text from public.reminder_drafts where invoice_id = tests.invoice('INV-1')), 'amount_changed',
  'AT-03: the waiting draft for the changed amount is cancelled');
select is((select detail from public.attention_items where invoice_id = tests.invoice('INV-1') and kind = 'amount_changed' and resolved_at is null),
  '{"from_cents":125000,"to_cents":100000}'::jsonb, 'AT-03: the invoice is flagged with the old and new amounts');
select ok(exists (select 1 from jsonb_array_elements(public.get_briefing('b0000000-0000-4000-8000-000000000030', '2026-11-09 07:00:00+11') -> 'needs_attention') x
                  where x ->> 'kind' = 'amount_changed' and x ->> 'invoice_number' = 'INV-1'),
  'AT-03: the flag shows under Needs attention in the briefing');
select is((select status::text || '/' || close_reason::text from public.invoices where id = tests.invoice('INV-2')), 'closed/not_in_latest_import',
  'BR-03: an invoice missing from the latest import is closed');
select is((select cancel_reason::text from public.reminder_drafts where invoice_id = tests.invoice('INV-2')), 'invoice_closed',
  'BR-03: its waiting draft is cancelled');
select is((select tone::text from public.clients where name = 'Alpha Builders (Test data)'), 'gentle', 'FR-06: an import keeps the client''s tone');
select is(array[(tests.result('second') ->> 'invoices_added')::integer, (tests.result('second') ->> 'invoices_updated')::integer,
                (tests.result('second') ->> 'invoices_closed')::integer], array[1, 1, 1],
  'The import reports 1 added, 1 updated and 1 closed');

-- Third import: INV-2 is back, so it reopens.
select is((public.confirm_import('b0000000-0000-4000-8000-000000000030', 'third.csv', 'xero_export', '{}',
  $j$[
    {"row":2,"client":"Alpha Builders (Test data)","invoice_number":"INV-1","issue_date":"01/10/2026","due_date":"15/10/2026","amount_due":"1000"},
    {"row":3,"client":"Beta Homes (Test data)","invoice_number":"INV-2","issue_date":"01/10/2026","due_date":"14/10/2026","amount_due":"980.50"},
    {"row":4,"client":"Gamma Strata (Test data)","invoice_number":"INV-6","issue_date":"01/10/2026","due_date":"20/10/2026","amount_due":"750"}
  ]$j$::jsonb, 3, 273050) ->> 'invoices_reopened')::integer, 1, 'An invoice seen again in a later import reopens');

-- A paid invoice stays paid even if the export still lists it (Xero may not have caught up).
select lives_ok($$ select public.mark_paid(tests.invoice('INV-1'), '2026-10-10') $$, 'FR-24: the owner marks INV-1 paid');
select is((public.confirm_import('b0000000-0000-4000-8000-000000000030', 'fourth.csv', 'xero_export', '{}',
  $j$[
    {"row":2,"client":"Alpha Builders (Test data)","invoice_number":"INV-1","issue_date":"01/10/2026","due_date":"15/10/2026","amount_due":"1000"},
    {"row":3,"client":"Beta Homes (Test data)","invoice_number":"INV-2","issue_date":"01/10/2026","due_date":"14/10/2026","amount_due":"980.50"},
    {"row":4,"client":"Gamma Strata (Test data)","invoice_number":"INV-6","issue_date":"01/10/2026","due_date":"20/10/2026","amount_due":"750"}
  ]$j$::jsonb, 3, 273050) ->> 'invoices_kept_paid')::integer, 1, 'A paid invoice in a later import is kept paid');
select is((select status::text from public.invoices where id = tests.invoice('INV-1')), 'paid', 'INV-1 is still paid');

-- The named checker may import too (Design Requirements v0.1 section 4).
select tests.as_user('a0000000-0000-4000-8000-000000000031');
select lives_ok($$ select public.confirm_import('b0000000-0000-4000-8000-000000000030', 'checker.csv', 'xero_export', '{}',
  '[{"row":2,"client":"Beta Homes (Test data)","invoice_number":"INV-2","issue_date":"01/10/2026","due_date":"14/10/2026","amount_due":"980.50"},
    {"row":3,"client":"Gamma Strata (Test data)","invoice_number":"INV-6","issue_date":"01/10/2026","due_date":"20/10/2026","amount_due":"750"}]', 2, 173050) $$,
  'The checker can import');

-- A partial file must not quietly close most open invoices.
reset role;
insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents)
select 'b0000000-0000-4000-8000-000000000030', (select id from public.clients where name = 'Beta Homes (Test data)'), 'MC-' || n, '2026-10-01', '2026-10-30', 10000
from generate_series(1, 7) as n;
select tests.as_user('a0000000-0000-4000-8000-000000000030');
select throws_like($q$ select public.confirm_import('b0000000-0000-4000-8000-000000000030', 'partial.csv', 'xero_export', '{}',
  '[{"row":2,"client":"Beta Homes (Test data)","invoice_number":"INV-2","issue_date":"01/10/2026","due_date":"14/10/2026","amount_due":"980.50"}]', 1, 98050) $q$,
  '%would close 8 of your 9 open invoices%', 'A file that would close most open invoices asks for confirmation first');
select is((public.confirm_import('b0000000-0000-4000-8000-000000000030', 'partial.csv', 'xero_export', '{}',
  '[{"row":2,"client":"Beta Homes (Test data)","invoice_number":"INV-2","issue_date":"01/10/2026","due_date":"14/10/2026","amount_due":"980.50"}]', 1, 98050, true)
  ->> 'invoices_closed')::integer, 8, 'Once confirmed, the import closes them');

select * from finish();
rollback;
