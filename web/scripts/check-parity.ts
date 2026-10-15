// Checks that the browser's import and edit rules give the same answers as the database's, input by input.
// The preview must agree with confirm_import, or the server refuses imports the person was told were fine.
// Needs a local database built by scripts/local-stack/setup-db.sh. Usage, from web/:
//   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres node scripts/check-parity.ts
import { execFileSync } from 'node:child_process';
import { parseAuDate } from '../src/lib/dates.ts';
import { checkLockedFacts } from '../src/lib/drafts.ts';
import { cleanEmail } from '../src/lib/import-rows.ts';
import { parseAmountCents } from '../src/lib/money.ts';

const database = process.env.LOCAL_DB ?? 'getpaid_dev';

const sqlText = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const query = (sql: string): unknown =>
  JSON.parse(execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], { encoding: 'utf8' }));

// A seeded generator, so a failure can be repeated.
let seed = 20261015;
const random = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const fuzz = (alphabet: string, length: number): string => Array.from({ length }, () => pick([...alphabet])).join('');

const amounts = [
  '$1,250.00', '1250', 'A$1,250.5', '1250 AUD', 'aud1250', 'AUD 1,250', ' 760.00 ', '-12.5', '12.345', '1,2,5,0', '$ 5', '$-5',
  '0', '0.00', '.50', '5.', '1e3', '١٢٣', '\t1250', '1250\n', '99999999999.99', '100000000000', '$1 250.00', 'A$ 1,250.00 AUD', '',
  ...Array.from({ length: 300 }, () => fuzz('0123456789.,$ -AUDaud', 1 + Math.floor(random() * 10))),
];

const dates = [
  '15/10/2026', '5/1/26', '15-10-26', '15.10.2026', '2026-10-15', '2026-1-5', '15 Oct 2026', '15 October 2026', '15-Oct-2026',
  '15 Octopus 2026', '15/10/2026 9:30 AM', '15/10/2026 09:30:00', '31/02/2026', '29/02/2028', '29/02/2027', '15/13/2026', '0/10/2026',
  '15/10/1999', '15/10/2101', '15/10/202', '10/15/2026', '2026/10/15', ' 15/10/2026 ', '15/10/26 7:05pm', '', 'today',
  ...Array.from({ length: 300 }, () => fuzz('0123456789/-. :AMPamOctJanDec', 4 + Math.floor(random() * 14))),
];

const emails = [
  'Accounts <Pay@Example.test>, other@example.test', 'a@b.c', 'a@b', '"x"@y.z', 'mei@chen-reno.example; tom@x.example', 'no address',
  'UPPER@EXAMPLE.TEST', 'a@b.c.d', '@b.c', 'a@.c', '',
  ...Array.from({ length: 200 }, () => fuzz('ab@.;, <>"xyz', 3 + Math.floor(random() * 12))),
];

const body = 'Hi Priya,\n\nInvoice 1051 for $8,450.00 was due on Mon 21 Sep 2026.\n\nThanks,\nAlex Test\nHarbour Line Electrical (Test data)';
const edits: [string, string][] = [
  ['Invoice 1051', body],
  ['Invoice 1051', body.replace('$8,450.00', '$8,000.00')],
  ['Invoice 1051', body.replace('Invoice 1051', 'Invoice 10512')],
  ['Invoice 1051', body.replace('Invoice 1051', 'Invoice A1051')],
  ['Invoice 1051', body.replace('Invoice 1051', 'Invoice #1051.')],
  ['Invoice 1051', `${body} Or pay $100 now.`],
  ['Invoice 1051', `${body} $8,450.00 again.`],
  ['Invoice 1051', body.replace('$8,450.00', '$ 8,450.00')],
  ['Invoice 1051', body.replace('$8,450.00', '$8,450.001')],
  ['Discount $5', body],
  ['', body],
  ['Hi', ''],
  ['x'.repeat(121), body],
  ['Hi', `${body}${'a'.repeat(1700)}`],
  ['Hi', `${body}${'a'.repeat(1800)}`],
];

let failures = 0;
const compare = (label: string, input: string, mine: unknown, theirs: unknown): void => {
  if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
    failures += 1;
    if (failures <= 20) console.error(`Mismatch in ${label} for ${JSON.stringify(input)}: browser ${JSON.stringify(mine)}, database ${JSON.stringify(theirs)}`);
  }
};

const values = (items: string[]): string => items.map((item, i) => `(${i}, ${sqlText(item)})`).join(',');

const amountRows = query(
  `select coalesce(json_agg(private.parse_amount_cents(v)::text order by i), '[]') from (values ${values(amounts)}) t(i, v)`,
) as (string | null)[];
amounts.forEach((input, i) => compare('parse_amount_cents', input, parseAmountCents(input)?.toString() ?? null, amountRows[i] ?? null));

const dateRows = query(`select coalesce(json_agg(private.parse_au_date(v)::text order by i), '[]') from (values ${values(dates)}) t(i, v)`) as (string | null)[];
dates.forEach((input, i) => compare('parse_au_date', input, parseAuDate(input), dateRows[i] ?? null));

const emailRows = query(`select coalesce(json_agg(private.clean_email(v) order by i), '[]') from (values ${values(emails)}) t(i, v)`) as (string | null)[];
emails.forEach((input, i) => compare('clean_email', input, cleanEmail(input), emailRows[i] ?? null));

const editRows = query(
  `select coalesce(json_agg(private.check_locked_facts(btrim(s), btrim(b), '1051', 845000) order by i), '[]')
     from (values ${edits.map(([s, b], i) => `(${i}, ${sqlText(s)}, ${sqlText(b)})`).join(',')}) t(i, s, b)`,
) as (string | null)[];
edits.forEach(([s, b], i) => compare('check_locked_facts', `${s} | ${b.slice(0, 40)}`, checkLockedFacts(s, b, '1051', 845000), editRows[i] ?? null));

const total = amounts.length + dates.length + emails.length + edits.length;
if (failures > 0) {
  console.error(`${failures} of ${total} inputs disagree with the database.`);
  process.exit(1);
}
console.log(`The browser and the database agree on all ${total} inputs.`);
