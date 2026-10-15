// The import preview (FR-04 to FR-06, BR-15). The browser reads the file and checks every row with the same
// rules as public.confirm_import, so the preview's problems, counts and total are the ones the server will find.
// The server still reads every value again and refuses the import if its count or total differs.
import { parseAuDate } from './dates.ts';
import { parseAmountCents, trimSpaces } from './money.ts';

export const IMPORT_FIELDS = ['client', 'email', 'contact', 'invoice_number', 'issue_date', 'due_date', 'amount_due'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, string>>;

export const FIELD_LABELS: Record<ImportField, string> = {
  client: 'Client',
  email: 'Email',
  contact: 'Contact name',
  invoice_number: 'Invoice number',
  issue_date: 'Issue date',
  due_date: 'Due date',
  amount_due: 'Amount due',
};

/** Six fields must be matched; contact name is optional (App Flow, Journey 4). */
export const REQUIRED_FIELDS: readonly ImportField[] = ['client', 'email', 'invoice_number', 'issue_date', 'due_date', 'amount_due'];

export const MAX_ROWS = 2000;

/** One row as confirm_import receives it: every mapped cell as text, with its spreadsheet row number. */
export interface ImportRowInput {
  row: number;
  client: string;
  email: string;
  contact: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  amount_due: string;
}

export interface CheckedRow {
  input: ImportRowInput;
  client: string | null;
  clientKey: string | null;
  email: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  amountCents: bigint | null;
  error: string | null;
}

export interface ParsedFile {
  fileName: string;
  headers: string[];
  /** Data rows with their spreadsheet row number (the header is row 1). Blank rows are dropped. */
  rows: { row: number; cells: string[] }[];
}

const nullIfBlank = (value: string): string | null => {
  const trimmed = trimSpaces(value);
  return trimmed === '' ? null : trimmed;
};

/** The first email address in a cell, lower-cased (private.clean_email). Xero cells can hold several. */
export const cleanEmail = (value: string | null | undefined): string | null => {
  const match = /([^@\s;,<>"]+@[^@\s;,<>"]+\.[^@\s;,<>"]+)/.exec(value ?? '');
  return match?.[1] ? match[1].toLowerCase() : null;
};

const codePoints = (value: string): number => [...value].length;

export const toImportRows = (file: ParsedFile, mapping: ColumnMapping): ImportRowInput[] => {
  const index = (field: ImportField): number => (mapping[field] ? file.headers.indexOf(mapping[field]) : -1);
  const columns = Object.fromEntries(IMPORT_FIELDS.map((field) => [field, index(field)])) as Record<ImportField, number>;
  const cell = (cells: string[], field: ImportField): string => {
    const at = columns[field];
    return at >= 0 ? (cells[at] ?? '') : '';
  };
  return file.rows.map(({ row, cells }) => ({
    row,
    client: cell(cells, 'client'),
    email: cell(cells, 'email'),
    contact: cell(cells, 'contact'),
    invoice_number: cell(cells, 'invoice_number'),
    issue_date: cell(cells, 'issue_date'),
    due_date: cell(cells, 'due_date'),
    amount_due: cell(cells, 'amount_due'),
  }));
};

/** Every row checked as confirm_import checks it; the first problem in a row is the one reported. */
export const checkRows = (inputs: ImportRowInput[]): CheckedRow[] => {
  const checked: CheckedRow[] = inputs.map((input) => {
    const client = nullIfBlank(input.client);
    const invoiceNumber = nullIfBlank(input.invoice_number);
    const issueDate = parseAuDate(input.issue_date);
    const dueDate = parseAuDate(input.due_date);
    const amountCents = parseAmountCents(input.amount_due);
    let error: string | null = null;
    if (invoiceNumber === null) error = 'Missing invoice number';
    else if (client === null) error = 'Missing client name';
    else if (amountCents === null) error = 'Amount is not a number';
    else if (amountCents <= 0n) error = 'Amount must be more than $0';
    else if (amountCents >= 100_000_000_000n) error = 'Amount is too large';
    else if (issueDate === null) error = 'Issue date is not a date (use DD/MM/YYYY)';
    else if (dueDate === null) error = 'Due date is not a date (use DD/MM/YYYY)';
    else if (dueDate < issueDate) error = 'Due date is before the issue date';
    else if (codePoints(invoiceNumber) > 50) error = 'Invoice number is longer than 50 characters';
    return {
      input,
      client,
      clientKey: client === null ? null : client.toLowerCase(),
      email: cleanEmail(input.email),
      invoiceNumber,
      issueDate,
      dueDate,
      amountCents,
      error,
    };
  });

  // BR-15: a number that appears twice in one file rejects every row that has it (rows with other problems count too).
  const seen = new Map<string, number>();
  for (const row of checked) {
    if (row.invoiceNumber !== null) seen.set(row.invoiceNumber, (seen.get(row.invoiceNumber) ?? 0) + 1);
  }
  for (const row of checked) {
    if (row.error === null && row.invoiceNumber !== null && (seen.get(row.invoiceNumber) ?? 0) > 1) {
      row.error = 'Invoice number appears more than once in this file';
    }
  }
  return checked;
};

/** The file's total: every readable amount, skipped rows included (the total the server checks). */
export const fileTotalCents = (rows: CheckedRow[]): bigint =>
  rows.reduce((sum, row) => (row.amountCents === null ? sum : sum + row.amountCents), 0n);

export const savedTotalCents = (rows: CheckedRow[]): bigint =>
  rows.reduce((sum, row) => (row.error === null && row.amountCents !== null ? sum + row.amountCents : sum), 0n);

// ---------------------------------------------------------------------------------------------
// Matching columns (FR-04): Xero's names and the team template's are matched automatically.
// ---------------------------------------------------------------------------------------------
const normalise = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]/g, '');

const CANDIDATES: Record<ImportField, string[]> = {
  invoice_number: ['invoicenumber', 'invoiceno', 'invoicenum', 'invoice', 'number', 'invno'],
  amount_due: ['amountdue', 'invoiceamountdue', 'balancedue', 'balance', 'amountoutstanding', 'outstanding', 'owing', 'amountowing'],
  due_date: ['duedate', 'paymentduedate', 'datedue', 'due'],
  issue_date: ['issuedate', 'invoicedate', 'dateissued', 'date'],
  client: ['client', 'clientname', 'contactname', 'customer', 'customername', 'company', 'businessname'],
  email: ['email', 'emailaddress', 'clientemail', 'contactemail', 'customeremail'],
  contact: ['contact', 'contactperson', 'attention', 'attn', 'firstname'],
};

/** Matches headers to fields by name; each header is used once, most specific fields first. */
export const autoMap = (headers: string[]): ColumnMapping => {
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  const order: ImportField[] = ['invoice_number', 'amount_due', 'due_date', 'issue_date', 'client', 'email', 'contact'];
  for (const field of order) {
    for (const candidate of CANDIDATES[field]) {
      const header = headers.find((h) => !used.has(h) && normalise(h) === candidate);
      if (header !== undefined) {
        mapping[field] = header;
        used.add(header);
        break;
      }
    }
  }
  return mapping;
};

/** A remembered mapping is reused only when every column it names is in this file. */
export const usableMapping = (remembered: unknown, headers: string[]): ColumnMapping | null => {
  if (!remembered || typeof remembered !== 'object' || Array.isArray(remembered)) return null;
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const header = (remembered as Record<string, unknown>)[field];
    if (typeof header === 'string' && header !== '') {
      if (!headers.includes(header)) return null;
      mapping[field] = header;
    }
  }
  return REQUIRED_FIELDS.every((field) => mapping[field]) ? mapping : null;
};

