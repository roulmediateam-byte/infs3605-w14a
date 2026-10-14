-- Business rules that need no data: Sydney dates (BR-06, BR-13), money (BR-14), CSV values (FR-05, BR-15),
-- placeholders (AI-02), the AI-06 checks and the locked facts of an edit (FR-15, AT-07).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(45);

-- BR-06 and BR-13: dates are Sydney dates, across daylight saving.
select is(private.sydney_date('2026-10-18 13:30:00+00'), date '2026-10-19', 'BR-06: 1:30 pm UTC on Sun 18 Oct is already Mon 19 Oct in Sydney (AEDT)');
select is(private.sydney_date('2026-10-03 14:30:00+00'), date '2026-10-04', 'BR-13: before daylight saving starts, Sydney is UTC+10');
select is(private.sydney_date('2027-04-04 15:30:00+00'), date '2027-04-05', 'BR-13: after daylight saving ends, Sydney is UTC+10 again');
select is(private.days_overdue(date '2026-10-12', '2026-10-18 13:30:00+00'), 7, 'BR-06: days overdue = Sydney date minus due date');
select is(private.days_overdue(date '2026-10-19', '2026-10-18 13:30:00+00'), 0, 'BR-06: an invoice due today is not overdue');

-- BR-14: money in whole cents, shown as $1,250.00; dates as Mon 12 Oct 2026.
select is(private.format_aud(125000), '$1,250.00', 'BR-14: 125000 cents reads $1,250.00');
select is(private.format_aud(5), '$0.05', 'BR-14: 5 cents reads $0.05');
select is(private.format_aud(123456789), '$1,234,567.89', 'BR-14: thousands separators');
select is(private.format_date(date '2026-10-12'), 'Mon 12 Oct 2026', 'Dates read "Mon 12 Oct 2026"');

-- FR-05: reading CSV values.
select is(private.parse_amount_cents('$1,250.00'), 125000::bigint, 'FR-05: "$1,250.00" is read as 125000 cents');
select is(private.parse_amount_cents('A$1,250.5'), 125050::bigint, 'FR-05: "A$1,250.5" is read as 125050 cents');
select is(private.parse_amount_cents('1250 AUD'), 125000::bigint, 'FR-05: "1250 AUD" is read as 125000 cents');
select is(private.parse_amount_cents('TBC'), null::bigint, 'FR-05: "TBC" is not a number');
select is(private.parse_amount_cents('12.345'), null::bigint, 'FR-05: three decimal places are not an amount');
select is(private.parse_au_date('15/10/2026'), date '2026-10-15', 'FR-05: day-first dates (Xero''s Australian format)');
select is(private.parse_au_date('5-1-27'), date '2027-01-05', 'FR-05: short day-first dates');
select is(private.parse_au_date('15 Oct 2026'), date '2026-10-15', 'FR-05: "15 Oct 2026"');
select is(private.parse_au_date('2026-10-15'), date '2026-10-15', 'FR-05: ISO dates');
select is(private.parse_au_date('15/10/2026 12:00:00 AM'), date '2026-10-15', 'FR-05: a trailing time is ignored');
select is(private.parse_au_date('31/02/2026'), null::date, 'FR-05: 31 February is a bad date');
select is(private.parse_au_date('10/15/2026'), null::date, 'FR-05: month-first dates are refused rather than guessed');
select is(private.clean_email('Accounts@Alpha.example; boss@alpha.example'), 'accounts@alpha.example', 'The first address in a cell is used, lower-cased');
select is(private.clean_email('no email'), null, 'A cell without an address means no email (flagged, FR-10)');

-- AI-02: placeholders are filled from facts; "1 days" reads "1 day".
select is(private.render_template('Invoice {invoice_number} for {amount_due}', '{"invoice_number":"1043","amount_due":"$1,250.00"}'),
  'Invoice 1043 for $1,250.00', 'AI-02: facts fill the placeholders');
select is(private.render_template('now {days_overdue} days overdue', '{"days_overdue":"1"}'), 'now 1 day overdue', 'One day overdue reads "1 day"');

