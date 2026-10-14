-- Writes the Week 7 demonstration import to standard output, built from the seed so the dates always match:
--   * 1043 is missing (paid in Xero), so it closes and its waiting draft is cancelled (BR-03);
--   * 1051's amount drops by $450.00 (a part payment), so its waiting draft is cancelled and flagged (AT-03);
--   * one row has a bad date, so the totals check lists and skips it (FR-05);
--   * 1078 is new.
-- Usage (local Supabase): psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/make-demo-csv.sql > demo-import.csv
-- Test data only (RI-9). Delete the file after the demonstration.
\pset format unaligned
\pset tuples_only on
\pset fieldsep ','
select 'Client,Email,Contact,Invoice number,Issue date,Due date,Amount due';
with rows as (
  select c.name as client, coalesce(c.email, '') as email, coalesce(c.contact_name, '') as contact, i.invoice_number,
         to_char(i.issue_date, 'DD/MM/YYYY') as issue_date, to_char(i.due_date, 'DD/MM/YYYY') as due_date,
         case when i.invoice_number = '1051' then i.amount_due_cents - 45000 else i.amount_due_cents end as cents
  from public.invoices i join public.clients c on c.id = i.client_id
  where i.business_id = '0d5e0000-0000-4000-8000-000000000001' and i.status = 'open' and i.invoice_number <> '1043'
)
select format('"%s",%s,%s,%s,%s,%s,"%s"', client, email, contact, invoice_number, issue_date, due_date,
              to_char(cents / 100.0, 'FM999999990.00'))
from rows
union all
select format('"%s",%s,%s,%s,%s,%s,"%s"', 'Harbourside Cafe (Test data)', 'owner@harbourside-cafe.example', 'Lou', '1078',
              to_char(current_date - 20, 'DD/MM/YYYY'), to_char(current_date + 10, 'DD/MM/YYYY'), '760.00')
union all
select format('"%s",%s,%s,%s,%s,%s,"%s"', 'Coastline Fitouts (Test data)', '', '', '1080', '31/02/2026', '15/03/2026', '410.00');
