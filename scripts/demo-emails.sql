-- Points the seed business's owner and checker invitations at inboxes the team can read, so the sign-in codes
-- and the briefing (EM-01) arrive during the Week 7 demonstration and the acceptance tests (AT-09, AT-10).
-- The seed's own addresses end in .test, a reserved domain that never receives mail.
--
-- Addresses are passed in and never committed (NFR-04). Plus-addresses of one team inbox work, because the
-- owner and the checker only need different addresses. Dev project only, after every reset to the seed:
--
--   psql "<dev connection string>" -v owner_email='<team inbox>' -v checker_email='<team inbox>' -f scripts/demo-emails.sql
--
-- Then add the same two addresses as users in Supabase (Authentication > Add user), because sign-ups are off.
-- Their invitations are accepted on first sign-in (public.accept_invitations).

\set ON_ERROR_STOP on
\if :{?owner_email}
\else
  \echo 'Pass both addresses: -v owner_email=... -v checker_email=...'
  \quit
\endif
\if :{?checker_email}
\else
  \echo 'Pass both addresses: -v owner_email=... -v checker_email=...'
  \quit
\endif

select set_config('demo.owner_email', :'owner_email', false) is not null as owner_set,
       set_config('demo.checker_email', :'checker_email', false) is not null as checker_set \gset

do $$
declare
  biz constant uuid := '0d5e0000-0000-4000-8000-000000000001';
  owner_email constant text := lower(btrim(current_setting('demo.owner_email')));
  checker_email constant text := lower(btrim(current_setting('demo.checker_email')));
  owner_rows integer;
  checker_rows integer;
begin
  if not exists (select 1 from public.businesses b where b.id = biz and b.is_test_data) then
    raise exception 'The seed business is not here. Reset the dev project to the seed first.';
  end if;
  if owner_email = checker_email then
    raise exception 'The owner and the checker need different addresses. Plus-addresses of one inbox work.';
  end if;
  if owner_email like '%.test' or checker_email like '%.test' then
    raise exception 'A .test address never receives mail. Use an inbox the team can read.';
  end if;

  update public.memberships m set invited_email = owner_email
   where m.business_id = biz and m.role = 'owner' and m.status = 'invited';
  get diagnostics owner_rows = row_count;
  update public.memberships m set invited_email = checker_email
   where m.business_id = biz and m.role = 'checker' and m.status = 'invited';
  get diagnostics checker_rows = row_count;

  raise notice 'Invitations updated: owner %, checker %. Already-accepted members keep their sign-in address.',
    owner_rows, checker_rows;
end;
$$;
