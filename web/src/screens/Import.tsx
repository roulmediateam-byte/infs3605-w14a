// UI-08 Import (FR-04 to FR-06): bring in this week's export without surprises. Choose, Match (first time only),
// Check, Done. Every row and the total are checked before anything is saved, and a file that would quietly close most
// invoices is stopped. The browser and the server read values with the same rules (lib/import-rows.ts).
// The Check step names every invoice that will close and every reminder that will be cancelled, so "what will change"
// is always the whole truth.
import { Check, CircleAlert, CircleCheck, CircleDashed, FileUp, MoveRight, TriangleAlert, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import './Import.css';
import { useMessages } from '../app/messages.tsx';
import { useOnline } from '../app/online.ts';
import { useAction, useBusinessRecord, useClients, useDrafts, useInvoices } from '../app/queries.ts';
import { Link, toHref } from '../app/router.tsx';
import { useBackend, useBusiness } from '../app/session.tsx';
import { MESSAGES } from '../backend/errors.ts';
import type { ImportResult } from '../backend/types.ts';
import { formatDate } from '../lib/dates.ts';
import {
  autoMap,
  CANCELLED_BECAUSE,
  checkRows,
  clashingFields,
  detectFormat,
  FIELD_LABELS,
  IMPORT_FIELDS,
  MAX_ROWS,
  missingFields,
  planImport,
  planWords,
  REQUIRED_FIELDS,
  toImportRows,
  usableMapping,
  type ColumnMapping,
  type ImportField,
  type ParsedFile,
} from '../lib/import-rows.ts';
import { formatAud, toJsonInteger } from '../lib/money.ts';
import { listCounts, pluralise } from '../lib/words.ts';
import type { CsvResponse } from '../workers/csv.worker.ts';
import { Banner, Button, ErrorPanel, FormError, IconTile, LoadingBlock, PageTitle, SelectField } from '../ui/controls.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { isPausedOffline } from '../ui/QueryState.tsx';

type Step = 'choose' | 'match' | 'check' | 'done';
const STEPS: { id: Step; label: string }[] = [
  { id: 'choose', label: 'Choose' },
  { id: 'match', label: 'Match' },
  { id: 'check', label: 'Check' },
  { id: 'done', label: 'Done' },
];

const NOT_CSV = "This file isn't a CSV. In Xero, export your invoices as CSV and try again.";

/** How many closing invoices and cancelled reminders are named before "And 3 more." */
const LIST_LIMIT = 10;

const readCsv = (file: File): Promise<string[][]> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/csv.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<CsvResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.rows);
      else reject(new Error(event.data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error(NOT_CSV));
    };
    worker.postMessage({ file });
  });

/** Header row, then data rows with their spreadsheet row numbers (the header is row 1); blank rows are dropped. */
export const toParsedFile = (fileName: string, raw: string[][]): ParsedFile | null => {
  const headerIndex = raw.findIndex((row) => row.some((cell) => cell.trim() !== ''));
  if (headerIndex === -1) return null;
  const headers = (raw[headerIndex] ?? []).map((cell, index) => (index === 0 ? cell.replace(/^﻿/, '') : cell).trim());
  const rows = raw
    .map((cells, index) => ({ row: index + 1, cells }))
    .slice(headerIndex + 1)
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ''));
  return { fileName, headers, rows };
};

/**
 * The preview table scrolls inside its own box (UI brief, UI-08). When the table is wider than the box, as on every
 * phone, a hint says so and the right edge fades until the last column is in view.
 */
