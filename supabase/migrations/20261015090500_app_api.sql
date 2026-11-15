-- Payprentice · migration 6 of 7 · the app's API
-- Every function the web app calls. Each one checks the caller's role first, does its work in one transaction
-- and writes the activity log in the same transaction (FR-21). Roles follow Design Requirements v0.1 section 4:
--   owner: everything for their business
--   checker: import, approve, edit, reject, mark paid, fix emails; send only when checker_may_send (D3)
--   admin (team): read and import test data only
-- Errors are raised with plain-words messages the app can show as they are (UI rule: never an error code alone).

-- ---------------------------------------------------------------------------------------------
-- Businesses, settings and the team (FR-01, FR-02, FR-25)
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
  select u.email into caller_email from auth.users u where u.id = caller;
  insert into public.businesses (name, owner_name, reply_to_email, sign_off)
  values (btrim(p_name), btrim(p_owner_name), lower(btrim(p_reply_to_email)), coalesce(nullif(btrim(p_sign_off), ''), 'Thanks,'))
  returning id into new_id;
  insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, invited_by, accepted_at)
  values (new_id, caller, lower(coalesce(caller_email, p_reply_to_email)), btrim(p_owner_name), 'owner', 'active', caller, now());
  perform private.log(new_id, 'business_created', jsonb_build_object('is_test_data', true));
  return new_id;
end;
$$;
comment on function public.create_business(text, text, text, text) is 'First sign-in setup: creates the business as test data and makes the caller its owner (FR-02, D7).';

create or replace function public.update_settings(p_business_id uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed constant text[] := array['name', 'owner_name', 'sign_off', 'reply_to_email', 'overdue_threshold_days', 'cooldown_days',
                                   'briefing_weekday', 'briefing_time', 'checker_may_send', 'style_note', 'example_reminder',
                                   'call_first_threshold_cents', 'xero_reminders', 'column_mapping'];
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
    column_mapping = case when p_changes ? 'column_mapping' then p_changes -> 'column_mapping' else b.column_mapping end
  where b.id = p_business_id;

  perform private.log(p_business_id, 'settings_changed',
                      jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(p_changes) as k)));
end;
$$;
comment on function public.update_settings(uuid, jsonb) is 'Owner only. Changes listed settings (FR-02, FR-27, FR-32, FR-33, D3); they apply from the next run.';

