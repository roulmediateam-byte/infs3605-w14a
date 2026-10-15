// Money is whole cents everywhere (BR-14). These mirror the database's private.format_aud and
// private.parse_amount_cents exactly, so the import preview and the server read every amount the same way.

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Whole cents to "$1,250.00", as private.format_aud writes it. */
export const formatAud = (cents: number | bigint): string => {
  const value = BigInt(cents);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const dollars = abs / 100n;
  const rest = abs % 100n;
  return `${negative ? '-' : ''}$${group(dollars.toString())}.${rest.toString().padStart(2, '0')}`;
};

/** Postgres btrim(text) trims spaces only, not tabs or line breaks; matching it keeps the preview honest. */
export const trimSpaces = (value: string): string => value.replace(/^ +| +$/g, '');

/**
 * Reads "$1,250.00", "1250", "A$1,250.5" or "1250 AUD" as cents; null when it is not a number.
 * BigInt keeps the file total exact, because the server sums every readable amount in numeric.
 */
export const parseAmountCents = (input: string | null | undefined): bigint | null => {
  let cleaned = trimSpaces(input ?? '');
  cleaned = cleaned.replace(/^(A\$|AUD|\$)\s*/i, '');
  cleaned = cleaned.replace(/\s*AUD$/i, '');
  cleaned = cleaned.replaceAll(',', '').replaceAll(' ', '');
  const match = /^(-?)([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return sign === '-' ? -cents : cents;
};

/** For sending a bigint total to the server: a JSON number when it is safe, otherwise a string Postgres casts. */
export const toJsonInteger = (value: bigint): number | string =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();

/** Dollars typed in a form ("1,500" or "$1500.50") to cents, or null. */
export const dollarsToCents = (input: string): number | null => {
  const cents = parseAmountCents(input);
  if (cents === null || cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents);
};
