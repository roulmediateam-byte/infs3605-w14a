-- Security conventions that every migration must keep (NFR-05, NFR-06, FR-21; docs/adr/0003).
-- These tests read the catalogue, so a future migration that forgets a grant or a policy fails CI.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity
$$, 'Row-level security is on for every table in public and private (NFR-05)');

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'deletion_receipts'
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.cmd = 'SELECT')
$$, 'Every public table except deletion_receipts has a read policy for members');

select is_empty($$
  select tablename::text || ':' || policyname::text from pg_policies
  where schemaname = 'public' and cmd <> 'SELECT'
$$, 'No policy allows inserts, updates or deletes: writes go through functions (ADR 0003)');

select is_empty($$
  select table_name::text || ':' || privilege_type::text from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
$$, 'anon has no privilege on any table or view');

select is_empty($$
  select table_name::text || ':' || privilege_type::text from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public' and privilege_type <> 'SELECT'
$$, 'Signed-in users can only read tables and views');

select ok(not has_table_privilege('authenticated', 'public.deletion_receipts', 'select'),
  'Signed-in users cannot read deletion receipts');

select ok(not has_table_privilege('service_role', 'public.activity_log', 'update')
      and not has_table_privilege('service_role', 'public.activity_log', 'delete'),
  'Even the service role cannot change or delete activity log entries (FR-21)');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and not coalesce(p.proconfig @> array['search_path=""'], false)
$$, 'Every function sets search_path to an empty string');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
$$, 'anon can execute no function');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'job\_%' and has_function_privilege('authenticated', p.oid, 'execute')
$$, 'Signed-in users cannot run job functions');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'job\_%' and not has_function_privilege('service_role', p.oid, 'execute')
$$, 'The service role can run every job function');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname not like 'job\_%' and not has_function_privilege('authenticated', p.oid, 'execute')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
$$, 'Signed-in users can call every app function');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname not in ('my_business_ids', 'sydney_date', 'days_overdue')
    and has_function_privilege('authenticated', p.oid, 'execute')
$$, 'Private helpers are closed to signed-in users, apart from the three that policies and views use');

select is_empty($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions @> array['security_invoker=true'], false)
$$, 'Every view obeys the caller''s row-level security (security_invoker)');

-- Supabase advises against security definer functions in exposed schemas, because the API can call them with the
-- owner's rights. Ours are the API, so each must check the caller before anything else (ADR 0003).
select is_empty($$
  select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.proname not like 'job\_%'
    and p.prosrc !~ 'private\.require_role\(' and p.prosrc !~ '\(select auth\.uid\(\)\)'
$$, 'Every exposed security definer function checks the caller''s role or identity first');

select is_empty($$
  select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.proname like 'job\_%'
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
$$, 'Job functions, which do not check a person, are closed to everyone but the service role');

select col_type_is('public', 'invoices', 'amount_due_cents', 'bigint', 'Money is stored as whole cents (BR-14)');
select hasnt_column('public', 'invoices', 'is_overdue', '"Overdue" is calculated, never stored (BR-06)');
select has_index('public', 'reminder_drafts', 'reminder_drafts_one_live', 'At most one live draft per invoice (AT-08)');
select has_trigger('public', 'activity_log', 'activity_log_no_update_or_delete', 'The activity log has its append-only trigger (FR-21)');

select * from finish();
rollback;
