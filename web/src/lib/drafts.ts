// Draft text rules shared by Edit (UI-04) and Send (UI-06).
import { formatAud } from './money.ts';

const escapeRegExp = (value: string): string => value.replace(/[.^$*+?()[\]{}|\\-]/g, '\\$&');
const characters = (value: string): number => [...value].length;

/**
 * FR-15 and AT-07, checked in the browser for instant feedback. The same rules as
 * private.check_locked_facts; approve_draft checks again and its answer is final.
 */
export const checkLockedFacts = (subject: string, body: string, invoiceNumber: string, amountCents: number): string | null => {
  const amountText = formatAud(amountCents);
  const keep = `Keep ${amountText} and invoice ${invoiceNumber} as they are.`;
  const s = subject.trim();
  const b = body.trim();
  if (s === '') return 'Add a subject.';
  if (b === '') return 'Add a message.';
  if (characters(s) > 120) return 'Keep the subject under 120 characters.';
  if (characters(s) + characters(b) > 1800) return 'Keep the message under 1,800 characters so it fits in your email app.';
  const numberPattern = new RegExp(`(^|[^0-9A-Za-z])${escapeRegExp(invoiceNumber)}($|[^0-9A-Za-z])`);
  if (!numberPattern.test(b) || !b.includes(amountText)) return keep;
  for (const found of `${s} ${b}`.matchAll(/\$\s?[0-9][0-9,]*(?:\.[0-9]+)?/g)) {
    if (found[0] !== amountText) return keep;
  }
  return null;
};

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
