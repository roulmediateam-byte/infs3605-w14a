import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { describe as describeEntry, type LogEntry, type LogLookups } from './activity.ts';
import { addDays, daysOverdue, formatDate, formatDateLong, formatDay, formatTime, overdueText, parseAuDate, sydneyDate, thisWeeksSunday } from './dates.ts';
import { buildMailto, checkLockedFacts, diffWords, lockedFactsProblem, markLockedChanges, putAmountBack } from './drafts.ts';
import { crc32, csvCell, exportEntries, toCsv, zip } from './export.ts';
import { autoMap, checkRows, cleanEmail, clashingFields, detectFormat, missingFields, planImport, toImportRows, usableMapping, type ParsedFile } from './import-rows.ts';
import { formatAud, parseAmountCents, toJsonInteger } from './money.ts';
import {
  droppedNotes,
  homeCard,
  initialReview,
  nextToSend,
  position,
  reviewReducer,
  reviewSummary,
  sessionCounts,
  stillToSend,
  summaryLine,
  unsentInSession,
} from './review-session.ts';
import { initials, invoiceChip, NOT_SENT_YET, sendByLine, sentLeftToSend, waitingForOwnerLine, whyThisDraft } from './words.ts';
import type { DraftRecord, QueueItem } from '../backend/types.ts';

// A fixed moment: Thu 15 Oct 2026, 1:30 pm in Sydney (AEDT, UTC+11).
const NOW = new Date('2026-10-15T02:30:00Z');

describe('money (BR-14)', () => {
  it('formats cents as private.format_aud does', () => {
    expect(formatAud(125000)).toBe('$1,250.00');
    expect(formatAud(6244000)).toBe('$62,440.00');
    expect(formatAud(5)).toBe('$0.05');
    expect(formatAud(-45000)).toBe('-$450.00');
    expect(formatAud(99_999_999_999n)).toBe('$999,999,999.99');
  });

  it('reads amounts as private.parse_amount_cents does', () => {
    expect(parseAmountCents('$1,250.00')).toBe(125000n);
    expect(parseAmountCents('1250')).toBe(125000n);
    expect(parseAmountCents('A$1,250.5')).toBe(125050n);
    expect(parseAmountCents('1250 AUD')).toBe(125000n);
    expect(parseAmountCents('aud 1 250.00')).toBe(125000n);
    expect(parseAmountCents('-12.5')).toBe(-1250n);
    expect(parseAmountCents('  760.00  ')).toBe(76000n);
    expect(parseAmountCents('12.345')).toBeNull();
    expect(parseAmountCents('twelve')).toBeNull();
    expect(parseAmountCents('')).toBeNull();
    expect(parseAmountCents('\t1250')).toBeNull(); // btrim leaves tabs, so the server can't read it either
    expect(parseAmountCents('123456789012345678901')).toBe(12345678901234567890100n);
  });

  it('sends big totals as strings', () => {
    expect(toJsonInteger(6191000n)).toBe(6191000);
    expect(toJsonInteger(12345678901234567890100n)).toBe('12345678901234567890100');
  });
});