-- AI-06: the checks every AI reply and template must pass before a draft is saved.
create temporary table good_reply as select
  'Invoice {invoice_number} is now overdue'::text as subject,
  E'Hi {client_name},\n\nJust a quick note that invoice {invoice_number} for {amount_due} was due on {due_date} and is now {days_overdue} days overdue. Could you let me know when we can expect payment? If it has already gone through, thank you, and please ignore this email. Happy to help if anything is holding it up.'::text as body;

select is(private.check_reminder_template(subject, body, 'standard'), '{}'::text[], 'AI-06: a good reply passes') from good_reply;
select is(private.check_reminder_template(t.subject, t.body, t.tone), '{}'::text[], 'AI-06: the ' || t.tone || ' fallback template passes (FR-09)')
  from private.reminder_templates t where t.active order by t.tone;
select ok('placeholder_count:amount_due' = any (private.check_reminder_template(subject, replace(body, '{amount_due}', 'the balance'), 'standard')),
  'AI-06: the amount placeholder must appear') from good_reply;
select ok('placeholder_count:invoice_number' = any (private.check_reminder_template(subject, body || ' Re {invoice_number}.', 'standard')),
  'AI-06: the invoice number appears exactly once in the body') from good_reply;
select ok('digits_outside_placeholders' = any (private.check_reminder_template(subject, replace(body, 'a quick note', 'a note from 2026'), 'standard')),
  'AI-06: no digits outside placeholders (no invented amounts or dates)') from good_reply;
select ok('currency_outside_placeholders' = any (private.check_reminder_template(subject, replace(body, 'a quick note', 'a $ note'), 'standard')),
  'AI-06: no currency symbols outside placeholders') from good_reply;
select ok('unknown_placeholder:client_email' = any (private.check_reminder_template(subject, body || ' {client_email}', 'standard')),
  'AI-06: only the seven placeholders of AI-02') from good_reply;
select ok('body_length' = any (private.check_reminder_template('Invoice {invoice_number}', 'Invoice {invoice_number} for {amount_due} was due {due_date}.', 'standard')),
  'AI-06: a body under 40 words fails');
select ok('subject_too_long' = any (private.check_reminder_template(repeat('a', 71), body, 'standard')),
  'AI-06: a subject over 70 characters fails') from good_reply;
select ok('banned_phrase:late fee' = any (private.check_reminder_template(subject, body || ' A late fee may apply.', 'standard')),
  'AI-05: fees are never mentioned') from good_reply;
select ok('banned_phrase:debt collector' = any (private.check_reminder_template(subject, body || ' We may pass this to a debt collector.', 'standard')),
  'AI-05: debt collectors are never mentioned') from good_reply;
select ok('banned_phrase:as discussed' = any (private.check_reminder_template(subject, replace(body, 'Just a quick note', 'As discussed'), 'standard')),
  'AI-05: no invented facts such as "as discussed"') from good_reply;
select ok('capitals' = any (private.check_reminder_template(subject, replace(body, 'quick', 'QUICK'), 'standard')),
  'AI-05: no shouting in capitals') from good_reply;
select ok('firm_exclamation' = any (private.check_reminder_template(subject, replace(body, 'thank you,', 'thank you!'), 'firm')),
  'Firm tone: no exclamation marks') from good_reply;

-- FR-15 and AT-07: an edit must keep the invoice number and the amount exactly.
select is(private.check_locked_facts('Invoice 1043', E'Hi Sam, invoice 1043 for $1,250.00 is now overdue.', '1043', 125000), null,
  'FR-15: an edit that keeps the facts may be approved');
select is(private.check_locked_facts('Invoice 1043', E'Hi Sam, invoice 1043 is now overdue.', '1043', 125000),
  'Keep $1,250.00 and invoice 1043 as they are.', 'AT-07: removing the amount blocks saving, with the reason');
select is(private.check_locked_facts('Invoice 1043', E'Hi Sam, invoice 1043 for $1,250.00, or $1,000.00 if paid today.', '1043', 125000),
  'Keep $1,250.00 and invoice 1043 as they are.', 'FR-15: adding a different amount blocks saving');
select is(private.check_locked_facts('Invoice 1043', E'Hi Sam, invoice 1034 for $1,250.00 is now overdue.', '1043', 125000),
  'Keep $1,250.00 and invoice 1043 as they are.', 'FR-15: changing the invoice number blocks saving');

select * from finish();
rollback;
