-- Payprentice · migration 4 of 7 · triggers
-- Rules that hold for every writer, including the service role and team admins:
--   * the activity log is append-only (FR-21);
--   * a draft moves only along its lifecycle, and its facts and approved text never change (FR-15, FR-17, BR-02);
--   * invoice numbers and owners never change, and status moves only along its lifecycle;
--   * team admins can be members of test businesses only.

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger businesses_touch before update on public.businesses for each row execute function private.touch_updated_at();
create trigger clients_touch before update on public.clients for each row execute function private.touch_updated_at();
create trigger invoices_touch before update on public.invoices for each row execute function private.touch_updated_at();
create trigger reminder_drafts_touch before update on public.reminder_drafts for each row execute function private.touch_updated_at();
create trigger quotes_touch before update on public.quotes for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- FR-21: entries cannot be edited or deleted. The one exception is deleting a whole business
-- (FR-03, NFR-03): its log rows go with it, which is detected because the business row is already gone.
-- ---------------------------------------------------------------------------------------------
create or replace function private.activity_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.businesses b where b.id = old.business_id) then
    return old;
  end if;
  raise exception 'The activity log cannot be changed or deleted.' using errcode = '42501';
end;
$$;

create trigger activity_log_no_update_or_delete
  before update or delete on public.activity_log
  for each row execute function private.activity_log_append_only();

create or replace function private.refuse_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Truncating % is not allowed.', tg_table_name using errcode = '42501';
end;
$$;

create trigger activity_log_no_truncate before truncate on public.activity_log for each statement execute function private.refuse_truncate();

-- ---------------------------------------------------------------------------------------------
-- Draft lifecycle (docs/state-machines.md):
--   waiting -> approved | rejected | cancelled
--   approved -> sent | cancelled
--   sent, rejected, cancelled: final
-- Facts, provenance and the approved text are frozen. There is no path from waiting to sent (AT-01).
-- ---------------------------------------------------------------------------------------------
create or replace function private.reminder_draft_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  if new.business_id is distinct from old.business_id
     or new.invoice_id is distinct from old.invoice_id
     or new.run_id is distinct from old.run_id
     or new.tone_used is distinct from old.tone_used
     or new.subject_template is distinct from old.subject_template
     or new.body_template is distinct from old.body_template
     or new.invoice_number_shown is distinct from old.invoice_number_shown
     or new.amount_shown_cents is distinct from old.amount_shown_cents
     or new.due_date_shown is distinct from old.due_date_shown
     or new.source is distinct from old.source
     or new.prompt_version is distinct from old.prompt_version
     or new.model is distinct from old.model
     or new.ai_attempts is distinct from old.ai_attempts
     or new.fallback_reason is distinct from old.fallback_reason
     or new.created_at is distinct from old.created_at then
    raise exception 'A draft''s facts and provenance cannot change. Cancel it and draft again.' using errcode = '42501';
  end if;

  if old.status in ('approved', 'sent', 'cancelled') and old.approved_at is not null and (
       new.final_subject is distinct from old.final_subject
    or new.final_body is distinct from old.final_body
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.approver_role is distinct from old.approver_role
    or new.edited is distinct from old.edited
  ) then
    raise exception 'An approved message is final. Cancel it and draft again to change it.' using errcode = '42501';
  end if;

  if not (
       (old.status = 'waiting' and new.status in ('approved', 'rejected', 'cancelled'))
    or (old.status = 'approved' and new.status in ('sent', 'cancelled'))
  ) then
    raise exception 'A draft that is % cannot become %.', old.status, new.status using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger reminder_drafts_lifecycle
  before update on public.reminder_drafts
  for each row execute function private.reminder_draft_guard();

create or replace function private.reminder_draft_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.businesses b where b.id = old.business_id) then
    return old;
  end if;
  raise exception 'Drafts are kept as a record. Cancel a draft instead of deleting it.' using errcode = '42501';
end;
$$;

create trigger reminder_drafts_no_delete
  before delete on public.reminder_drafts
  for each row execute function private.reminder_draft_no_delete();

-- ---------------------------------------------------------------------------------------------
-- Invoice lifecycle: open -> paid | closed; closed -> open (seen again in an import);
-- paid -> open (a person undoes "Mark paid"). Numbers and owners never change.
-- ---------------------------------------------------------------------------------------------
create or replace function private.invoice_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id or new.invoice_number is distinct from old.invoice_number then
    raise exception 'An invoice''s business and number cannot change.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'open' and new.status in ('paid', 'closed'))
    or (old.status = 'closed' and new.status = 'open')
    or (old.status = 'paid' and new.status = 'open')
  ) then
    raise exception 'A % invoice cannot become %.', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger invoices_lifecycle before update on public.invoices for each row execute function private.invoice_guard();

-- ---------------------------------------------------------------------------------------------
-- Team admins see test data only (Design Requirements v0.1 section 4).
-- ---------------------------------------------------------------------------------------------
create or replace function private.membership_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'admin' and not (select b.is_test_data from public.businesses b where b.id = new.business_id) then
    raise exception 'Team admins can join test businesses only.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.business_id is distinct from old.business_id or new.role is distinct from old.role) then
    raise exception 'A membership''s business and role cannot change. Remove it and invite again.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger memberships_rules before insert or update on public.memberships for each row execute function private.membership_guard();

select private.apply_function_grants();