describe('dates in Sydney time (BR-06)', () => {
  it('works out the Sydney date and days overdue', () => {
    expect(sydneyDate(NOW)).toBe('2026-10-15');
    expect(sydneyDate(new Date('2026-10-15T13:30:00Z'))).toBe('2026-10-16'); // 12:30 am Fri in Sydney
    expect(daysOverdue('2026-10-01', NOW)).toBe(14);
    expect(daysOverdue('2026-10-15', NOW)).toBe(0);
    expect(daysOverdue('2026-10-20', NOW)).toBe(-5);
  });

  it('formats dates and times in the house style', () => {
    expect(formatDate('2026-10-12', NOW)).toBe('Mon 12 Oct');
    expect(formatDate('2026-09-21', NOW)).toBe('Mon 21 Sep');
    expect(formatDate('2025-12-25', NOW)).toBe('Thu 25 Dec 2025');
    expect(formatDateLong('2026-10-12')).toBe('Mon 12 Oct 2026');
    expect(formatTime(new Date('2026-10-14T20:00:00Z'))).toBe('7:00 am');
    expect(formatTime(new Date('2026-10-15T07:00:00Z'))).toBe('6:00 pm');
    expect(formatTime(new Date('2026-10-15T01:05:00Z'))).toBe('12:05 pm');
    expect(formatTime(new Date('2026-10-14T13:05:00Z'))).toBe('12:05 am');
    expect(formatDay('2026-10-15T00:00:00Z', NOW)).toBe('Today');
    expect(formatDay('2026-10-14T01:00:00Z', NOW)).toBe('Yesterday');
    expect(overdueText(1)).toBe('1 day overdue');
    expect(overdueText(14)).toBe('14 days overdue');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(thisWeeksSunday(NOW)).toBe('2026-10-11');
    expect(thisWeeksSunday(new Date('2026-10-18T10:30:00Z'))).toBe('2026-10-18'); // Sun 9:30 pm
  });

  it('reads day-first dates as private.parse_au_date does', () => {
    expect(parseAuDate('15/10/2026')).toBe('2026-10-15');
    expect(parseAuDate('5/1/26')).toBe('2026-01-05');
    expect(parseAuDate('15-10-26')).toBe('2026-10-15');
    expect(parseAuDate('15.10.2026')).toBe('2026-10-15');
    expect(parseAuDate('2026-10-15')).toBe('2026-10-15');
    expect(parseAuDate('15 Oct 2026')).toBe('2026-10-15');
    expect(parseAuDate('15 October 2026')).toBe('2026-10-15');
    expect(parseAuDate('15/10/2026 9:30 AM')).toBe('2026-10-15');
    expect(parseAuDate('31/02/2026')).toBeNull();
    expect(parseAuDate('15/13/2026')).toBeNull();
    expect(parseAuDate('15/10/1999')).toBeNull();
    expect(parseAuDate('15/10/202')).toBeNull();
    expect(parseAuDate('10/15/2026')).toBeNull();
    expect(parseAuDate('')).toBeNull();
  });
});

