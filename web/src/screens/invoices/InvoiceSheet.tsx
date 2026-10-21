// An invoice's sheet (UI-07): its facts, its status, its history from the activity log, and "Mark paid" with the
// paid date (FR-24, Should). Undo is offered in the message and kept here as "Mark as unpaid" (WCAG 2.2.1).
import { useState } from 'react';
import { useMessages } from '../../app/messages.tsx';
import { useOnline } from '../../app/online.ts';
import { useAction, useActivity, useClients, useInvoices, useMembers } from '../../app/queries.ts';
import { useBackend, useBusiness } from '../../app/session.tsx';
import { describe } from '../../lib/activity.ts';
import { formatDate, formatDay, formatTime, sydneyDate } from '../../lib/dates.ts';
import { formatAud } from '../../lib/money.ts';
import { invoiceChip, pluralise } from '../../lib/words.ts';
import { Button, Chip, ErrorPanel, FormError, Skeleton, TextField } from '../../ui/controls.tsx';
import { NoData } from '../../ui/QueryState.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

export const InvoiceSheet = ({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) => {
  const { role } = useBusiness();
  const backend = useBackend();
  const invoices = useInvoices();
  const clients = useClients();
  const members = useMembers();
  const history = useActivity(invoiceId);
  const { run, busy } = useAction();
  const { show } = useMessages();
  const online = useOnline();
  const today = sydneyDate();
  const [paidDate, setPaidDate] = useState(today);
  const [error, setError] = useState<string | null>(null);

  const invoice = invoices.data?.find((row) => row.id === invoiceId);
  const canAct = role === 'owner' || role === 'checker';

  const undo = async () => {
    const result = await run('undo', () => backend.undoMarkPaid(invoiceId));
    if (!result.ok) show({ text: result.error.message });
    else show({ text: "Open again. Cancelled reminders stay cancelled; Sunday's run drafts afresh." });
  };

  const markPaid = async () => {
    if (!invoice) return;
    if (!paidDate || paidDate < invoice.issue_date || paidDate > today) {
      setError(`Pick a paid date between ${formatDate(invoice.issue_date)} and today.`);
      return;
    }
    setError(null);
    const result = await run('paid', () => backend.markPaid(invoiceId, paidDate));
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const cancelled = result.value.drafts_cancelled ?? 0;
    show({
      text: `Marked paid.${cancelled > 0 ? ` ${pluralise(cancelled, 'reminder')} cancelled.` : ''}`,
      action: { label: 'Undo', run: () => undo() },
    });
  };

  const lookups = {
    memberName: (userId: string) => members.data?.find((m) => m.user_id === userId)?.display_name,
    invoiceNumber: (id: string) => invoices.data?.find((row) => row.id === id)?.invoice_number,
    clientName: (id: string) => clients.data?.find((c) => c.id === id)?.name,
  };
  const entries = history.data?.pages.flat() ?? [];

  return (
    // Mostly for reading: focus starts on the title, not the "Paid on" date, which a phone would open as a picker.
    <Sheet open onClose={onClose} title={invoice ? `Invoice ${invoice.invoice_number}` : 'Invoice'} busy={busy !== null} initialFocus="title">
      {invoices.data === undefined ? (
        <NoData
          query={invoices}
          loading={
            <div className="stack-sm" role="status" aria-label="Loading the invoice">
              <Skeleton width="50%" />
              <Skeleton height={80} />
            </div>
          }
        />
      ) : !invoice ? (
        <ErrorPanel message="This item is no longer available." />
      ) : (
        <div className="stack-lg">
          <div className="stack-sm">
            <p className="list-title">{invoice.client_name}</p>
            <div className="row-wrap">
              <span className="t-figure" style={{ fontSize: 28 }}>
                {formatAud(invoice.amount_due_cents)}
              </span>
              <Chip tone={invoiceChip(invoice).tone}>{invoiceChip(invoice).label}</Chip>
            </div>
            <dl className="stack-sm">
              <div className="spread">
                <dt className="t-secondary">Issued</dt>
                <dd className="num">{formatDate(invoice.issue_date)}</dd>
              </div>
              <div className="spread">
                <dt className="t-secondary">Due</dt>
                <dd className="num">{formatDate(invoice.due_date)}</dd>
              </div>
              <div className="spread">
                <dt className="t-secondary">Reminders sent</dt>
                <dd className="num">
                  {invoice.reminders_sent_count}
                  {invoice.last_reminder_sent_at ? `, last on ${formatDate(sydneyDate(new Date(invoice.last_reminder_sent_at)))}` : ''}
                </dd>
              </div>
            </dl>
          </div>

          {invoice.status === 'closed' ? <p className="note">This invoice is closed because it wasn't in your latest import.</p> : null}

          {invoice.status === 'open' && canAct ? (
            <section className="card stack-sm" aria-labelledby="paid-heading">
              <h3 className="t-heading" id="paid-heading">
                Mark paid
              </h3>
              <p className="t-caption">Any waiting reminder for this invoice is cancelled, and it leaves the briefing.</p>
              <TextField
                label="Paid on"
                type="date"
                value={paidDate}
                min={invoice.issue_date}
                max={today}
                onChange={(event) => setPaidDate(event.target.value)}
                error={error}
              />
              <Button variant="primary" busy={busy === 'paid'} busyLabel="Saving…" unavailable={!online} onClick={() => void markPaid()}>
                Mark paid
              </Button>
            </section>
          ) : null}

          {invoice.status === 'paid' && canAct ? (
            <div className="stack-sm">
              <Button variant="secondary" busy={busy === 'undo'} busyLabel="Saving…" unavailable={!online} onClick={() => void undo()}>
                Mark as unpaid
              </Button>
              <FormError message={error} />
            </div>
          ) : null}

          <section aria-labelledby="history-heading" className="stack-sm">
            <h3 className="t-heading" id="history-heading">
              History
            </h3>
            {history.data === undefined ? (
              <NoData query={history} loading={<Skeleton height={60} />} />
            ) : entries.length === 0 ? (
              <p className="t-secondary">Nothing has happened to this invoice yet.</p>
            ) : (
              <ul>
                {entries.map((entry) => (
                  <li key={entry.id} className="log-entry">
                    <span className="log-time t-caption">
                      {formatDay(entry.at)}
                      <br />
                      {formatTime(entry.at)}
                    </span>
                    <span>{describe(entry, lookups)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
};
