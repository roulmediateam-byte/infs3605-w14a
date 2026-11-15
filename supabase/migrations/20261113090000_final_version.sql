-- Payprentice · migration 9 · the final version for the Week 10 submission
--   * Plans: Solo A$29, Crew A$49 and Company A$79 a month, 80% off for the first 3 months (like Xero's offer).
--     The plan and its intro dates are stored; the phase, the price this month and the next charge are worked out
--     when read, as overdue is (ADR 0004). Payment is Stripe in test mode only: the database refuses a live
--     checkout id, and the billing-checkout Edge Function refuses a live key.
--   * Promises to pay (the demonstration report's change 3; no PRD ID yet): a client's promised date stops reminders
--     until that date, then they start again.
--   * Joining a business with a code: an invitation carries an 8-character code that works for 7 days. Any signed-in
--     account can use it, including a demonstration account, because the code, not the email, proves the invitation.
--   * Sample Test data for a business set up in the app, and a cap of 5 businesses per account.
--   * Tone presets: saved per business, remembered by each client, given automatically to new clients in a group.
--   * Firmer by itself (opt-in): after a set number of unpaid reminders, the weekly run moves a client one tone firmer.
--     Every draft still waits for the owner's approval.
-- Every write still goes through a role-checked function that logs in the same transaction (ADR 0003, FR-21).

-- New values first. They are used only inside function bodies, which run after this migration commits.
alter type public.activity_action add value if not exists 'plan_changed';
alter type public.activity_action add value if not exists 'plan_cancelled';
alter type public.activity_action add value if not exists 'plan_resumed';
alter type public.activity_action add value if not exists 'payment_recorded';
alter type public.activity_action add value if not exists 'promise_recorded';
alter type public.activity_action add value if not exists 'promise_cleared';
alter type public.cancel_reason add value if not exists 'promised';
alter type public.activity_action add value if not exists 'preset_saved';
alter type public.activity_action add value if not exists 'preset_deleted';
alter type public.activity_action add value if not exists 'preset_applied';
alter type public.activity_action add value if not exists 'tone_stepped_up';

create type public.plan_id as enum ('solo', 'crew', 'company');

-- ---------------------------------------------------------------------------------------------
-- The plans, in whole cents of Australian dollars. Keep in step with web/src/lib/plans.ts (tested on both sides).
-- ---------------------------------------------------------------------------------------------
create or replace function private.plan_catalogue()
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'currency', 'AUD',
    'intro_months', 3,
    'intro_percent_off', 80,
    'plans', jsonb_build_array(
      jsonb_build_object('id', 'solo', 'name', 'Solo', 'price_cents', 2900, 'intro_price_cents', 580,
                         'clients_limit', 25, 'checker_allowed', false),
      jsonb_build_object('id', 'crew', 'name', 'Crew', 'price_cents', 4900, 'intro_price_cents', 980,
                         'clients_limit', 100, 'checker_allowed', true),
      jsonb_build_object('id', 'company', 'name', 'Company', 'price_cents', 7900, 'intro_price_cents', 1580,
                         'clients_limit', null, 'checker_allowed', true)
    )
  );
$$;
comment on function private.plan_catalogue() is 'The three plans and the intro offer: 80% off the first 3 monthly charges, then the full price.';

create table public.subscriptions (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  plan public.plan_id not null,
  started_on date not null,
  intro_ends_on date not null,
  cancelled_at timestamptz,
  ends_on date,
  payment_mode text not null default 'none' check (payment_mode in ('none', 'stripe_test')),
  stripe_checkout_id text check (stripe_checkout_id is null or stripe_checkout_id ~ '^cs_test_[A-Za-z0-9_]{1,200}$'),
  stripe_customer_id text check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,100}$'),
  stripe_subscription_id text check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,100}$'),
  paid_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The intro lasts at most 3 months, once per business: a plan chosen again after it ended starts at the full price.
  -- A card checkout moves the dates to the checkout day, so they match Stripe's, with the intro months still left.
  constraint intro_within_three_months check (intro_ends_on between started_on and (started_on + interval '3 months')::date),
  constraint cancelled_plan_has_end check ((cancelled_at is null) = (ends_on is null)),
  constraint verified_payment_is_test_mode check (paid_verified_at is null or payment_mode = 'stripe_test')
);
comment on table public.subscriptions is
  'A business''s plan. Phase (intro, full, cancelling, ended), this month''s price and the next charge are calculated when read.';
create trigger subscriptions_touch before update on public.subscriptions for each row execute function private.touch_updated_at();

alter table public.subscriptions enable row level security;
create policy "Members read their plan"
  on public.subscriptions for select to authenticated
  using (business_id in (select private.my_business_ids()));
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert, update, delete on public.subscriptions to service_role;