describe('the import preview (FR-04, FR-05, BR-15)', () => {
  const headers = ['Client', 'Email', 'Contact', 'Invoice number', 'Issue date', 'Due date', 'Amount due'];
  const file: ParsedFile = {
    fileName: 'demo.csv',
    headers,
    rows: [
      { row: 2, cells: ['Bayside Builders (Test data)', 'accounts@bayside-builders.example', 'Sam', '1066', '07/09/2026', '07/10/2026', '18700.00'] },
      { row: 3, cells: ['Northshore Homes (Test data)', 'pay@northshore-homes.example', 'Priya', '1051', '25/08/2026', '24/09/2026', '8000.00'] },
      { row: 4, cells: ['Harbourside Cafe (Test data)', 'Owner <owner@harbourside-cafe.example>; b@x.example', 'Lou', '1078', '25/09/2026', '25/10/2026', '760.00'] },
      { row: 5, cells: ['Coastline Fitouts (Test data)', '', '', '1080', '31/02/2026', '15/03/2026', '410.00'] },
    ],
  };

  it('matches the team template and Xero columns', () => {
    const mapping = autoMap(headers);
    expect(mapping).toEqual({
      client: 'Client',
      email: 'Email',
      contact: 'Contact',
      invoice_number: 'Invoice number',
      issue_date: 'Issue date',
      due_date: 'Due date',
      amount_due: 'Amount due',
    });
    expect(detectFormat(headers)).toBe('team_template');
    const xero = ['ContactName', 'EmailAddress', 'InvoiceNumber', 'Reference', 'InvoiceDate', 'DueDate', 'Total', 'InvoiceAmountPaid', 'InvoiceAmountDue'];
    expect(autoMap(xero)).toEqual({
      client: 'ContactName',
      email: 'EmailAddress',
      invoice_number: 'InvoiceNumber',
      issue_date: 'InvoiceDate',
      due_date: 'DueDate',
      amount_due: 'InvoiceAmountDue',
    });
    expect(detectFormat(xero)).toBe('xero_export');
    expect(missingFields({ client: 'A' })).toContain('due_date');
    expect(clashingFields({ issue_date: 'Date', due_date: 'Date' })).toEqual(['due_date']);
    expect(usableMapping({ client: 'Client', email: 'Email', invoice_number: 'Invoice number', issue_date: 'Issue date', due_date: 'Due date', amount_due: 'Amount due' }, headers)).not.toBeNull();
    expect(usableMapping({ client: 'Customer' }, headers)).toBeNull();
  });

  it('finds the same problems the server will', () => {
    const rows = checkRows(toImportRows(file, autoMap(headers)));
    expect(rows.map((r) => r.error)).toEqual([null, null, null, 'Issue date is not a date (use DD/MM/YYYY)']);
    expect(rows[2]?.email).toBe('owner@harbourside-cafe.example');
    const dupes = checkRows([
      { row: 2, client: 'A', email: '', contact: '', invoice_number: '9', issue_date: '01/01/2026', due_date: '31/01/2026', amount_due: '1' },
      { row: 3, client: '', email: '', contact: '', invoice_number: '9', issue_date: '01/01/2026', due_date: '31/01/2026', amount_due: '1' },
      { row: 4, client: 'B', email: '', contact: '', invoice_number: '', issue_date: 'x', due_date: 'x', amount_due: 'x' },
      { row: 5, client: 'B', email: '', contact: '', invoice_number: '10', issue_date: '01/02/2026', due_date: '01/01/2026', amount_due: '0' },
    ]);
    expect(dupes.map((r) => r.error)).toEqual([
      'Invoice number appears more than once in this file',
      'Missing client name',
      'Missing invoice number',
      'Amount must be more than $0',
    ]);
  });

  it('works out what will change, as confirm_import will', () => {
    const rows = checkRows(toImportRows(file, autoMap(headers)));
    const existing = [
      { id: 'i1', invoice_number: '1043', status: 'open' as const, amount_due_cents: 125000, due_date: '2026-10-01', issue_date: '2026-09-01', client_name: 'Bayside Builders (Test data)' },
      { id: 'i2', invoice_number: '1051', status: 'open' as const, amount_due_cents: 845000, due_date: '2026-09-24', issue_date: '2026-08-25', client_name: 'Northshore Homes (Test data)' },
      { id: 'i3', invoice_number: '1066', status: 'open' as const, amount_due_cents: 1870000, due_date: '2026-10-07', issue_date: '2026-09-07', client_name: 'Bayside Builders (Test data)' },
      { id: 'i4', invoice_number: '1080', status: 'open' as const, amount_due_cents: 41000, due_date: '2026-03-15', issue_date: '2026-02-01', client_name: 'Coastline Fitouts (Test data)' },
    ];
    const plan = planImport(rows, existing, new Map([['i1', 1], ['i2', 1], ['i3', 1]]), new Set(['bayside builders (test data)', 'northshore homes (test data)']));
    expect(plan).toMatchObject({
      rowsRead: 4,
      rowsSaved: 3,
      rowsSkipped: 1,
      fileTotalCents: 2787000n,
      savedTotalCents: 2746000n,
      added: 1,
      updated: 1,
      closed: 1, // 1043; 1080 is in the file (a skipped row still counts as present)
      draftsCancelled: 2,
      newClients: 1,
      massClose: false,
    });
    expect(plan.problems).toEqual([{ row: 5, reason: 'Issue date is not a date (use DD/MM/YYYY)' }]);
  });

  it('reads the first email in a cell', () => {
    expect(cleanEmail('Accounts <Pay@Example.test>, other@example.test')).toBe('pay@example.test');
    expect(cleanEmail('no address')).toBeNull();
  });
});

