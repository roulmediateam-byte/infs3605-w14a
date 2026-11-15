// UI-10 Activity log (FR-21): who did what, and when. A read-only feed grouped by day, newest first, in Sydney
// time, each entry a sentence. Filter by action, person, date or invoice; /log?invoice=1051 opens filtered.
import {
  Ban,
  Building2,
  CalendarCheck,
  Check,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CirclePlay,
  Download,
  FileUp,
  ListChecks,
  Mail,
  MailCheck,
  Pencil,
  PenLine,
  RotateCcw,
  ScrollText,
  Settings2,
  TriangleAlert,
  UserCheck,
  UserMinus,
  UserPen,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useActivity, useClients, useInvoices, useMembers } from '../app/queries.ts';
import { navigate, useLocation } from '../app/router.tsx';
import { categoryOf, describe, LOG_CATEGORIES, type ActivityAction, type LogCategory, type LogEntry } from '../lib/activity.ts';
import { addDays, formatDay, formatTime, sydneyDate } from '../lib/dates.ts';
import { Button, EmptyState, IconTile, LoadingBlock, PageTitle, SelectField, TextField, type TileTone } from '../ui/controls.tsx';
import { NoData } from '../ui/QueryState.tsx';

type DateFilter = 'all' | 'today' | 'week' | 'month';

/**
 * Each entry's tile says what kind of thing happened, so a day of 19 entries scans at a glance: imports in sky, the
 * apprentice's drafting in violet, approvals in blue, sends and payments in green, and the rest in slate.
 */
const LOG_ICON: Record<ActivityAction, { icon: LucideIcon; tone: TileTone }> = {
  import_completed: { icon: FileUp, tone: 'info' },
  invoice_closed: { icon: Ban, tone: 'neutral' },
  draft_created: { icon: PenLine, tone: 'apprentice' },
  draft_flagged: { icon: TriangleAlert, tone: 'warning' },
  draft_cancelled: { icon: CircleDashed, tone: 'neutral' },
  weekly_run_completed: { icon: CalendarCheck, tone: 'apprentice' },
  draft_approved: { icon: Check, tone: 'ready' },
  draft_edited: { icon: Pencil, tone: 'ready' },
  draft_rejected: { icon: X, tone: 'neutral' },
  review_session: { icon: ListChecks, tone: 'ready' },
  reminder_sent: { icon: MailCheck, tone: 'success' },
  send_refused: { icon: Ban, tone: 'critical' },
  invoice_paid: { icon: CircleCheck, tone: 'success' },
  invoice_reopened: { icon: RotateCcw, tone: 'neutral' },
  briefing_sent: { icon: Mail, tone: 'info' },
  nudge_sent: { icon: Mail, tone: 'info' },
  business_created: { icon: Building2, tone: 'neutral' },
  settings_changed: { icon: Settings2, tone: 'neutral' },
  client_updated: { icon: UserPen, tone: 'neutral' },
  client_paused: { icon: CirclePause, tone: 'neutral' },
  client_unpaused: { icon: CirclePlay, tone: 'neutral' },
  member_invited: { icon: UserPlus, tone: 'neutral' },
  member_joined: { icon: UserCheck, tone: 'neutral' },
  member_removed: { icon: UserMinus, tone: 'neutral' },
  attention_dismissed: { icon: Check, tone: 'neutral' },
  data_exported: { icon: Download, tone: 'neutral' },
};

const sinceDate = (filter: DateFilter): string | null => {
  const today = sydneyDate();
  if (filter === 'today') return today;
  if (filter === 'week') return addDays(today, -6);
  if (filter === 'month') return addDays(today, -29);
  return null;
};