-- Charges fall monthly on the start date's day of the month (or the month's last day), the first on the start date.
-- The next charge is the first one after today.
create or replace function private.next_charge_on(p_started_on date, p_today date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  months integer := greatest(0, (extract(year from age(p_today, p_started_on)) * 12
                                 + extract(month from age(p_today, p_started_on)))::integer);
  candidate date := (p_started_on + make_interval(months => months + 1))::date;
begin
  while candidate <= p_today loop
    months := months + 1;
    candidate := (p_started_on + make_interval(months => months + 1))::date;
  end loop;
  return candidate;
end;
$$;

-- How many 80%-off monthly charges a card checkout today would include: the months from today until the intro ends.
create or replace function private.intro_months_left(p_intro_ends_on date, p_today date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(min(n), 3)::integer
  from generate_series(0, 3) as n
  where (p_today + make_interval(months => n))::date >= p_intro_ends_on;
$$;

create or replace function private.billing_state(p_business_id uuid, p_as_of timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sub public.subscriptions;
  cat jsonb := private.plan_catalogue();
  plan jsonb;
  today date := private.sydney_date(p_as_of);
  phase text;
  next_on date;
  active_clients integer;
  has_checker boolean;
  in_intro boolean;
begin
  select count(distinct i.client_id)::integer into active_clients
    from public.invoices i where i.business_id = p_business_id and i.status = 'open';
  select exists (select 1 from public.memberships m
                  where m.business_id = p_business_id and m.role = 'checker' and m.status <> 'removed')
    into has_checker;
  select * into sub from public.subscriptions s where s.business_id = p_business_id;
  if sub.business_id is null then
    return jsonb_build_object('catalogue', cat, 'plan', null, 'phase', 'none', 'checkout_intro_months', 3,
                              'usage', jsonb_build_object('active_clients', active_clients, 'has_checker', has_checker,
                                                          'clients_limit', null, 'checker_allowed', true),
                              'over_limit', false);
  end if;

  select p into plan from jsonb_array_elements(cat -> 'plans') as p where p ->> 'id' = sub.plan::text;
  in_intro := today < sub.intro_ends_on;
  phase := case
    when sub.cancelled_at is not null and today >= sub.ends_on then 'ended'
    when sub.cancelled_at is not null then 'cancelling'
    when in_intro then 'intro'
    else 'full'
  end;
  next_on := private.next_charge_on(sub.started_on, today);

  return jsonb_build_object(
    'catalogue', cat,
    'plan', sub.plan,
    'plan_name', plan ->> 'name',
    'phase', phase,
    'started_on', sub.started_on,
    'intro_ends_on', sub.intro_ends_on,
    'had_intro', sub.intro_ends_on > sub.started_on,
    'intro_days_left', case when in_intro and phase <> 'ended' then sub.intro_ends_on - today else 0 end,
    'price_now_cents', case when phase = 'ended' then 0
                            when in_intro then (plan ->> 'intro_price_cents')::bigint
                            else (plan ->> 'price_cents')::bigint end,
    'full_price_cents', (plan ->> 'price_cents')::bigint,
    'intro_price_cents', (plan ->> 'intro_price_cents')::bigint,
    'next_charge_on', case when phase in ('intro', 'full') then next_on end,
    'next_charge_cents', case when phase in ('intro', 'full') then
                                case when next_on < sub.intro_ends_on then (plan ->> 'intro_price_cents')::bigint
                                     else (plan ->> 'price_cents')::bigint end end,
    'ends_on', sub.ends_on,
    'checkout_intro_months', case when phase in ('intro', 'cancelling') then private.intro_months_left(sub.intro_ends_on, today)
                                  else 0 end,
    'payment', jsonb_build_object('mode', sub.payment_mode, 'verified_at', sub.paid_verified_at),
    'usage', jsonb_build_object('active_clients', active_clients, 'has_checker', has_checker,
                                'clients_limit', plan -> 'clients_limit',
                                'checker_allowed', (plan ->> 'checker_allowed')::boolean),
    'over_limit', jsonb_typeof(plan -> 'clients_limit') = 'number' and active_clients > (plan ->> 'clients_limit')::integer
  );
end;
$$;
comment on function private.billing_state(uuid, timestamptz) is
  'The plan as the app shows it: phase, intro days left, this month''s price, the next charge, usage against the plan''s limits.';

-- ---------------------------------------------------------------------------------------------
-- Billing functions the app calls
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_billing(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role(p_business_id, array['owner', 'checker', 'admin']::public.member_role[]);
  return private.billing_state(p_business_id, now());
end;
$$;
comment on function public.get_billing(uuid) is 'Any member. The plan, its intro countdown, this month''s price, the next charge and the plan''s limits.';

create or replace function public.choose_plan(p_business_id uuid, p_plan public.plan_id)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.subscriptions;
  today date := private.sydney_date(now());
  has_checker boolean;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  if p_plan is null then
    raise exception 'Choose a plan.' using errcode = '22023';
  end if;
  select exists (select 1 from public.memberships m
                  where m.business_id = p_business_id and m.role = 'checker' and m.status <> 'removed')
    into has_checker;
  if p_plan = 'solo' and has_checker then
    raise exception 'Solo is for one person. Remove your checker first, or choose Crew.' using errcode = '22023';
  end if;

  select * into sub from public.subscriptions s where s.business_id = p_business_id for update;
  if sub.business_id is null then
    insert into public.subscriptions (business_id, plan, started_on, intro_ends_on)
    values (p_business_id, p_plan, today, (today + interval '3 months')::date);
    perform private.log(p_business_id, 'plan_changed', jsonb_build_object('from', null, 'to', p_plan, 'intro', true));
  elsif sub.cancelled_at is not null and today >= sub.ends_on then
    -- The plan ended. It starts again today at the full price: the intro is once per business.
    update public.subscriptions
       set plan = p_plan, started_on = today, intro_ends_on = today, cancelled_at = null, ends_on = null,
           paid_verified_at = null
     where business_id = p_business_id;
    perform private.log(p_business_id, 'plan_changed', jsonb_build_object('from', sub.plan, 'to', p_plan, 'intro', false));
  elsif sub.plan = p_plan then
    if sub.cancelled_at is null then
      return private.billing_state(p_business_id, now());
    end if;
    -- The same plan while it is cancelling: it simply keeps going.
    update public.subscriptions set cancelled_at = null, ends_on = null where business_id = p_business_id;
    perform private.log(p_business_id, 'plan_resumed', jsonb_build_object('plan', p_plan));
  else
    -- A different plan keeps the same dates. A card checkout was for the old price, so the card is added again.
    update public.subscriptions
       set plan = p_plan, cancelled_at = null, ends_on = null, paid_verified_at = null
     where business_id = p_business_id;
    perform private.log(p_business_id, 'plan_changed', jsonb_build_object('from', sub.plan, 'to', p_plan,
                        'intro', sub.intro_ends_on > today));
  end if;
  return private.billing_state(p_business_id, now());
end;
$$;
comment on function public.choose_plan(uuid, public.plan_id) is
  'Owner only. Starts a plan with 3 months at 80% off, or moves to another plan on the same dates. Solo allows no checker.';

create or replace function public.cancel_plan(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.subscriptions;
  today date := private.sydney_date(now());
  last_day date;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  select * into sub from public.subscriptions s where s.business_id = p_business_id for update;
  if sub.business_id is null then
    raise exception 'There is no plan to cancel.' using errcode = 'P0002';
  end if;
  if sub.cancelled_at is not null then
    return private.billing_state(p_business_id, now());
  end if;
  -- The plan runs to the end of the month already paid for.
  last_day := private.next_charge_on(sub.started_on, today);
  update public.subscriptions set cancelled_at = now(), ends_on = last_day where business_id = p_business_id;
  perform private.log(p_business_id, 'plan_cancelled', jsonb_build_object('plan', sub.plan, 'ends_on', last_day));
  return private.billing_state(p_business_id, now());
end;
$$;
comment on function public.cancel_plan(uuid) is 'Owner only. The plan stops at the end of the month already paid for.';

create or replace function public.resume_plan(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.subscriptions;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  select * into sub from public.subscriptions s where s.business_id = p_business_id for update;
  if sub.business_id is null or sub.cancelled_at is null then
    return private.billing_state(p_business_id, now());
  end if;
  if private.sydney_date(now()) >= sub.ends_on then
    raise exception 'This plan has ended. Choose a plan to start again.' using errcode = '22023';
  end if;
  update public.subscriptions set cancelled_at = null, ends_on = null where business_id = p_business_id;
  perform private.log(p_business_id, 'plan_resumed', jsonb_build_object('plan', sub.plan));
  return private.billing_state(p_business_id, now());
end;
$$;
comment on function public.resume_plan(uuid) is 'Owner only. Keeps a cancelled plan going, on the same dates, before it ends.';

-- Called by the billing-checkout Edge Function after Stripe (test mode) confirms the checkout was paid.
-- Stripe bills monthly from the checkout day, so the plan's dates move to that day, keeping the intro months still left
-- (never more than the checkout's coupon gave).
create or replace function public.job_record_checkout(
  p_business_id uuid, p_plan public.plan_id, p_checkout_id text, p_customer_id text, p_subscription_id text,
  p_intro_months integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.subscriptions;
  today date := private.sydney_date(now());
  months integer;
begin
  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'That business does not exist.' using errcode = 'P0002';
  end if;
  if p_plan is null or p_checkout_id is null then
    raise exception 'A checkout needs its plan and id.' using errcode = '22023';
  end if;
  select * into sub from public.subscriptions s where s.business_id = p_business_id for update;
  if sub.business_id is not null and sub.stripe_checkout_id = p_checkout_id and sub.paid_verified_at is not null then
    -- The same checkout confirmed twice (a reload of the return page): nothing more to do.
    return private.billing_state(p_business_id, now());
  end if;
  months := least(greatest(coalesce(p_intro_months, 0), 0),
                  (private.billing_state(p_business_id, now()) ->> 'checkout_intro_months')::integer);
  if sub.business_id is null then
    insert into public.subscriptions (business_id, plan, started_on, intro_ends_on)
    values (p_business_id, p_plan, today, (today + make_interval(months => months))::date);
  end if;
  update public.subscriptions
     set plan = p_plan, started_on = today, intro_ends_on = (today + make_interval(months => months))::date,
         cancelled_at = null, ends_on = null,
         payment_mode = 'stripe_test', stripe_checkout_id = p_checkout_id,
         stripe_customer_id = p_customer_id, stripe_subscription_id = p_subscription_id, paid_verified_at = now()
   where business_id = p_business_id;
  perform private.log(p_business_id, 'payment_recorded',
                      jsonb_build_object('plan', p_plan, 'mode', 'stripe_test', 'intro_months', months));
  return private.billing_state(p_business_id, now());
end;
$$;
comment on function public.job_record_checkout(uuid, public.plan_id, text, text, text, integer) is
  'Service role only. Records a Stripe test-mode checkout that Stripe confirmed as paid; safe to repeat.';

-- ---------------------------------------------------------------------------------------------
-- Promises to pay (the demonstration report's change 3)
-- ---------------------------------------------------------------------------------------------
alter table public.invoices
  add column promised_on date,
  add column promise_note text check (promise_note is null or char_length(promise_note) between 1 and 200),
  add column promise_recorded_at timestamptz,
  add constraint promise_has_time check ((promised_on is null) = (promise_recorded_at is null));
comment on column public.invoices.promised_on is 'The date the client promised to pay by. No reminders are drafted until it passes.';

create or replace function public.record_promise(p_invoice_id uuid, p_promised_on date, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  today date := private.sydney_date(now());
  note text := nullif(btrim(coalesce(p_note, '')), '');
  cancelled integer;
begin
  select * into inv from public.invoices i where i.id = p_invoice_id for update;
  if inv.id is null then
    raise exception 'That invoice is not in your records.' using errcode = 'P0002';
  end if;
  perform private.require_role(inv.business_id, array['owner', 'checker']::public.member_role[]);
  if inv.status <> 'open' then
    raise exception 'Invoice % is already %, so there is nothing to promise.', inv.invoice_number, inv.status using errcode = '22023';
  end if;
  if p_promised_on is null or p_promised_on < today then
    raise exception 'Choose today or a later date.' using errcode = '22023';
  end if;
  if p_promised_on > today + 60 then
    raise exception 'Choose a date within 60 days. For longer, pause the client instead.' using errcode = '22023';
  end if;
  if note is not null and char_length(note) > 200 then
    raise exception 'Keep the note to 200 characters.' using errcode = '22023';
  end if;
  update public.invoices set promised_on = p_promised_on, promise_note = note, promise_recorded_at = now()
   where id = p_invoice_id;
  cancelled := private.cancel_live_drafts(p_invoice_id, 'promised');
  perform private.log(inv.business_id, 'promise_recorded',
                      jsonb_build_object('promised_on', p_promised_on, 'drafts_cancelled', cancelled),
                      p_invoice_id, null, inv.client_id);
  return jsonb_build_object('promised_on', p_promised_on, 'drafts_cancelled', cancelled);
end;
$$;
comment on function public.record_promise(uuid, date, text) is
  'Owner or checker. The client promised to pay by a date: the live draft is cancelled and no reminder is drafted until then.';

create or replace function public.clear_promise(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices i where i.id = p_invoice_id for update;
  if inv.id is null then
    raise exception 'That invoice is not in your records.' using errcode = 'P0002';
  end if;
  perform private.require_role(inv.business_id, array['owner', 'checker']::public.member_role[]);
  if inv.promised_on is null then
    return;
  end if;
  update public.invoices set promised_on = null, promise_note = null, promise_recorded_at = null where id = p_invoice_id;
  perform private.log(inv.business_id, 'promise_cleared', jsonb_build_object('was', inv.promised_on), p_invoice_id, null, inv.client_id);
end;
$$;
comment on function public.clear_promise(uuid) is 'Owner or checker. Removes a promise to pay; the next weekly run can draft a reminder again.';

-- BR-01 with promises: a promised invoice is skipped until the promised date has passed.
create or replace function private.ineligibility(p_invoice_id uuid, p_as_of timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when i.status <> 'open' then 'not_open'
    when private.days_overdue(i.due_date, p_as_of) < b.overdue_threshold_days then 'not_overdue_enough'
    when c.paused then 'client_paused'
    when i.promised_on is not null and i.promised_on >= private.sydney_date(p_as_of) then 'promised'
    when exists (select 1 from public.reminder_drafts d where d.invoice_id = i.id and d.status in ('waiting', 'approved')) then 'live_draft_exists'
    when i.last_reminder_sent_at is not null
         and private.sydney_date(p_as_of) - private.sydney_date(i.last_reminder_sent_at) < b.cooldown_days then 'cooldown'
    when c.email is null then 'email_missing'
    else null
  end
  from public.invoices i
  join public.clients c on c.id = i.client_id
  join public.businesses b on b.id = i.business_id
  where i.id = p_invoice_id;
$$;
comment on function private.ineligibility(uuid, timestamptz) is
  'BR-01, BR-04, BR-05, BR-11 and promises to pay for one invoice: null when a draft should be made, otherwise the reason not to.';

-- The briefing (FR-11 to FR-13), now with promises: kept ones wait, missed ones say so.
create or replace function private.build_briefing(p_business_id uuid, p_as_of timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select * from public.businesses where id = p_business_id
  ),
  open_invoices as (
    select i.id, i.invoice_number, i.amount_due_cents, i.due_date, i.reminders_sent_count, i.last_reminder_sent_at,
           i.promised_on,
           c.id as client_id, c.name as client_name, c.paused as client_paused, c.email is null as email_missing,
           private.days_overdue(i.due_date, p_as_of) as days_overdue,
           exists (select 1 from public.reminder_drafts d where d.invoice_id = i.id and d.status = 'waiting') as has_waiting_draft,
           (select b.call_first_threshold_cents from b) is not null
             and i.amount_due_cents >= (select b.call_first_threshold_cents from b) as call_first
    from public.invoices i
    join public.clients c on c.id = i.client_id
    where i.business_id = p_business_id and i.status = 'open'
  ),
  waiting as (
    select d.id, i.amount_due_cents, private.days_overdue(i.due_date, p_as_of) as days_overdue, i.invoice_number
    from public.reminder_drafts d
    join public.invoices i on i.id = d.invoice_id
    where d.business_id = p_business_id and d.status = 'waiting'
  ),
  attention as (
    select 'email_missing' as kind, o.id as invoice_id, o.invoice_number, o.client_id, o.client_name, o.amount_due_cents,
           jsonb_build_object('days_overdue', o.days_overdue) as detail
    from open_invoices o, b
    where o.email_missing and not o.client_paused and o.days_overdue >= b.overdue_threshold_days
      and (o.promised_on is null or o.promised_on < private.sydney_date(p_as_of))
    union all
    select a.kind::text, i.id, i.invoice_number, c.id, c.name, i.amount_due_cents, a.detail
    from public.attention_items a
    join public.invoices i on i.id = a.invoice_id
    join public.clients c on c.id = i.client_id
    where a.business_id = p_business_id and a.resolved_at is null
  )
  select jsonb_build_object(
    'business', (select jsonb_build_object('id', b.id, 'name', b.name, 'owner_name', b.owner_name,
                                           'is_test_data', b.is_test_data, 'overdue_threshold_days', b.overdue_threshold_days) from b),
    'as_of', p_as_of,
    'as_of_date', private.sydney_date(p_as_of),
    'totals', (
      select jsonb_build_object(
        'owed_cents', coalesce(sum(amount_due_cents), 0),
        'overdue_cents', coalesce(sum(amount_due_cents) filter (where days_overdue > 0), 0),
        'open_count', count(*),
        'overdue_count', count(*) filter (where days_overdue > 0),
        'due_this_week_cents', coalesce(sum(amount_due_cents) filter (where days_overdue between -7 and 0), 0),
        'due_this_week_count', count(*) filter (where days_overdue between -7 and 0)
      ) from open_invoices
    ),
    'drafts_waiting', (select count(*) from waiting),
    'first_draft_id', (select w.id from waiting w order by w.amount_due_cents desc, w.days_overdue desc, w.invoice_number limit 1),
    'overdue', coalesce((
      select jsonb_agg(jsonb_build_object(
               'invoice_id', o.id, 'invoice_number', o.invoice_number, 'client_id', o.client_id,
               'client_name', o.client_name, 'amount_due_cents', o.amount_due_cents, 'due_date', o.due_date,
               'days_overdue', o.days_overdue, 'has_waiting_draft', o.has_waiting_draft,
               'client_paused', o.client_paused, 'call_first', o.call_first,
               'reminders_sent', o.reminders_sent_count, 'promised_on', o.promised_on)
             order by o.amount_due_cents desc, o.days_overdue desc, o.invoice_number)
      from open_invoices o where o.days_overdue > 0), '[]'::jsonb),
    'needs_attention', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', a.kind, 'invoice_id', a.invoice_id, 'invoice_number', a.invoice_number,
               'client_id', a.client_id, 'client_name', a.client_name,
               'amount_due_cents', a.amount_due_cents, 'detail', a.detail)
             order by a.amount_due_cents desc, a.invoice_number)
      from attention a), '[]'::jsonb),
    'paused_clients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_id', c.id, 'name', c.name,
               'open_invoices', (select count(*) from open_invoices o where o.client_id = c.id),
               'overdue_cents', (select coalesce(sum(o.amount_due_cents), 0) from open_invoices o where o.client_id = c.id and o.days_overdue > 0))
             order by c.name)
      from public.clients c where c.business_id = p_business_id and c.paused), '[]'::jsonb),
    'promises', coalesce((
      select jsonb_agg(jsonb_build_object(
               'invoice_id', o.id, 'invoice_number', o.invoice_number, 'client_id', o.client_id,
               'client_name', o.client_name, 'amount_due_cents', o.amount_due_cents, 'promised_on', o.promised_on,
               'missed', o.promised_on < private.sydney_date(p_as_of))
             order by o.promised_on, o.invoice_number)
      from open_invoices o where o.promised_on is not null), '[]'::jsonb)
  );
$$;
comment on function private.build_briefing(uuid, timestamptz) is
  'The briefing as JSON: totals, overdue invoices largest first (BR-07), drafts waiting, Needs attention, paused clients and promises to pay. Shared by EM-01 and UI-02.';

-- The Invoices screen's read model gains the promise (columns added at the end; RLS still applies).
create or replace view public.invoice_list
with (security_invoker = true)
as
select
  i.id,
  i.business_id,
  i.client_id,
  c.name as client_name,
  c.email is not null as client_has_email,
  c.paused as client_paused,
  c.tone as client_tone,
  i.invoice_number,
  i.issue_date,
  i.due_date,
  i.amount_due_cents,
  i.status,
  i.paid_date,
  i.close_reason,
  i.last_reminder_sent_at,
  i.reminders_sent_count,
  private.days_overdue(i.due_date, now()) as days_past_due,
  case
    when i.status = 'paid' then 'paid'
    when i.status = 'closed' then 'closed'
    when private.days_overdue(i.due_date, now()) > 0 then 'overdue'
    when private.days_overdue(i.due_date, now()) >= -7 then 'due_soon'
    else 'due'
  end as display_status,
  i.promised_on,
  i.promise_note
from public.invoices i
join public.clients c on c.id = i.client_id;
revoke all on public.invoice_list from anon, authenticated;
grant select on public.invoice_list to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Joining a business with a code
-- ---------------------------------------------------------------------------------------------
alter table public.memberships
  add column join_code text unique check (join_code is null or join_code ~ '^[A-HJKMNP-Z2-9]{8}$'),
  add column join_code_expires_at timestamptz,
  add constraint join_code_has_expiry check ((join_code is null) = (join_code_expires_at is null));
comment on column public.memberships.join_code is
  '8 characters, no I, L, O, 0 or 1. Shown to the owner; the invited person enters it to join. Cleared once used.';

create or replace function private.new_join_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  bytes bytea;
begin
  loop
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    select string_agg(substr(alphabet, 1 + (get_byte(bytes, n) % 31), 1), '' order by n)
      into code from generate_series(0, 7) as n;
    exit when not exists (select 1 from public.memberships m where m.join_code = code);
  end loop;
  return code;
end;
$$;

-- Invitations now carry a code, and Solo allows no checker.
create or replace function public.invite_checker(p_business_id uuid, p_email text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := private.clean_email(p_email);
  owner_email text;
  current_plan public.plan_id;
  new_id uuid;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  if v_email is null or v_email <> lower(btrim(p_email)) then
    raise exception 'Enter one valid email address.' using errcode = '22023';
  end if;
  select s.plan into current_plan from public.subscriptions s
   where s.business_id = p_business_id
     and (s.cancelled_at is null or private.sydney_date(now()) < s.ends_on);
  if current_plan = 'solo' then
    raise exception 'Solo is for one person. Move to Crew to add a checker.' using errcode = '22023';
  end if;
  select lower(m.invited_email) into owner_email from public.memberships m
   where m.business_id = p_business_id and m.role = 'owner' and m.status <> 'removed';
  if v_email = owner_email then
    raise exception 'The checker must be someone other than the owner.' using errcode = '22023';
  end if;
  if exists (select 1 from public.memberships m where m.business_id = p_business_id and m.role = 'checker' and m.status <> 'removed') then
    raise exception 'This business already has a checker. Remove them first.' using errcode = '23505';
  end if;
  insert into public.memberships (business_id, invited_email, display_name, role, status, invited_by, join_code, join_code_expires_at)
  values (p_business_id, v_email, btrim(p_display_name), 'checker', 'invited', (select auth.uid()),
          private.new_join_code(), now() + interval '7 days')
  returning id into new_id;
  perform private.log(p_business_id, 'member_invited', jsonb_build_object('role', 'checker'));
  return new_id;
end;
$$;
comment on function public.invite_checker(uuid, text, text) is
  'Owner only, not on Solo. Records the invitation with a join code that works for 7 days (FR-25).';

create or replace function public.join_with_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  invitation public.memberships;
begin
  if caller is null then
    raise exception 'Sign in to continue.' using errcode = '28000';
  end if;
  if code !~ '^[A-HJKMNP-Z2-9]{8}$' then
    raise exception 'That code isn''t right. It has 8 letters and numbers, like K7QF-2MWD.' using errcode = '22023';
  end if;
  select * into invitation from public.memberships m where m.join_code = code for update;
  if invitation.id is null or invitation.status <> 'invited' or invitation.join_code_expires_at < now() then
    raise exception 'That code has expired or been used. Ask the owner for a new invitation.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.memberships m
              where m.business_id = invitation.business_id and m.user_id = caller and m.status <> 'removed') then
    raise exception 'You''re already on this team.' using errcode = '23505';
  end if;
  update public.memberships
     set user_id = caller, status = 'active', accepted_at = now(), join_code = null, join_code_expires_at = null
   where id = invitation.id;
  perform private.log(invitation.business_id, 'member_joined', jsonb_build_object('role', invitation.role, 'via', 'code'));
  return jsonb_build_object('business_id', invitation.business_id, 'role', invitation.role);
end;
$$;
comment on function public.join_with_code(text) is
  'Any signed-in account. Uses an invitation''s code to join that business in the invited role; the code then stops working.';

-- As in migration 8, and an invitation accepted by email also retires its code.
create or replace function public.accept_invitations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text;
  invitation record;
begin
  if caller is null then
    raise exception 'Sign in to continue.' using errcode = '28000';
  end if;
  select lower(u.email) into caller_email from auth.users u where u.id = caller;
  -- Nobody checked a demonstration account's address (no email is sent), so it can't prove an invitation is its own.
  -- It joins with the invitation's code instead (join_with_code).
  if not private.is_demo_account(caller) then
    for invitation in
      select m.id, m.business_id, m.role from public.memberships m
      where m.status = 'invited' and lower(m.invited_email) = caller_email
      for update
    loop
      update public.memberships
         set user_id = caller, status = 'active', accepted_at = now(), join_code = null, join_code_expires_at = null
       where id = invitation.id;
      perform private.log(invitation.business_id, 'member_joined', jsonb_build_object('role', invitation.role));
    end loop;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('business_id', m.business_id, 'role', m.role) order by m.accepted_at)
    from public.memberships m
    where m.user_id = caller and m.status = 'active'
  ), '[]'::jsonb);
end;
$$;
comment on function public.accept_invitations() is 'Called after every sign-in. Activates invitations for the caller''s email and returns their businesses. An empty list means "Ask the owner to invite you" (FR-01). Accounts made by the demonstration sign-up never accept invitations by email; they join with a code (migration 9).';

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
          case when private.is_demo_account(caller) then date '2026-11-25' end)
  returning id into new_id;
  insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, invited_by, accepted_at)
  values (new_id, caller, lower(coalesce(caller_email, p_reply_to_email)), btrim(p_owner_name), 'owner', 'active', caller, now());
  perform private.log(new_id, 'business_created', jsonb_build_object('is_test_data', true));
  return new_id;
