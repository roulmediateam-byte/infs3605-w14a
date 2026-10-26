// The Week 7 demonstration import built from a business's own invoices: the same file scripts/make-demo-csv.sql makes
// from the seed, with dates that match whichever day the copy of the seed was made.
import { describe, expect, it } from 'vitest';
import type { Client, InvoiceListRow } from '../backend/types.ts';
import { addDays } from './dates.ts';
import { week7Csv } from './demo-file.ts';

const TODAY = '2026-10-28';

const clients: Client[] = [
  { id: 'c1', name: 'Bayside Builders (Test data)', contact_name: 'Sam', email: 'accounts@bayside-builders.example', tone: 'gentle', client_group: 'head_contractor', paused: false, paused_at: null },
  { id: 'c2', name: 'Northshore Homes (Test data)', contact_name: 'Priya', email: 'pay@northshore-homes.example', tone: 'standard', client_group: 'head_contractor', paused: false, paused_at: null },
  { id: 'c4', name: 'Coastline Fitouts (Test data)', contact_name: null, email: null, tone: 'standard', client_group: 'other', paused: false, paused_at: null },
];

const invoice = (number: string, clientId: string, issue: number, due: number, cents: number, status: InvoiceListRow['status'] = 'open'): InvoiceListRow => ({
  id: `i${number}`,
  business_id: 'b1',
  client_id: clientId,
  client_name: clients.find((client) => client.id === clientId)?.name ?? '',
  client_has_email: true,
  client_paused: false,
  client_tone: 'standard',
  invoice_number: number,
  issue_date: addDays(TODAY, issue),
  due_date: addDays(TODAY, due),
  amount_due_cents: cents,
  status,
  paid_date: null,
  close_reason: null,
  last_reminder_sent_at: null,
  reminders_sent_count: 0,
  days_past_due: -due,
  display_status: 'overdue',
});

describe('week7Csv', () => {
  it('leaves out 1043, takes A$450.00 off 1051, adds 1078 and the bad row, with the business\'s own dates', () => {
    const csv = week7Csv(
      [
        invoice('1043', 'c1', -44, -14, 125000),
        invoice('1051', 'c2', -51, -21, 845000),
        invoice('1060', 'c4', -40, -10, 218000),
        invoice('1066', 'c1', -38, -8, 1870000),
        invoice('1090', 'c1', -60, -30, 50000, 'paid'),
      ],
      clients,
      TODAY,
    );
    expect(csv.split('\n')).toEqual([
      'Client,Email,Contact,Invoice number,Issue date,Due date,Amount due',
      '"Northshore Homes (Test data)",pay@northshore-homes.example,Priya,1051,07/09/2026,07/10/2026,"8000.00"',
      '"Coastline Fitouts (Test data)",,,1060,18/09/2026,18/10/2026,"2180.00"',
      '"Bayside Builders (Test data)",accounts@bayside-builders.example,Sam,1066,20/09/2026,20/10/2026,"18700.00"',
      '"Harbourside Cafe (Test data)",owner@harbourside-cafe.example,Lou,1078,08/10/2026,07/11/2026,"760.00"',
      '"Coastline Fitouts (Test data)",,,1080,31/02/2026,15/03/2026,"410.00"',
      '',
    ]);
  });
});