export const missingFields = (mapping: ColumnMapping): ImportField[] => REQUIRED_FIELDS.filter((field) => !mapping[field]);

/** Fields that share a column with an earlier field: each field needs its own column. */
export const clashingFields = (mapping: ColumnMapping): ImportField[] => {
  const seen = new Set<string>();
  const clashes: ImportField[] = [];
  for (const field of IMPORT_FIELDS) {
    const header = mapping[field];
    if (!header) continue;
    if (seen.has(header)) clashes.push(field);
    seen.add(header);
  }
  return clashes;
};

export type ImportFormat = 'xero_export' | 'team_template' | 'myob_export' | 'other_csv';

export const detectFormat = (headers: string[]): ImportFormat => {
  const names = headers.map(normalise);
  if (names.includes('contactname') && names.includes('invoicenumber')) return 'xero_export';
  const template = ['client', 'email', 'contact', 'invoicenumber', 'issuedate', 'duedate', 'amountdue'];
  if (template.every((name) => names.includes(name))) return 'team_template';
  return 'other_csv';
};

// ---------------------------------------------------------------------------------------------
// What will change (FR-06, BR-03, BR-05): the preview compares the file with the invoices and live drafts the
// person can already read, applying confirm_import's rules in the same order.
// ---------------------------------------------------------------------------------------------
export interface ExistingInvoice {
  id: string;
  invoice_number: string;
  status: 'open' | 'paid' | 'closed';
  amount_due_cents: number;
  due_date: string;
  issue_date: string;
  client_name: string;
}

