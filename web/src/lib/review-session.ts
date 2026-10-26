// One review session (FR-14, FR-19): the queue as it stood when Review opened, what happened to each draft, and the
// counts for the summary and the review_session log. The count is fixed when the session starts, so it reads
// "3 of 5" after two decisions. A draft that leaves the queue during the session drops out with a note saying who
// decided it or that it was cancelled ("Linda approved 1 while you were reviewing"), and the count stays.
import type { CancelReason, DraftRecord, DraftStatus, QueueItem } from '../backend/types.ts';
import { listCounts, pluralise, sendByLine, waitingForOwnerLine } from './words.ts';

/** Whether a draft left the queue while it was on screen (it explains itself in place) or while it wasn't (a note). */
export type Dropped = 'on-screen' | 'away';

export type Outcome =
  | { kind: 'approved'; edited: boolean }
  | { kind: 'sent'; edited: boolean }
  | { kind: 'not-yet'; edited: boolean }
  | { kind: 'rejected' }
  | { kind: 'cancelled'; reason: CancelReason; dropped?: Dropped }
  | { kind: 'elsewhere'; status: DraftStatus | null; by?: string | null; dropped?: Dropped }
  /** Left the queue during the session; its record is being read to say what happened. */
  | { kind: 'dropped'; dropped: Dropped }
  | { kind: 'gone' };

export interface ReviewState {
  started: boolean;
  order: string[];
  items: Record<string, QueueItem>;
  outcomes: Record<string, Outcome>;
  currentId: string | null;
  total: number;
}

export type ReviewAction =
  | { type: 'load'; queue: QueueItem[]; startAt?: string | null }
  | { type: 'outcome'; id: string; outcome: Outcome }
  | { type: 'resolve'; id: string; record: DraftRecord | null }
  | { type: 'select'; id: string }
  | { type: 'next' }
  | { type: 'previous' };

export const initialReview: ReviewState = {
  started: false,
  order: [],
  items: {},
  outcomes: {},
  currentId: null,
  total: 0,
};

/** What became of a draft that left the queue during the session, read from its record. */
export const resolveDropped = (record: DraftRecord | null, dropped: Dropped): Outcome => {
  if (!record) return { kind: 'gone' };
  switch (record.status) {
    case 'cancelled':
      return { kind: 'cancelled', reason: record.cancel_reason ?? 'superseded', dropped };
    case 'approved':
      return { kind: 'elsewhere', status: 'approved', by: record.approved_by, dropped };
    case 'sent':
      return { kind: 'elsewhere', status: 'sent', by: record.sent_confirmed_by ?? record.approved_by, dropped };
    case 'rejected':
      return { kind: 'elsewhere', status: 'rejected', by: record.rejected_by, dropped };
    default:
      return { kind: 'gone' };
  }
};

const undecided = (state: ReviewState): string[] => state.order.filter((id) => !state.outcomes[id]);

const nextAfter = (state: ReviewState, from: string | null, step: 1 | -1): string | null => {
  const open = undecided(state);
  if (open.length === 0) return null;
  const index = from ? state.order.indexOf(from) : -1;
  for (let i = 1; i <= state.order.length; i += 1) {
    const candidate = state.order[(index + step * i + state.order.length * 2) % state.order.length];
    if (candidate && !state.outcomes[candidate]) return candidate;
  }
  return open[0] ?? null;
};

export const reviewReducer = (state: ReviewState, action: ReviewAction): ReviewState => {
  switch (action.type) {
    case 'load': {
      const items = { ...state.items };
      for (const item of action.queue) items[item.draft_id] = item;
      if (!state.started) {
        const order = action.queue.map((item) => item.draft_id);
        const startAt = action.startAt && order.includes(action.startAt) ? action.startAt : (order[0] ?? null);
        return { ...state, started: true, order, items, currentId: startAt, total: order.length };
      }
      const inQueue = new Set(action.queue.map((item) => item.draft_id));
      const added = action.queue.map((item) => item.draft_id).filter((id) => !state.order.includes(id));
      const outcomes = { ...state.outcomes };
      for (const id of state.order) {
        if (!outcomes[id] && !inQueue.has(id)) outcomes[id] = { kind: 'dropped', dropped: id === state.currentId ? 'on-screen' : 'away' };
      }
      const order = [...state.order, ...added];
      const next = { ...state, order, items, outcomes, total: state.total + added.length };
      // An empty screen picks up drafts that arrived while the summary was showing.
      if (next.currentId === null && added.length > 0) next.currentId = added[0] ?? null;
      return next;
    }
    case 'outcome':
      return { ...state, outcomes: { ...state.outcomes, [action.id]: action.outcome } };
    case 'resolve': {
      const current = state.outcomes[action.id];
      if (current?.kind !== 'dropped') return state;
      return { ...state, outcomes: { ...state.outcomes, [action.id]: resolveDropped(action.record, current.dropped) } };
    }
    case 'select':
      return state.order.includes(action.id) ? { ...state, currentId: action.id } : state;
    case 'next':
      return { ...state, currentId: nextAfter(state, state.currentId, 1) };
    case 'previous':
      return { ...state, currentId: nextAfter(state, state.currentId, -1) };
    default:
      return state;
  }
};

