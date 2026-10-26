-- Payprentice · migration 3 of 7 · private helpers
-- Sydney dates, money formatting, placeholder filling, the AI-06 checks, CSV value parsing,
-- membership checks and the activity-log writer. None of these is exposed through the API.

-- ---------------------------------------------------------------------------------------------
-- Dates, money and text (BR-06, BR-14)
-- ---------------------------------------------------------------------------------------------
create or replace function private.sydney_date(p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Australia/Sydney')::date;
$$;
comment on function private.sydney_date(timestamptz) is 'The Sydney calendar date of a moment (BR-06, BR-13). Handles daylight saving.';

create or replace function private.days_overdue(p_due_date date, p_as_of timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select private.sydney_date(p_as_of) - p_due_date;
$$;
comment on function private.days_overdue(date, timestamptz) is 'Today''s Sydney date minus the due date (BR-06). Positive means overdue; 0 or less means not yet overdue.';

create or replace function private.format_aud(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_cents < 0 then '-' else '' end
         || '$' || to_char(abs(p_cents) / 100.0, 'FM999,999,999,990.00');
$$;
comment on function private.format_aud(bigint) is 'Whole cents to "$1,250.00" (BR-14).';

create or replace function private.format_date(p_date date)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_date, 'Dy FMDD Mon YYYY');
$$;
comment on function private.format_date(date) is 'A date as "Mon 12 Oct 2026", the house style for reminders and the briefing.';

create or replace function private.regex_escape(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(p_text, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g');
$$;

create or replace function private.render_template(p_template text, p_facts jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  fact record;
  rendered text := p_template;
begin
  for fact in select key, value from jsonb_each_text(p_facts) loop
    rendered := replace(rendered, '{' || fact.key || '}', coalesce(fact.value, ''));
  end loop;
  -- "1 days overdue" reads wrong; facts are numbers, so fix the one plural the templates can produce.
  return regexp_replace(rendered, '\m1 days\M', '1 day', 'g');
end;
$$;
comment on function private.render_template(text, jsonb) is 'Fills {placeholders} from a JSON object of facts (AI-02) and writes "1 day", not "1 days". The AI never sees the values.';

create or replace function private.signature(p_sign_off text, p_owner_name text, p_business_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select E'\n\n' || btrim(p_sign_off) || E'\n' || btrim(p_owner_name) || E'\n' || btrim(p_business_name);
$$;
comment on function private.signature(text, text, text) is 'The signature the app adds below every reminder, from the business settings (FR-02).';

-- ---------------------------------------------------------------------------------------------
-- AI-06: checks every AI reply and every fallback template before a draft is saved
-- ---------------------------------------------------------------------------------------------
create or replace function private.check_reminder_template(p_subject text, p_body text, p_tone public.tone)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  allowed constant text[] := array['client_name', 'invoice_number', 'amount_due', 'due_date', 'days_overdue', 'owner_name', 'business_name'];
  required constant text[] := array['invoice_number', 'amount_due', 'due_date'];
  problems text[] := '{}';
  subject text := coalesce(p_subject, '');
  body text := coalesce(p_body, '');
  placeholder text;
  bare text;
  word_count integer;
  banned record;
begin
  if btrim(subject) = '' then problems := problems || 'subject_missing'::text; end if;
  if btrim(body) = '' then return problems || 'body_missing'::text; end if;
  if char_length(subject) > 70 then problems := problems || 'subject_too_long'::text; end if;

  -- Only the seven placeholders of AI-02, and the three facts exactly once each in the body.
  for placeholder in select (regexp_matches(subject || ' ' || body, '\{([^{}]*)\}', 'g'))[1] loop
    if not (placeholder = any (allowed)) then problems := problems || ('unknown_placeholder:' || placeholder); end if;
  end loop;
  foreach placeholder in array required loop
    if (select count(*) from regexp_matches(body, '\{' || placeholder || '\}', 'g')) <> 1 then
      problems := problems || ('placeholder_count:' || placeholder);
    end if;
  end loop;

  -- No facts outside placeholders: no digits, no currency symbols.
  bare := regexp_replace(subject || E'\n' || body, '\{[a-z_]+\}', '', 'g');
  if bare ~ '[0-9]' then problems := problems || 'digits_outside_placeholders'::text; end if;
  if bare ~ '[$€£¥]' then problems := problems || 'currency_outside_placeholders'::text; end if;

  word_count := coalesce(array_length(regexp_split_to_array(btrim(body), '\s+'), 1), 0);
  if word_count < 40 or word_count > 150 then problems := problems || 'body_length'::text; end if;

  for banned in select phrase from private.banned_phrases order by phrase loop
    if lower(subject || ' ' || body) ~ ('\m' || banned.phrase || '\M') then
      problems := problems || ('banned_phrase:' || banned.phrase);
    end if;
  end loop;

  if (subject || body) ~ '[\U0001F000-\U0001FAFF☀-➿]' then problems := problems || 'emoji'::text; end if;
  if bare ~ '\m[A-Z]{4,}\M' then problems := problems || 'capitals'::text; end if;
  if p_tone = 'firm' and (subject || body) ~ '!' then problems := problems || 'firm_exclamation'::text; end if;

  return problems;
end;
$$;
comment on function private.check_reminder_template(text, text, public.tone) is
  'AI-06 checks. Returns an empty array when the subject and body may be saved, otherwise problem codes.';

-- FR-15: an edited message must keep the invoice number and amount exactly, and add no other amount.
create or replace function private.check_locked_facts(p_subject text, p_body text, p_invoice_number text, p_amount_cents bigint)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  amount_text constant text := private.format_aud(p_amount_cents);
  keep_message constant text := format('Keep %s and invoice %s as they are.', amount_text, p_invoice_number);
  found_amount text;
begin
  if p_subject is null or btrim(p_subject) = '' then return 'Add a subject.'; end if;
  if p_body is null or btrim(p_body) = '' then return 'Add a message.'; end if;
  if char_length(p_subject) > 120 then return 'Keep the subject under 120 characters.'; end if;
  if char_length(p_subject) + char_length(p_body) > 1800 then
    return 'Keep the message under 1,800 characters so it fits in your email app.';
  end if;
  if p_body !~ ('(^|[^0-9A-Za-z])' || private.regex_escape(p_invoice_number) || '($|[^0-9A-Za-z])')
     or position(amount_text in p_body) = 0 then
    return keep_message;
  end if;
  for found_amount in select (regexp_matches(p_subject || ' ' || p_body, '\$\s?[0-9][0-9,]*(?:\.[0-9]+)?', 'g'))[1] loop
    if found_amount <> amount_text then return keep_message; end if;
  end loop;
  return null;
end;
$$;
comment on function private.check_locked_facts(text, text, text, bigint) is
  'FR-15 and AT-07: returns null when an edited message keeps the locked facts, otherwise the message to show.';

-- ---------------------------------------------------------------------------------------------
-- CSV values (FR-05, BR-15). The browser previews; the server decides.
-- ---------------------------------------------------------------------------------------------
create or replace function private.parse_amount_cents(p_value text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := btrim(coalesce(p_value, ''));
begin
  cleaned := regexp_replace(cleaned, '^(A\$|AUD|\$)\s*', '', 'i');
  cleaned := regexp_replace(cleaned, '\s*AUD$', '', 'i');
  cleaned := replace(replace(cleaned, ',', ''), ' ', '');
  if cleaned !~ '^-?[0-9]+(\.[0-9]{1,2})?$' then
    return null;
  end if;
  return round(cleaned::numeric * 100)::bigint;
end;
$$;
comment on function private.parse_amount_cents(text) is 'Reads "$1,250.00", "1250", "A$1,250.5" or "1250 AUD" as cents; null when it is not a number.';

create or replace function private.parse_au_date(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := btrim(coalesce(p_value, ''));
  part text[];
  y integer;
  m integer;
  d integer;
begin
  cleaned := regexp_replace(cleaned, '\s+[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?(\s*[AaPp][Mm])?$', '');
  if cleaned ~ '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$' then
    part := regexp_match(cleaned, '^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$');
    y := part[1]::integer; m := part[2]::integer; d := part[3]::integer;
  elsif cleaned ~ '^[0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}$' then
    part := regexp_match(cleaned, '^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{2,4})$');
    d := part[1]::integer; m := part[2]::integer; y := part[3]::integer;
    if y < 100 then y := 2000 + y; end if;
  elsif cleaned ~* '^[0-9]{1,2}[ -][a-z]{3,9}[ -][0-9]{4}$' then
    part := regexp_match(cleaned, '^([0-9]{1,2})[ -]([A-Za-z]{3,9})[ -]([0-9]{4})$');
    d := part[1]::integer; y := part[3]::integer;
    m := array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], lower(left(part[2], 3)));
  else
    return null;
  end if;
  if m is null or y not between 2000 and 2100 then
    return null;
  end if;
  return make_date(y, m, d);
exception
  when others then
    return null;
end;
$$;
comment on function private.parse_au_date(text) is 'Reads Australian day-first dates (15/10/2026, 15-10-26, 15 Oct 2026) and ISO dates; null when invalid.';

create or replace function private.clean_email(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(match[1])
  from regexp_match(coalesce(p_value, ''), '([^@\s;,<>"]+@[^@\s;,<>"]+\.[^@\s;,<>"]+)') as match;
$$;
comment on function private.clean_email(text) is 'The first email address in a cell (Xero cells can hold several), lower-cased; null when there is none.';

-- ---------------------------------------------------------------------------------------------
-- Membership checks (NFR-05). Security definer so policies can read memberships without recursion.
-- ---------------------------------------------------------------------------------------------
create or replace function private.my_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
  from public.memberships m
  join public.businesses b on b.id = m.business_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and (m.role <> 'admin' or b.is_test_data);
$$;
comment on function private.my_business_ids() is 'Businesses the signed-in user may read. Admins see test data only. Used by every row-level security policy.';

create or replace function private.my_role(p_business_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  join public.businesses b on b.id = m.business_id
  where m.business_id = p_business_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and (m.role <> 'admin' or b.is_test_data);
$$;

create or replace function private.require_role(p_business_id uuid, p_roles public.member_role[])
returns public.member_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_role public.member_role;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to continue.' using errcode = '28000';
  end if;
  caller_role := private.my_role(p_business_id);
  if caller_role is null or not (caller_role = any (p_roles)) then
    raise exception 'You don''t have permission to do that.' using errcode = '42501';
  end if;
  return caller_role;
end;
$$;
comment on function private.require_role(uuid, public.member_role[]) is 'Raises unless the signed-in user has one of the roles in the business. Every write function calls it first.';

-- ---------------------------------------------------------------------------------------------
-- Activity log writer (FR-21). Jobs have no signed-in user and log as "system".
-- ---------------------------------------------------------------------------------------------
create or replace function private.log(
  p_business_id uuid,
  p_action public.activity_action,
  p_details jsonb default '{}'::jsonb,
  p_invoice_id uuid default null,
  p_draft_id uuid default null,
  p_client_id uuid default null,
  p_import_id uuid default null,
  p_run_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_role text := 'system';
  entry_id bigint;
begin
  if caller is not null then
    caller_role := private.my_role(p_business_id)::text;
    if caller_role is null then
      raise exception 'Only members of this business can act on it.' using errcode = '42501';
    end if;
  end if;
  insert into public.activity_log (business_id, actor_user_id, actor_role, action, invoice_id, draft_id, client_id, import_id, run_id, details)
  values (p_business_id, case when caller_role = 'system' then null else caller end, caller_role, p_action,
          p_invoice_id, p_draft_id, p_client_id, p_import_id, p_run_id, coalesce(p_details, '{}'::jsonb))
  returning id into entry_id;
  return entry_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Draft and attention helpers shared by imports, reviews, payments and the weekly run
-- ---------------------------------------------------------------------------------------------
create or replace function private.cancel_live_drafts(p_invoice_id uuid, p_reason public.cancel_reason, p_run_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft record;
  cancelled integer := 0;
begin
  for draft in
    select id, business_id, status from public.reminder_drafts
    where invoice_id = p_invoice_id and status in ('waiting', 'approved')
    for update
  loop
    update public.reminder_drafts
       set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
     where id = draft.id;
    perform private.log(draft.business_id, 'draft_cancelled',
                        jsonb_build_object('reason', p_reason, 'was', draft.status),
                        p_invoice_id, draft.id, null, null, p_run_id);
    cancelled := cancelled + 1;
  end loop;
  return cancelled;
end;
$$;
comment on function private.cancel_live_drafts(uuid, public.cancel_reason, uuid) is 'Cancels the waiting or approved draft of an invoice and logs it (BR-03, BR-05, BR-10, BR-11).';

create or replace function private.open_attention(p_business_id uuid, p_invoice_id uuid, p_kind public.attention_kind, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attention_items (business_id, invoice_id, kind, detail)
  values (p_business_id, p_invoice_id, p_kind, coalesce(p_detail, '{}'::jsonb))
  on conflict (invoice_id, kind) where resolved_at is null
  do update set detail = excluded.detail, created_at = now();
  perform private.log(p_business_id, 'draft_flagged', jsonb_build_object('reason', p_kind) || coalesce(p_detail, '{}'::jsonb), p_invoice_id);
end;
$$;

create or replace function private.resolve_attention(p_invoice_id uuid, p_resolution text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved integer;
begin
  update public.attention_items
     set resolved_at = now(), resolved_by = (select auth.uid()), resolution = p_resolution
   where invoice_id = p_invoice_id and resolved_at is null;
  get diagnostics resolved = row_count;
  return resolved;
end;
$$;

-- BR-01 for one invoice. Null means "draft it"; otherwise the reason it is skipped.
-- 'email_missing' is checked last, so only invoices that would otherwise be drafted are flagged (FR-10).
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
comment on function private.ineligibility(uuid, timestamptz) is 'BR-01, BR-04, BR-05 and BR-11 for one invoice: null when a draft should be made, otherwise the reason not to.';

-- The facts that fill a draft's placeholders. Amount, number and due date come from the copy taken
-- when the draft was made; days overdue is worked out for the moment of rendering.
create or replace function private.draft_facts(p_draft_id uuid, p_as_of timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'client_name', coalesce(c.contact_name, c.name),
    'invoice_number', d.invoice_number_shown,
    'amount_due', private.format_aud(d.amount_shown_cents),
    'due_date', private.format_date(d.due_date_shown),
    'days_overdue', greatest(private.days_overdue(d.due_date_shown, p_as_of), 0)::text,
    'owner_name', b.owner_name,
    'business_name', b.name
  )
  from public.reminder_drafts d
  join public.invoices i on i.id = d.invoice_id
  join public.clients c on c.id = i.client_id
  join public.businesses b on b.id = d.business_id
  where d.id = p_draft_id;
$$;

-- ---------------------------------------------------------------------------------------------
-- The Monday briefing (FR-11 to FR-13). One function feeds both the email and the Home screen,
-- so their numbers cannot differ (AT-06).
-- ---------------------------------------------------------------------------------------------
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
               'reminders_sent', o.reminders_sent_count)
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
      from public.clients c where c.business_id = p_business_id and c.paused), '[]'::jsonb)
  );
$$;
comment on function private.build_briefing(uuid, timestamptz) is
  'The briefing as JSON: totals, overdue invoices largest first (BR-07), drafts waiting, Needs attention and paused clients. Shared by EM-01 and UI-02.';

-- FR-22: drafts approved without edits, with edits, and rejected, this week and overall.
create or replace function private.trust_summary(p_business_id uuid, p_as_of timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with week_start as (
    select (date_trunc('week', (p_as_of at time zone 'Australia/Sydney')) at time zone 'Australia/Sydney') as at
  ),
  decided as (
    select d.edited, d.approved_at, d.rejected_at
    from public.reminder_drafts d
    where d.business_id = p_business_id and (d.approved_at is not null or d.rejected_at is not null)
  )
  select jsonb_build_object(
    'this_week', jsonb_build_object(
      'approved_clean', count(*) filter (where approved_at >= (select at from week_start) and not edited),
      'approved_edited', count(*) filter (where approved_at >= (select at from week_start) and edited),
      'rejected', count(*) filter (where rejected_at >= (select at from week_start))),
    'overall', jsonb_build_object(
      'approved_clean', count(*) filter (where approved_at is not null and not edited),
      'approved_edited', count(*) filter (where approved_at is not null and edited),
      'rejected', count(*) filter (where rejected_at is not null))
  )
  from decided;
$$;

select private.apply_function_grants();
