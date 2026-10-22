// UI-07 Invoices: find any invoice and its status. A search field and filter chips; each row shows the client,
// invoice number, the amount right-aligned and a status chip; a tap opens the invoice's sheet.
import { Ban, CalendarDays, FileText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useInvoices } from '../../app/queries.ts';
import { Link, navigate, useLocation } from '../../app/router.tsx';
import type { DisplayStatus, InvoiceListRow } from '../../backend/types.ts';
import { formatAud } from '../../lib/money.ts';
import { invoiceChip } from '../../lib/words.ts';
import { Avatar, Chip, Choices, EmptyState, LoadingBlock, PageTitle, TextField } from '../../ui/controls.tsx';
import { NoData } from '../../ui/QueryState.tsx';
import { InvoiceSheet } from './InvoiceSheet.tsx';

// "Open" is every unpaid, unclosed invoice: what Home's "Owed to you" adds up (UI brief, Home: "Each opens Invoices, filtered").
type Filter = 'all' | 'open' | DisplayStatus;
const FILTERS: { value: Exclude<Filter, 'due'>; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'paid', label: 'Paid' },
  { value: 'closed', label: 'Closed' },
];

const inFilter = (invoice: InvoiceListRow, filter: Filter): boolean =>
  filter === 'all' ? true : filter === 'open' ? invoice.status === 'open' : invoice.display_status === filter;

const matches = (invoice: InvoiceListRow, filter: Filter, query: string): boolean => {
  if (!inFilter(invoice, filter)) return false;
  if (!query) return true;
  const q = query.toLowerCase();
  return invoice.invoice_number.toLowerCase().includes(q) || invoice.client_name.toLowerCase().includes(q);
};

export const InvoicesScreen = () => {
  const location = useLocation();
  const invoices = useInvoices();
  const filterParam = location.params.get('filter');
  const filter: Filter = FILTERS.some((f) => f.value === filterParam) ? (filterParam as Filter) : 'all';
  const [query, setQuery] = useState(location.params.get('q') ?? '');
  const [openId, setOpenId] = useState<string | null>(location.params.get('invoice'));

  const rows = useMemo(() => {
    const list = (invoices.data ?? []).filter((invoice) => matches(invoice, filter, query.trim()));
    if (filter === 'paid') return [...list].sort((a, b) => (b.paid_date ?? '').localeCompare(a.paid_date ?? ''));
    return list;
  }, [invoices.data, filter, query]);

  const setFilter = (value: Filter) => {
    const params = new URLSearchParams();
    if (value !== 'all') params.set('filter', value);
    if (query.trim()) params.set('q', query.trim());
    const search = params.toString();
    navigate(`invoices${search ? `?${search}` : ''}`, { replace: true });
  };

  const counts = useMemo(() => {
    const all = invoices.data ?? [];
    return Object.fromEntries(FILTERS.map((f) => [f.value, all.filter((i) => inFilter(i, f.value)).length]));
  }, [invoices.data]);

  return (
    <div className="page-wide stack-lg">
      <div className="page-head">
        <PageTitle documentTitle="Invoices">Invoices</PageTitle>
      </div>
      {invoices.data === undefined ? (
        <NoData query={invoices} loading={<LoadingBlock label="Loading invoices" />} />
      ) : invoices.data.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          icon={FileText}
          action={
            <Link className="btn btn-primary" to="import">
              Import invoices
            </Link>
          }
        >
          Import your open invoices to start.
        </EmptyState>
      ) : (
        <>
          <div className="stack">
            <TextField
              label="Search by client or invoice number"
              icon={Search}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Choices
              legend="Show"
              scroll
              name="invoice-filter"
              value={filter === 'due' ? 'all' : filter}
              options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} (${counts[f.value] ?? 0})` }))}
              onChange={(value) => setFilter(value)}
            />
          </div>
          <p className="t-caption" role="status">
            {rows.length === 1 ? '1 invoice' : `${rows.length} invoices`}
          </p>
          {rows.length === 0 ? (
            <EmptyState title="No invoices match">Try another filter, or search by a different client or number.</EmptyState>
          ) : (
            <ul className="list">
              {rows.map((invoice) => {
                const chip = invoiceChip(invoice);
                return (
                  <li key={invoice.id}>
                    {/* The status sits under the client's name, after the amount in reading order. */}
                    <button type="button" className="list-row row-grid" onClick={() => setOpenId(invoice.id)}>
                      <Avatar name={invoice.client_name} />
                      <span className="list-main">
                        <span className="list-title" style={{ display: 'block' }}>
                          {invoice.client_name}
                        </span>
                        <span className="list-meta" style={{ display: 'block' }}>
                          Invoice {invoice.invoice_number}
                          {invoice.client_paused ? ' · Paused' : ''}
                        </span>
                      </span>
                      <span className="amount">{formatAud(invoice.amount_due_cents)}</span>
                      <span className="row-status">
                        <Chip tone={chip.tone} icon={chip.tone === 'neutral' ? (invoice.display_status === 'closed' ? Ban : CalendarDays) : undefined}>
                          {chip.label}
                        </Chip>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {openId ? <InvoiceSheet invoiceId={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
};