end;
$$;
comment on function public.create_business(text, text, text, text) is
  'Setup: creates the business as Test data and makes the caller its owner (FR-02, D7). At most 5 per account.';

-- The seed's sample clients and 12 open invoices, dated from today, then this week's drafts from the templates.
-- Shared by the demonstration sign-up and "Start with sample Test data" in setup. Keep in step with supabase/seed.sql.
create or replace function private.add_sample_data(p_business_id uuid, p_source text default 'sample_data')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  team_uploader constant uuid := '0d5e0000-0000-4000-8000-0000000000ff';
  today constant date := private.sydney_date(now());
  sample_import uuid;
  bayside uuid;
  northshore uuid;
  chen uuid;
  coastline uuid;
  greenway uuid;
  ridgeway uuid;
  run_id uuid;
  planned record;
  template record;
  drafted integer := 0;
begin
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'Bayside Builders (Test data)', 'Sam', 'accounts@bayside-builders.example', 'gentle', 'head_contractor')
  returning id into bayside;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'Northshore Homes (Test data)', 'Priya', 'pay@northshore-homes.example', 'standard', 'head_contractor')
  returning id into northshore;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'M. Chen Renovation (Test data)', 'Mei', 'mei@chen-reno.example', 'standard', 'homeowner')
  returning id into chen;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'Coastline Fitouts (Test data)', null, null, 'standard', 'other')
  returning id into coastline;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group)
  values (p_business_id, 'Greenway Strata (Test data)', 'Tom', 'tom@greenway-strata.example', 'firm', 'other')
  returning id into greenway;
  insert into public.clients (business_id, name, contact_name, email, tone, client_group, paused, paused_at)
  values (p_business_id, 'Ridgeway Developments (Test data)', 'Lee', 'lee@ridgeway-dev.example', 'standard', 'head_contractor', true, now())
  returning id into ridgeway;

  insert into public.imports (business_id, uploaded_by, file_name, source_format, column_mapping, rows_read, rows_saved,
                              rows_skipped, file_total_cents, saved_total_cents, invoices_added)
  values (p_business_id, team_uploader, 'test-data-open-invoices.csv', 'team_template',
          '{"client":"Client","email":"Email","contact":"Contact","invoice_number":"Invoice number","issue_date":"Issue date","due_date":"Due date","amount_due":"Amount due"}',
          12, 12, 0, 6244000, 6244000, 12)
  returning id into sample_import;

  insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents,
                               first_seen_import_id, last_seen_import_id) values
    (p_business_id, bayside,    '1043', today - 44, today - 14,  125000, sample_import, sample_import),
    (p_business_id, northshore, '1051', today - 51, today - 21,  845000, sample_import, sample_import),
    (p_business_id, chen,       '1056', today - 44, today - 30,  320000, sample_import, sample_import),
    (p_business_id, coastline,  '1060', today - 40, today - 10,  218000, sample_import, sample_import),
    (p_business_id, greenway,   '1062', today - 75, today - 45,   64000, sample_import, sample_import),
    (p_business_id, ridgeway,   '1064', today - 65, today - 35,  590000, sample_import, sample_import),
    (p_business_id, bayside,    '1066', today - 38, today - 8,  1870000, sample_import, sample_import),
    (p_business_id, northshore, '1068', today - 36, today - 6,   99000, sample_import, sample_import),
    (p_business_id, chen,       '1070', today - 17, today - 3,   148000, sample_import, sample_import),
    (p_business_id, greenway,   '1072', today - 28, today + 2,   275000, sample_import, sample_import),
    (p_business_id, bayside,    '1074', today - 25, today + 5,   430000, sample_import, sample_import),
    (p_business_id, northshore, '1076', today - 10, today + 20, 1260000, sample_import, sample_import);

  update public.invoices set last_reminder_sent_at = now() - interval '8 days', reminders_sent_count = 1
   where invoices.business_id = p_business_id and invoices.invoice_number = '1062';

  -- This week's drafts with the fallback templates, as the seed makes them: 1066, 1051, 1056, 1043 and 1062.
  -- Forced, because a business set up before Sunday may already have an empty run for this week.
  run_id := (public.job_start('weekly_run', p_business_id, (today - (extract(isodow from today)::integer % 7))::text,
                              'manual', null, true)) ->> 'run_id';
  for planned in select * from public.job_plan_weekly_run(run_id) loop
    select * into template from public.job_get_templates() t where t.tone = planned.tone;
    perform public.job_save_draft(run_id, planned.invoice_id, template.subject, template.body, 'template',
                                  template.version, null, 0::smallint, 'ai_disabled');
    drafted := drafted + 1;
  end loop;
  perform public.job_finish(run_id, 'succeeded', jsonb_build_object('drafts_created', drafted, 'source', p_source));
  return drafted;