describe('drafts (FR-15, FR-18)', () => {
  const body = 'Hi Priya,\n\nInvoice 1051 for $8,450.00 was due on Mon 21 Sep 2026.\n\nThanks,\nAlex Test\nHarbour Line Electrical (Test data)';

  it('keeps the locked facts', () => {
    expect(checkLockedFacts('Invoice 1051', body, '1051', 845000)).toBeNull();
    expect(checkLockedFacts('Invoice 1051', body.replace('$8,450.00', '$8,000.00'), '1051', 845000)).toBe('Keep $8,450.00 and invoice 1051 as they are.');
    expect(checkLockedFacts('Invoice 1051', body.replace('Invoice 1051', 'Invoice 10512'), '1051', 845000)).toBe('Keep $8,450.00 and invoice 1051 as they are.');
    expect(checkLockedFacts('Invoice 1051', `${body} Or pay $100 now.`, '1051', 845000)).toBe('Keep $8,450.00 and invoice 1051 as they are.');
    expect(checkLockedFacts('Discount $5', body, '1051', 845000)).toBe('Keep $8,450.00 and invoice 1051 as they are.');
    expect(checkLockedFacts(' ', body, '1051', 845000)).toBe('Add a subject.');
    expect(checkLockedFacts('Hi', '  ', '1051', 845000)).toBe('Add a message.');
    expect(checkLockedFacts('x'.repeat(121), body, '1051', 845000)).toBe('Keep the subject under 120 characters.');
    expect(checkLockedFacts('Hi', `${body}${'a'.repeat(1800)}`, '1051', 845000)).toBe('Keep the message under 1,800 characters so it fits in your email app.');
  });

  it('names the wrong amount, and refuses exactly what the server refuses', () => {
    // The demonstration's "blocked" beat: the amount changed in the message.
    const changed = body.replace('$8,450.00', '$8,000.00');
    expect(lockedFactsProblem('Invoice 1051', changed, '1051', 845000)).toEqual({
      server: 'Keep $8,450.00 and invoice 1051 as they are.',
      message: 'The message says $8,000.00. Amounts come from your records, so keep $8,450.00.',
      field: 'body',
      wrong: '$8,000.00',
      right: '$8,450.00',
    });
    expect(lockedFactsProblem('Discount $5', body, '1051', 845000)).toMatchObject({
      message: 'The subject says $5. Amounts come from your records, so keep $8,450.00.',
      field: 'subject',
      wrong: '$5',
    });
    // An extra amount is named even though the locked one is still there.
    expect(lockedFactsProblem('Invoice 1051', `${body} Or pay $100 now.`, '1051', 845000)?.wrong).toBe('$100');
    // A changed invoice number has no amount to name, so the server's words stand.
    expect(lockedFactsProblem('Invoice 1051', body.replace('Invoice 1051', 'Invoice 10512'), '1051', 845000)).toMatchObject({
      message: 'Keep $8,450.00 and invoice 1051 as they are.',
      wrong: null,
    });
    // An amount that runs from the subject into the message is refused, but not named.
    expect(lockedFactsProblem('Pay $', `100 now. ${body}`, '1051', 845000)).toMatchObject({ server: 'Keep $8,450.00 and invoice 1051 as they are.', wrong: null });
    expect(checkLockedFacts('Pay $', `100 now. ${body}`, '1051', 845000)).toBe('Keep $8,450.00 and invoice 1051 as they are.');
    expect(lockedFactsProblem('Invoice 1051', body, '1051', 845000)).toBeNull();
  });

  it('puts the locked amount back wherever the wrong one was written', () => {
    const changed = `${body.replace('$8,450.00', '$8,000.00')} Again, $8,000.00. Not $80.`;
    const fixed = putAmountBack(changed, '$8,000.00', '$8,450.00');
    expect(fixed).toContain('Invoice 1051 for $8,450.00 was due');
    expect(fixed).toContain('Again, $8,450.00. Not $80.');
    expect(lockedFactsProblem('Invoice 1051', fixed, '1051', 845000)?.wrong).toBe('$80');
  });

  it('marks a changed locked fact apart from ordinary changes', () => {
    const before = 'Invoice 1051 for $8,450.00 was due.';
    const after = 'Invoice 1051 for $8,000.00 was due last month.';
    expect(markLockedChanges(diffWords(before, after), '1051', '$8,450.00')).toEqual([
      { kind: 'same', text: 'Invoice 1051 for ' },
      { kind: 'removed', text: '$8,450.00', locked: true },
      { kind: 'added', text: '$8,000.00', locked: true },
      { kind: 'same', text: ' was ' },
      { kind: 'removed', text: 'due.' },
      { kind: 'added', text: 'due last month.' },
    ]);
    // A removed invoice number is marked; the punctuation around it is not.
    expect(markLockedChanges([{ kind: 'removed', text: '(1051),' }], '1051', '$8,450.00')).toEqual([
      { kind: 'removed', text: '(' },
      { kind: 'removed', text: '1051', locked: true },
      { kind: 'removed', text: '),' },
    ]);
    // The locked amount added back somewhere else is not a change to warn about.
    expect(markLockedChanges([{ kind: 'added', text: 'now $8,450.00' }], '1051', '$8,450.00')).toEqual([{ kind: 'added', text: 'now $8,450.00' }]);
  });

  it('builds the email link with encodeURIComponent', () => {
    const link = buildMailto('pay+ar@northshore-homes.example', 'Invoice 1051 & more', 'Hi Priya,\nThanks');
    expect(link).toBe('mailto:pay%2Bar@northshore-homes.example?subject=Invoice%201051%20%26%20more&body=Hi%20Priya%2C%0D%0AThanks');
  });

  it('shows changes word by word', () => {
    expect(diffWords('Thanks for paying soon', 'Thanks for paying this week')).toEqual([
      { kind: 'same', text: 'Thanks for paying ' },
      { kind: 'removed', text: 'soon' },
      { kind: 'added', text: 'this week' },
    ]);
  });
});