create or replace function public.invite_checker(p_business_id uuid, p_email text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := private.clean_email(p_email);
  owner_email text;
  new_id uuid;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  if v_email is null or v_email <> lower(btrim(p_email)) then
    raise exception 'Enter one valid email address.' using errcode = '22023';
  end if;
  select lower(m.invited_email) into owner_email from public.memberships m
   where m.business_id = p_business_id and m.role = 'owner' and m.status <> 'removed';
  if v_email = owner_email then
    raise exception 'The checker must be someone other than the owner.' using errcode = '22023';
  end if;
  if exists (select 1 from public.memberships m where m.business_id = p_business_id and m.role = 'checker' and m.status <> 'removed') then
    raise exception 'This business already has a checker. Remove them first.' using errcode = '23505';
  end if;
  insert into public.memberships (business_id, invited_email, display_name, role, status, invited_by)
  values (p_business_id, v_email, btrim(p_display_name), 'checker', 'invited', (select auth.uid()))
  returning id into new_id;
  perform private.log(p_business_id, 'member_invited', jsonb_build_object('role', 'checker'));
  return new_id;
end;
$$;
comment on function public.invite_checker(uuid, text, text) is 'Owner only. Records the invitation; the invite-member Edge Function then creates the sign-in account (FR-25).';

create or replace function public.remove_member(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.memberships;
begin
  select * into member from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'That person is not on this team.' using errcode = 'P0002';
  end if;
  perform private.require_role(member.business_id, array['owner']::public.member_role[]);
  if member.role = 'owner' then
    raise exception 'The owner cannot be removed. Delete the business instead.' using errcode = '42501';
  end if;
  if member.status = 'removed' then
    return;
  end if;
  update public.memberships set status = 'removed', removed_at = now() where id = p_membership_id;
  perform private.log(member.business_id, 'member_removed', jsonb_build_object('role', member.role));
end;
$$;

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
  for invitation in
    select m.id, m.business_id, m.role from public.memberships m
    where m.status = 'invited' and lower(m.invited_email) = caller_email
    for update
  loop
    update public.memberships set user_id = caller, status = 'active', accepted_at = now() where id = invitation.id;
    perform private.log(invitation.business_id, 'member_joined', jsonb_build_object('role', invitation.role));
  end loop;
  return coalesce((
    select jsonb_agg(jsonb_build_object('business_id', m.business_id, 'role', m.role) order by m.accepted_at)
    from public.memberships m
    where m.user_id = caller and m.status = 'active'
  ), '[]'::jsonb);
end;
$$;
comment on function public.accept_invitations() is 'Called after every sign-in. Activates invitations for the caller''s email and returns their businesses. An empty list means "Ask the owner to invite you" (FR-01).';

-- ---------------------------------------------------------------------------------------------
-- Clients (FR-23, FR-26, FR-34; fixing emails clears FR-10 flags)
-- ---------------------------------------------------------------------------------------------
create or replace function public.update_client_contact(p_client_id uuid, p_email text, p_contact_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  client public.clients;
  v_email text := private.clean_email(p_email);
begin
  select * into client from public.clients where id = p_client_id;
  if not found then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;
  perform private.require_role(client.business_id, array['owner', 'checker']::public.member_role[]);
  if v_email is null or v_email <> lower(btrim(p_email)) then
    raise exception 'Enter one valid email address.' using errcode = '22023';
  end if;
  update public.clients
     set email = v_email,
         contact_name = coalesce(nullif(btrim(p_contact_name), ''), contact_name)
   where id = p_client_id;
  perform private.log(client.business_id, 'client_updated',
                      jsonb_build_object('fields', case when nullif(btrim(p_contact_name), '') is null
                                                        then jsonb_build_array('email') else jsonb_build_array('email', 'contact_name') end),
                      null, null, p_client_id);
end;
$$;

create or replace function public.set_client_tone(p_client_id uuid, p_tone public.tone)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  client public.clients;
begin
  select * into client from public.clients where id = p_client_id;
  if not found then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;
  perform private.require_role(client.business_id, array['owner']::public.member_role[]);
  if client.tone = p_tone then
    return;
  end if;
  update public.clients set tone = p_tone where id = p_client_id;
  perform private.log(client.business_id, 'client_updated', jsonb_build_object('fields', jsonb_build_array('tone'), 'tone', p_tone), null, null, p_client_id);
end;
$$;
comment on function public.set_client_tone(uuid, public.tone) is 'Owner only (a relationship decision). New drafts use the new tone (FR-23).';

create or replace function public.set_client_paused(p_client_id uuid, p_paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  client public.clients;
  invoice record;
  cancelled integer := 0;
begin
  select * into client from public.clients where id = p_client_id for update;
  if not found then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;
  perform private.require_role(client.business_id, array['owner']::public.member_role[]);
  if client.paused = p_paused then
    return jsonb_build_object('paused', p_paused, 'drafts_cancelled', 0);
  end if;
  update public.clients set paused = p_paused, paused_at = case when p_paused then now() else null end where id = p_client_id;
  if p_paused then
    for invoice in select i.id from public.invoices i where i.client_id = p_client_id loop
      cancelled := cancelled + private.cancel_live_drafts(invoice.id, 'client_paused');
    end loop;
  end if;
  perform private.log(client.business_id, case when p_paused then 'client_paused' else 'client_unpaused' end::public.activity_action,
                      jsonb_build_object('drafts_cancelled', cancelled), null, null, p_client_id);
  return jsonb_build_object('paused', p_paused, 'drafts_cancelled', cancelled);
end;
$$;
comment on function public.set_client_paused(uuid, boolean) is 'Owner only. Pausing cancels live drafts; unpausing applies from the next weekly run (BR-11, FR-26).';

create or replace function public.set_client_group(p_client_id uuid, p_group public.client_group)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  client public.clients;
begin
  select * into client from public.clients where id = p_client_id;
  if not found then
    raise exception 'Client not found.' using errcode = 'P0002';
  end if;
  perform private.require_role(client.business_id, array['owner']::public.member_role[]);
  update public.clients set client_group = p_group where id = p_client_id;
  perform private.log(client.business_id, 'client_updated', jsonb_build_object('fields', jsonb_build_array('client_group'), 'client_group', p_group), null, null, p_client_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Import (FR-04 to FR-06, BR-03, BR-05, BR-15). The browser parses and previews the CSV, then sends the
-- mapped cells. The server re-reads every value, so the preview cannot save something the rules reject.
-- ---------------------------------------------------------------------------------------------
create or replace function public.confirm_import(
  p_business_id uuid,
  p_file_name text,
  p_format public.import_format,
  p_mapping jsonb,
  p_rows jsonb,
  p_expected_rows integer,
  p_expected_total_cents bigint,
  p_allow_mass_close boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  row_count integer;
  v_rows_saved integer;
  file_total bigint;
  saved_total bigint;
  open_before integer;
  would_close integer;
  import_id uuid;
  line record;
  existing public.invoices;
  added integer := 0;
  updated integer := 0;
  reopened integer := 0;
  kept_paid integer := 0;
  closed integer := 0;
  v_drafts_cancelled integer := 0;
  just_cancelled integer;
  error_list jsonb;
begin
  perform private.require_role(p_business_id, array['owner', 'checker', 'admin']::public.member_role[]);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no rows to import.' using errcode = '22023';
  end if;
  row_count := jsonb_array_length(p_rows);
  if row_count > 2000 then
    raise exception 'Import up to 2,000 rows at a time. This file has %.', row_count using errcode = '22023';
  end if;
  if row_count <> p_expected_rows then
    raise exception 'The number of rows doesn''t match the file (% in the file, % received). Nothing was saved.', p_expected_rows, row_count
      using errcode = '22023';
  end if;

  -- 1. Read every row.
  drop table if exists pg_temp.import_rows;
  create temporary table import_rows (
    row_no integer not null,
    client_name text,
    client_key text,
    email text,
    contact_name text,
    invoice_number text,
    issue_date date,
    due_date date,
    amount_cents bigint,
    issue_date_raw text,
    due_date_raw text,
    error text
  ) on commit drop;

  insert into pg_temp.import_rows (row_no, client_name, client_key, email, contact_name, invoice_number,
                                   issue_date, due_date, amount_cents, issue_date_raw, due_date_raw)
  select case when cell ->> 'row' ~ '^[0-9]{1,6}$' then (cell ->> 'row')::integer else position::integer + 1 end,
         nullif(btrim(cell ->> 'client'), ''),
         lower(nullif(btrim(cell ->> 'client'), '')),
         private.clean_email(cell ->> 'email'),
         nullif(btrim(cell ->> 'contact'), ''),
         nullif(btrim(cell ->> 'invoice_number'), ''),
         private.parse_au_date(cell ->> 'issue_date'),
         private.parse_au_date(cell ->> 'due_date'),
         private.parse_amount_cents(cell ->> 'amount_due'),
         cell ->> 'issue_date',
         cell ->> 'due_date'
  from jsonb_array_elements(p_rows) with ordinality as t(cell, position);

  -- 2. Find bad rows (FR-05). The first problem in each row is reported.
  update pg_temp.import_rows set error = case
    when invoice_number is null then 'Missing invoice number'
    when client_name is null then 'Missing client name'
    when amount_cents is null then 'Amount is not a number'
    when amount_cents <= 0 then 'Amount must be more than $0'
    when amount_cents >= 100000000000 then 'Amount is too large'
    when issue_date is null then 'Issue date is not a date (use DD/MM/YYYY)'
    when due_date is null then 'Due date is not a date (use DD/MM/YYYY)'
    when due_date < issue_date then 'Due date is before the issue date'
    when char_length(invoice_number) > 50 then 'Invoice number is longer than 50 characters'
    else null
  end;

  -- BR-15: a number that appears twice in one file rejects every row that has it.
  update pg_temp.import_rows r set error = 'Invoice number appears more than once in this file'
  where r.error is null
    and r.invoice_number in (
      select invoice_number from pg_temp.import_rows where invoice_number is not null
      group by invoice_number having count(*) > 1
    );

  -- 3. The totals must match what the user saw in the preview.
  select coalesce(sum(amount_cents), 0) into file_total from pg_temp.import_rows where amount_cents is not null;
  if file_total <> p_expected_total_cents then
    raise exception 'Totals don''t match the file (% in the file, % read). Nothing was saved.',
      private.format_aud(p_expected_total_cents), private.format_aud(file_total) using errcode = '22023';
  end if;
  select count(*), coalesce(sum(amount_cents), 0) into v_rows_saved, saved_total from pg_temp.import_rows where error is null;

  -- 4. Guard against a partial file closing most open invoices (BR-03 applies to the whole list).
  select count(*) into open_before from public.invoices where business_id = p_business_id and status = 'open';
  select count(*) into would_close from public.invoices i
   where i.business_id = p_business_id and i.status = 'open'
     and not exists (select 1 from pg_temp.import_rows r where r.invoice_number = i.invoice_number);
  if would_close > 5 and would_close * 2 > open_before and not p_allow_mass_close then
    raise exception 'This file would close % of your % open invoices. Check it is your full list of unpaid invoices, then confirm again.',
      would_close, open_before using errcode = 'P0001', hint = 'confirm_mass_close';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('row', row_no, 'reason', error) order by row_no), '[]'::jsonb)
    into error_list from pg_temp.import_rows where error is not null;

  insert into public.imports (business_id, uploaded_by, file_name, source_format, column_mapping, rows_read, rows_saved,
                              rows_skipped, file_total_cents, saved_total_cents, errors)
  values (p_business_id, caller, left(btrim(p_file_name), 255), p_format, coalesce(p_mapping, '{}'::jsonb), row_count, v_rows_saved,
          row_count - v_rows_saved, file_total, saved_total, error_list)
  returning id into import_id;

  -- 5. Clients: add new ones; fill a missing email or contact name; never change tone or pause (FR-06).
  insert into public.clients (business_id, name, email, contact_name)
  select p_business_id,
         min(client_name),
         (array_agg(email order by row_no) filter (where email is not null))[1],
         (array_agg(contact_name order by row_no) filter (where contact_name is not null))[1]
  from pg_temp.import_rows
  where error is null
  group by client_key
  on conflict (business_id, lower(btrim(name))) do update
    set email = coalesce(public.clients.email, excluded.email),
        contact_name = coalesce(public.clients.contact_name, excluded.contact_name)
    where (public.clients.email is null and excluded.email is not null)
       or (public.clients.contact_name is null and excluded.contact_name is not null);

  -- 6. Invoices: add, update, reopen or keep paid (FR-06). A changed amount or due date cancels the live draft
  --    and flags the invoice (BR-05, AT-03).
  for line in
    select r.*, c.id as client_id
    from pg_temp.import_rows r
    join public.clients c on c.business_id = p_business_id and lower(btrim(c.name)) = r.client_key
    where r.error is null
    order by r.row_no
  loop
    select * into existing from public.invoices
     where business_id = p_business_id and invoice_number = line.invoice_number
     for update;

    if not found then
      insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents,
                                   first_seen_import_id, last_seen_import_id)
      values (p_business_id, line.client_id, line.invoice_number, line.issue_date, line.due_date, line.amount_cents,
              import_id, import_id);
      added := added + 1;
      continue;
    end if;

    if existing.status = 'paid' then
      update public.invoices set last_seen_import_id = import_id where id = existing.id;
      kept_paid := kept_paid + 1;
      continue;
    end if;

    if existing.status = 'open' and existing.amount_due_cents <> line.amount_cents then
      just_cancelled := private.cancel_live_drafts(existing.id, 'amount_changed');
      if just_cancelled > 0 then
        perform private.open_attention(p_business_id, existing.id, 'amount_changed',
          jsonb_build_object('from_cents', existing.amount_due_cents, 'to_cents', line.amount_cents));
      end if;
      v_drafts_cancelled := v_drafts_cancelled + just_cancelled;
    elsif existing.status = 'open' and existing.due_date <> line.due_date then
      just_cancelled := private.cancel_live_drafts(existing.id, 'due_date_changed');
      if just_cancelled > 0 then
        perform private.open_attention(p_business_id, existing.id, 'due_date_changed',
          jsonb_build_object('from', existing.due_date, 'to', line.due_date));
      end if;
      v_drafts_cancelled := v_drafts_cancelled + just_cancelled;
    end if;

    update public.invoices
       set client_id = line.client_id, issue_date = line.issue_date, due_date = line.due_date,
           amount_due_cents = line.amount_cents, status = 'open', closed_at = null, close_reason = null,
           last_seen_import_id = import_id
     where id = existing.id;

    if existing.status = 'closed' then
      reopened := reopened + 1;
      perform private.log(p_business_id, 'invoice_reopened', jsonb_build_object('reason', 'seen_in_import'), existing.id, null, null, import_id);
    elsif existing.amount_due_cents <> line.amount_cents or existing.due_date <> line.due_date
       or existing.issue_date <> line.issue_date or existing.client_id <> line.client_id then
      updated := updated + 1;
    end if;
  end loop;

  -- 7. BR-03: open invoices missing from the file are closed and their live drafts cancelled.
  --    Rows skipped for errors still count as present, so a typo never closes an invoice.
  for line in
    select i.id from public.invoices i
    where i.business_id = p_business_id and i.status = 'open'
      and not exists (select 1 from pg_temp.import_rows r where r.invoice_number = i.invoice_number)
    for update
  loop
    update public.invoices set status = 'closed', closed_at = now(), close_reason = 'not_in_latest_import' where id = line.id;
    v_drafts_cancelled := v_drafts_cancelled + private.cancel_live_drafts(line.id, 'invoice_closed');
    perform private.resolve_attention(line.id, 'invoice_closed');
    perform private.log(p_business_id, 'invoice_closed', jsonb_build_object('reason', 'not_in_latest_import'), line.id, null, null, import_id);
    closed := closed + 1;
  end loop;

  update public.imports
     set invoices_added = added, invoices_updated = updated, invoices_reopened = reopened, invoices_kept_paid = kept_paid,
         invoices_closed = closed, drafts_cancelled = v_drafts_cancelled
   where id = import_id;
  update public.businesses set column_mapping = coalesce(p_mapping, column_mapping) where id = p_business_id;

  perform private.log(p_business_id, 'import_completed', jsonb_build_object(
    'format', p_format, 'rows_read', row_count, 'rows_saved', v_rows_saved, 'rows_skipped', row_count - v_rows_saved,
    'file_total_cents', file_total, 'saved_total_cents', saved_total, 'invoices_added', added, 'invoices_updated', updated,
    'invoices_reopened', reopened, 'invoices_kept_paid', kept_paid, 'invoices_closed', closed, 'drafts_cancelled', v_drafts_cancelled
  ), null, null, null, import_id);

  return jsonb_build_object(
    'import_id', import_id, 'rows_read', row_count, 'rows_saved', v_rows_saved, 'rows_skipped', row_count - v_rows_saved,
    'file_total_cents', file_total, 'saved_total_cents', saved_total, 'invoices_added', added, 'invoices_updated', updated,
    'invoices_reopened', reopened, 'invoices_kept_paid', kept_paid, 'invoices_closed', closed,
    'drafts_cancelled', v_drafts_cancelled, 'errors', error_list
  );
end;
$$;
comment on function public.confirm_import(uuid, text, public.import_format, jsonb, jsonb, integer, bigint, boolean) is
  'FR-04 to FR-06. Rows are [{"row","client","email","contact","invoice_number","issue_date","due_date","amount_due"}] as text. All or nothing.';

-- ---------------------------------------------------------------------------------------------
-- Review (FR-14 to FR-17, BR-02, BR-05, BR-08, BR-09)
-- ---------------------------------------------------------------------------------------------
create or replace function public.review_queue(p_business_id uuid)
returns table (
  draft_id uuid,
  queue_position integer,
  queue_total integer,
  invoice_id uuid,
  invoice_number text,
  client_id uuid,
  client_name text,
  client_email text,
  amount_due_cents bigint,
  due_date date,
  days_overdue integer,
  tone public.tone,
  source public.draft_source,
  subject text,
  body text,
  call_first boolean,
  reminders_sent_before integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_role(p_business_id, array['owner', 'checker', 'admin']::public.member_role[]);
  return query
  with queue as (
    select d.id, d.invoice_id, d.invoice_number_shown, d.amount_shown_cents, d.due_date_shown, d.tone_used, d.source,
           d.subject_template, d.body_template, d.created_at,
           i.reminders_sent_count, c.id as client_id, c.name as client_name, c.email as client_email,
           b.sign_off, b.owner_name, b.name as business_name, b.call_first_threshold_cents,
           private.draft_facts(d.id, now()) as facts,
           private.days_overdue(d.due_date_shown, now()) as days_overdue
    from public.reminder_drafts d
    join public.invoices i on i.id = d.invoice_id
    join public.clients c on c.id = i.client_id
    join public.businesses b on b.id = d.business_id
    where d.business_id = p_business_id and d.status = 'waiting'
  )
  select q.id,
         (row_number() over (order by q.amount_shown_cents desc, q.days_overdue desc, q.invoice_number_shown))::integer,
         (count(*) over ())::integer,
         q.invoice_id, q.invoice_number_shown, q.client_id, q.client_name, q.client_email,
         q.amount_shown_cents, q.due_date_shown, q.days_overdue, q.tone_used, q.source,
         private.render_template(q.subject_template, q.facts),
         private.render_template(q.body_template, q.facts) || private.signature(q.sign_off, q.owner_name, q.business_name),
         (q.call_first_threshold_cents is not null and q.amount_shown_cents >= q.call_first_threshold_cents),
         q.reminders_sent_count, q.created_at
  from queue q
  order by q.amount_shown_cents desc, q.days_overdue desc, q.invoice_number_shown;
end;
$$;
comment on function public.review_queue(uuid) is 'Waiting drafts, largest first (BR-07), with facts filled in and the signature added: exactly what approval will freeze (FR-14).';

create or replace function public.approve_draft(p_draft_id uuid, p_subject text default null, p_body text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.reminder_drafts;
  invoice public.invoices;
  client public.clients;
  business public.businesses;
  caller_role public.member_role;
  facts jsonb;
  generated_subject text;
  generated_body text;
  v_final_subject text;
  v_final_body text;
  is_edited boolean := false;
  problem text;
  next_id uuid;
begin
  select * into draft from public.reminder_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'Draft not found.' using errcode = 'P0002';
  end if;
  caller_role := private.require_role(draft.business_id, array['owner', 'checker']::public.member_role[]);
  if draft.status <> 'waiting' then
    return jsonb_build_object('status', draft.status, 'changed', false, 'draft_id', draft.id);
  end if;

  select * into invoice from public.invoices where id = draft.invoice_id for update;
  select * into client from public.clients where id = invoice.client_id;
  select * into business from public.businesses where id = draft.business_id;

  -- BR-05, checked again at approval: the facts must still match the records.
  problem := case
    when invoice.status = 'paid' then 'invoice_paid'
    when invoice.status = 'closed' then 'invoice_closed'
    when invoice.amount_due_cents <> draft.amount_shown_cents then 'amount_changed'
    when invoice.due_date <> draft.due_date_shown then 'due_date_changed'
    when client.paused then 'client_paused'
    when client.email is null then 'email_missing'
  end;
  if problem is not null then
    perform private.cancel_live_drafts(invoice.id, problem::public.cancel_reason);
    if problem = 'amount_changed' then
      perform private.open_attention(draft.business_id, invoice.id, 'amount_changed',
        jsonb_build_object('from_cents', draft.amount_shown_cents, 'to_cents', invoice.amount_due_cents));
    elsif problem = 'due_date_changed' then
      perform private.open_attention(draft.business_id, invoice.id, 'due_date_changed',
        jsonb_build_object('from', draft.due_date_shown, 'to', invoice.due_date));
    end if;
    return jsonb_build_object('status', 'cancelled', 'changed', true, 'reason', problem, 'draft_id', draft.id);
  end if;

  facts := private.draft_facts(draft.id, now());
  generated_subject := private.render_template(draft.subject_template, facts);
  generated_body := private.render_template(draft.body_template, facts) || private.signature(business.sign_off, business.owner_name, business.name);

  if p_subject is null and p_body is null then
    v_final_subject := generated_subject;
    v_final_body := generated_body;
  else
    v_final_subject := btrim(coalesce(p_subject, generated_subject));
    v_final_body := btrim(coalesce(p_body, generated_body));
    problem := private.check_locked_facts(v_final_subject, v_final_body, draft.invoice_number_shown, draft.amount_shown_cents);
    if problem is not null then
      raise exception '%', problem using errcode = '22023', hint = 'locked_facts';
    end if;
    is_edited := v_final_subject <> btrim(generated_subject) or v_final_body <> btrim(generated_body);
  end if;

  update public.reminder_drafts
     set status = 'approved', approved_by = (select auth.uid()), approver_role = caller_role, approved_at = now(),
         final_subject = v_final_subject, final_body = v_final_body, edited = is_edited
   where id = draft.id;

  if is_edited then
    perform private.log(draft.business_id, 'draft_edited', '{}'::jsonb, invoice.id, draft.id);
  end if;
  perform private.log(draft.business_id, 'draft_approved',
                      jsonb_build_object('edited', is_edited, 'approver_role', caller_role, 'source', draft.source),
                      invoice.id, draft.id);

  select d.id into next_id
  from public.reminder_drafts d
  join public.invoices i on i.id = d.invoice_id
  where d.business_id = draft.business_id and d.status = 'waiting'
  order by d.amount_shown_cents desc, private.days_overdue(d.due_date_shown, now()) desc, d.invoice_number_shown
  limit 1;

  return jsonb_build_object('status', 'approved', 'changed', true, 'edited', is_edited, 'draft_id', draft.id, 'next_draft_id', next_id);
end;
$$;
comment on function public.approve_draft(uuid, text, text) is
  'FR-15 and FR-17. Approves a waiting draft, optionally with edited text that must keep the locked facts. Freezes the exact text to send.';

create or replace function public.reject_draft(p_draft_id uuid, p_reason public.reject_reason, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.reminder_drafts;
begin
  select * into draft from public.reminder_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'Draft not found.' using errcode = 'P0002';
  end if;
  perform private.require_role(draft.business_id, array['owner', 'checker']::public.member_role[]);
  if p_reason is null then
    raise exception 'Pick a reason.' using errcode = '22023';
  end if;
  if p_reason = 'other' and char_length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'Add a few words.' using errcode = '22023';
  end if;
  if draft.status <> 'waiting' then
    return jsonb_build_object('status', draft.status, 'changed', false, 'draft_id', draft.id);
  end if;
  update public.reminder_drafts
     set status = 'rejected', rejected_by = (select auth.uid()), rejected_at = now(), reject_reason = p_reason,
         reject_note = nullif(btrim(p_note), '')
   where id = draft.id;
  perform private.log(draft.business_id, 'draft_rejected', jsonb_build_object('reason', p_reason), draft.invoice_id, draft.id);
  return jsonb_build_object('status', 'rejected', 'changed', true, 'draft_id', draft.id);
end;
$$;
comment on function public.reject_draft(uuid, public.reject_reason, text) is 'FR-16 and BR-09. A reason is required; "other" needs a note. The invoice can be drafted again next run.';

-- ---------------------------------------------------------------------------------------------
-- Sending (FR-17 to FR-20, D2, D3). In the PoC the user's own email app sends the message; the server
-- hands over only approved text and records the confirmation. Refusals are logged, never silent (AT-01).
-- ---------------------------------------------------------------------------------------------
create or replace function private.send_refusal(p_draft public.reminder_drafts, p_role public.member_role)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checker_may_send boolean;
begin
  select b.checker_may_send into v_checker_may_send from public.businesses b where b.id = p_draft.business_id;
  if p_role = 'checker' and not v_checker_may_send then
    perform private.log(p_draft.business_id, 'send_refused', jsonb_build_object('reason', 'checker_may_not_send', 'status', p_draft.status), p_draft.invoice_id, p_draft.id);
    return jsonb_build_object('ok', false, 'code', 'checker_may_not_send', 'message', 'Only the owner sends reminders for this business.');
  end if;
  if p_draft.status <> 'approved' then
    perform private.log(p_draft.business_id, 'send_refused', jsonb_build_object('reason', 'not_approved', 'status', p_draft.status), p_draft.invoice_id, p_draft.id);
    return jsonb_build_object('ok', false, 'code', 'not_approved', 'message', 'This reminder needs approval before it can be sent.');
  end if;
  return null;
end;
$$;

create or replace function public.get_send_payload(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.reminder_drafts;
  caller_role public.member_role;
  refusal jsonb;
  recipient text;
  reply_to text;
begin
  select * into draft from public.reminder_drafts where id = p_draft_id;
  if not found then
    raise exception 'Draft not found.' using errcode = 'P0002';
  end if;
  caller_role := private.require_role(draft.business_id, array['owner', 'checker']::public.member_role[]);
  if draft.status = 'sent' then
    return jsonb_build_object('ok', false, 'code', 'already_sent', 'message', 'This reminder was already sent.');
  end if;
  refusal := private.send_refusal(draft, caller_role);
  if refusal is not null then
    return refusal;
  end if;
  select c.email, b.reply_to_email into recipient, reply_to
  from public.invoices i
  join public.clients c on c.id = i.client_id
  join public.businesses b on b.id = i.business_id
  where i.id = draft.invoice_id;
  return jsonb_build_object('ok', true, 'draft_id', draft.id, 'to', recipient, 'reply_to', reply_to,
                            'subject', draft.final_subject, 'body', draft.final_body);
end;
$$;
comment on function public.get_send_payload(uuid) is 'FR-18. Returns the recipient and the exact approved text for the email app, or a logged refusal (AT-01).';

create or replace function public.confirm_sent(p_draft_id uuid, p_method public.send_method default 'email_app')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.reminder_drafts;
  caller_role public.member_role;
  refusal jsonb;
begin
  select * into draft from public.reminder_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'Draft not found.' using errcode = 'P0002';
  end if;
  caller_role := private.require_role(draft.business_id, array['owner', 'checker']::public.member_role[]);
  if draft.status = 'sent' then
    return jsonb_build_object('ok', true, 'changed', false, 'draft_id', draft.id);
  end if;
  refusal := private.send_refusal(draft, caller_role);
  if refusal is not null then
    return refusal;
  end if;
  update public.reminder_drafts
     set status = 'sent', sent_confirmed_by = (select auth.uid()), sent_confirmed_at = now(), send_method = coalesce(p_method, 'email_app')
   where id = draft.id;
  update public.invoices
     set last_reminder_sent_at = now(), reminders_sent_count = reminders_sent_count + 1
   where id = draft.invoice_id;
  perform private.log(draft.business_id, 'reminder_sent',
                      jsonb_build_object('method', coalesce(p_method, 'email_app'), 'edited', draft.edited,
                                         'days_overdue', private.days_overdue(draft.due_date_shown, now())),
                      draft.invoice_id, draft.id);
  return jsonb_build_object('ok', true, 'changed', true, 'draft_id', draft.id);
end;
$$;
comment on function public.confirm_sent(uuid, public.send_method) is 'FR-18 to FR-20. The user confirms "Sent"; records the last reminder date that starts the cool-down (BR-04). Safe to tap twice.';

-- ---------------------------------------------------------------------------------------------
-- Payments and attention (FR-24, BR-03)
-- ---------------------------------------------------------------------------------------------
create or replace function public.mark_paid(p_invoice_id uuid, p_paid_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices;
  paid_on date := coalesce(p_paid_date, private.sydney_date(now()));
  cancelled integer;
begin
  select * into invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  perform private.require_role(invoice.business_id, array['owner', 'checker']::public.member_role[]);
  if invoice.status = 'paid' then
    return jsonb_build_object('status', 'paid', 'changed', false);
  end if;
  if invoice.status = 'closed' then
    raise exception 'This invoice is closed because it wasn''t in your latest import.' using errcode = '22023';
  end if;
  if paid_on < invoice.issue_date or paid_on > private.sydney_date(now()) then
    raise exception 'Pick a paid date between % and today.', private.format_date(invoice.issue_date) using errcode = '22023';
  end if;
  update public.invoices set status = 'paid', paid_date = paid_on where id = p_invoice_id;
  cancelled := private.cancel_live_drafts(p_invoice_id, 'invoice_paid');
  perform private.resolve_attention(p_invoice_id, 'invoice_paid');
  perform private.log(invoice.business_id, 'invoice_paid', jsonb_build_object(
    'paid_date', paid_on,
    'reminders_sent', invoice.reminders_sent_count,
    'days_since_last_reminder', case when invoice.last_reminder_sent_at is null then null
                                     else paid_on - private.sydney_date(invoice.last_reminder_sent_at) end,
    'drafts_cancelled', cancelled), p_invoice_id);
  return jsonb_build_object('status', 'paid', 'changed', true, 'drafts_cancelled', cancelled);
end;
$$;
comment on function public.mark_paid(uuid, date) is 'FR-24. Owner or checker records the paid date; live drafts are cancelled; the invoice leaves the briefing.';

create or replace function public.undo_mark_paid(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice public.invoices;
begin
  select * into invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;
  perform private.require_role(invoice.business_id, array['owner', 'checker']::public.member_role[]);
  if invoice.status <> 'paid' then
    return;
  end if;
  update public.invoices set status = 'open', paid_date = null where id = p_invoice_id;
  perform private.log(invoice.business_id, 'invoice_reopened', jsonb_build_object('reason', 'undo_mark_paid'), p_invoice_id);
end;
$$;
comment on function public.undo_mark_paid(uuid) is 'Undo for a mistaken "Mark paid". The next weekly run drafts again if BR-01 holds.';

create or replace function public.dismiss_attention(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.attention_items;
begin
  select * into item from public.attention_items where id = p_item_id for update;
  if not found then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;
  perform private.require_role(item.business_id, array['owner', 'checker']::public.member_role[]);
  if item.resolved_at is not null then
    return;
  end if;
  update public.attention_items set resolved_at = now(), resolved_by = (select auth.uid()), resolution = 'dismissed' where id = p_item_id;
  perform private.log(item.business_id, 'attention_dismissed', jsonb_build_object('kind', item.kind), item.invoice_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Briefing, trust summary and review sessions (FR-11 to FR-13, FR-19, FR-22, PRD section 15)
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_briefing(p_business_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role(p_business_id, array['owner', 'checker', 'admin']::public.member_role[]);
  return private.build_briefing(p_business_id, coalesce(p_as_of, now()));
end;
$$;
comment on function public.get_briefing(uuid, timestamptz) is 'The Home screen briefing (FR-13). Same function as the email (FR-11), so the numbers match (AT-06).';

create or replace function public.get_trust_summary(p_business_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role(p_business_id, array['owner', 'checker', 'admin']::public.member_role[]);
  return private.trust_summary(p_business_id, coalesce(p_as_of, now()));
end;
$$;

create or replace function public.log_review_session(p_business_id uuid, p_stats jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed constant text[] := array['approved', 'edited', 'rejected', 'sent', 'not_yet', 'waiting', 'seconds'];
  cleaned jsonb := '{}'::jsonb;
  item record;
begin
  perform private.require_role(p_business_id, array['owner', 'checker']::public.member_role[]);
  for item in select key, value from jsonb_each(coalesce(p_stats, '{}'::jsonb)) loop
    if item.key = any (allowed) and jsonb_typeof(item.value) = 'number' and (item.value)::numeric between 0 and 100000 then
      cleaned := cleaned || jsonb_build_object(item.key, (item.value)::numeric::integer);
    end if;
  end loop;
  perform private.log(p_business_id, 'review_session', cleaned);
end;
$$;
comment on function public.log_review_session(uuid, jsonb) is 'FR-19 and the review-time metric: counts and seconds for one review session. Numbers only.';

-- ---------------------------------------------------------------------------------------------
-- Export and delete (FR-03, NFR-03, PD-7)
-- ---------------------------------------------------------------------------------------------
create or replace function private.business_row_counts(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'memberships', (select count(*) from public.memberships where business_id = p_business_id),
    'clients', (select count(*) from public.clients where business_id = p_business_id),
    'invoices', (select count(*) from public.invoices where business_id = p_business_id),
    'imports', (select count(*) from public.imports where business_id = p_business_id),
    'reminder_drafts', (select count(*) from public.reminder_drafts where business_id = p_business_id),
    'attention_items', (select count(*) from public.attention_items where business_id = p_business_id),
    'activity_log', (select count(*) from public.activity_log where business_id = p_business_id),
    'job_runs', (select count(*) from public.job_runs where business_id = p_business_id),
    'quotes', (select count(*) from public.quotes where business_id = p_business_id)
  );
$$;

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
    'quotes', coalesce((select jsonb_agg(to_jsonb(q) order by q.quote_number) from public.quotes q where q.business_id = p_business_id), '[]'::jsonb)
  ) into v_export;
  perform private.log(p_business_id, 'data_exported', '{}'::jsonb);
  return v_export;
end;
$$;
comment on function public.export_business_data(uuid) is 'FR-03. Owner only. Every record as JSON; the app saves one CSV file per list.';

create or replace function public.delete_business(p_business_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  business public.businesses;
  counts jsonb;
  receipt_id bigint;
begin
  perform private.require_role(p_business_id, array['owner']::public.member_role[]);
  select * into business from public.businesses where id = p_business_id for update;
  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(business.name)) then
    raise exception 'Type the business name exactly to confirm.' using errcode = '22023';
  end if;
  counts := private.business_row_counts(p_business_id);
  insert into public.deletion_receipts (business_id, deleted_by, reason, was_test_data, row_counts)
  values (p_business_id, (select auth.uid()), 'owner_request', business.is_test_data, counts)
  returning id into receipt_id;
  delete from public.businesses where id = p_business_id;
  return jsonb_build_object('deleted', true, 'receipt_id', receipt_id, 'row_counts', counts);
end;
$$;
comment on function public.delete_business(uuid, text) is 'FR-03. Owner only, after typing the business name. Deletes everything at once and keeps a receipt with counts only.';

select private.apply_function_grants();