export interface ImportPlan {
  rowsRead: number;
  rowsSaved: number;
  rowsSkipped: number;
  fileTotalCents: bigint;
  savedTotalCents: bigint;
  added: number;
  updated: number;
  reopened: number;
  keptPaid: number;
  closed: number;
  draftsCancelled: number;
  newClients: number;
  openBefore: number;
  massClose: boolean;
  problems: { row: number; reason: string }[];
}

export const planImport = (
  rows: CheckedRow[],
  existing: ExistingInvoice[],
  liveDraftsByInvoice: Map<string, number>,
  existingClientKeys: Set<string>,
): ImportPlan => {
  const byNumber = new Map(existing.map((invoice) => [invoice.invoice_number, invoice]));
  const valid = rows.filter((row) => row.error === null);
  let added = 0;
  let updated = 0;
  let reopened = 0;
  let keptPaid = 0;
  let draftsCancelled = 0;
  for (const row of valid) {
    const current = row.invoiceNumber === null ? undefined : byNumber.get(row.invoiceNumber);
    if (!current) {
      added += 1;
      continue;
    }
    if (current.status === 'paid') {
      keptPaid += 1;
      continue;
    }
    const amount = Number(row.amountCents);
    const live = liveDraftsByInvoice.get(current.id) ?? 0;
    if (current.status === 'open' && (current.amount_due_cents !== amount || current.due_date !== row.dueDate)) {
      draftsCancelled += live;
    }
    if (current.status === 'closed') reopened += 1;
    else if (
      current.amount_due_cents !== amount ||
      current.due_date !== row.dueDate ||
      current.issue_date !== row.issueDate ||
      current.client_name.replace(/^ +| +$/g, '').toLowerCase() !== row.clientKey
    ) {
      updated += 1;
    }
  }
  const inFile = new Set(rows.map((row) => row.invoiceNumber).filter((number): number is string => number !== null));
  const open = existing.filter((invoice) => invoice.status === 'open');
  const closing = open.filter((invoice) => !inFile.has(invoice.invoice_number));
  for (const invoice of closing) draftsCancelled += liveDraftsByInvoice.get(invoice.id) ?? 0;
  const newClientKeys = new Set(valid.map((row) => row.clientKey).filter((key): key is string => key !== null && !existingClientKeys.has(key)));
  return {
    rowsRead: rows.length,
    rowsSaved: valid.length,
    rowsSkipped: rows.length - valid.length,
    fileTotalCents: fileTotalCents(rows),
    savedTotalCents: savedTotalCents(rows),
    added,
    updated,
    reopened,
    keptPaid,
    closed: closing.length,
    draftsCancelled,
    newClients: newClientKeys.size,
    openBefore: open.length,
    massClose: closing.length > 5 && closing.length * 2 > open.length,
    problems: rows.filter((row) => row.error !== null).map((row) => ({ row: row.input.row, reason: row.error ?? '' })),
  };
};
