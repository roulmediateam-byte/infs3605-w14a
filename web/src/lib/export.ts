// "Export all" (FR-03): one CSV file per record type in a .zip, built in the browser. A cell that starts with
// =, +, -, @ or a tab gets an apostrophe, so no spreadsheet runs it as a formula (docs/api.md).

const FORMULA_START = /^[=+\-@\t\r]/;

export const csvCell = (value: unknown): string => {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'string') text = FORMULA_START.test(value) ? `'${value}` : value;
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') text = String(value);
  else {
    const json = JSON.stringify(value);
    text = FORMULA_START.test(json) ? `'${json}` : json;
  }
  return /[",\r\n]|^ | $/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Rows of objects to CSV text, with the union of their keys as the header row, in first-seen order. */
export const toCsv = (rows: Record<string, unknown>[]): string => {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','));
  // A byte order mark tells Excel the file is UTF-8, so client names keep their accents.
  return `﻿${lines.join('\r\n')}\r\n`;
};

// ---------------------------------------------------------------------------------------------
// A minimal ZIP writer (stored, not compressed): enough for a handful of CSV files, with no dependency.
// ---------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

export interface ZipEntry {
  name: string;
  content: string | Uint8Array;
}

const dosDateTime = (at: Date): { date: number; time: number } => ({
  time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
  date: ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
});

export const zip = (entries: ZipEntry[], at: Date = new Date()): Uint8Array => {
  const encoder = new TextEncoder();
  const { date, time } = dosDateTime(at);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at2 = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at2);
    at2 += part.length;
  }
  return out;
};

/** The export JSON from export_business_data as ZIP entries: one CSV per list, plus the business row. */
export const exportEntries = (data: Record<string, unknown>): ZipEntry[] => {
  const entries: ZipEntry[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) entries.push({ name: `${key}.csv`, content: toCsv(value as Record<string, unknown>[]) });
    else if (value && typeof value === 'object') entries.push({ name: `${key}.csv`, content: toCsv([value as Record<string, unknown>]) });
  }
  const readme = [
    'Payprentice: everything held for this business, one CSV file per record type.',
    `Exported at ${typeof data.exported_at === 'string' ? data.exported_at : new Date().toISOString()} (UTC).`,
    'Amounts are in whole cents. Times are in UTC. Cells that start with =, +, - or @ begin with an apostrophe so no spreadsheet runs them.',
    '',
  ].join('\r\n');
  return [{ name: 'README.txt', content: readme }, ...entries];
};

export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'business';
