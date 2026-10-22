// UI-03 Review (FR-14 to FR-19): one decision at a time. Review is a focused mode with its own progress and close
// button; on a computer the queue sits beside the draft. The server confirms each decision before the screen moves.
// Done means sent: the end of a review says "All caught up" only when no approved reminder is left unsent.
import { useQueryClient } from '@tanstack/react-query';
import { Ban, CircleCheck, CircleDashed, ScrollText, Send, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useMessages } from '../../app/messages.tsx';
import { useOnline } from '../../app/online.ts';
import { useAction, useBusinessRecord, useClients, useDraftRecord, useDrafts, useLastImport, useMembers, useQueue } from '../../app/queries.ts';
import { Link, navigate, useLocation } from '../../app/router.tsx';
import { useBackend, useBusiness } from '../../app/session.tsx';
import { screenEnabled } from '../../app/config.ts';
import type { DraftRecord, QueueItem, RejectReason } from '../../backend/types.ts';
import { formatAud } from '../../lib/money.ts';
import { formatTime } from '../../lib/dates.ts';
import {
  droppedNotes,
  initialReview,
  largestFirst,
  nextToSend,
  position,
  remaining,
  reviewReducer,
  reviewSummary,
  sessionCounts,
  stillToSend,
  unsentInSession,
  doneCount,
  type Outcome,
  type ReviewState,
} from '../../lib/review-session.ts';
import { KEYS, readItem } from '../../lib/storage.ts';
import { CANCEL_REASON, CANCELLED_IN_PLACE, firstName, NOT_SENT_YET, pluralise, sendByLine, sentLeftToSend, waitingForOwnerLine } from '../../lib/words.ts';
import { Banner, Button, Chip, FormError, IconTile, PageTitle, Skeleton } from '../../ui/controls.tsx';
import type { ChipTone } from '../../lib/words.ts';
import { useInsetRef } from '../../ui/insets.ts';
import { NoData } from '../../ui/QueryState.tsx';
import { InvoiceSheet } from '../invoices/InvoiceSheet.tsx';
import { DraftWords, LockedFacts, WhoAndHow, WhyThisDraft, draftHeading } from './DraftView.tsx';
import { EditDraft } from './EditDraft.tsx';
import { RejectSheet } from './RejectSheet.tsx';
import { SendSheet, type SendRefusal } from './SendSheet.tsx';
import { useReviewClock } from './useReviewClock.ts';

const DEEP_LINK_NOTE: Record<string, string> = {
  approved: 'That draft was already approved.',
  sent: 'That draft was already sent.',
  rejected: 'That draft was already rejected.',
};

const describeDecision = (record: DraftRecord, name: (userId: string | null) => string): string => {
  if (record.status === 'cancelled') return `Cancelled: ${CANCEL_REASON[record.cancel_reason ?? 'superseded']}.`;
  if (record.status === 'rejected') return `Already rejected by ${name(record.rejected_by)}${record.rejected_at ? ` at ${formatTime(record.rejected_at)}` : ''}.`;
  if (record.status === 'sent') return `Already sent by ${name(record.sent_confirmed_by)}${record.sent_confirmed_at ? ` at ${formatTime(record.sent_confirmed_at)}` : ''}.`;
  return `Already approved by ${name(record.approved_by)}${record.approved_at ? ` at ${formatTime(record.approved_at)}` : ''}.`;
};

const outcomeLabel = (outcome: Outcome | undefined, sends: boolean, owner: string, nameOf: (userId: string | null) => string): string => {
  if (!outcome) return 'To review';
  switch (outcome.kind) {
    case 'approved':
    case 'not-yet':
      return sends ? 'Ready to send' : `Approved, ${owner} sends`;
    case 'sent':
      return 'Sent';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
    case 'elsewhere': {
      if (!outcome.by) return 'Decided elsewhere';
      const who = nameOf(outcome.by);
      const name = who === 'you' ? 'you' : who;
      return outcome.status === 'rejected' ? `Rejected by ${name}` : outcome.status === 'sent' ? `Sent by ${name}` : `Approved by ${name}`;
    }
    case 'dropped':
      return 'No longer waiting';
    default:
      return 'No longer available';
  }
};