const SidewaysScroll = ({ labelledBy, children }: { labelledBy: string; children: ReactNode }) => {
  const [edge, setEdge] = useState({ wide: false, more: false, barRight: 0, barBottom: 0 });
  const watch = useCallback((box: HTMLDivElement | null) => {
    if (!box) return;
    const measure = () => {
      const hidden = box.scrollWidth - box.clientWidth;
      const next = {
        wide: hidden > 1,
        more: hidden - box.scrollLeft > 1,
        // Scrollbars that take room (not the overlay kind on phones) stay clear of the fade.
        barRight: Math.max(0, box.offsetWidth - box.clientWidth - box.clientLeft * 2),
        barBottom: Math.max(0, box.offsetHeight - box.clientHeight - box.clientTop * 2),
      };
      setEdge((current) =>
        current.wide === next.wide && current.more === next.more && current.barRight === next.barRight && current.barBottom === next.barBottom
          ? current
          : next,
      );
    };
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(box);
    if (box.firstElementChild) observer?.observe(box.firstElementChild);
    return () => {
      box.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, []);
  return (
    <>
      {edge.wide ? (
        <p className="t-caption import-scroll-hint">
          <MoveRight size={16} strokeWidth={1.5} aria-hidden="true" />
          Scroll sideways for more.
        </p>
      ) : null}
      <div
        className="import-scroll"
        data-more={edge.more || undefined}
        style={{ '--bar-right': `${edge.barRight}px`, '--bar-bottom': `${edge.barBottom}px` } as CSSProperties}
      >
        <div ref={watch} className="table-wrap" tabIndex={0} role="region" aria-labelledby={labelledBy}>
          {children}
        </div>
      </div>
    </>
  );
};

export const ImportScreen = () => {
  const { businessId, role } = useBusiness();
  const backend = useBackend();
  const business = useBusinessRecord();
  const invoices = useInvoices();
  const clients = useClients();
  const live = useDrafts(['waiting', 'approved']);
  const { run, busy } = useAction();
  const { announce } = useMessages();
  const online = useOnline();
  const [step, setStep] = useState<Step>('choose');
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [autoMatched, setAutoMatched] = useState(false);
  const [chooseError, setChooseError] = useState<string | null>(null);
  // Counts file errors, so the same message chosen twice is shown, scrolled to and announced again.
  const [errorCount, setErrorCount] = useState(0);
  const [reading, setReading] = useState(false);
  const [matchErrors, setMatchErrors] = useState<Partial<Record<ImportField, string>>>({});
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [massClose, setMassClose] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Invoices whose reminder the import cancelled because their amount or due date changed: Home lists them.
  const [flagged, setFlagged] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const safeRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef<Step>(step);

  const checked = useMemo(() => (file && step === 'check' ? checkRows(toImportRows(file, mapping)) : []), [file, mapping, step]);
  const plan = useMemo(() => {
    if (step !== 'check' || !invoices.data || !live.data || !clients.data) return null;
    const liveByInvoice = new Map<string, number>();
    for (const draft of live.data) liveByInvoice.set(draft.invoice_id, (liveByInvoice.get(draft.invoice_id) ?? 0) + 1);
    return planImport(checked, invoices.data, liveByInvoice, new Set(clients.data.map((c) => c.name.replace(/^ +| +$/g, '').toLowerCase())));
  }, [step, checked, invoices.data, live.data, clients.data]);

  // A file error sits in the drop zone; bring it to the middle of the screen, clear of the phone's bottom bar.
  useEffect(() => {
    if (errorCount > 0) errorRef.current?.scrollIntoView({ block: 'center' });
  }, [errorCount]);

  // Each step starts at its heading: focus moves there (the button that was pressed has gone), and the page scrolls
  // back up if the heading is above the screen, as after a file error was scrolled into view. The Check step's
  // heading appears once the current invoices have loaded, so this waits for it.
  useEffect(() => {
    if (shownStep.current === step) return;
    const heading = stepHeadingRef.current;
    if (!heading) return;
    shownStep.current = step;
    heading.focus({ preventScroll: true });
    if (heading.getBoundingClientRect().top < 0) headRef.current?.scrollIntoView({ block: 'start' });
  }, [step, plan]);

  const fail = (message: string) => {
    setChooseError(message);
    setErrorCount((count) => count + 1);
  };

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    setChooseError(null);
    setResult(null);
    if (!/\.csv$/i.test(picked.name) && !['text/csv', 'application/vnd.ms-excel', 'text/plain'].includes(picked.type)) {
      fail(NOT_CSV);
      return;
    }
    setReading(true);
    try {
      const parsed = toParsedFile(picked.name, await readCsv(picked));
      if (!parsed || parsed.headers.filter(Boolean).length < 2) {
        fail(NOT_CSV);
        return;
      }
      if (parsed.rows.length === 0) {
        fail('The file has no rows to import.');
        return;
      }
      if (parsed.rows.length > MAX_ROWS) {
        fail(`Import up to 2,000 rows at a time. This file has ${parsed.rows.length.toLocaleString('en-AU')}.`);
        return;
      }
      const remembered = usableMapping(business.data?.column_mapping, parsed.headers);
      const matched = remembered ?? autoMap(parsed.headers);
      setFile(parsed);
      setMapping(matched);
      setMatchErrors({});
      const complete = missingFields(matched).length === 0 && clashingFields(matched).length === 0;
      setAutoMatched(complete);
      setStep(complete ? 'check' : 'match');
      announce(complete ? `Read ${pluralise(parsed.rows.length, 'row')}. Columns matched.` : `Read ${pluralise(parsed.rows.length, 'row')}. Match the columns.`);
    } catch {
      fail(NOT_CSV);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const confirmMatch = () => {
    const errors: Partial<Record<ImportField, string>> = {};
    for (const field of missingFields(mapping)) errors[field] = `Choose a column for ${FIELD_LABELS[field]}.`;
    for (const field of clashingFields(mapping)) errors[field] ??= 'Each field needs its own column.';
    setMatchErrors(errors);
    if (Object.keys(errors).length > 0) {
      const first = IMPORT_FIELDS.find((field) => errors[field]);
      if (first) document.getElementById(`map-${first}`)?.focus();
      return;
    }
    setStep('check');
  };

  const confirmImport = async (allowMassClose: boolean) => {
    if (!file || !plan) return;
    setConfirmError(null);
    const rows = checked.map((row) => row.input);
    const outcome = await run(
      'import',
      () =>
        backend.confirmImport({
          businessId,
          fileName: file.fileName,
          format: detectFormat(file.headers),
          mapping,
          rows,
          expectedRows: rows.length,
          expectedTotalCents: toJsonInteger(plan.fileTotalCents),
          allowMassClose,
        }),
      { refresh: 'wait' },
    );
    if (!outcome.ok) {
      if (outcome.error.kind === 'mass-close') {
        setMassClose(outcome.error.message);
        return;
      }
      setMassClose(null);
      setConfirmError(outcome.error.message);
      return;
    }
    setMassClose(null);
    setFlagged(plan.cancelledReminders.filter((reminder) => reminder.reason !== 'invoice_closed').length);
    setResult(outcome.value);
    setStep('done');
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void choose(event.dataTransfer.files[0]);
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const words = plan ? planWords(plan) : null;
  // A file that would close most open invoices makes choosing another file the main action (the mass-close guard).
  const safeFirst = Boolean(words?.massClose);
  const chooseAnother = (variant: 'primary' | 'secondary') => (
    <Button key="choose" variant={variant} size="lg" unavailable={busy !== null} onClick={() => setStep('choose')}>
      Choose another file
    </Button>
  );

  if (role !== 'owner' && role !== 'checker' && role !== 'admin') return null;

  return (
    <div className="page-wide stack-lg">
      <div className="page-head stack-sm" ref={headRef}>
        <PageTitle documentTitle="Import invoices">Import invoices</PageTitle>
        <ol className="stepper" aria-label={`Step ${stepIndex + 1} of 4`}>
          {STEPS.map((s, index) => (
            <li
              key={s.id}
              aria-current={s.id === step ? 'step' : undefined}
              data-state={index < stepIndex || (step === 'done' && s.id === 'done') ? 'done' : undefined}
            >
              {/* A green tick for a done step, a blue number for this one, a slate ring for the rest; the words say it too. */}
              <span className="step-mark" aria-hidden="true">
                {index < stepIndex || (step === 'done' && s.id === 'done') ? <Check size={14} strokeWidth={3} /> : index + 1}
              </span>
              {s.label}
              <span className="visually-hidden">{index < stepIndex ? ', done' : s.id === step ? ', current step' : ''}</span>
            </li>
          ))}
        </ol>
      </div>

      {step === 'choose' ? (
        <section className="stack" aria-labelledby="choose-heading">
          <h2 className="t-heading" id="choose-heading" ref={stepHeadingRef} tabIndex={-1}>
            Upload your open invoices
          </h2>
          <p>
            In Xero, export your unpaid invoices as a CSV file, then choose it here. Nothing is saved until you check it and confirm. The{' '}
            {backend.preview ? (
              // The preview's viewer can't save files, so the template is named but not offered as a download.
              "team's template"
            ) : (
              <a href={toHref('invoice-template.csv')} download>
                team's template
              </a>
            )}{' '}
            works too.
          </p>
          <div
            className="dropzone stack-sm"
            data-over={dragging || undefined}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <IconTile icon={FileUp} tone="info" size="lg" />
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              id="import-file"
              aria-label="Choose a CSV file"
              onChange={(event) => void choose(event.target.files?.[0])}
            />
            {chooseError ? (
              // Inside the drop zone, above the button, where the person is looking (not under the bottom bar).
              <div key={errorCount} ref={errorRef} id="import-error" className="import-file-error">
                <FormError message={chooseError} />
              </div>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              busy={reading}
              busyLabel="Reading the file…"
              aria-describedby={chooseError ? 'import-error' : undefined}
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={20} strokeWidth={1.5} aria-hidden="true" /> Choose a CSV file
            </Button>
            <p className="t-caption import-drag-hint">On a computer you can also drag the file here.</p>
            {backend.preview ? (
              <Button
                variant="secondary"
                unavailable={reading}
                onClick={() => {
                  void backend.preview?.sampleImportFile().then((file) => choose(file));
                }}
              >
                Preview: use the Week 7 demonstration file
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {step === 'match' && file ? (
        <section className="stack" aria-labelledby="match-heading">
          <h2 className="t-heading" id="match-heading" ref={stepHeadingRef} tabIndex={-1}>
            Match your columns
          </h2>
          <p>
            Tell us which column in <strong>{file.fileName}</strong> holds each field. We remember your choice for next time.
          </p>
          <div className="mapping-grid">
            {IMPORT_FIELDS.map((field) => {
              const header = mapping[field];
              const sample = header ? file.rows[0]?.cells[file.headers.indexOf(header)] : undefined;
              return (
                <SelectField
                  key={field}
                  id={`map-${field}`}
                  label={`${FIELD_LABELS[field]}${REQUIRED_FIELDS.includes(field) ? '' : ' (optional)'}`}
                  value={header ?? ''}
                  error={matchErrors[field] ?? null}
                  hint={sample ? `First row: ${sample}` : undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    setMapping((current) => {
                      const next = { ...current };
                      if (value) next[field] = value;
                      else delete next[field];
                      return next;
                    });
                    setMatchErrors((current) => ({ ...current, [field]: undefined }));
                  }}
                >
                  <option value="">{REQUIRED_FIELDS.includes(field) ? 'Choose a column' : 'No column'}</option>
                  {file.headers.map((h, index) =>
                    h ? (
                      <option key={`${h}-${index}`} value={h}>
                        {h}
                      </option>
                    ) : null,
                  )}
                </SelectField>
              );
            })}
          </div>
          <div className="row-wrap">
            <Button variant="primary" onClick={confirmMatch}>
              Check the file
            </Button>
            <Button variant="secondary" onClick={() => setStep('choose')}>
              Choose another file
            </Button>
          </div>
        </section>
      ) : null}

      {step === 'check' && file ? (
        !plan ? (
          invoices.isError || live.isError || clients.isError || [invoices, live, clients].some(isPausedOffline) ? (
            <ErrorPanel
              message={
                [invoices, live, clients].some(isPausedOffline)
                  ? MESSAGES.offlineNoData
                  : "Your current invoices could not be loaded, so the file can't be compared with them yet."
              }
              onRetry={() => {
                void invoices.refetch();
                void live.refetch();
                void clients.refetch();
              }}
            />
          ) : (
            <LoadingBlock label="Checking the file" />
          )
        ) : (
          <section className="stack-lg" aria-labelledby="check-heading">
            <div className="stack-sm">
              <h2 className="t-heading" id="check-heading" ref={stepHeadingRef} tabIndex={-1}>
                Check what will change
              </h2>
              <p>
                <strong className="file-name">{file.fileName}</strong>: {pluralise(plan.rowsRead, 'row')}, totalling{' '}
                <span className="num">{formatAud(plan.fileTotalCents)}</span>.
              </p>
              {autoMatched ? (
                <div className="row-wrap import-columns">
                  <p className="t-caption">Columns matched automatically.</p>
                  <Button variant="quiet" onClick={() => setStep('match')}>
                    Change columns
                  </Button>
                </div>
              ) : null}
            </div>

            {words?.massClose ? (
              <Banner tone="warning">
                <strong>{words.massClose.title}</strong> {words.massClose.body}
              </Banner>
            ) : null}

            <div className="card stack-sm" role="status">
              <p className="list-title">{words?.headline}</p>
              {words?.detail ? <p className="t-secondary">{words.detail}</p> : null}
              {plan.keptPaid > 0 ? (
                <p className="t-secondary">
                  {plan.keptPaid === 1 ? '1 invoice you marked paid is still unpaid in Xero. It stays paid.' : `${plan.keptPaid} invoices you marked paid are still unpaid in Xero. They stay paid.`}
                </p>
              ) : null}
            </div>

            {words?.closing ? (
              <section aria-labelledby="closing-heading" className="notice notice-warning stack-sm">
                <h3 className="t-subheading notice-title" id="closing-heading">
                  <TriangleAlert size={20} strokeWidth={2} aria-hidden="true" />
                  {words.closing.heading}
                </h3>
                <p>{words.closing.explanation}</p>
                <ul className="list">
                  {plan.closingInvoices.slice(0, LIST_LIMIT).map((invoice) => (
                    <li key={invoice.invoiceNumber} className="list-row">
                      <div className="list-main">
                        <p className="list-title">Invoice {invoice.invoiceNumber}</p>
                        <p className="list-meta">{invoice.clientName}</p>
                      </div>
                      <div className="list-end">
                        <span className="amount">{formatAud(invoice.amountDueCents)}</span>
                        <span className="list-meta">Due {formatDate(invoice.dueDate)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {plan.closingInvoices.length > LIST_LIMIT ? <p className="t-caption">And {plan.closingInvoices.length - LIST_LIMIT} more.</p> : null}
              </section>
            ) : null}

            {words?.cancelled ? (
              <section aria-labelledby="cancelled-heading" className="notice stack-sm">
                <h3 className="t-subheading notice-title" id="cancelled-heading">
                  <CircleDashed size={20} strokeWidth={2} aria-hidden="true" />
                  {words.cancelled.heading}
                </h3>
                <p>{words.cancelled.explanation}</p>
                <ul className="list">
                  {plan.cancelledReminders.slice(0, LIST_LIMIT).map((reminder) => (
                    <li key={reminder.invoiceNumber} className="list-row">
                      <div className="list-main">
                        <p className="list-title">Invoice {reminder.invoiceNumber}</p>
                        <p className="list-meta">{reminder.clientName}</p>
                      </div>
                      <div className="list-end">
                        <span className="list-meta">{CANCELLED_BECAUSE[reminder.reason]}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {plan.cancelledReminders.length > LIST_LIMIT ? <p className="t-caption">And {plan.cancelledReminders.length - LIST_LIMIT} more.</p> : null}
              </section>
            ) : null}

            {plan.problems.length > 0 ? (
              <section aria-labelledby="problems-heading" className="notice notice-critical stack-sm">
                <h3 className="t-subheading notice-title" id="problems-heading">
                  <CircleAlert size={20} strokeWidth={2} aria-hidden="true" />
                  {plan.problems.length === 1 ? "1 row can't be imported" : `${plan.problems.length} rows can't be imported`}
                </h3>
                <p className="t-caption">Row numbers match your spreadsheet. Fix them there and import again; the other rows don't wait for them.</p>
                <ul className="problem-list">
                  {plan.problems.slice(0, 50).map((problem) => (
                    <li key={problem.row}>
                      <strong className="num">Row {problem.row}:</strong> <span>{problem.reason}</span>
                    </li>
                  ))}
                </ul>
                {plan.problems.length > 50 ? <p className="t-caption">And {plan.problems.length - 50} more.</p> : null}
              </section>
            ) : null}

            {/* Not a named region itself: the scrolling box below carries the heading's name, so it is said once. */}
            <section className="stack-sm">
              <h3 className="t-subheading" id="preview-heading">
                The first {Math.min(10, checked.length)} rows as we read them
              </h3>
              <SidewaysScroll labelledBy="preview-heading">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Client</th>
                      <th scope="col">Invoice</th>
                      <th scope="col">Issued</th>
                      <th scope="col">Due</th>
                      <th scope="col" className="num">
                        Amount due
                      </th>
                      <th scope="col">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checked.slice(0, 10).map((row) => (
                      <tr key={row.input.row}>
                        <td className="num">{row.input.row}</td>
                        <td>{row.client ?? '—'}</td>
                        <td>{row.invoiceNumber ?? '—'}</td>
                        <td>{row.issueDate ? formatDate(row.issueDate) : <span className="t-secondary">{row.input.issue_date || '—'} (not read)</span>}</td>
                        <td>{row.dueDate ? formatDate(row.dueDate) : <span className="t-secondary">{row.input.due_date || '—'} (not read)</span>}</td>
                        <td className="num">{row.amountCents !== null ? formatAud(row.amountCents) : '—'}</td>
                        <td>{row.email ?? <span className="t-secondary">No email</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SidewaysScroll>
            </section>

            <div className="stack-sm">
              {!online ? <Banner tone="warning">You're offline. Your place is saved.</Banner> : null}
              <div className="row-wrap">
                {safeFirst ? chooseAnother('primary') : null}
                <Button
                  key="import"
                  variant={safeFirst ? 'secondary' : 'primary'}
                  size="lg"
                  busy={busy === 'import'}
                  busyLabel="Importing…"
                  unavailable={plan.rowsSaved === 0 || !online}
                  aria-describedby={plan.rowsSaved === 0 ? 'nothing-to-import' : undefined}
                  onClick={() => void confirmImport(false)}
                >
                  Import {pluralise(plan.rowsSaved, 'invoice')}
                </Button>
                {safeFirst ? null : chooseAnother('secondary')}
              </div>
              {plan.rowsSaved === 0 ? (
                <p className="t-caption" id="nothing-to-import">
                  Fix the rows above in your spreadsheet, then choose the file again.
                </p>
              ) : null}
              <FormError message={confirmError} />
            </div>
          </section>
        )
      ) : null}

      {step === 'done' && result ? (
        <section className="summary-card import-done" aria-labelledby="done-heading" role="status">
          <IconTile icon={CircleCheck} tone="success" size="lg" />
          <h2 className="t-title" id="done-heading" ref={stepHeadingRef} tabIndex={-1}>
            Done
          </h2>
          <p>
            {listCounts([
              [result.invoices_added, 'added'],
              [result.invoices_updated, 'updated'],
              [result.invoices_reopened, 'reopened'],
              [result.invoices_closed, 'closed'],
              [result.drafts_cancelled, result.drafts_cancelled === 1 ? 'reminder cancelled' : 'reminders cancelled'],
            ]) || 'Nothing changed'}
            .
          </p>
          {result.rows_skipped > 0 ? (
            <p className="t-secondary">
              {pluralise(result.rows_skipped, 'row')} skipped, so {formatAud(result.saved_total_cents)} of the file's {formatAud(result.file_total_cents)} was saved.
            </p>
          ) : null}
          {result.invoices_kept_paid > 0 ? (
            <p className="t-secondary">
              {result.invoices_kept_paid === 1 ? '1 invoice you marked paid is still unpaid in Xero. It stays paid.' : `${result.invoices_kept_paid} invoices you marked paid are still unpaid in Xero. They stay paid.`}
            </p>
          ) : null}
          {/* Only changed invoices go under Needs attention; a closed invoice's reminder is simply cancelled. */}
          {result.drafts_cancelled > 0 && flagged > 0 ? (
            <p className="t-secondary">Invoices that changed while a reminder waited are under Needs attention on Home.</p>
          ) : null}
          <div className="stack-sm">
            <Link className="btn btn-primary btn-lg btn-block" to="">
              Back to Home
            </Link>
            <Button
              variant="quiet"
              onClick={() => {
                setFile(null);
                setResult(null);
                setStep('choose');
              }}
            >
              Import another file
            </Button>
          </div>
        </section>
      ) : null}

      <Sheet
        open={massClose !== null}
        onClose={() => setMassClose(null)}
        title="Check this is your full list"
        alert
        busy={busy === 'import'}
        initialFocus={safeRef}
        footer={
          <>
            <Button
              ref={safeRef}
              variant="primary"
              block
              unavailable={busy !== null}
              onClick={() => {
                setMassClose(null);
                setStep('choose');
              }}
            >
              Choose another file
            </Button>
            <Button variant="secondary" block busy={busy === 'import'} busyLabel="Importing…" onClick={() => void confirmImport(true)}>
              Close them anyway
            </Button>
          </>
        }
      >
        <p>{massClose}</p>
      </Sheet>
    </div>
  );
};