describe('status language', () => {
  it('words invoice chips', () => {
    expect(invoiceChip({ display_status: 'overdue', due_date: '2026-10-01', paid_date: null }, NOW)).toEqual({ label: 'Overdue · 14 days', tone: 'overdue' });
    expect(invoiceChip({ display_status: 'due_soon', due_date: '2026-10-18', paid_date: null }, NOW)).toEqual({ label: 'Due in 3 days', tone: 'due-soon' });
    expect(invoiceChip({ display_status: 'due', due_date: '2026-11-02', paid_date: null }, NOW)).toEqual({ label: 'Due Mon 2 Nov', tone: 'neutral' });
    expect(invoiceChip({ display_status: 'paid', due_date: '2026-10-01', paid_date: '2026-10-12' }, NOW)).toEqual({ label: 'Paid Mon 12 Oct', tone: 'paid' });
    expect(invoiceChip({ display_status: 'closed', due_date: '2026-10-01', paid_date: null }, NOW).label).toBe('Closed: not in latest import');
  });

  it('explains a draft', () => {
    const lines = whyThisDraft({ invoice_number: '1043', days_overdue: 14, reminders_sent_before: 0, tone: 'gentle', source: 'template', cooldownDays: 6 });
    expect(lines[0]).toBe('Drafted because invoice 1043 is 14 days overdue, the client has an email and no reminder has been sent for it yet. Tone: Gentle, set for this client.');
    expect(lines[1]).toBe("Your apprentice couldn't write this one, so it used the Gentle template.");
    // The preview has no AI at all, so it doesn't report a failure.
    const preview = whyThisDraft({ invoice_number: '1062', days_overdue: 45, reminders_sent_before: 1, tone: 'firm', source: 'template', cooldownDays: 6 }, { preview: true });
    expect(preview[1]).toBe('This preview has no AI, so your apprentice used the Firm template.');
    expect(whyThisDraft({ invoice_number: '1062', days_overdue: 45, reminders_sent_before: 1, tone: 'firm', source: 'ai', cooldownDays: 6 }, { preview: true })).toHaveLength(1);
  });

  it('gives each client an avatar of up to two letters, leaving out "(Test data)"', () => {
    expect(initials('Northshore Homes (Test data)')).toBe('NH');
    expect(initials('Greenway Strata (Test data)')).toBe('GS');
    expect(initials('bayside')).toBe('B');
    expect(initials('Smith & Sons Electrical')).toBe('SS');
    expect(initials('Élan Fitouts')).toBe('ÉF');
    expect(initials('(Test data)')).toBe('?');
  });

  it('words sending the same way everywhere', () => {
    expect(NOT_SENT_YET).toBe('Not sent yet. It waits under Ready to send on Home.');
    expect(sendByLine(2)).toBe("Send by Sun 9:00 pm, when Sunday's run replaces them.");
    expect(sendByLine(1)).toBe("Send by Sun 9:00 pm, when Sunday's run replaces it.");
    expect(waitingForOwnerLine('Alex', 4)).toBe("Waiting for Alex to send them by Sun 9:00 pm, when Sunday's run replaces them.");
    expect(sentLeftToSend(1)).toBe('Sent. 1 left to send.');
    expect(sentLeftToSend(0)).toBe('Sent. None left to send.');
  });

  it('writes log sentences', () => {
    const lookups: LogLookups = { memberName: (id) => (id === 'u1' ? 'Jo Test' : undefined), invoiceNumber: () => '1051', clientName: () => 'Northshore Homes (Test data)' };
    const entry = (action: LogEntry['action'], details: Record<string, unknown>, role: LogEntry['actor_role'] = 'checker'): LogEntry => ({
      id: 1, at: NOW.toISOString(), actor_user_id: role === 'system' ? null : 'u1', actor_role: role, action, invoice_id: 'i', draft_id: null, client_id: 'c', import_id: null, run_id: null, details,
    });
    expect(describeEntry(entry('draft_approved', { edited: true }), lookups)).toBe('Jo Test approved the reminder for invoice 1051 after editing it');
    expect(describeEntry(entry('draft_rejected', { reason: 'will_call' }), lookups)).toBe("Jo Test rejected the reminder for invoice 1051: I'll call them");
    expect(describeEntry(entry('draft_cancelled', { reason: 'amount_changed' }, 'system'), lookups)).toBe('The reminder for invoice 1051 was cancelled: the amount changed');
    expect(describeEntry(entry('draft_flagged', { reason: 'amount_changed', from_cents: 845000, to_cents: 800000 }), lookups)).toBe('The amount of invoice 1051 changed from $8,450.00 to $8,000.00');
    expect(describeEntry(entry('reminder_sent', { method: 'copy_paste' }), lookups)).toBe('Jo Test sent the reminder for invoice 1051 by copying it into their email');
    expect(describeEntry(entry('import_completed', { rows_read: 13, invoices_added: 1, invoices_updated: 1, invoices_closed: 1, rows_skipped: 1 }), lookups)).toBe(
      'Jo Test imported 13 rows: 1 added, 1 updated, 1 closed, 1 row skipped',
    );
    expect(describeEntry(entry('settings_changed', { fields: ['briefing_time', 'style_note'] }, 'owner'), lookups)).toBe('Jo Test changed the briefing time and style note');
  });
});