/** "2 of 5": decisions already made, plus the draft on screen. */
export const position = (state: ReviewState): number =>
  Math.min(state.total, state.order.filter((id) => state.outcomes[id] && id !== state.currentId).length + 1);

export const remaining = (state: ReviewState): number => undecided(state).length;

export const doneCount = (state: ReviewState): number => state.order.filter((id) => state.outcomes[id]).length;

export interface SessionCounts {
  approved: number;
  edited: number;
  sent: number;
  notYet: number;
  rejected: number;
  cancelled: number;
  elsewhere: number;
  waiting: number;
}

export const sessionCounts = (state: ReviewState): SessionCounts => {
  const counts: SessionCounts = { approved: 0, edited: 0, sent: 0, notYet: 0, rejected: 0, cancelled: 0, elsewhere: 0, waiting: 0 };
  for (const id of state.order) {
    const outcome = state.outcomes[id];
    if (!outcome) counts.waiting += 1;
    else if (outcome.kind === 'approved' || outcome.kind === 'sent' || outcome.kind === 'not-yet') {
      counts.approved += 1;
      if (outcome.edited) counts.edited += 1;
      if (outcome.kind === 'sent') counts.sent += 1;
      else counts.notYet += 1;
    } else if (outcome.kind === 'rejected') counts.rejected += 1;
    else if (outcome.kind === 'cancelled') counts.cancelled += 1;
    else counts.elsewhere += 1;
  }
  return counts;
};

/** "3 sent, 1 rejected, 1 waiting to send": the session's counts for someone who sends. */
const sendersCounts = (counts: SessionCounts): string =>
  listCounts([
    [counts.sent, 'sent'],
    [counts.rejected, 'rejected'],
    [counts.notYet, 'waiting to send'],
    [counts.cancelled, 'cancelled'],
    [counts.elsewhere, 'decided by someone else'],
  ]);

/**
 * The end-of-review line: "All caught up: 3 sent, 1 rejected, 1 waiting to send" for someone who sends, or
 * "4 approved for Steve to send, 1 rejected" for a checker who may not (App Flow, Journeys 2 and 3).
 */
export const summaryLine = (counts: SessionCounts, sends: boolean, ownerFirstName: string): string => {
  if (sends) {
    const list = sendersCounts(counts);
    return list ? `All caught up: ${list}` : 'All caught up';
  }
  const list = listCounts([
    [counts.approved, `approved for ${ownerFirstName} to send`],
    [counts.rejected, 'rejected'],
    [counts.cancelled, 'cancelled'],
    [counts.elsewhere, 'decided by someone else'],
  ]);
  return list || 'All caught up';
};

// ---------------------------------------------------------------------------------------------
// Done means sent. Nothing says "All caught up" while an approved reminder is still unsent, because the brief's
// measure is that nobody believes a reminder went when it didn't (UI brief, What success looks like).
// ---------------------------------------------------------------------------------------------

/** Drafts approved in this session and not sent yet, in the session's order: "Not yet" and a closed Send sheet alike. */
export const unsentInSession = (state: ReviewState): string[] =>
  state.order.filter((id) => {
    const kind = state.outcomes[id]?.kind;
    return kind === 'approved' || kind === 'not-yet';
  });

/**
 * Every approved reminder still to send: this session's first, in its order, then any approved earlier or by
 * someone else (approvedIds, read from the database), less any sent from this screen that the database list
 * hasn't caught up with yet.
 */
export const stillToSend = (state: ReviewState, approvedIds: readonly string[]): string[] => {
  const session = unsentInSession(state);
  const sent = new Set(Object.keys(state.outcomes).filter((id) => state.outcomes[id]?.kind === 'sent'));
  return [...session, ...approvedIds.filter((id) => !sent.has(id) && !session.includes(id))];
};

/** Approved reminders in the order they are offered for sending: the largest first, as Review orders drafts. */
export const largestFirst = <T extends { id: string; amount_shown_cents: number }>(drafts: readonly T[]): T[] =>
  [...drafts].sort((a, b) => b.amount_shown_cents - a.amount_shown_cents || a.id.localeCompare(b.id));

/**
 * "Send the next one": the first reminder still to send, or, when the last one offered is still unsent (the person
 * said "Not yet" or closed the sheet), the one after it, so the same reminder isn't offered straight back.
 */
export const nextToSend = (ids: readonly string[], lastOffered: string | null): string | null => {
  if (ids.length === 0) return null;
  const at = lastOffered === null ? -1 : ids.indexOf(lastOffered);
  return ids[at === -1 ? 0 : (at + 1) % ids.length] ?? null;
};

