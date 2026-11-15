// The Check step's lists and words (UI-08, FR-06, BR-03, BR-05): what will close, which reminders are cancelled and
// why, and a summary that never says "nothing changes" while an invoice closes or a reminder is cancelled.
import { describe, expect, it } from 'vitest';
import { CANCELLED_BECAUSE, checkRows, planImport, planWords, type ExistingInvoice, type ImportPlan, type ImportRowInput } from './import-rows.ts';

const row = (n: number, invoice: string, client: string, issued: string, due: string, amount: string): ImportRowInput => ({
  row: n,
  client,
  email: 'pay@example.test',
  contact: '',
  invoice_number: invoice,
  issue_date: issued,
  due_date: due,
  amount_due: amount,
});

const invoice = (id: string, number: string, client: string, cents: number, due: string, status: ExistingInvoice['status'] = 'open'): ExistingInvoice => ({
  id,
  invoice_number: number,
  status,
  amount_due_cents: cents,
  due_date: due,
  issue_date: '2026-09-01',
  client_name: client,
});

/** A plan with every count at zero, for checking the words of one combination at a time. */
const blank = (overrides: Partial<ImportPlan>): ImportPlan => ({
  rowsRead: 0,
  rowsSaved: 0,
  rowsSkipped: 0,
  fileTotalCents: 0n,
  savedTotalCents: 0n,
  added: 0,
  updated: 0,
  reopened: 0,
  keptPaid: 0,
  unchanged: 0,
  closed: 0,
  draftsCancelled: 0,
  newClients: 0,
  openBefore: 0,
  massClose: false,
  problems: [],
  closingInvoices: [],
  cancelledReminders: [],
  ...overrides,
});

const allText = (words: ReturnType<typeof planWords>): string[] =>
  [words.headline, words.detail, words.closing?.heading, words.closing?.explanation, words.cancelled?.heading, words.cancelled?.explanation, words.massClose?.title, words.massClose?.body].filter(
    (text): text is string => typeof text === 'string',
  );