describe('export (FR-03)', () => {
  it('stops spreadsheets running formulas', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+61 2 9000 0000')).toBe("'+61 2 9000 0000");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@me')).toBe("'@me");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell(-450)).toBe('-450');
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell({ row: 13 })).toBe('"{""row"":13}"');
    expect(toCsv([{ a: 1, b: 'x' }, { a: 2, c: true }])).toBe('﻿a,b,c\r\n1,x,\r\n2,,true\r\n');
  });

  it('writes a valid stored zip', () => {
    const bytes = zip([{ name: 'a.csv', content: 'hello' }, { name: 'b.csv', content: 'world!' }], new Date(2026, 9, 15, 13, 30));
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(crc32(new TextEncoder().encode('hello')));
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    // The stored data is the file itself.
    expect(new TextDecoder().decode(bytes.slice(30 + 5, 30 + 5 + 5))).toBe('hello');
    expect(typeof inflateRawSync).toBe('function');
    const entries = exportEntries({ exported_at: '2026-10-15T02:30:00Z', business: { name: 'X' }, clients: [{ name: '=evil' }] });
    expect(entries.map((e) => e.name)).toEqual(['README.txt', 'business.csv', 'clients.csv']);
    expect(entries[2]?.content).toContain("'=evil");
  });
});