end;
$$;
comment on function private.add_sample_data(uuid, text) is
  'The seed''s 6 clients and 12 open invoices (A$62,440.00 owed, A$42,790.00 overdue) dated from today, and this week''s template drafts.';

create or replace function public.add_sample_invoices(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  drafted integer;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  if not (select b.is_test_data from public.businesses b where b.id = p_business_id) then
    raise exception 'Sample invoices are only for Test data businesses.' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices i where i.business_id = p_business_id)
     or exists (select 1 from public.clients c where c.business_id = p_business_id) then
    raise exception 'This business already has clients or invoices. Import your file instead.' using errcode = '23505';
  end if;
  drafted := private.add_sample_data(p_business_id);
  perform private.log(p_business_id, 'import_completed', jsonb_build_object('sample', true, 'rows', 12, 'drafts', drafted));
  return jsonb_build_object('invoices', 12, 'drafts', drafted);
end;
$$;
comment on function public.add_sample_invoices(uuid) is
  'Owner only, Test data businesses with no clients yet. Adds the seed''s sample clients and invoices and this week''s drafts.';

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
          'Short and friendly. First names. No jargon.', true, date '2026-11-25')
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

-- Export (FR-03) includes the plan.
create or replace function public.export_business_data(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export jsonb;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  select jsonb_build_object(
    'exported_at', now(),
    'business', (select to_jsonb(b) from public.businesses b where b.id = p_business_id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('display_name', m.display_name, 'email', m.invited_email, 'role', m.role,
                                                             'status', m.status, 'invited_at', m.invited_at, 'accepted_at', m.accepted_at))
                         from public.memberships m where m.business_id = p_business_id), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from public.clients c where c.business_id = p_business_id), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(to_jsonb(i) order by i.invoice_number) from public.invoices i where i.business_id = p_business_id), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(to_jsonb(x) order by x.uploaded_at) from public.imports x where x.business_id = p_business_id), '[]'::jsonb),
    'reminder_drafts', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.reminder_drafts d where d.business_id = p_business_id), '[]'::jsonb),
    'attention_items', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.attention_items a where a.business_id = p_business_id), '[]'::jsonb),
    'activity_log', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.activity_log l where l.business_id = p_business_id), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(to_jsonb(q) order by q.quote_number) from public.quotes q where q.business_id = p_business_id), '[]'::jsonb),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('plan', s.plan, 'started_on', s.started_on, 'intro_ends_on', s.intro_ends_on,
                                                                   'cancelled_at', s.cancelled_at, 'ends_on', s.ends_on, 'payment_mode', s.payment_mode,
                                                                   'paid_verified_at', s.paid_verified_at))
                               from public.subscriptions s where s.business_id = p_business_id), '[]'::jsonb)
  ) into v_export;
  perform private.log(p_business_id, 'data_exported', '{}'::jsonb);
  return v_export;
