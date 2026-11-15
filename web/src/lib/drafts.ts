// Draft text rules shared by Edit (UI-04) and Send (UI-06).
import { formatAud } from './money.ts';

const escapeRegExp = (value: string): string => value.replace(/[.^$*+?()[\]{}|\\-]/g, '\\$&');
const characters = (value: string): number => [...value].length;

/** A dollar amount as private.check_locked_facts reads one: "$17,000.00", "$ 5", "$8,450". */
const AMOUNT = /\$\s?[0-9][0-9,]*(?:\.[0-9]+)?/g;

export interface LockedFactsProblem {
  /** The server's words for the refusal (private.check_locked_facts). They match it exactly, input by input. */
  server: string;
  /** What Edit shows. A changed amount is named: "The message says $17,000.00. Amounts come from your records, so keep $18,700.00." */
  message: string;
  /** Where the problem is. */
  field: 'subject' | 'body';
  /** The amount as written, when it isn't the locked one ("$17,000.00"); null for every other problem. */
  wrong: string | null;
  /** The locked amount, from the records ("$18,700.00"). */
  right: string;
}

/**
 * FR-15 and AT-07, checked in the browser for instant feedback. It refuses exactly what private.check_locked_facts
 * refuses (approve_draft checks again and its answer is final), but it says which amount is wrong, so the owner
 * doesn't have to hunt for it. The server's own message is kept in `server`.
 */
export const lockedFactsProblem = (subject: string, body: string, invoiceNumber: string, amountCents: number): LockedFactsProblem | null => {
  const right = formatAud(amountCents);
  const keep = `Keep ${right} and invoice ${invoiceNumber} as they are.`;
  const plain = (message: string, field: 'subject' | 'body'): LockedFactsProblem => ({ server: message, message, field, wrong: null, right });
  const s = subject.trim();
  const b = body.trim();
  if (s === '') return plain('Add a subject.', 'subject');
  if (b === '') return plain('Add a message.', 'body');
  if (characters(s) > 120) return plain('Keep the subject under 120 characters.', 'subject');
  if (characters(s) + characters(b) > 1800) return plain('Keep the message under 1,800 characters so it fits in your email app.', 'body');
  // Any amount other than the locked one, read across subject and message together as the server reads them.
  const joined = `${s} ${b}`;
  for (const found of joined.matchAll(AMOUNT)) {
    if (found[0] === right) continue;
    const start = found.index ?? 0;
    const end = start + found[0].length;
    const field = end <= s.length ? 'subject' : start > s.length ? 'body' : null;
    // An amount that runs from the subject into the message can't be put back in one place, so it isn't named.
    if (field === null) return plain(keep, 'body');
    return {
      server: keep,
      message: `The ${field === 'subject' ? 'subject' : 'message'} says ${found[0]}. Amounts come from your records, so keep ${right}.`,
      field,
      wrong: found[0],
      right,
    };
  }
  const numberPattern = new RegExp(`(^|[^0-9A-Za-z])${escapeRegExp(invoiceNumber)}($|[^0-9A-Za-z])`);
  if (!numberPattern.test(b) || !b.includes(right)) return plain(keep, 'body');
  return null;
};

/** The server's answer for an edit, word for word (scripts/check-parity.ts compares the two). */
export const checkLockedFacts = (subject: string, body: string, invoiceNumber: string, amountCents: number): string | null =>
  lockedFactsProblem(subject, body, invoiceNumber, amountCents)?.server ?? null;

/** "Put $18,700.00 back": every copy of the wrong amount becomes the locked one again. */
export const putAmountBack = (text: string, wrong: string, right: string): string => text.replace(AMOUNT, (found) => (found === wrong ? right : found));

/** Characters left before the 1,800 limit for subject and message together. */
export const charactersLeft = (subject: string, body: string): number => 1800 - characters(subject.trim()) - characters(body.trim());

/**
 * The pre-filled email (FR-18). encodeURIComponent, not URLSearchParams, so spaces stay %20 rather than "+";
 * line breaks become %0D%0A. The address keeps its "@" so every email app reads it.
 */
export const buildMailto = (to: string, subject: string, body: string): string => {
  const address = encodeURIComponent(to).replace(/%40/g, '@');
  const text = body.replace(/\r?\n/g, '\r\n');
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
};

/** Outlook has documented URL limits, so long links lead with the copy buttons (TRD, Sending reminders). */
export const MAILTO_COMFORT_LIMIT = 2000;

// ---------------------------------------------------------------------------------------------
// "Show changes" in Edit: added and removed words, marked by underline and strikethrough as well as colour.
// ---------------------------------------------------------------------------------------------
export interface DiffPart {
  kind: 'same' | 'added' | 'removed';
  text: string;
  /** A locked fact that changed: an amount added that isn't the locked one, or the locked amount or number removed. */
  locked?: boolean;
}

const tokens = (text: string): string[] => text.match(/\s+|[^\s]+/g) ?? [];

export const diffWords = (before: string, after: string): DiffPart[] => {
  const a = tokens(before);
  const b = tokens(after);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j] ? (table[(i + 1) * cols + j + 1] ?? 0) + 1 : Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string): void => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i] ?? '');
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
      push('removed', a[i] ?? '');
      i += 1;
    } else {
      push('added', b[j] ?? '');
      j += 1;
    }
  }
  while (i < a.length) push('removed', a[i++] ?? '');
  while (j < b.length) push('added', b[j++] ?? '');
  return parts;
};

/**
 * Picks out the locked facts that an edit changed, so "Show changes" can mark them apart from ordinary wording
 * changes: an added amount that isn't the locked one, and the locked amount or invoice number where it was removed.
 * Use it only while the edit breaks the locked facts; a fact that was just moved is not a change.
 */
export const markLockedChanges = (parts: DiffPart[], invoiceNumber: string, amountText: string): DiffPart[] => {
  const numberPattern = new RegExp(`(^|[^0-9A-Za-z])(${escapeRegExp(invoiceNumber)})(?=$|[^0-9A-Za-z])`, 'g');
  const out: DiffPart[] = [];
  for (const part of parts) {
    if (part.kind === 'same') {
      out.push(part);
      continue;
    }
    const spans: [number, number][] = [];
    for (const found of part.text.matchAll(AMOUNT)) {
      const start = found.index ?? 0;
      const isLocked = found[0] === amountText;
      if ((part.kind === 'added' && !isLocked) || (part.kind === 'removed' && isLocked)) spans.push([start, start + found[0].length]);
    }
    if (part.kind === 'removed') {
      for (const found of part.text.matchAll(numberPattern)) {
        const start = (found.index ?? 0) + (found[1] ?? '').length;
        spans.push([start, start + invoiceNumber.length]);
      }
    }
    spans.sort((x, y) => x[0] - y[0]);
    let at = 0;
    for (const [start, end] of spans) {
      if (start < at) continue;
      if (start > at) out.push({ kind: part.kind, text: part.text.slice(at, start) });
      out.push({ kind: part.kind, text: part.text.slice(start, end), locked: true });
      at = end;
    }
    if (at < part.text.length) out.push({ kind: part.kind, text: part.text.slice(at) });
  }
  return out;
};
