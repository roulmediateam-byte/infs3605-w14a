// Dates and times in Sydney time (BR-06, BR-14). Dates without a time ("2026-10-12") are calendar dates and are
// never shifted by a time zone. Month and day names are fixed lists, so September reads "Sep" as in
// private.format_date, whatever the browser's locale data says.

export const TIME_ZONE = 'Australia/Sydney';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

const sydneyParts = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsOf = (at: Date): Parts => {
  const parts: Record<string, string> = {};
  for (const part of sydneyParts.formatToParts(at)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** The Sydney calendar date of a moment, as "YYYY-MM-DD" (private.sydney_date). */
export const sydneyDate = (at: Date = new Date()): string => {
  const p = partsOf(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

const toUtcDay = (isoDate: string): number => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
};

/** Calendar days from one ISO date to another (b minus a). */
export const daysBetween = (a: string, b: string): number => Math.round(toUtcDay(b) - toUtcDay(a));

/** Today's Sydney date minus the due date (private.days_overdue): positive means overdue. */
export const daysOverdue = (dueDate: string, now: Date = new Date()): number => daysBetween(dueDate, sydneyDate(now));

export const addDays = (isoDate: string, days: number): string => {
  const at = new Date((toUtcDay(isoDate) + days) * 86_400_000);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
};

const calendar = (isoDate: string) => {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const at = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return { year: y ?? 0, weekday: DAYS[at.getUTCDay()] ?? '', month: MONTHS[(m ?? 1) - 1] ?? '', day: d ?? 0 };
};

/** "Mon 12 Oct", with the year only outside the current Sydney year (UI brief, Formats). */
export const formatDate = (isoDate: string, now: Date = new Date()): string => {
  const c = calendar(isoDate);
  const thisYear = Number(sydneyDate(now).slice(0, 4));
  return `${c.weekday} ${c.day} ${c.month}${c.year === thisYear ? '' : ` ${c.year}`}`;
};

/** "Mon 12 Oct 2026", always with the year (private.format_date). */
export const formatDateLong = (isoDate: string): string => {
  const c = calendar(isoDate);
  return `${c.weekday} ${c.day} ${c.month} ${c.year}`;
};

/** "7:00 am" in Sydney time. */
export const formatTime = (at: Date | string): string => {
  const p = partsOf(typeof at === 'string' ? new Date(at) : at);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${hour12}:${pad(p.minute)} ${p.hour < 12 ? 'am' : 'pm'}`;
};

/** "Today", "Yesterday" or "Mon 12 Oct" for a moment, by its Sydney date. */
export const formatDay = (at: Date | string, now: Date = new Date()): string => {
  const date = sydneyDate(typeof at === 'string' ? new Date(at) : at);
  const gap = daysBetween(date, sydneyDate(now));
  if (gap === 0) return 'Today';
  if (gap === 1) return 'Yesterday';
  return formatDate(date, now);
};

/** "14 days overdue" or "1 day overdue". */
export const overdueText = (days: number): string => `${days} ${days === 1 ? 'day' : 'days'} overdue`;

/** The Sunday that starts this week's drafting period (the weekly run's period key), as an ISO date. */
export const thisWeeksSunday = (now: Date = new Date()): string => {
  const today = sydneyDate(now);
  const weekday = calendar(today).weekday;
  return addDays(today, -DAYS.indexOf(weekday as (typeof DAYS)[number]));
};

/** Minutes past midnight in Sydney for a moment, with its Sydney date. */
export const sydneyClock = (at: Date = new Date()): { date: string; minutes: number; weekday: string } => {
  const p = partsOf(at);
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return { date, minutes: p.hour * 60 + p.minute, weekday: calendar(date).weekday };
};

/**
 * Reads Australian day-first dates (15/10/2026, 15-10-26, 15 Oct 2026) and ISO dates; null when invalid.
 * Mirrors private.parse_au_date rule for rule, including its two-digit years and month-name prefixes.
 */
export const parseAuDate = (input: string | null | undefined): string | null => {
  let cleaned = (input ?? '').replace(/^ +| +$/g, '');
  cleaned = cleaned.replace(/\s+[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?(\s*[AaPp][Mm])?$/, '');
  let y: number;
  let m: number | null;
  let d: number;
  let match: RegExpExecArray | null;
  if ((match = /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/.exec(cleaned))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = /^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{2,4})$/.exec(cleaned))) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
    if (y < 100) y += 2000;
  } else if ((match = /^([0-9]{1,2})[ -]([A-Za-z]{3,9})[ -]([0-9]{4})$/.exec(cleaned))) {
    d = Number(match[1]);
    y = Number(match[3]);
    const index = MONTH_KEYS.indexOf((match[2] ?? '').slice(0, 3).toLowerCase() as (typeof MONTH_KEYS)[number]);
    m = index === -1 ? null : index + 1;
  } else {
    return null;
  }
  if (m === null || y < 2000 || y > 2100) return null;
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};
