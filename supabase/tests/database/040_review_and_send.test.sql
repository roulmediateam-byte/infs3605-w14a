-- Review and sending: AT-01 (approval gate), AT-02 (facts shown exactly), AT-07 (locked facts),
-- FR-14 to FR-20, FR-24, FR-25, BR-05 at approval, BR-08, BR-09 and decision D3.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(35);

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
create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;
create function tests.draft(p_number text) returns uuid language sql stable as $$
  select d.id from public.reminder_drafts d join public.invoices i on i.id = d.invoice_id
  where d.business_id = 'b0000000-0000-4000-8000-000000000040' and i.invoice_number = p_number
  order by d.created_at desc limit 1
$$;
create function tests.invoice(p_number text) returns uuid language sql stable as
  $$ select id from public.invoices where business_id = 'b0000000-0000-4000-8000-000000000040' and invoice_number = p_number $$;

-- Fixture: owner Owner R and checker; one client; six invoices all overdue on Sun 8 Nov 2026.
select tests.create_user('a0000000-0000-4000-8000-000000000040', 'owner.review@example.test');
select tests.create_user('a0000000-0000-4000-8000-000000000041', 'checker.review@example.test');
insert into public.businesses (id, name, owner_name, sign_off, reply_to_email)
values ('b0000000-0000-4000-8000-000000000040', 'Review Test (Test data)', 'Owner R', 'Thanks,', 'accounts@review.example');
insert into public.memberships (business_id, user_id, invited_email, display_name, role, status, accepted_at) values
  ('b0000000-0000-4000-8000-000000000040', 'a0000000-0000-4000-8000-000000000040', 'owner.review@example.test', 'Owner R', 'owner', 'active', now()),
  ('b0000000-0000-4000-8000-000000000040', 'a0000000-0000-4000-8000-000000000041', 'checker.review@example.test', 'Checker R', 'checker', 'active', now());
insert into public.clients (id, business_id, name, contact_name, email)
values ('c0000000-0000-4000-8000-000000000040', 'b0000000-0000-4000-8000-000000000040', 'Bayside Builders (Test data)', 'Sam', 'sam@bayside.example');
insert into public.invoices (business_id, client_id, invoice_number, issue_date, due_date, amount_due_cents)
select 'b0000000-0000-4000-8000-000000000040', 'c0000000-0000-4000-8000-000000000040', n, '2026-09-01', '2026-10-01', cents
from (values ('1043', 125000), ('2001', 64000), ('3001', 99000), ('4001', 200000), ('5001', 300000), ('6001', 150000)) as v(n, cents);