end;
$$;
comment on function public.export_business_data(uuid) is 'FR-03. Owner only. Every record as JSON, including the plan; the app saves one CSV file per list.';

-- ---------------------------------------------------------------------------------------------
-- Tone presets: a name and a tone the owner reuses, remembered by each client
-- ---------------------------------------------------------------------------------------------
create table public.tone_presets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  tone public.tone not null,
  note text check (note is null or char_length(note) <= 160),
  client_group public.client_group,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.tone_presets is
  'Saved tones, such as "Good payer: gentle". A preset with a client group is given to new clients in that group.';
comment on column public.tone_presets.note is 'The owner''s own reminder of when to use it. Never sent to the AI or to clients.';
create unique index tone_presets_name_once on public.tone_presets (business_id, lower(btrim(name)));
create unique index tone_presets_group_once on public.tone_presets (business_id, client_group) where client_group is not null;
create trigger tone_presets_touch before update on public.tone_presets for each row execute function private.touch_updated_at();
alter table public.tone_presets enable row level security;
create policy "Members read their presets"
  on public.tone_presets for select to authenticated
  using (business_id in (select private.my_business_ids()));
revoke all on public.tone_presets from anon, authenticated;
grant select on public.tone_presets to authenticated;
grant select, insert, update, delete on public.tone_presets to service_role;