describe('a review session (FR-14, FR-19)', () => {
  const item = (id: string, amount: number) =>
    ({
      draft_id: id, queue_position: 0, queue_total: 0, invoice_id: `i-${id}`, invoice_number: id, client_id: 'c', client_name: 'C', client_email: 'c@example.test',
      amount_due_cents: amount, due_date: '2026-10-01', days_overdue: 14, tone: 'standard', source: 'template', subject: 's', body: 'b', call_first: false,
      reminders_sent_before: 0, created_at: NOW.toISOString(),
    }) as QueueItem;

  const record = (id: string): DraftRecord => ({
    id, invoice_id: `i-${id}`, status: 'waiting', source: 'template', tone_used: 'standard', invoice_number_shown: id, amount_shown_cents: 100,
    due_date_shown: '2026-10-01', edited: false, final_subject: null, final_body: null, approved_by: null, approver_role: null, approved_at: null,
    rejected_by: null, rejected_at: null, reject_reason: null, sent_confirmed_by: null, sent_confirmed_at: null, cancelled_at: null, cancel_reason: null,
    created_at: NOW.toISOString(),
  });

  it('keeps the count fixed and notes drafts decided elsewhere', () => {
    let state = reviewReducer(initialReview, { type: 'load', queue: [item('a', 3), item('b', 2), item('c', 1)], startAt: 'b' });
    expect(state.currentId).toBe('b');
    expect(position(state)).toBe(1);
    state = reviewReducer(state, { type: 'outcome', id: 'b', outcome: { kind: 'approved', edited: false } });
    state = reviewReducer(state, { type: 'next' });
    expect(state.currentId).toBe('c');
    expect(position(state)).toBe(2);
    // Someone else decides "a" while "c" is on screen: it drops out, the count stays 3, and its record says who.
    state = reviewReducer(state, { type: 'load', queue: [item('c', 1)] });
    expect(state.total).toBe(3);
    expect(state.outcomes.a).toEqual({ kind: 'dropped', dropped: 'away' });
    expect(position(state)).toBe(3);
    state = reviewReducer(state, { type: 'resolve', id: 'a', record: { ...record('a'), status: 'approved', approved_by: 'u-linda' } });
    const names = (id: string | null) => (id === 'u-linda' ? 'Linda' : id === 'u-me' ? 'you' : 'someone');
    expect(droppedNotes(state, names)).toEqual(['Linda approved 1 while you were reviewing.']);
    state = reviewReducer(state, { type: 'outcome', id: 'c', outcome: { kind: 'rejected' } });
    state = reviewReducer(state, { type: 'next' });
    expect(state.currentId).toBeNull();
    const counts = sessionCounts(state);
    expect(counts).toMatchObject({ approved: 1, notYet: 1, rejected: 1, elsewhere: 1, waiting: 0 });
    expect(summaryLine(counts, true, 'Alex')).toBe('All caught up: 1 rejected, 1 waiting to send, 1 decided by someone else');
    expect(summaryLine(counts, false, 'Alex')).toBe('1 approved for Alex to send, 1 rejected, 1 decided by someone else');
  });

  it('says a draft was cancelled, not decided by someone, when an import or payment cancels it mid-review', () => {
    let state = reviewReducer(initialReview, { type: 'load', queue: [item('a', 3), item('b', 2), item('c', 1)] });
    // "b" is cancelled by an import while "a" is on screen; "a" itself is cancelled too.
    state = reviewReducer(state, { type: 'load', queue: [item('c', 1)] });
    expect(state.outcomes.a).toEqual({ kind: 'dropped', dropped: 'on-screen' });
    state = reviewReducer(state, { type: 'resolve', id: 'b', record: { ...record('b'), status: 'cancelled', cancel_reason: 'invoice_closed' } });
    state = reviewReducer(state, { type: 'resolve', id: 'a', record: { ...record('a'), status: 'cancelled', cancel_reason: 'amount_changed' } });
    expect(state.outcomes.a).toEqual({ kind: 'cancelled', reason: 'amount_changed', dropped: 'on-screen' });
    // Only the one that wasn't on screen gets a note; the one on screen explains itself in place.
    expect(droppedNotes(state, () => 'someone')).toEqual(['1 draft was cancelled while you were reviewing.']);
    expect(sessionCounts(state)).toMatchObject({ cancelled: 2, elsewhere: 0, waiting: 1 });
    // A record that can't be found reads as gone; a resolve for a draft that didn't drop out changes nothing.
    expect(reviewReducer(state, { type: 'resolve', id: 'c', record: null }).outcomes.c).toBeUndefined();
  });

  it('never says "All caught up" while an approved reminder is unsent', () => {
    let state = reviewReducer(initialReview, { type: 'load', queue: [item('a', 3), item('b', 2), item('c', 1), item('d', 1)] });
    state = reviewReducer(state, { type: 'outcome', id: 'a', outcome: { kind: 'sent', edited: false } });
    state = reviewReducer(state, { type: 'outcome', id: 'b', outcome: { kind: 'not-yet', edited: false } });
    // The Send sheet closed without an answer: still approved, still unsent.
    state = reviewReducer(state, { type: 'outcome', id: 'c', outcome: { kind: 'approved', edited: true } });
    state = reviewReducer(state, { type: 'outcome', id: 'd', outcome: { kind: 'rejected' } });
    const counts = sessionCounts(state);
    expect(unsentInSession(state)).toEqual(['b', 'c']);
    // "z" was approved by the checker before this review; "a" was sent here, though the database list hasn't caught up.
    expect(stillToSend(state, ['z', 'a', 'b'])).toEqual(['b', 'c', 'z']);
    expect(reviewSummary(counts, true, 'Alex', 3)).toEqual({
      title: '3 reminders still to send',
      counts: '1 sent, 1 rejected, 2 waiting to send',
      line: "Send by Sun 9:00 pm, when Sunday's run replaces them. They wait under Ready to send on Home.",
    });
    expect(reviewSummary(counts, true, 'Alex', 1).line).toBe("Send by Sun 9:00 pm, when Sunday's run replaces it. It waits under Ready to send on Home.");
    // While the approved list hasn't loaded, the summary gives the counts and makes no claim.
    expect(reviewSummary({ ...counts, notYet: 0, approved: 1 }, true, 'Alex', null)).toEqual({ title: '1 sent, 1 rejected', counts: null, line: null });
    // Only when nothing is left to send is it all caught up.
    expect(reviewSummary({ ...counts, notYet: 0, approved: 1 }, true, 'Alex', 0)).toEqual({ title: 'All caught up: 1 sent, 1 rejected', counts: null, line: null });
    // A checker who may not send is told who does.
    expect(reviewSummary(counts, false, 'Alex', null)).toEqual({
      title: '3 approved for Alex to send, 1 rejected',
      counts: null,
      line: "Waiting for Alex to send them by Sun 9:00 pm, when Sunday's run replaces them.",
    });
  });

  it('offers the next reminder to send, not the one just put off', () => {
    expect(nextToSend([], null)).toBeNull();
    expect(nextToSend(['b', 'c', 'z'], null)).toBe('b');
    expect(nextToSend(['b', 'c', 'z'], 'b')).toBe('c'); // "Not yet" on b
    expect(nextToSend(['b', 'c', 'z'], 'z')).toBe('b');
    expect(nextToSend(['c', 'z'], 'b')).toBe('c'); // b was sent
    expect(nextToSend(['c'], 'c')).toBe('c');
  });

  it("chooses Home's decision card: review, then send, then all caught up", () => {
    const base = { sends: true, ownerSends: false, ownerFirstName: 'Alex' };
    expect(homeCard({ ...base, waiting: 5, approved: 2 })).toEqual({ kind: 'review', title: '5 drafts need your OK', line: 'Nothing is sent until you approve and send it.' });
    expect(homeCard({ ...base, waiting: 0, approved: 2 })).toEqual({
      kind: 'send',
      title: '2 reminders approved, not sent yet',
      line: "Send by Sun 9:00 pm, when Sunday's run replaces them.",
    });
    expect(homeCard({ ...base, waiting: 0, approved: 1 }).title).toBe('1 reminder approved, not sent yet');
    expect(homeCard({ ...base, waiting: 0, approved: 0 })).toEqual({ kind: 'done', title: 'All caught up', line: 'Your apprentice drafts again on Sunday.' });
    // Until the approved reminders have loaded, the card doesn't claim the week is done.
    expect(homeCard({ ...base, waiting: 0, approved: null }).kind).toBe('unknown');
    expect(homeCard({ ...base, waiting: 0, approved: null }).title).not.toContain('caught up');
    // A checker who may not send: the owner sends.
    const checker = { sends: false, ownerSends: true, ownerFirstName: 'Alex' };
    expect(homeCard({ ...checker, waiting: 1, approved: 1 }).line).toBe('Nothing is sent until you approve it and Alex sends it.');
    expect(homeCard({ ...checker, waiting: 0, approved: 4 })).toEqual({
      kind: 'send',
      title: '4 reminders approved, not sent yet',
      line: "Waiting for Alex to send them by Sun 9:00 pm, when Sunday's run replaces them.",
    });
  });

  it('logs a review in plain words', () => {
    const lookups: LogLookups = { memberName: () => 'Jo Test', invoiceNumber: () => undefined, clientName: () => undefined };
    const base = { id: 1, at: NOW.toISOString(), actor_user_id: 'u', invoice_id: null, draft_id: null, client_id: null, import_id: null, run_id: null } as const;
    expect(describeEntry({ ...base, actor_role: 'owner', action: 'review_session', details: { approved: 4, sent: 3, not_yet: 1, rejected: 1, seconds: 250 } }, lookups)).toBe(
      'Jo Test reviewed 5 drafts in 4 min: 3 sent, 1 rejected, 1 waiting to send',
    );
    expect(describeEntry({ ...base, actor_role: 'checker', action: 'review_session', details: { approved: 4, not_yet: 4, rejected: 1, seconds: 30 } }, lookups)).toBe(
      'Jo Test reviewed 5 drafts in 1 min: 4 approved, 1 rejected',
    );
    expect(describeEntry({ ...base, actor_user_id: null, actor_role: 'system', action: 'weekly_run_completed', details: { drafts_created: 5, source: 'seed' } }, lookups)).toBe(
      'Your apprentice drafted 5 reminders',
    );
  });
});
