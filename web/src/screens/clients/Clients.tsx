// UI-09 Clients: keep emails, tones and pauses right. Clients missing an email come first, because no reminder can
// be drafted for them (FR-10).
import { CirclePause, TriangleAlert, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useClients, useInvoices } from '../../app/queries.ts';
import { Link, useLocation } from '../../app/router.tsx';
import { formatAud } from '../../lib/money.ts';
import { TONE_LABEL } from '../../lib/words.ts';
import { Avatar, Chip, EmptyState, LoadingBlock, PageTitle } from '../../ui/controls.tsx';
import { NoData } from '../../ui/QueryState.tsx';
import { ClientSheet } from './ClientSheet.tsx';

export const ClientsScreen = () => {
  const location = useLocation();
  const clients = useClients();
  const invoices = useInvoices();
  const [openId, setOpenId] = useState<string | null>(location.params.get('client'));

  const owedByClient = useMemo(() => {
    const totals = new Map<string, number>();
    for (const invoice of invoices.data ?? []) {
      if (invoice.status === 'open') totals.set(invoice.client_id, (totals.get(invoice.client_id) ?? 0) + invoice.amount_due_cents);
    }
    return totals;
  }, [invoices.data]);

  const sorted = useMemo(
    () =>
      [...(clients.data ?? [])].sort((a, b) => {
        if (!a.email !== !b.email) return a.email ? 1 : -1;
        return a.name.localeCompare(b.name, 'en-AU');
      }),
    [clients.data],
  );

  return (
    <div className="page stack-lg">
      <div className="page-head">
        <PageTitle documentTitle="Clients">Clients</PageTitle>
      </div>
      {clients.data === undefined ? (
        <NoData query={clients} loading={<LoadingBlock label="Loading clients" />} />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No clients yet"
          icon={Users}
          action={
            <Link className="btn btn-primary" to="import">
              Import invoices
            </Link>
          }
        >
          Clients come from your imported invoices.
        </EmptyState>
      ) : (
        <ul className="list">
          {sorted.map((client) => (
            <li key={client.id}>
              <button type="button" className="list-row row-grid" onClick={() => setOpenId(client.id)}>
                <Avatar name={client.name} />
                <span className="list-main">
                  <span className="list-title" style={{ display: 'block' }}>
                    {client.name}
                  </span>
                  <span className="list-meta" style={{ display: 'block' }}>
                    {client.email ? (client.contact_name ? `${client.contact_name} · ${client.email}` : client.email) : 'No email address: add one so reminders can be drafted'}
                  </span>
                </span>
                <span className="list-end">
                  <span className="amount">{formatAud(owedByClient.get(client.id) ?? 0)}</span>
                  <span className="t-caption">owed</span>
                </span>
                {/* The same chips as the client's sheet: tone, Paused, and one amber "No email". */}
                <span className="row-status">
                  <Chip>{TONE_LABEL[client.tone]}</Chip>
                  {client.paused ? <Chip icon={CirclePause}>Paused</Chip> : null}
                  {!client.email ? (
                    <Chip tone="due-soon" icon={TriangleAlert}>
                      No email
                    </Chip>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId ? <ClientSheet clientId={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
};