select ok((public.job_start('weekly_run', 'b0000000-0000-4000-8000-000000000040', '2026-11-08', 'manual') ->> 'proceed')::boolean, 'A weekly run starts');
select is((select count(*)::integer
           from public.job_plan_weekly_run((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000040'), '2026-11-08 21:00:00+11') p
           cross join lateral (select * from public.job_get_templates() t where t.tone = p.tone) t
           where public.job_save_draft((select id from public.job_runs where business_id = 'b0000000-0000-4000-8000-000000000040'),
                                       p.invoice_id, t.subject, t.body, 'template', t.version, null, 0::smallint, 'ai_disabled') is not null),
  6, 'Six drafts wait for review');

-- FR-14: one draft at a time, largest first, with the text exactly as approval will freeze it.
select tests.as_user('a0000000-0000-4000-8000-000000000040');
select is((select array[queue_total::text, invoice_number] from public.review_queue('b0000000-0000-4000-8000-000000000040') where queue_position = 1),
  array['6', '5001'], 'FR-14 and BR-07: the queue shows the largest invoice first, with "1 of 6"');
select ok((select body like '%Invoice 1043 for $1,250.00 was due on Thu 1 Oct 2026%' and body like '%' || E'Thanks,\nOwner R\nReview Test (Test data)'
           from public.review_queue('b0000000-0000-4000-8000-000000000040') where invoice_number = '1043'),
  'AT-02: the draft shows $1,250.00 and invoice 1043, with the signature from settings');

-- AT-01: a waiting draft cannot be sent by any path, and every attempt is logged.
select is(public.get_send_payload(tests.draft('1043')) ->> 'code', 'not_approved', 'AT-01: the send screen refuses a waiting draft');
select is((select count(*)::integer from public.activity_log where draft_id = tests.draft('1043') and action = 'send_refused'), 1,
  'AT-01: the refused attempt is logged');
select is((public.confirm_sent(tests.draft('1043')) ->> 'ok')::boolean, false, 'AT-01: confirming "Sent" on a waiting draft is refused');
select is((select status::text from public.reminder_drafts where id = tests.draft('1043')), 'waiting', 'AT-01: the draft is still waiting');
select throws_ok($$ update public.reminder_drafts set status = 'sent' where id = tests.draft('1043') $$, '42501', null,
  'AT-01: a signed-in user cannot update a draft directly');
select tests.as_service();
select throws_like($$ update public.reminder_drafts set status = 'sent', sent_confirmed_at = now(), sent_confirmed_by = gen_random_uuid(), send_method = 'email_app'
                      where id = tests.draft('1043') $$, '%is waiting cannot become sent%',
  'AT-01: even the service role cannot move a waiting draft to sent');

-- AT-07 and AT-02.
select tests.as_user('a0000000-0000-4000-8000-000000000040');
select throws_ok($$ select public.approve_draft(tests.draft('1043'), 'Invoice 1043', 'Hi Sam, invoice 1043 is overdue. Thanks, Owner R') $$,
  '22023', 'Keep $1,250.00 and invoice 1043 as they are.', 'AT-07: an edit that removes the amount cannot be saved, and says why');
select is(public.approve_draft(tests.draft('1043')) ->> 'status', 'approved', 'FR-17: the owner approves the draft');
select ok((select final_body like '%Invoice 1043 for $1,250.00 was due on Thu 1 Oct 2026%' and not edited and approver_role = 'owner' and approved_at is not null
           from public.reminder_drafts where id = tests.draft('1043')),
  'AT-02: the approved message shows exactly $1,250.00 and 1043, recorded with who and when');
select is(public.approve_draft(tests.draft('1043')) ->> 'changed', 'false', 'Tapping Approve twice changes nothing');
select tests.as_service();
select throws_like($$ update public.reminder_drafts set final_body = 'Pay me $9,999.00' where id = tests.draft('1043') $$,
  '%approved message is final%', 'FR-15: the approved text cannot be changed afterwards, even by the service role');

-- Decision D3: by default only the owner sends.
select tests.as_user('a0000000-0000-4000-8000-000000000041');
select is(public.get_send_payload(tests.draft('1043')) ->> 'code', 'checker_may_not_send', 'D3: the checker cannot send unless the owner allows it');
select tests.as_user('a0000000-0000-4000-8000-000000000040');
select lives_ok($$ select public.update_settings('b0000000-0000-4000-8000-000000000040', '{"checker_may_send": true}') $$,
  'D3: the owner lets the checker send from the business mailbox');
select tests.as_user('a0000000-0000-4000-8000-000000000041');
select is(public.get_send_payload(tests.draft('1043')) ->> 'body', (select final_body from public.reminder_drafts where id = tests.draft('1043')),
  'FR-18: the email app receives exactly the approved text');

-- FR-18 to FR-20: confirming "Sent".
select tests.as_user('a0000000-0000-4000-8000-000000000040');
select is(public.confirm_sent(tests.draft('1043')) ->> 'changed', 'true', 'FR-18: the owner confirms "Sent"');
select ok((select last_reminder_sent_at is not null and reminders_sent_count = 1 from public.invoices where id = tests.invoice('1043')),
  'FR-20: the last reminder date is recorded, which starts the cool-down');
select is(public.confirm_sent(tests.draft('1043')) ->> 'changed', 'false', 'Tapping "Sent" twice records one send');
select is((select count(*)::integer from public.activity_log where draft_id = tests.draft('1043') and action = 'reminder_sent'), 1,
  'FR-21: one send is logged');

-- BR-08 and FR-22: an edited approval is not a clean approval.
select is(public.approve_draft(tests.draft('2001'), null,
          replace((select body from public.review_queue('b0000000-0000-4000-8000-000000000040') where invoice_number = '2001'),
                  'Could you please', 'Can you please')) ->> 'edited', 'true',
  'BR-08: an approval with changed wording is marked edited');
select is((select count(*)::integer from public.activity_log where draft_id = tests.draft('2001') and action = 'draft_edited'), 1, 'FR-15: the edit is logged');
select is(public.get_trust_summary('b0000000-0000-4000-8000-000000000040') -> 'overall',
  '{"approved_clean": 1, "approved_edited": 1, "rejected": 0}'::jsonb, 'FR-22: the trust summary counts clean and edited approvals');

-- FR-16 and BR-09: rejecting needs a reason, and the invoice can be drafted again next run.
select throws_ok($$ select public.reject_draft(tests.draft('3001'), 'other', ' ') $$, '22023', 'Add a few words.', 'FR-16: "Other" needs a note');
select is(public.reject_draft(tests.draft('3001'), 'wrong_tone') ->> 'status', 'rejected', 'FR-16: the draft is rejected with a reason');
reset role;
select is(private.ineligibility(tests.invoice('3001'), '2026-11-15 21:00:00+11'), null, 'BR-09: the invoice can be drafted again at the next run');
select tests.as_user('a0000000-0000-4000-8000-000000000040');

-- FR-24: marking an invoice paid cancels its draft; undo reopens it.
select is((public.mark_paid(tests.invoice('4001'), '2026-10-10') ->> 'drafts_cancelled')::integer, 1, 'FR-24: marking paid cancels the waiting draft');
select is((select cancel_reason::text from public.reminder_drafts where id = tests.draft('4001')), 'invoice_paid', 'BR-03: the draft is cancelled because the invoice is paid');
select lives_ok($$ select public.undo_mark_paid(tests.invoice('4001')) $$, 'A mistaken "Mark paid" can be undone');

-- BR-05 at approval: if the amount changed since drafting, approval cancels the draft and flags it.
reset role;
update public.invoices set amount_due_cents = 250000 where id = tests.invoice('5001');
select tests.as_user('a0000000-0000-4000-8000-000000000040');
select is(public.approve_draft(tests.draft('5001')) ->> 'reason', 'amount_changed', 'BR-05: a draft whose amount no longer matches cannot be approved');
select ok(exists (select 1 from public.attention_items where invoice_id = tests.invoice('5001') and kind = 'amount_changed' and resolved_at is null),
  'BR-05: the invoice shows under Needs attention');

-- FR-25: the named checker approves while the owner is on site, and the log shows who.
select tests.as_user('a0000000-0000-4000-8000-000000000041');
select is((public.approve_draft(tests.draft('6001')) ->> 'status'), 'approved', 'FR-25: the checker approves a draft');
select is((select details ->> 'approver_role' from public.activity_log where draft_id = tests.draft('6001') and action = 'draft_approved'), 'checker',
  'FR-25: the log shows the checker approved it');

select * from finish();
rollback;