describe('what the import will close and cancel (FR-06, BR-03, BR-05)', () => {
  const existing = [
    invoice('i1', '1043', 'Bayside Builders (Test data)', 125000, '2026-10-01'),
    invoice('i2', '1051', 'Northshore Homes (Test data)', 845000, '2026-09-24'),
    invoice('i3', '1066', 'Bayside Builders (Test data)', 1870000, '2026-10-07'),
    invoice('i4', '1056', 'M. Chen Renovation (Test data)', 320000, '2026-09-21'),
    invoice('i5', '998', 'Greenway Strata (Test data)', 64000, '2026-09-06'),
    invoice('i6', '1030', 'Coastline Fitouts (Test data)', 41000, '2026-08-15', 'paid'),
    invoice('i7', '1020', 'Coastline Fitouts (Test data)', 99000, '2026-08-01', 'closed'),
  ];
  // 1043 and 998 are missing; 1051 drops by $450.00; 1056 moves its due date; 1066 is unchanged; 1078 is new.
  const rows = checkRows([
    row(2, '1051', 'Northshore Homes (Test data)', '01/09/2026', '24/09/2026', '8000.00'),
    row(3, '1066', 'Bayside Builders (Test data)', '01/09/2026', '07/10/2026', '18700.00'),
    row(4, '1056', 'M. Chen Renovation (Test data)', '01/09/2026', '28/09/2026', '3200.00'),
    row(5, '1078', 'Harbourside Cafe (Test data)', '01/10/2026', '31/10/2026', '760.00'),
  ]);
  const live = new Map([
    ['i1', 1],
    ['i2', 1],
    ['i3', 1],
    ['i4', 1],
  ]);
  const plan = planImport(rows, existing, live, new Set(['bayside builders (test data)', 'northshore homes (test data)', 'm. chen renovation (test data)']));

  it('names every open invoice that will close, in invoice number order', () => {
    expect(plan.closed).toBe(2);
    expect(plan.closingInvoices).toEqual([
      { invoiceNumber: '998', clientName: 'Greenway Strata (Test data)', amountDueCents: 64000, dueDate: '2026-09-06' },
      { invoiceNumber: '1043', clientName: 'Bayside Builders (Test data)', amountDueCents: 125000, dueDate: '2026-10-01' },
    ]);
  });

  it('leaves paid and already closed invoices off the closing list', () => {
    expect(plan.closingInvoices.map((closing) => closing.invoiceNumber)).not.toContain('1030');
    expect(plan.closingInvoices.map((closing) => closing.invoiceNumber)).not.toContain('1020');
  });

  it('names every reminder that will be cancelled, with the reason confirm_import records', () => {
    expect(plan.cancelledReminders).toEqual([
      { invoiceNumber: '1043', clientName: 'Bayside Builders (Test data)', reason: 'invoice_closed' },
      { invoiceNumber: '1051', clientName: 'Northshore Homes (Test data)', reason: 'amount_changed' },
      { invoiceNumber: '1056', clientName: 'M. Chen Renovation (Test data)', reason: 'due_date_changed' },
    ]);
    // 998 closes but has no reminder waiting, and 1066's reminder stays because nothing about it changed.
    expect(plan.draftsCancelled).toBe(plan.cancelledReminders.length);
    expect(plan.cancelledReminders.map((reminder) => CANCELLED_BECAUSE[reminder.reason])).toEqual(['Not in this file', 'Amount changed', 'Due date changed']);
  });

  it('counts the unchanged rows, so the parts add up to the invoices saved', () => {
    expect(plan).toMatchObject({ rowsSaved: 4, added: 1, updated: 2, unchanged: 1, keptPaid: 0, reopened: 0 });
    expect(plan.added + plan.updated + plan.reopened + plan.keptPaid + plan.unchanged).toBe(plan.rowsSaved);
  });

  it('gives the amount as the reason when both the amount and the due date change, as the server does', () => {
    const both = planImport(
      checkRows([row(2, '1051', 'Northshore Homes (Test data)', '01/09/2026', '30/09/2026', '8000.00')]),
      [invoice('i2', '1051', 'Northshore Homes (Test data)', 845000, '2026-09-24')],
      new Map([['i2', 1]]),
      new Set(['northshore homes (test data)']),
    );
    expect(both.cancelledReminders).toEqual([{ invoiceNumber: '1051', clientName: 'Northshore Homes (Test data)', reason: 'amount_changed' }]);
  });

  it('sorts invoice numbers as numbers, not as text', () => {
    const sorted = planImport(
      checkRows([row(2, 'INV-1', 'A', '01/09/2026', '30/09/2026', '1.00')]),
      [invoice('a', 'INV-10', 'A', 100, '2026-09-30'), invoice('b', 'INV-9', 'A', 100, '2026-09-30'), invoice('c', 'INV-100', 'A', 100, '2026-09-30')],
      new Map(),
      new Set(['a']),
    );
    expect(sorted.closingInvoices.map((closing) => closing.invoiceNumber)).toEqual(['INV-9', 'INV-10', 'INV-100']);
  });
});

