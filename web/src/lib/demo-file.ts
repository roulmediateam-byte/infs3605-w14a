// The Week 7 demonstration import, built from the business's own invoices so its dates always match, as
// scripts/make-demo-csv.sql builds it from the seed and the preview's sampleImportFile does in the browser. Keep the
// three in step. Against a copy of the seed's invoices it gives the demo's plan:
//   * 1043 is missing (paid in Xero), so it closes and its waiting draft is cancelled (BR-03);
//   * 1051's amount drops by A$450.00 (a part payment), so its waiting draft is cancelled and flagged (AT-03);
//   * 1078 is new, and one row (spreadsheet row 14) has a date that doesn't exist, so it is skipped (FR-05).
// The demonstration build offers it on Import, for Test data businesses only (RI-9).
import type { Client, InvoiceListRow } from '../backend/types.ts';
import { addDays, sydneyDate } from './dates.ts';

const HEADER = 'Client,Email,Contact,Invoice number,Issue date,Due date,Amount due';

/** 2026-10-27 as 27/10/2026, the way an Australian spreadsheet writes it. */
const auDate = (isoDate: string): string => {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
};

const dollars = (cents: number): string => (cents / 100).toFixed(2);

export const week7Csv = (invoices: readonly InvoiceListRow[], clients: readonly Client[], today: string = sydneyDate()): string => {
  const byId = new Map(clients.map((client) => [client.id, client]));
  const lines = invoices
    .filter((invoice) => invoice.status === 'open' && invoice.invoice_number !== '1043')
    .map((invoice) => {
      const client = byId.get(invoice.client_id);
      const cents = invoice.invoice_number === '1051' ? invoice.amount_due_cents - 45000 : invoice.amount_due_cents;
      return [
        `"${client?.name ?? invoice.client_name}"`,
        client?.email ?? '',
        client?.contact_name ?? '',
        invoice.invoice_number,
        auDate(invoice.issue_date),
        auDate(invoice.due_date),
        `"${dollars(cents)}"`,
      ].join(',');
    });
  lines.push(`"Harbourside Cafe (Test data)",owner@harbourside-cafe.example,Lou,1078,${auDate(addDays(today, -20))},${auDate(addDays(today, 10))},"760.00"`);
  lines.push('"Coastline Fitouts (Test data)",,,1080,31/02/2026,15/03/2026,"410.00"');
  return [HEADER, ...lines, ''].join('\n');
};

export const week7File = (invoices: readonly InvoiceListRow[], clients: readonly Client[]): File =>
  new File([week7Csv(invoices, clients)], 'demo-import.csv', { type: 'text/csv' });