/** The queue's chips in their tones: the apprentice's violet to review, blue approved, green sent, slate otherwise. */
const outcomeTone = (outcome: Outcome | undefined): ChipTone => {
  if (!outcome) return 'apprentice';
  switch (outcome.kind) {
    case 'approved':
    case 'not-yet':
      return 'ready';
    case 'sent':
      return 'paid';
    case 'elsewhere':
      return outcome.status === 'rejected' ? 'neutral' : outcome.status === 'sent' ? 'paid' : 'ready';
    default:
      return 'neutral';
  }
};

/** Neutral outcomes keep a shape of their own: a no-entry sign for rejected, a broken circle for cancelled or gone. */
const outcomeIcon = (outcome: Outcome | undefined): LucideIcon | undefined => {
  if (outcome?.kind === 'rejected' || (outcome?.kind === 'elsewhere' && outcome.status === 'rejected')) return Ban;
  if (outcome?.kind === 'cancelled' || outcome?.kind === 'dropped' || outcome?.kind === 'gone') return CircleDashed;
  return undefined;
};

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const ReviewScreen = () => {
  const location = useLocation();
  const startAt = location.params.get('draft');
  const { role, businessId, user } = useBusiness();
  const backend = useBackend();
  const queryClient = useQueryClient();
  const queue = useQueue();
  const business = useBusinessRecord();
  const members = useMembers();
  const clients = useClients();
  const approvedDrafts = useDrafts(['approved']);
  const lastImport = useLastImport();
  const { run, busy } = useAction();
  const { show, announce } = useMessages();
  const online = useOnline();
  const seconds = useReviewClock();

  const [state, dispatch] = useReducer(reviewReducer, initialReview);
  const stateRef = useRef<ReviewState>(state);
  stateRef.current = state;
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [sendDraftId, setSendDraftId] = useState<string | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const regionRef = useRef<HTMLElement>(null);
  const endTitleRef = useRef<HTMLHeadingElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const backFromEdit = useRef(false);
  const logged = useRef(false);
  const firstDraft = useRef(true);
  const resolving = useRef(new Set<string>());
  /** The reminder "Send the next one" offered last, so the one after it comes next if it is still unsent. */
  const lastOffered = useRef<string | null>(null);
  const topInset = useInsetRef('top');
  const bottomInset = useInsetRef('bottom');
  // The session starts from the queue as it is now, never from a copy cached before Review opened: an import or a
  // payment since then may have cancelled drafts, which must not read as "decided by someone else" (App Flow, Journey 2).
  const openedAt = useRef(Date.now());
  const fresh = queue.data !== undefined && queue.dataUpdatedAt >= openedAt.current;

  const ownerFirst = firstName(business.data?.owner_name ?? 'the owner');
  const sends = role === 'owner' || (role === 'checker' && Boolean(business.data?.checker_may_send));
  const canDecide = role === 'owner' || role === 'checker';
  const shortcuts = readItem(KEYS.shortcuts) === 'on';

  useEffect(() => {
    if (!queue.data || (!stateRef.current.started && !fresh)) return;
    dispatch({ type: 'load', queue: queue.data, startAt });
    // startAt only matters for the first load of the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.data, fresh]);

  // A draft that left the queue during the session: read its record to say who decided it, or why it was cancelled.
  useEffect(() => {
    for (const id of state.order) {
      if (state.outcomes[id]?.kind !== 'dropped' || resolving.current.has(id)) continue;
      resolving.current.add(id);
      void queryClient
        .fetchQuery({ queryKey: ['b', businessId, 'draft', id], queryFn: () => backend.draft(id), staleTime: 0 })
        .then(
          (record) => dispatch({ type: 'resolve', id, record }),
          () => undefined, // Offline or unreachable: it stays "no longer waiting" until the next refresh.
        )
        .finally(() => resolving.current.delete(id));
    }
  }, [state.order, state.outcomes, queryClient, backend, businessId]);

  // A deep link to a draft that is no longer waiting: open at the next one and say why (App Flow, Edge cases).
  const linkedMissing = Boolean(startAt && state.started && !state.order.includes(startAt));
  const linkedRecord = useDraftRecord(linkedMissing ? startAt : null);
  const deepLinkNote = useMemo(() => {
    if (!linkedMissing || linkedRecord.isLoading) return null;
    const record = linkedRecord.data;
    if (!record) return 'That draft is no longer available.';
    if (record.status === 'cancelled') return `That draft was cancelled: ${CANCEL_REASON[record.cancel_reason ?? 'superseded']}.`;
    return DEEP_LINK_NOTE[record.status] ?? null;
  }, [linkedMissing, linkedRecord.isLoading, linkedRecord.data]);

  const nameOf = useCallback(
    (userId: string | null): string => {
      if (!userId) return 'someone';
      if (userId === user.id) return 'you';
      return firstName(members.data?.find((m) => m.user_id === userId)?.display_name ?? 'someone');
    },
    [members.data, user.id],
  );

  const currentId = state.currentId;
  const latest = useMemo(() => new Map((queue.data ?? []).map((item) => [item.draft_id, item])), [queue.data]);
  const item: QueueItem | null = currentId ? (latest.get(currentId) ?? state.items[currentId] ?? null) : null;
  const outcome = currentId ? state.outcomes[currentId] : undefined;
  const elsewhereRecord = useDraftRecord((outcome?.kind === 'elsewhere' || outcome?.kind === 'dropped') && currentId ? currentId : null);
  // Once approved, the words on screen are the frozen text from the record, so an edit shows as saved (UI brief, Review).
  const approvedHere = outcome?.kind === 'approved' || outcome?.kind === 'sent' || outcome?.kind === 'not-yet';
  const approvedRecord = useDraftRecord(approvedHere && currentId ? currentId : null);
  const contact = item ? clients.data?.find((client) => client.id === item.client_id)?.contact_name : null;

  // Every approved reminder still to send: this session's, then any approved before it or by someone else. Null
  // while the database's list is still loading and this session has none of its own.
  const approvedIds = approvedDrafts.data ? largestFirst(approvedDrafts.data).map((draft) => draft.id) : null;
  const sessionUnsent = unsentInSession(state);
  const toSend = approvedIds ? stillToSend(state, approvedIds) : sessionUnsent.length > 0 ? sessionUnsent : null;

  // Moving on to another draft starts at the top of the page, with the client's name in view, and focus on the new
  // draft (WCAG 2.4.3); the end of the review does the same with its title. Not on first arrival.
  useEffect(() => {
    if (!currentId) {
      if (!firstDraft.current && stateRef.current.total > 0) {
        window.scrollTo({ top: 0 });
        endTitleRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (firstDraft.current) {
      firstDraft.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    regionRef.current?.focus({ preventScroll: true });
  }, [currentId]);

  // After a send from the end of the review, focus stays put unless the button it came from has gone.
  useEffect(() => {
    if (sendDraftId !== null || !stateRef.current.started || stateRef.current.currentId !== null) return;
    if (document.activeElement === null || document.activeElement === document.body) endTitleRef.current?.focus({ preventScroll: true });
  }, [sendDraftId]);

  // Leaving the editor without saving puts focus back on Edit (WCAG 2.4.3).
  useEffect(() => {
    if (mode !== 'view' || !backFromEdit.current) return;
    backFromEdit.current = false;
    editButtonRef.current?.focus();
  }, [mode]);

  const logSession = useCallback(() => {
    const s = stateRef.current;
    if (logged.current || !canDecide) return;
    const counts = sessionCounts(s);
    if (doneCount(s) === 0 && seconds() < 10) return;
    logged.current = true;
    void backend
      .logReviewSession(businessId, {
        approved: counts.approved,
        edited: counts.edited,
        rejected: counts.rejected,
        sent: counts.sent,
        not_yet: counts.notYet,
        waiting: counts.waiting,
        seconds: seconds(),
      })
      .catch(() => {
        // The session record is a measure, not a step the person waits for.
      });
  }, [backend, businessId, canDecide, seconds]);

  // Review is a focused mode: messages move above its action bar (styles.css, review-mode).
  useEffect(() => {
    document.documentElement.classList.add('review-mode');
    return () => document.documentElement.classList.remove('review-mode');
  }, []);

  // Closing Review early logs a session too (FR-19).
  useEffect(() => () => logSession(), [logSession]);

  const finished = state.started && state.total > 0 && currentId === null;
  useEffect(() => {
    if (finished) logSession();
  }, [finished, logSession]);

  const left = (afterId: string | null): number => stateRef.current.order.filter((id) => !stateRef.current.outcomes[id] && id !== afterId).length;

  const advance = () => {
    setActionError(null);
    dispatch({ type: 'next' });
  };

  /** "Send the next one" and "Send them": the next reminder still to send, not the one just put off. */
  const sendNext = () => {
    const id = nextToSend(toSend ?? [], lastOffered.current);
    if (!id) return;
    lastOffered.current = id;
    setSendDraftId(id);
  };

  const approve = async (edit?: { subject: string; body: string }) => {
    if (!item || !canDecide) return;
    const id = item.draft_id;
    setActionError(null);
    const result = await run(edit ? 'save' : 'approve', () => backend.approveDraft(id, edit));
    if (!result.ok) {
      if (edit && result.error.kind === 'rule') {
        setEditError(result.error.message);
        return;
      }
      if (result.error.kind === 'not-found') {
        setMode('view');
        dispatch({ type: 'outcome', id, outcome: { kind: 'gone' } });
        return;
      }
      setActionError(result.error.message);
      return;
    }
    setMode('view');
    setEditError(null);
    const value = result.value;
    if (value.status === 'approved' && value.changed) {
      dispatch({ type: 'outcome', id, outcome: { kind: 'approved', edited: value.edited } });
      if (sends) {
        // The Send sheet that rises next says what to do, so the confirmation is spoken rather than laid over it.
        announce('Approved. Now send it from your email.');
        setSendDraftId(id);
      } else {
        show({ text: `Approved. ${ownerFirst} sends it.` });
        announce(`${pluralise(left(id), 'draft')} left.`);
        advance();
      }
    } else if (value.status === 'cancelled' && value.changed) {
      dispatch({ type: 'outcome', id, outcome: { kind: 'cancelled', reason: value.reason } });
      announce(CANCELLED_IN_PLACE[value.reason]);
    } else {
      // Decided or cancelled before this approval arrived: its record says by whom, or why (App Flow, Journey 2).
      dispatch({ type: 'outcome', id, outcome: { kind: 'dropped', dropped: 'on-screen' } });
    }
  };

  const reject = async (reason: RejectReason, note: string) => {
    if (!item) return;
    const id = item.draft_id;
    const result = await run('reject', () => backend.rejectDraft(id, reason, note || undefined));
    if (!result.ok) {
      setRejectError(result.error.message);
      return;
    }
    setRejectOpen(false);
    setRejectError(null);
    if (result.value.changed) {
      dispatch({ type: 'outcome', id, outcome: { kind: 'rejected' } });
      const n = left(id);
      show({ text: `Rejected. ${n === 0 ? 'None' : n} left.` });
      advance();
    } else {
      dispatch({ type: 'outcome', id, outcome: { kind: 'dropped', dropped: 'on-screen' } });
    }
  };

  const sendDone = (result: 'sent' | 'not-yet', id: string) => {
    setSendDraftId(null);
    const s = stateRef.current;
    const previous = s.outcomes[id];
    const edited = previous && 'edited' in previous ? previous.edited : false;
    // Reminders approved before this session are recorded too, so the end of the review counts them out once sent.
    dispatch({ type: 'outcome', id, outcome: { kind: result === 'sent' ? 'sent' : 'not-yet', edited } });
    if (result === 'not-yet') show({ text: NOT_SENT_YET, tone: 'info' });
    else if (id === s.currentId) {
      const n = left(id);
      show({ text: `Sent. ${n === 0 ? 'None' : n} left.` });
    } else show({ text: sentLeftToSend((toSend ?? []).filter((other) => other !== id).length) });
    if (id === s.currentId) advance();
  };

  // Closed without an answer: the sheet has said "Not sent yet…". A refusal means the reminder was sent, held back
  // or cancelled somewhere else, so its record is read again and the screen says what happened.
  const closeSend = (refused?: SendRefusal) => {
    const id = sendDraftId;
    setSendDraftId(null);
    if (!id) return;
    const s = stateRef.current;
    if (refused) {
      if (s.order.includes(id)) dispatch({ type: 'outcome', id, outcome: { kind: 'dropped', dropped: id === s.currentId ? 'on-screen' : 'away' } });
      return;
    }
    if (id === s.currentId) advance();
  };

  const close = () => {
    logSession();
    navigate('');
  };

  // Keyboard shortcuts, off until turned on under More (WCAG 2.1.4). Nothing fires in a text field or a sheet.
  useEffect(() => {
    if (!shortcuts || mode !== 'view') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || document.querySelector('dialog[open]')) return;
      const s = stateRef.current;
      const undecided = s.currentId !== null && !s.outcomes[s.currentId];
      if (event.key === 'A' && event.shiftKey && undecided && canDecide) {
        event.preventDefault();
        void approve();
      } else if (event.key.toLowerCase() === 'e' && !event.shiftKey && undecided && canDecide) {
        event.preventDefault();
        setMode('edit');
      } else if (event.key.toLowerCase() === 'r' && !event.shiftKey && undecided && canDecide) {
        event.preventDefault();
        setRejectOpen(true);
      } else if (event.key.toLowerCase() === 'j' && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: 'next' });
      } else if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: 'previous' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (mode === 'edit' && item) {
    return (
      <EditDraft
        item={item}
        busy={busy === 'save'}
        serverError={editError}
        onCancel={() => {
          backFromEdit.current = true;
          setEditError(null);
          setMode('view');
        }}
        onSave={(subject, body) => void approve({ subject, body })}
      />
    );
  }

  const total = state.total;
  const pos = position(state);
  // Empty until the queue has loaded, so the bar never starts full and runs backwards.
  const percent = state.started && total > 0 ? Math.round((doneCount(state) / total) * 100) : 0;
  const counts = sessionCounts(state);

  const topBar = (
    <header className="review-top" ref={topInset}>
      <div className="review-top-inner">
        <button type="button" className="icon-button" aria-label="Close review" onClick={close}>
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {total > 0 && currentId ? (
          <span className="progress-count">
            {pos} of {total}
          </span>
        ) : null}
        <div className="progress-bar" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </header>
  );

  const notes = [deepLinkNote, ...droppedNotes(state, nameOf)].filter((note): note is string => Boolean(note));

  const endButtons = (sendLabel: string | null) => (
    <div className="stack-sm">
      {sendLabel ? (
        <>
          <Button variant="primary" size="lg" block onClick={sendNext}>
            {sendLabel}
          </Button>
          <Button variant="secondary" size="lg" block onClick={close}>
            Back to Home
          </Button>
        </>
      ) : (
        <Button variant="primary" size="lg" block onClick={close}>
          Back to Home
        </Button>
      )}
      <Link className="btn btn-quiet" to="log">
        <ScrollText size={16} strokeWidth={2} aria-hidden="true" />
        See what happened
      </Link>
    </div>
  );

  let body;
  let actions = null;
  if (!state.started) {
    // Loading, offline before the drafts arrived, or failed: never the empty "All caught up".
    body = (
      <NoData
        query={queue}
        errorMessage={queue.error instanceof Error ? queue.error.message : 'The drafts could not be loaded.'}
        loading={
          <div className="stack" role="status" aria-label="Loading the drafts">
            <Skeleton width="50%" height={24} />
            <Skeleton height={72} />
            <Skeleton height={20} />
            <Skeleton height={20} />
            <Skeleton height={20} />
            <Skeleton width="70%" height={20} />
          </div>
        }
      />
    );
  } else if (!item && total === 0) {
    // Nothing waiting for review. It is all caught up only if no approved reminder is waiting to send either.
    const waitingToSend = toSend?.length ?? 0;
    body =
      toSend === null && approvedDrafts.isLoading ? (
        <div className="stack-sm" role="status" aria-label="Checking for reminders still to send">
          <Skeleton width="60%" height={28} />
          <Skeleton height={48} />
        </div>
      ) : (
        <div className="summary-card" role="status">
          {waitingToSend > 0 ? <IconTile icon={Send} tone="ready" size="lg" /> : <IconTile icon={CircleCheck} tone="success" size="lg" />}
          <h2 className="t-title" ref={endTitleRef} tabIndex={-1}>
            {waitingToSend > 0
              ? sends
                ? `${pluralise(waitingToSend, 'reminder')} still to send`
                : `${pluralise(waitingToSend, 'reminder')} approved, not sent yet`
              : toSend === null
                ? 'Nothing to review'
                : 'All caught up'}
          </h2>
          <p>
            Nothing is waiting for review.{' '}
            {waitingToSend > 0 ? (sends ? sendByLine(waitingToSend) : waitingForOwnerLine(ownerFirst, waitingToSend)) : 'Your apprentice drafts again on Sunday.'}
          </p>
          {endButtons(waitingToSend > 0 && sends ? 'Send them' : null)}
        </div>
      );
  } else if (!item) {
    const summary = reviewSummary(counts, sends, ownerFirst, toSend === null ? null : toSend.length);
    body = (
      <div className="summary-card" role="status">
        {sends && toSend !== null && toSend.length > 0 ? <IconTile icon={Send} tone="ready" size="lg" /> : <IconTile icon={CircleCheck} tone="success" size="lg" />}
        <h2 className="t-title" ref={endTitleRef} tabIndex={-1}>
          {summary.title}
        </h2>
        {summary.counts ? <p>{summary.counts}</p> : null}
        {summary.line ? <p className="t-secondary">{summary.line}</p> : null}
        {endButtons(sends && toSend !== null && toSend.length > 0 ? 'Send the next one' : null)}
      </div>
    );
  } else {
    const panel =
      outcome?.kind === 'cancelled'
        ? CANCELLED_IN_PLACE[outcome.reason]
        : outcome?.kind === 'elsewhere'
          ? elsewhereRecord.data
            ? describeDecision(elsewhereRecord.data, nameOf)
            : 'Someone else decided this draft.'
          : outcome?.kind === 'dropped'
            ? 'This draft is no longer waiting.'
            : outcome?.kind === 'gone'
              ? 'This item is no longer available.'
              : null;
    const frozen = approvedRecord.data?.final_body ? approvedRecord.data : null;
    const showEdited = approvedHere && outcome && 'edited' in outcome && outcome.edited && !frozen;
    body = (
      <section ref={regionRef} tabIndex={-1} aria-label={draftHeading(item)} className="stack slide-in" key={item.draft_id} style={{ outline: 'none' }}>
        <WhoAndHow item={item} contactName={contact} />
        <LockedFacts
          item={item}
          onOpenInvoice={screenEnabled('invoices') ? () => setInvoiceOpen(item.invoice_id) : undefined}
          importedAt={lastImport.data?.uploaded_at ?? null}
        />
        {panel ? (
          <div className="note" role="status">
            <p className="list-title">{panel}</p>
            {outcome?.kind === 'cancelled' && ['amount_changed', 'due_date_changed', 'email_missing'].includes(outcome.reason) ? (
              <p className="t-caption">A new draft comes on Sunday if the invoice is still overdue.</p>
            ) : null}
          </div>
        ) : null}
        {showEdited ? (
          <div className="stack-sm" role="status" aria-label="Loading the approved text">
            <Skeleton width="60%" height={20} />
            <Skeleton height={96} />
          </div>
        ) : (
          <DraftWords subject={frozen?.final_subject ?? item.subject} body={frozen?.final_body ?? item.body} approved={approvedHere} />
        )}
        {!panel ? <WhyThisDraft item={item} cooldownDays={business.data?.cooldown_days ?? 6} /> : null}
      </section>
    );
    if (panel || outcome) {
      actions = (
        <Button variant="primary" size="lg" block onClick={advance}>
          {remaining(state) > 0 ? 'Next draft' : 'See the summary'}
        </Button>
      );
    } else if (!canDecide) {
      actions = <p className="t-secondary">Team admins can read drafts but not approve, edit or reject them.</p>;
    } else {
      actions = (
        <>
          {!online ? <Banner tone="warning">You're offline. Your place is saved.</Banner> : null}
          <p className="consequence t-caption">
            {sends
              ? item.client_email
                ? `Approving lets you send this to ${item.client_email} from your own email.`
                : 'Approving lets you send this from your own email.'
              : `Approving hands this to ${ownerFirst} to send.`}
          </p>
          <Button variant="primary" size="lg" block busy={busy === 'approve'} busyLabel="Approving…" unavailable={!online || busy !== null} onClick={() => void approve()}>
            Approve
          </Button>
          <div className="action-pair">
            <Button ref={editButtonRef} variant="secondary" size="lg" unavailable={!online || busy !== null} onClick={() => setMode('edit')}>
              Edit
            </Button>
            <Button
              variant="secondary"
              size="lg"
              unavailable={!online || busy !== null}
              onClick={() => {
                setRejectError(null);
                setRejectOpen(true);
              }}
            >
              Reject
            </Button>
          </div>
          <FormError message={actionError} />
        </>
      );
    }
  }

  return (
    <div className="review">
      {topBar}
      <div className="review-split">
        <nav className="review-queue" aria-label="Drafts in this review">
          <ul className="stack-sm">
            {state.order.map((id) => {
              const entry = latest.get(id) ?? state.items[id];
              if (!entry) return null;
              const result = state.outcomes[id];
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="queue-item"
                    aria-current={id === currentId ? 'true' : undefined}
                    onClick={() => (!result ? dispatch({ type: 'select', id }) : undefined)}
                    aria-disabled={result ? true : undefined}
                  >
                    <span className="list-title">{entry.client_name}</span>
                    <span className="spread">
                      <span className="list-meta num">
                        Invoice {entry.invoice_number} · {formatAud(entry.amount_due_cents)}
                      </span>
                    </span>
                    <Chip tone={outcomeTone(result)} icon={outcomeIcon(result)}>
                      {outcomeLabel(result, sends, ownerFirst, nameOf)}
                    </Chip>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="review-col">
          <main className="review-body stack" id="main">
            <PageTitle documentTitle={total > 0 && currentId ? `Review ${pos} of ${total}` : 'Review'} className="visually-hidden">
              Review drafts
            </PageTitle>
            {notes.map((note) => (
              <Banner key={note}>{note}</Banner>
            ))}
            {body}
          </main>
          {actions ? (
            <footer className="action-bar" ref={bottomInset}>
              <div className="action-bar-inner">{actions}</div>
            </footer>
          ) : null}
        </div>
      </div>
      {item ? (
        <RejectSheet
          key={item.draft_id}
          open={rejectOpen}
          invoiceNumber={item.invoice_number}
          busy={busy === 'reject'}
          serverError={rejectError}
          onClose={() => setRejectOpen(false)}
          onReject={(reason, note) => void reject(reason, note)}
        />
      ) : null}
      {sendDraftId ? <SendSheet draftId={sendDraftId} onClose={closeSend} onDone={sendDone} /> : null}
      {invoiceOpen ? <InvoiceSheet invoiceId={invoiceOpen} onClose={() => setInvoiceOpen(null)} /> : null}
    </div>
  );
};