alter table public.clients add column preset_id uuid references public.tone_presets (id) on delete set null;
comment on column public.clients.preset_id is 'The preset this client''s tone came from. Cleared when the tone is changed by hand.';

alter table public.businesses add column auto_firm_after smallint check (auto_firm_after between 1 and 6);
comment on column public.businesses.auto_firm_after is
  'Off when null. After this many reminders on an unpaid invoice, the weekly run moves the client one tone firmer, once a week, up to firm.';

-- New clients get their group's preset; changing a tone by hand forgets the preset.
create or replace function private.client_preset_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  preset public.tone_presets;
begin
  if tg_op = 'INSERT' then
    if new.preset_id is null and new.client_group is not null then
      select * into preset from public.tone_presets p where p.business_id = new.business_id and p.client_group = new.client_group;
      if preset.id is not null then
        new.preset_id := preset.id;
        new.tone := preset.tone;
      end if;
    end if;
  elsif new.tone is distinct from old.tone and new.preset_id is not distinct from old.preset_id and new.preset_id is not null
        and new.tone is distinct from (select p.tone from public.tone_presets p where p.id = new.preset_id) then
    new.preset_id := null;
  end if;
  return new;
end;
$$;
create trigger clients_preset_rules before insert or update on public.clients for each row execute function private.client_preset_rules();