export const LogScreen = () => {
  const location = useLocation();
  const members = useMembers();
  const invoices = useInvoices();
  const clients = useClients();
  const [category, setCategory] = useState<'all' | LogCategory>('all');
  const [person, setPerson] = useState<string>('all');
  const [dates, setDates] = useState<DateFilter>('all');
  const invoiceNumber = location.params.get('invoice') ?? '';
  const [invoiceText, setInvoiceText] = useState(invoiceNumber);

  const invoiceId = useMemo(() => {
    if (!invoiceNumber) return undefined;
    return invoices.data?.find((invoice) => invoice.invoice_number === invoiceNumber)?.id ?? (invoices.data ? 'none' : undefined);
  }, [invoiceNumber, invoices.data]);
  const waitingForInvoice = Boolean(invoiceNumber) && invoiceId === undefined;
  const activity = useActivity(invoiceId === 'none' ? '00000000-0000-0000-0000-000000000000' : invoiceId);

  const lookups = useMemo(
    () => ({
      memberName: (userId: string) => members.data?.find((m) => m.user_id === userId)?.display_name,
      invoiceNumber: (id: string) => invoices.data?.find((invoice) => invoice.id === id)?.invoice_number,
      clientName: (id: string) => clients.data?.find((client) => client.id === id)?.name,
    }),
    [members.data, invoices.data, clients.data],
  );

  const entries = useMemo(() => {
    const since = sinceDate(dates);
    return (activity.data?.pages.flat() ?? []).filter((entry) => {
      if (category !== 'all' && categoryOf(entry.action) !== category) return false;
      if (person === 'system' && entry.actor_role !== 'system') return false;
      if (person !== 'all' && person !== 'system' && entry.actor_user_id !== person) return false;
      if (since && sydneyDate(new Date(entry.at)) < since) return false;
      return true;
    });
  }, [activity.data, category, person, dates]);

  const days = useMemo(() => {
    const groups: { day: string; entries: LogEntry[] }[] = [];
    for (const entry of entries) {
      const day = formatDay(entry.at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.entries.push(entry);
      else groups.push({ day, entries: [entry] });
    }
    return groups;
  }, [entries]);

  const people = (members.data ?? []).filter((m) => m.user_id);
  const filtered = category !== 'all' || person !== 'all' || dates !== 'all' || Boolean(invoiceNumber);

  return (
    <div className="page stack-lg">
      <div className="page-head stack-sm">
        <PageTitle documentTitle="Activity log">Activity log</PageTitle>
        <p className="t-caption">Every import, draft, approval, send and payment, newest first. Times are Sydney time.</p>
      </div>
      <div className="filters">
        <SelectField label="Action" value={category} onChange={(event) => setCategory(event.target.value as 'all' | LogCategory)}>
          <option value="all">All actions</option>
          {LOG_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Person" value={person} onChange={(event) => setPerson(event.target.value)}>
          <option value="all">Everyone</option>
          {people.map((m) => (
            <option key={m.id} value={m.user_id ?? ''}>
              {m.display_name}
            </option>
          ))}
          <option value="system">Your apprentice</option>
        </SelectField>
        <SelectField label="Date" value={dates} onChange={(event) => setDates(event.target.value as DateFilter)}>
          <option value="all">Any time</option>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
        </SelectField>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = invoiceText.trim();
            navigate(value ? `log?invoice=${encodeURIComponent(value)}` : 'log', { replace: true });
          }}
        >
          <TextField
            label="Invoice number"
            value={invoiceText}
            inputMode="search"
            enterKeyHint="search"
            onChange={(event) => setInvoiceText(event.target.value)}
            onBlur={() => {
              const value = invoiceText.trim();
              if (value !== invoiceNumber) navigate(value ? `log?invoice=${encodeURIComponent(value)}` : 'log', { replace: true });
            }}
          />
        </form>
      </div>

      {waitingForInvoice ? (
        <NoData query={invoices} loading={<LoadingBlock label="Loading the activity log" />} />
      ) : activity.data === undefined ? (
        <NoData query={activity} loading={<LoadingBlock label="Loading the activity log" />} />
      ) : days.length === 0 ? (
        <EmptyState title={filtered ? 'Nothing matches these filters' : 'Nothing has happened yet.'} icon={ScrollText} tone="neutral">
          {filtered ? (invoiceId === 'none' ? `There's no invoice ${invoiceNumber}.` : 'Try another filter.') : null}
        </EmptyState>
      ) : (
        <div>
          <p className="visually-hidden" role="status">
            {entries.length === 1 ? '1 entry' : `${entries.length} entries`}
          </p>
          {days.map((group) => (
            <section key={group.day} className="log-day" aria-labelledby={`day-${group.day.replace(/\W+/g, '-')}`}>
              <h2 className="t-heading" id={`day-${group.day.replace(/\W+/g, '-')}`}>
                {group.day}
              </h2>
              <ul className="log-card">
                {group.entries.map((entry) => {
                  const kind = LOG_ICON[entry.action] ?? { icon: ScrollText, tone: 'neutral' as const };
                  return (
                    <li key={entry.id} className="log-entry">
                      <IconTile icon={kind.icon} tone={kind.tone} size="sm" />
                      <span className="log-text">{describe(entry, lookups)}</span>
                      <span className="log-time t-caption">{formatTime(entry.at)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {activity.hasNextPage ? (
            <Button variant="secondary" busy={activity.isFetchingNextPage} busyLabel="Loading…" onClick={() => void activity.fetchNextPage()}>
              Show older entries
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
};