describe('the Check step summary (UI-08)', () => {
  it('nothing changes', () => {
    expect(planWords(blank({ rowsRead: 2, rowsSaved: 2, unchanged: 2, openBefore: 2 }))).toEqual({
      headline: '2 invoices will be saved.',
      detail: 'Nothing changes. The 2 invoices in this file match your records.',
      closing: null,
      cancelled: null,
      massClose: null,
    });
    expect(planWords(blank({ rowsRead: 2, rowsSaved: 1, rowsSkipped: 1, unchanged: 1 }))).toMatchObject({
      headline: '1 invoice will be saved and 1 row skipped.',
      detail: 'Nothing changes. The invoice in this file matches your records.',
    });
  });

  it('only additions or updates', () => {
    expect(planWords(blank({ rowsRead: 3, rowsSaved: 3, added: 2, updated: 1, newClients: 1 }))).toEqual({
      headline: '3 invoices will be saved.',
      detail: '2 new, 1 changed, 1 new client.',
      closing: null,
      cancelled: null,
      massClose: null,
    });
    expect(planWords(blank({ rowsRead: 4, rowsSaved: 4, updated: 1, reopened: 1, keptPaid: 1, unchanged: 1 })).detail).toBe(
      '1 changed, 1 reopened, 1 already marked paid, 1 unchanged.',
    );
  });

  it('closures, when the file itself is unchanged (the case that used to say "No changes to your invoices.")', () => {
    const words = planWords(blank({ rowsRead: 2, rowsSaved: 2, unchanged: 2, closed: 10, draftsCancelled: 4, openBefore: 12, massClose: true }));
    expect(words).toEqual({
      headline: "2 invoices will be saved. 10 invoices aren't in this file and will be closed, and 4 reminders will be cancelled.",
      detail: 'The 2 invoices in this file are unchanged.',
      closing: {
        heading: '10 invoices will be closed',
        explanation: 'Not in this file, so they will be closed. That usually means they were paid in Xero.',
      },
      cancelled: { heading: '4 reminders will be cancelled', explanation: "They won't be sent." },
      massClose: {
        title: 'This file would close 10 of your 12 open invoices.',
        body: "Check it is your full list of unpaid invoices. If it isn't, choose another file.",
      },
    });
  });

  it('closures without reminders, and the demonstration file', () => {
    expect(planWords(blank({ rowsRead: 1, rowsSaved: 1, unchanged: 1, closed: 1, openBefore: 2 }))).toEqual({
      headline: "1 invoice will be saved. 1 invoice isn't in this file and will be closed.",
      detail: 'The invoice in this file is unchanged.',
      closing: { heading: '1 invoice will be closed', explanation: 'Not in this file, so it will be closed. That usually means it was paid in Xero.' },
      cancelled: null,
      massClose: null,
    });
    // App Flow, Journey 4, step 4: the Week 7 demonstration file.
    const demo = planWords(
      blank({ rowsRead: 13, rowsSaved: 12, rowsSkipped: 1, added: 1, updated: 1, unchanged: 10, newClients: 1, closed: 1, draftsCancelled: 2, openBefore: 12 }),
    );
    expect(demo.headline).toBe("12 invoices will be saved and 1 row skipped. 1 invoice isn't in this file and will be closed, and 2 reminders will be cancelled.");
    expect(demo.detail).toBe('1 new, 1 changed, 10 unchanged, 1 new client.');
    expect(demo.cancelled).toEqual({ heading: '2 reminders will be cancelled', explanation: "They won't be sent." });
    expect(demo.massClose).toBeNull();
  });

  it('cancellations without closures', () => {
    expect(planWords(blank({ rowsRead: 3, rowsSaved: 3, updated: 1, unchanged: 2, draftsCancelled: 1, openBefore: 3 }))).toEqual({
      headline: '3 invoices will be saved. 1 reminder will be cancelled.',
      detail: '1 changed, 2 unchanged.',
      closing: null,
      cancelled: { heading: '1 reminder will be cancelled', explanation: "It won't be sent." },
      massClose: null,
    });
  });

  it('nothing can be imported, so nothing is said to close', () => {
    expect(planWords(blank({ rowsRead: 2, rowsSkipped: 2, closed: 8, draftsCancelled: 3, openBefore: 9, massClose: true }))).toEqual({
      headline: 'No rows can be imported.',
      detail: null,
      closing: null,
      cancelled: null,
      massClose: null,
    });
  });

  it('never says nothing changes while anything closes or is cancelled, in plain short sentences', () => {
    for (const saved of [1, 2, 12])
      for (const added of [0, 1])
        for (const updated of [0, 1])
          for (const closed of [0, 1, 7])
            for (const draftsCancelled of [0, 1, 3]) {
              if (added + updated > saved) continue;
              const words = planWords(
                blank({
                  rowsRead: saved,
                  rowsSaved: saved,
                  added,
                  updated,
                  unchanged: saved - added - updated,
                  closed,
                  draftsCancelled,
                  openBefore: closed + saved,
                  massClose: closed > 5 && closed * 2 > closed + saved,
                }),
              );
              const text = allText(words);
              if (closed > 0 || draftsCancelled > 0) expect(text.join(' ')).not.toMatch(/nothing changes|no changes/i);
              if (closed > 0) expect(words.closing?.heading).toBe(`${closed} ${closed === 1 ? 'invoice' : 'invoices'} will be closed`);
              if (draftsCancelled > 0) expect(words.cancelled?.heading).toBe(`${draftsCancelled} ${draftsCancelled === 1 ? 'reminder' : 'reminders'} will be cancelled`);
              for (const sentence of text.flatMap((t) => t.split(/(?<=\.)\s+/))) {
                expect(sentence).not.toMatch(/!/);
                expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25);
              }
            }
  });
});