export interface ReviewSummary {
  /** "2 reminders still to send", "All caught up: 3 sent, 1 rejected" or "4 approved for Steve to send, 1 rejected". */
  title: string;
  /** This session's counts, when the title doesn't carry them: "2 sent, 1 rejected, 2 waiting to send". */
  counts: string | null;
  /** What happens next, when something is still to send. */
  line: string | null;
}

/**
 * The end of a review (FR-19). For someone who sends, it says "All caught up" only when nothing approved is left
 * unsent; toSend counts every approved reminder still to send, or is null while that isn't known yet, when the
 * summary makes no claim either way. A checker who may not send is told who sends (D3).
 */
export const reviewSummary = (counts: SessionCounts, sends: boolean, ownerFirstName: string, toSend: number | null): ReviewSummary => {
  if (!sends) {
    return { title: summaryLine(counts, false, ownerFirstName), counts: null, line: counts.approved > 0 ? waitingForOwnerLine(ownerFirstName, counts.approved) : null };
  }
  const list = sendersCounts(counts);
  if (toSend === null) return { title: list || 'Nothing left to review', counts: null, line: null };
  if (toSend > 0) {
    return { title: `${pluralise(toSend, 'reminder')} still to send`, counts: list || null, line: `${sendByLine(toSend)} ${toSend === 1 ? 'It waits' : 'They wait'} under Ready to send on Home.` };
  }
  return { title: list ? `All caught up: ${list}` : 'All caught up', counts: null, line: null };
};

export type HomeCardKind = 'review' | 'send' | 'done' | 'unknown';

export interface HomeCard {
  kind: HomeCardKind;
  title: string;
  line: string;
}

/**
 * Home's decision card (UI-02), in three states: drafts waiting for review; otherwise approved reminders not sent
 * yet; otherwise all caught up. approved is null while the approved reminders haven't loaded, and then the card
 * claims nothing. ownerSends is false for a checker who may not send (D3): the owner sends.
 */
export const homeCard = ({
  waiting,
  approved,
  sends,
  ownerSends,
  ownerFirstName,
}: {
  waiting: number;
  approved: number | null;
  sends: boolean;
  ownerSends: boolean;
  ownerFirstName: string;
}): HomeCard => {
  if (waiting > 0) {
    return {
      kind: 'review',
      title: `${pluralise(waiting, 'draft')} ${waiting === 1 ? 'needs' : 'need'} your OK`,
      line: `Nothing is sent until ${ownerSends ? `you approve it and ${ownerFirstName} sends it` : 'you approve and send it'}.`,
    };
  }
  if (approved === null) return { kind: 'unknown', title: 'No drafts to review', line: 'Your apprentice drafts again on Sunday.' };
  if (approved > 0) {
    return {
      kind: 'send',
      title: `${pluralise(approved, 'reminder')} approved, not sent yet`,
      line: sends ? sendByLine(approved) : waitingForOwnerLine(ownerFirstName, approved),
    };
  }
  return { kind: 'done', title: 'All caught up', line: 'Your apprentice drafts again on Sunday.' };
};

const joinAnd = (parts: string[]): string => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/**
 * Notes for drafts that left the queue while the person was looking at others: "Linda approved 2 and rejected 1
 * while you were reviewing." (App Flow, Journey 2, proposed copy) and "1 draft was cancelled while you were reviewing."
 * nameOf turns a user id into a first name, or "you" for the person reviewing.
 */
export const droppedNotes = (state: ReviewState, nameOf: (userId: string | null) => string): string[] => {
  const people = new Map<string, { approved: number; sent: number; rejected: number }>();
  let cancelled = 0;
  for (const id of state.order) {
    const outcome = state.outcomes[id];
    if (!outcome || !('dropped' in outcome) || outcome.dropped !== 'away') continue;
    if (outcome.kind === 'cancelled') cancelled += 1;
    if (outcome.kind !== 'elsewhere') continue;
    const name = nameOf(outcome.by ?? null);
    const counts = people.get(name) ?? { approved: 0, sent: 0, rejected: 0 };
    if (outcome.status === 'rejected') counts.rejected += 1;
    else if (outcome.status === 'sent') counts.sent += 1;
    else counts.approved += 1;
    people.set(name, counts);
  }
  const notes = [...people.entries()].map(([name, counts]) => {
    const did = joinAnd(
      [
        [counts.approved, 'approved'],
        [counts.sent, 'sent'],
        [counts.rejected, 'rejected'],
      ]
        .filter(([count]) => (count as number) > 0)
        .map(([count, verb]) => `${verb as string} ${count as number}`),
    );
    return name === 'you' ? `You ${did} on another device while you were reviewing here.` : `${name.charAt(0).toUpperCase()}${name.slice(1)} ${did} while you were reviewing.`;
  });
  if (cancelled > 0) notes.push(`${pluralise(cancelled, 'draft')} ${cancelled === 1 ? 'was' : 'were'} cancelled while you were reviewing.`);
  return notes;
};
