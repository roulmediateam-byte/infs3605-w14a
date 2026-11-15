-- Migration 10: keep the demonstration open to ordinary users until the end of the course.
--
-- Until now, demonstration sign-ups closed after Wed 25 Nov 2026 and each demonstration account's Test data business
-- was marked for deletion on that date. That window was set for judging. The team wants the app to keep working for
-- anyone who tries it, so the window now runs to the course's hard deletion date (PD-7, NFR-03):
--   * sign-ups stay open while under the caps, until Wed 30 Dec 2026;
--   * demonstration businesses, new and existing, are deleted on Thu 31 Dec 2026, when every business is deleted anyway
--     (job_retention_purge, constraint delete_by_end_of_course).
-- All of this data is synthetic Test data made by the sign-up; no real business data is involved.

-- ---------------------------------------------------------------------------------------------
-- Sign-ups are open while under the caps, and until Wed 30 Dec 2026 (every business is deleted on Thu 31 Dec, PD-7)
-- ---------------------------------------------------------------------------------------------
create or replace function public.job_demo_sign_up_room(p_as_of timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with counts as (
    select count(*) as accounts,
           count(*) filter (where u.created_at > coalesce(p_as_of, now()) - interval '1 hour') as last_hour
    from auth.users u
    where (u.raw_app_meta_data ->> 'demo_sign_up') = 'true'
  )
  select jsonb_build_object(
    'open', r.reason = 'open',
    'reason', r.reason,
    'accounts', c.accounts,
    'last_hour', c.last_hour
  )
  from counts c,
  lateral (
    select case
      when private.sydney_date(coalesce(p_as_of, now())) > date '2026-12-30' then 'closed'
      when c.accounts >= 300 then 'full'
      when c.last_hour >= 60 then 'busy'
      else 'open'
    end as reason
  ) r;
$$;
comment on function public.job_demo_sign_up_room(timestamptz) is
  'Whether the demonstration sign-up is open: at most 300 accounts, 60 an hour, and none after Wed 30 Dec 2026 (PD-7).';

-- ---------------------------------------------------------------------------------------------
-- Setting up a business in the app: at most 5 per account; a demonstration account's is deleted with the Test data
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_business(p_name text, p_owner_name text, p_reply_to_email text, p_sign_off text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text;
  new_id uuid;
begin
  if caller is null then
    raise exception 'Sign in to continue.' using errcode = '28000';
  end if;
  if (select count(*) from public.memberships m where m.user_id = caller and m.role = 'owner' and m.status <> 'removed') >= 5 then
    raise exception 'You already own 5 businesses, the most one account can set up.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'Enter the business name.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_owner_name, ''))) not between 1 and 80 then
    raise exception 'Enter your name.' using errcode = '22023';
  end if;
  if private.clean_email(p_reply_to_email) is distinct from lower(btrim(p_reply_to_email)) then
    raise exception 'Enter one valid email address for replies.' using errcode = '22023';
  end if;
  select u.email into caller_email from auth.users u where u.id = caller;
  insert into public.businesses (name, owner_name, reply_to_email, sign_off, delete_after)
  values (btrim(p_name), btrim(p_owner_name), lower(btrim(p_reply_to_email)),
          coalesce(nullif(btrim(p_sign_off), ''), 'Thanks,'),
          case when private.is_demo_account(caller) then date '2026-12-31' end)
  returning id into new_id;
  insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, invited_by, accepted_at)
  values (new_id, caller, lower(coalesce(caller_email, p_reply_to_email)), btrim(p_owner_name), 'owner', 'active', caller, now());
  perform private.log(new_id, 'business_created', jsonb_build_object('is_test_data', true));
  return new_id;
end;
$$;
comment on function public.create_business(text, text, text, text) is
  'Setup: creates the business as Test data and makes the caller its owner (FR-02, D7). At most 5 per account.';

-- The demonstration sign-up, as in migration 8, now through add_sample_data and on Crew's intro.
create or replace function public.job_demo_provision(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_email text;
  existing uuid;
  biz uuid;
  today constant date := private.sydney_date(now());
  drafted integer;
begin
  select lower(u.email) into account_email from auth.users u where u.id = p_user_id;
  if account_email is null then
    return jsonb_build_object('outcome', 'no_account');
  end if;
  if not private.is_demo_account(p_user_id) then
    return jsonb_build_object('outcome', 'not_demo');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job_demo_provision:' || p_user_id::text, 0));

  select m.business_id into existing
    from public.memberships m
   where m.user_id = p_user_id and m.status = 'active'
   order by m.accepted_at
   limit 1;
  if existing is not null then
    return jsonb_build_object('outcome', 'exists', 'business_id', existing);
  end if;
  if (select count(*) from private.demo_provisions d where d.user_id = p_user_id) >= 10 then
    return jsonb_build_object('outcome', 'limit');
  end if;

  insert into public.businesses (name, owner_name, sign_off, reply_to_email, call_first_threshold_cents, xero_reminders,
                                 style_note, is_test_data, delete_after)
  values ('Harbour Line Electrical (Test data)', 'Alex Test', 'Thanks,', 'accounts@harbourline.example', 1500000, 'off',
          'Short and friendly. First names. No jargon.', true, date '2026-12-31')
  returning id into biz;

  insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, accepted_at)
  values (biz, p_user_id, account_email, 'Alex Test', 'owner', 'active', now());

  drafted := private.add_sample_data(biz, 'demo_sign_up');

  -- Each copy starts on Crew's 3-month intro, so the plan screen shows a real countdown. Nothing is charged.
  insert into public.subscriptions (business_id, plan, started_on, intro_ends_on)
  values (biz, 'crew', today, (today + interval '3 months')::date);

  insert into private.demo_provisions (user_id, business_id) values (p_user_id, biz);
  return jsonb_build_object('outcome', 'created', 'business_id', biz, 'drafts', drafted);
end;
$$;
comment on function public.job_demo_provision(uuid) is
  'Gives a demonstration account its own copy of the seed''s Test data business on Crew''s intro, as the active owner. Returns the business it already has, if any; at most 10 copies per account.';

-- Existing demonstration businesses move to the new date too. Only rows still on the old demonstration date change.
update public.businesses
   set delete_after = date '2026-12-31'
 where is_test_data and delete_after = date '2026-11-25';

select private.apply_function_grants();
