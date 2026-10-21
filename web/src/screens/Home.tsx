// UI-02 Home (FR-13): how much is owed, and is there anything to do? It shows the same briefing as the Monday
// email, from the same database function, so the numbers never differ (AT-06). Order: context, decision,
// exceptions, detail; a section with nothing in it disappears. Done means sent: the decision card says "All caught
// up" only when no draft waits for review and no approved reminder waits to be sent.
import { Phone, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { screenEnabled } from '../app/config.ts';
import { useMessages } from '../app/messages.tsx';
import { useOnline } from '../app/online.ts';
import {
  useAction,
  useBriefing,
  useBusinessRecord,
  useDrafts,
  useInvoices,
  useMembers,
  useOpenAttention,
  useWeeklyRuns,
} from '../app/queries.ts';
import { Link } from '../app/router.tsx';
import { useBackend, useBusiness } from '../app/session.tsx';
import type { AttentionEntry, Business, WeeklyRun } from '../backend/types.ts';
import { addDays, formatDate, sydneyClock, thisWeeksSunday } from '../lib/dates.ts';
import { formatAud } from '../lib/money.ts';
import { homeCard, largestFirst, nextToSend } from '../lib/review-session.ts';
import { pendingSends } from '../lib/storage.ts';
import { firstName, NOT_SENT_YET, overdueChip, pluralise, sentLeftToSend } from '../lib/words.ts';
import { Banner, Button, Chip, EmptyState, FormError, PageTitle, Skeleton } from '../ui/controls.tsx';
import { isPausedOffline, NoData } from '../ui/QueryState.tsx';
import { ClientSheet } from './clients/ClientSheet.tsx';
import { DemoGuide } from './DemoGuide.tsx';
import { InvoiceSheet } from './invoices/InvoiceSheet.tsx';
import { SendSheet } from './review/SendSheet.tsx';

const ATTENTION_TEXT: Record<AttentionEntry['kind'], string> = {
  email_missing: 'no email address, so no reminder was drafted.',
  amount_changed: 'the amount changed in your latest import, so its reminder was cancelled. A new one comes on Sunday.',
  due_date_changed: 'the due date changed in your latest import, so its reminder was cancelled. A new one comes on Sunday.',
};

/**
 * "This week's drafts are late. The team has been told." (NFR-09): the weekly run for this week's Sunday hasn't
 * succeeded by Monday 5:30 am, for a business that existed before the run was due.
 */
export const draftsLate = (runs: WeeklyRun[] | undefined, business: Business | undefined, now: Date = new Date()): boolean => {
  if (!runs || !business) return false;
  const clock = sydneyClock(now);
  let period = thisWeeksSunday(now);
  if (clock.weekday === 'Sun' && clock.minutes < 21 * 60) period = addDays(period, -7);
  const monday = addDays(period, 1);
  const pastCatchUp = clock.date > monday || (clock.date === monday && clock.minutes >= 5 * 60 + 30);
  if (!pastCatchUp) return false;
  const created = sydneyClock(new Date(business.created_at));
  const existedBeforeRun = created.date < period || (created.date === period && created.minutes < 21 * 60);
  if (!existedBeforeRun) return false;
  return !runs.some((run) => run.period_key === period && run.status === 'succeeded');
};

export const HomeScreen = () => {
  const { role, user } = useBusiness();
  const backend = useBackend();
  const briefing = useBriefing();
  const business = useBusinessRecord();
  const approved = useDrafts(['approved']);
  const members = useMembers();
  const invoices = useInvoices();
  const attention = useOpenAttention();
  const runs = useWeeklyRuns(addDays(thisWeeksSunday(), -7));
  const { run, busy } = useAction();
  const { show } = useMessages();
  const online = useOnline();
  const [sendId, setSendId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The reminder "Send the next one" offered last, so the one after it comes next if it is still unsent. */
  const lastOffered = useRef<string | null>(null);

  const invoicesOn = screenEnabled('invoices');
  const clientsOn = screenEnabled('clients');
  const sends = role === 'owner' || (role === 'checker' && Boolean(business.data?.checker_may_send));
  const canFix = role === 'owner' || role === 'checker';
  const ownerFirst = firstName(business.data?.owner_name ?? 'the owner');

  const clientNameByInvoice = useMemo(() => new Map((invoices.data ?? []).map((invoice) => [invoice.id, invoice.client_name])), [invoices.data]);
  const memberName = (userId: string | null) => (userId ? members.data?.find((m) => m.user_id === userId)?.display_name : undefined);

  if (briefing.data === undefined) {
    if (!briefing.isError && !isPausedOffline(briefing)) {
      return (
        <div className="page stack-lg" role="status" aria-label="Loading this week's briefing">
          <Skeleton width="60%" height={28} />
          <div className="home-figures">
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
          <Skeleton height={140} />
        </div>
      );
    }
    return (
      <div className="page stack">
        <PageTitle documentTitle="Home">Home</PageTitle>
        <NoData query={briefing} errorMessage={briefing.error?.message ?? "This week's briefing could not be loaded."} loading={null} />
      </div>
    );
  }

  const b = briefing.data;
  const late = draftsLate(runs.data, business.data);
  const noInvoices = b.totals.open_count === 0 && (invoices.data?.length ?? 0) === 0;
  const readyToSend = largestFirst(approved.data ?? []);
  const approvers = [...new Set(readyToSend.map((draft) => draft.approved_by).filter((id): id is string => Boolean(id) && id !== user.id))];
  const overdueShown = showAllOverdue ? b.overdue : b.overdue.slice(0, 5);
  const pending = pendingSends();
  const card = homeCard({
    waiting: b.drafts_waiting,
    approved: approved.data ? approved.data.length : null,
    sends,
    ownerSends: role === 'checker' && !sends,
    ownerFirstName: ownerFirst,
  });
  // The business name already says "(Test data)" for the seed businesses, so the chip would only repeat it.
  const nameSaysTestData = /\(test data\)\s*$/i.test(b.business.name);

  const sendNext = () => {
    const id = nextToSend(
      readyToSend.map((draft) => draft.id),
      lastOffered.current,
    );
    if (!id) return;
    lastOffered.current = id;
    setSendId(id);
  };

  const answerXero = async (answer: 'on' | 'off') => {
    const result = await run('xero', () => backend.updateSettings(b.business.id, { xero_reminders: answer }));
    if (!result.ok) setError(result.error.message);
    else show({ text: answer === 'on' ? "Saved. Turn off Xero's invoice reminders so clients don't get two." : 'Saved. Thanks.' });
  };

  const dismiss = async (entry: AttentionEntry) => {
    const item = attention.data?.find((a) => a.invoice_id === entry.invoice_id && a.kind === entry.kind);
    if (!item) return;
    const result = await run(`dismiss-${item.id}`, () => backend.dismissAttention(item.id));
    if (!result.ok) setError(result.error.message);
    else show({ text: 'Dismissed. The log keeps it.' });
  };

  const header = (
    <div className="stack-sm">
      <div className="row-wrap">
        <PageTitle documentTitle="Home">{b.business.name}</PageTitle>
        {b.business.is_test_data && !nameSaysTestData ? <Chip>Test data</Chip> : null}
      </div>
      <p className="t-caption">This week's briefing, as of {formatDate(b.as_of_date)}.</p>
    </div>
  );

  if (noInvoices) {
    return (
      <div className="page stack-lg">
        {header}
        <EmptyState
          title="Import your open invoices to start"
          action={
            <Link className="btn btn-primary btn-lg" to="import">
              <Upload size={20} strokeWidth={1.5} aria-hidden="true" /> Import invoices
            </Link>
          }
        >
          Upload this week's export of unpaid invoices from Xero. Your apprentice drafts reminders for the overdue ones on Sunday.
        </EmptyState>
      </div>
    );
  }

  const figure = (label: string, cents: number, count: number, filter: string) => {
    const content = (
      <>
        <span className="t-caption">{label}</span>
        <span className="t-figure" style={{ display: 'block' }}>
          {formatAud(cents)}
        </span>
        <span className="t-caption num">{pluralise(count, 'invoice')}</span>
      </>
    );
    return invoicesOn ? (
      <Link className="figure-link" to={`invoices?filter=${filter}`}>
        {content}
      </Link>
    ) : (
      <div className="figure-link">{content}</div>
    );
  };

  const left = (
    <div className="stack-lg">
      {header}
      {late ? (
        <Banner tone="warning" role="status">
          This week's drafts are late. The team has been told.
        </Banner>
      ) : null}
      <section aria-label="Totals" className="stack-sm">
        <div className="home-figures">
          {figure('Owed to you', b.totals.owed_cents, b.totals.open_count, 'open')}
          {figure('Overdue', b.totals.overdue_cents, b.totals.overdue_count, 'overdue')}
        </div>
        <p className="t-caption">
          <span className="num">{formatAud(b.totals.due_this_week_cents)}</span> due in the next 7 days
        </p>
      </section>

      {/* The one decision, in three states: drafts to review; otherwise approved reminders not sent yet; otherwise all caught up. */}
      <section className="action-card" aria-labelledby="drafts-heading">
        {card.kind === 'unknown' && approved.isLoading ? (
          <div className="stack-sm" role="status" aria-label="Checking for reminders still to send">
            <Skeleton width="70%" height={24} />
            <Skeleton height={20} />
          </div>
        ) : (
          <>
            <h2 className="t-heading" id="drafts-heading">
              {card.title}
            </h2>
            <p className="t-secondary">{card.line}</p>
            {card.kind === 'review' ? (
              <Link className="btn btn-primary btn-lg btn-block" to={b.first_draft_id ? `review?draft=${b.first_draft_id}` : 'review'}>
                {role === 'admin' ? 'See drafts' : 'Review drafts'}
              </Link>
            ) : card.kind === 'send' && sends ? (
              <Button variant="primary" size="lg" block onClick={sendNext}>
                Send the next one
              </Button>
            ) : null}
          </>
        )}
      </section>

      {/* Preview only: the "Try the Week 7 demo" card. It renders nothing in the real app. */}
      <DemoGuide />

      {readyToSend.length > 0 && sends ? (
        <section aria-labelledby="ready-heading">
          <div className="section-head">
            <h2 className="t-heading" id="ready-heading">
              Ready to send ({readyToSend.length})
            </h2>
          </div>
          {approvers.length > 0 ? <p className="t-caption">Approved by {approvers.map((id) => memberName(id) ?? 'your checker').join(' and ')}.</p> : null}
          <ul className="list">
            {readyToSend.map((draft) => (
              <li key={draft.id} className="list-row ready-row">
                <span className="list-main">
                  <span className="list-title" style={{ display: 'block' }}>
                    {clientNameByInvoice.get(draft.invoice_id) ?? `Invoice ${draft.invoice_number_shown}`}
                  </span>
                  <span className="list-meta">
                    Invoice {draft.invoice_number_shown} · {pending[draft.id] ? 'Did it send? Tap Send to answer' : 'Send by Sun 9:00 pm'}
                  </span>
                </span>
                <span className="amount">{formatAud(draft.amount_shown_cents)}</span>
                <Button variant="secondary" onClick={() => setSendId(draft.id)}>
                  Send<span className="visually-hidden"> the reminder for invoice {draft.invoice_number_shown}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {readyToSend.length > 0 && !sends && card.kind !== 'send' ? (
        <p className="note">
          {pluralise(readyToSend.length, 'approved reminder')} {readyToSend.length === 1 ? 'is' : 'are'} waiting for {ownerFirst} to send.
        </p>
      ) : null}

      {role === 'owner' && business.data?.xero_reminders === 'unknown' ? (
        <section className="card stack-sm" aria-labelledby="xero-heading">
          <h2 className="t-heading" id="xero-heading">
            Does Xero send its own invoice reminders?
          </h2>
          <p className="t-secondary">If it does, a client could get two reminders for the same invoice.</p>
          <div className="row-wrap">
            <Button variant="secondary" busy={busy === 'xero'} unavailable={!online} onClick={() => void answerXero('on')}>
              Yes, Xero sends them
            </Button>
            <Button variant="secondary" unavailable={!online || busy !== null} onClick={() => void answerXero('off')}>
              No, they're off
            </Button>
          </div>
          <p className="t-caption">Not sure? Ask the team under More.</p>
        </section>
      ) : null}
      <FormError message={error} />
    </div>
  );

  const right = (
    <div className="stack-lg">
      {b.needs_attention.length > 0 ? (
        <section aria-labelledby="attention-heading">
          <div className="section-head">
            <h2 className="t-heading" id="attention-heading">
              Needs attention ({b.needs_attention.length})
            </h2>
          </div>
          <ul className="list">
            {b.needs_attention.map((entry) => (
              <li key={`${entry.kind}-${entry.invoice_id}`} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="list-main stack-sm">
                  <p>
                    <span className="list-title">{entry.client_name}</span>, invoice {entry.invoice_number}: {ATTENTION_TEXT[entry.kind]}
                    {entry.kind === 'amount_changed' && entry.detail.from_cents !== undefined && entry.detail.to_cents !== undefined
                      ? ` It went from ${formatAud(entry.detail.from_cents)} to ${formatAud(entry.detail.to_cents)}.`
                      : null}
                    {entry.kind === 'due_date_changed' && entry.detail.from && entry.detail.to
                      ? ` It moved from ${formatDate(entry.detail.from)} to ${formatDate(entry.detail.to)}.`
                      : null}
                  </p>
                  {entry.kind === 'email_missing' ? (
                    clientsOn && canFix ? (
                      <Button variant="secondary" onClick={() => setClientId(entry.client_id)}>
                        Add an email
                      </Button>
                    ) : (
                      <p className="t-caption">Add it in Xero, then import again.</p>
                    )
                  ) : canFix ? (
                    <Button variant="secondary" busy={busy !== null && busy.startsWith('dismiss')} unavailable={!online} onClick={() => void dismiss(entry)}>
                      Checked, dismiss
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="overdue-heading">
        <div className="section-head">
          <h2 className="t-heading" id="overdue-heading">
            Biggest overdue
          </h2>
        </div>
        {b.overdue.length === 0 ? (
          <p className="note">Nothing to chase this week. Your apprentice checked every open invoice.</p>
        ) : (
          <>
            <ul className="list">
              {overdueShown.map((invoice) => {
                const content = (
                  <>
                    <span className="list-main">
                      <span className="list-title" style={{ display: 'block' }}>
                        {invoice.client_name}
                      </span>
                      <span className="list-meta">
                        Invoice {invoice.invoice_number}
                        {invoice.client_paused ? ' · Paused' : ''}
                      </span>
                      {invoice.call_first ? (
                        <span className="row" style={{ marginTop: 4 }}>
                          <Phone size={16} strokeWidth={1.5} aria-hidden="true" />
                          <span className="t-caption">Consider a call</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="list-end">
                      <span className="amount">{formatAud(invoice.amount_due_cents)}</span>
                      <Chip tone="overdue">{overdueChip(invoice.days_overdue).label}</Chip>
                    </span>
                  </>
                );
                return (
                  <li key={invoice.invoice_id}>
                    {invoicesOn ? (
                      <button type="button" className="list-row" onClick={() => setInvoiceId(invoice.invoice_id)}>
                        {content}
                      </button>
                    ) : (
                      <div className="list-row">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            {b.overdue.length > 5 ? (
              invoicesOn ? (
                <Link className="btn btn-quiet" to="invoices?filter=overdue">
                  See all invoices
                </Link>
              ) : (
                <Button variant="quiet" aria-expanded={showAllOverdue} onClick={() => setShowAllOverdue((v) => !v)}>
                  {showAllOverdue ? 'Show the biggest 5' : `Show all ${b.overdue.length} overdue`}
                </Button>
              )
            ) : null}
          </>
        )}
      </section>

      {b.paused_clients.length > 0 ? (
        <p className="t-secondary">
          Paused:{' '}
          {b.paused_clients.map((client, index) => (
            <span key={client.client_id}>
              {index > 0 ? '; ' : ''}
              {clientsOn ? <Link to={`clients?client=${client.client_id}`}>{client.name}</Link> : client.name}
            </span>
          ))}
          . No reminders are drafted for paused clients.
        </p>
      ) : null}

      <div className="row-wrap">
        <Link className="btn btn-quiet" to="log">
          See what happened
        </Link>
        <Link className="btn btn-quiet" to="import">
          Import invoices
        </Link>
      </div>
    </div>
  );

  return (
    <div className="page-wide">
      <div className="home-grid">
        {left}
        {right}
      </div>
      {sendId ? (
        <SendSheet
          draftId={sendId}
          onClose={() => setSendId(null)}
          onDone={(outcome, id) => {
            setSendId(null);
            show({ text: outcome === 'sent' ? sentLeftToSend(readyToSend.filter((draft) => draft.id !== id).length) : NOT_SENT_YET });
          }}
        />
      ) : null}
      {invoiceId ? <InvoiceSheet invoiceId={invoiceId} onClose={() => setInvoiceId(null)} /> : null}
      {clientId ? <ClientSheet clientId={clientId} onClose={() => setClientId(null)} /> : null}
    </div>
  );
};