create or replace function public.save_preset(
  p_business_id uuid, p_name text, p_tone public.tone, p_note text default null, p_client_group public.client_group default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  if char_length(v_name) not between 1 and 40 then
    raise exception 'Give the preset a name of up to 40 characters.' using errcode = '22023';
  end if;
  if p_tone is null then
    raise exception 'Choose a tone.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 160 then
    raise exception 'Keep the note to 160 characters.' using errcode = '22023';
  end if;
  select p.id into v_id from public.tone_presets p where p.business_id = p_business_id and lower(btrim(p.name)) = lower(v_name);
  if v_id is null and (select count(*) from public.tone_presets p where p.business_id = p_business_id) >= 12 then
    raise exception 'You have 12 presets, the most a business can keep. Delete one first.' using errcode = '22023';
  end if;
  if p_client_group is not null then
    -- One preset per group: the newest wins.
    update public.tone_presets set client_group = null
     where business_id = p_business_id and client_group = p_client_group and id is distinct from v_id;
  end if;
  if v_id is null then
    insert into public.tone_presets (business_id, name, tone, note, client_group)
    values (p_business_id, v_name, p_tone, v_note, p_client_group)
    returning id into v_id;
  else
    update public.tone_presets set name = v_name, tone = p_tone, note = v_note, client_group = p_client_group where id = v_id;
    -- Clients that remember this preset follow it.
    update public.clients set tone = p_tone where clients.preset_id = v_id and clients.tone <> p_tone;
  end if;
  perform private.log(p_business_id, 'preset_saved',
                      jsonb_build_object('name', v_name, 'tone', p_tone, 'client_group', p_client_group));
  return v_id;
end;
$$;
comment on function public.save_preset(uuid, text, public.tone, text, public.client_group) is
  'Owner only. Saves a preset by name (up to 12). With a client group, new clients in that group get it automatically.';

create or replace function public.delete_preset(p_preset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  preset public.tone_presets;
begin
  select * into preset from public.tone_presets where id = p_preset_id;
  if preset.id is null then
    raise exception 'That preset is not in your records.' using errcode = 'P0002';
  end if;
  perform private.require_role(preset.business_id, array['owner']::public.member_role[]);
  delete from public.tone_presets where id = p_preset_id;
  perform private.log(preset.business_id, 'preset_deleted', jsonb_build_object('name', preset.name));
end;
$$;
comment on function public.delete_preset(uuid) is 'Owner only. Clients keep their tone; they just stop remembering the preset.';

create or replace function public.apply_preset(p_preset_id uuid, p_client_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  preset public.tone_presets;
  changed integer;
begin
  select * into preset from public.tone_presets where id = p_preset_id;
  if preset.id is null then
    raise exception 'That preset is not in your records.' using errcode = 'P0002';
  end if;
  perform private.require_role(preset.business_id, array['owner']::public.member_role[]);
  if exists (select 1 from unnest(coalesce(p_client_ids, '{}')) as x(id)
              where not exists (select 1 from public.clients c where c.id = x.id and c.business_id = preset.business_id)) then
    raise exception 'Every client must belong to this business.' using errcode = '42501';
  end if;
  update public.clients c set tone = preset.tone, preset_id = preset.id
   where c.business_id = preset.business_id and c.id = any (p_client_ids)
     and (c.preset_id is distinct from preset.id or c.tone <> preset.tone);
  get diagnostics changed = row_count;
  perform private.log(preset.business_id, 'preset_applied',
                      jsonb_build_object('name', preset.name, 'tone', preset.tone, 'clients', changed));
  return changed;
end;
$$;
comment on function public.apply_preset(uuid, uuid[]) is 'Owner only. Gives clients the preset''s tone; they remember it. New drafts use it (FR-23).';

-- Settings gain auto_firm_after (as migration 6 otherwise).
create or replace function public.update_settings(p_business_id uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed constant text[] := array['name', 'owner_name', 'sign_off', 'reply_to_email', 'overdue_threshold_days', 'cooldown_days',
                                   'briefing_weekday', 'briefing_time', 'checker_may_send', 'style_note', 'example_reminder',
                                   'call_first_threshold_cents', 'xero_reminders', 'column_mapping', 'auto_firm_after'];
  unknown text;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'Nothing to change.' using errcode = '22023';
  end if;
  select k into unknown from jsonb_object_keys(p_changes) as k where not (k = any (allowed)) limit 1;
  if unknown is not null then
    raise exception 'The setting "%" cannot be changed here.', unknown using errcode = '22023';
  end if;

  update public.businesses b set
    name = case when p_changes ? 'name' then btrim(p_changes ->> 'name') else b.name end,
    owner_name = case when p_changes ? 'owner_name' then btrim(p_changes ->> 'owner_name') else b.owner_name end,
    sign_off = case when p_changes ? 'sign_off' then btrim(p_changes ->> 'sign_off') else b.sign_off end,
    reply_to_email = case when p_changes ? 'reply_to_email' then lower(btrim(p_changes ->> 'reply_to_email')) else b.reply_to_email end,
    overdue_threshold_days = case when p_changes ? 'overdue_threshold_days' then (p_changes ->> 'overdue_threshold_days')::smallint else b.overdue_threshold_days end,
    cooldown_days = case when p_changes ? 'cooldown_days' then (p_changes ->> 'cooldown_days')::smallint else b.cooldown_days end,
    briefing_weekday = case when p_changes ? 'briefing_weekday' then (p_changes ->> 'briefing_weekday')::smallint else b.briefing_weekday end,
    briefing_time = case when p_changes ? 'briefing_time' then (p_changes ->> 'briefing_time')::time else b.briefing_time end,
    checker_may_send = case when p_changes ? 'checker_may_send' then (p_changes ->> 'checker_may_send')::boolean else b.checker_may_send end,
    style_note = case when p_changes ? 'style_note' then nullif(btrim(p_changes ->> 'style_note'), '') else b.style_note end,
    example_reminder = case when p_changes ? 'example_reminder' then nullif(btrim(p_changes ->> 'example_reminder'), '') else b.example_reminder end,
    call_first_threshold_cents = case when p_changes ? 'call_first_threshold_cents' then (p_changes ->> 'call_first_threshold_cents')::bigint else b.call_first_threshold_cents end,
    xero_reminders = case when p_changes ? 'xero_reminders' then (p_changes ->> 'xero_reminders')::public.xero_reminders_status else b.xero_reminders end,
    column_mapping = case when p_changes ? 'column_mapping' then p_changes -> 'column_mapping' else b.column_mapping end,
    auto_firm_after = case when p_changes ? 'auto_firm_after' then (p_changes ->> 'auto_firm_after')::smallint else b.auto_firm_after end
  where b.id = p_business_id;

  perform private.log(p_business_id, 'settings_changed',
                      jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(p_changes) as k)));
end;
$$;
comment on function public.update_settings(uuid, jsonb) is 'Owner only. Changes listed settings (FR-02, FR-27, FR-32, FR-33, D3, firmer by itself); they apply from the next run.';

-- The weekly run as in migration 7, with "firmer by itself" before the invoices to draft are chosen.
create or replace function public.job_plan_weekly_run(p_run_id uuid, p_as_of timestamptz default null)
returns table (
  invoice_id uuid,
  tone public.tone,
  days_overdue integer,
  reminders_sent_before integer,
  style_note text,
  example_reminder text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  run public.job_runs;
  business public.businesses;
  as_of timestamptz := coalesce(p_as_of, now());
  item record;
begin
  select * into run from public.job_runs where id = p_run_id for update;
  if not found or run.job <> 'weekly_run' or run.status <> 'running' or run.business_id is null then
    raise exception 'Start a weekly run with job_start first.' using errcode = '22023';
  end if;
  select * into business from public.businesses where id = run.business_id for update;
  update public.job_runs set stats = stats || jsonb_build_object('as_of', as_of) where id = p_run_id;

  for item in
    select distinct d.invoice_id from public.reminder_drafts d
    where d.business_id = business.id and d.status in ('waiting', 'approved') and d.run_id is distinct from p_run_id
  loop
    perform private.cancel_live_drafts(item.invoice_id, 'superseded', p_run_id);
  end loop;

  for item in
    select i.id from public.invoices i
    where i.business_id = business.id and i.status = 'open'
      and private.ineligibility(i.id, as_of) = 'email_missing'
      and not exists (select 1 from public.activity_log l
                      where l.run_id = p_run_id and l.invoice_id = i.id and l.action = 'draft_flagged')
  loop
    perform private.log(business.id, 'draft_flagged', jsonb_build_object('reason', 'email_missing'), item.id, null, null, null, p_run_id);
  end loop;

  -- Firmer by itself: a client with an invoice about to get another reminder after auto_firm_after reminders moves one
  -- tone firmer, once per run, never past firm. The owner still approves every draft.
  if business.auto_firm_after is not null then
    for item in
      select c.id, c.tone from public.clients c
      where c.business_id = business.id and c.tone <> 'firm'
        and exists (select 1 from public.invoices i
                    where i.client_id = c.id and i.status = 'open' and i.reminders_sent_count >= business.auto_firm_after
                      and private.ineligibility(i.id, as_of) is null)
        and not exists (select 1 from public.activity_log l
                        where l.run_id = p_run_id and l.client_id = c.id and l.action = 'tone_stepped_up')
    loop
      update public.clients set tone = case item.tone when 'gentle' then 'standard'::public.tone else 'firm'::public.tone end,
                                preset_id = null
       where id = item.id;
      perform private.log(business.id, 'tone_stepped_up',
                          jsonb_build_object('from', item.tone, 'to', case item.tone when 'gentle' then 'standard' else 'firm' end,
                                             'after_reminders', business.auto_firm_after),
                          null, null, item.id, null, p_run_id);
    end loop;
  end if;

  return query
    select i.id, c.tone, private.days_overdue(i.due_date, as_of), i.reminders_sent_count, business.style_note, business.example_reminder
    from public.invoices i
    join public.clients c on c.id = i.client_id
    where i.business_id = business.id and i.status = 'open' and private.ineligibility(i.id, as_of) is null
    order by i.amount_due_cents desc, i.due_date, i.invoice_number;
end;
$$;
comment on function public.job_plan_weekly_run(uuid, timestamptz) is
  'BR-10 replacement, FR-10 flags, firmer by itself (opt-in), then the invoices to draft (BR-01) with the only fields the AI may see (AI-03).';

select private.apply_function_grants();
