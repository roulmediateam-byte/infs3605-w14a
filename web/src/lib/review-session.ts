// One review session (FR-14, FR-19): the queue as it stood when Review opened, what happened to each draft, and the
// counts for the summary and the review_session log. The count is fixed when the session starts, so it reads
// "3 of 5" after two decisions. A draft that leaves the queue during the session drops out with a note saying who
// decided it or that it was cancelled ("Linda approved 1 while you were reviewing"), and the count stays.
import type { CancelReason, DraftRecord, DraftStatus, QueueItem } from '../backend/types.ts';
import { listCounts, pluralise } from './words.ts';

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

/**
 * The end-of-review line: "All caught up: 3 sent, 1 rejected, 1 waiting to send" for someone who sends, or
 * "4 approved for Steve to send, 1 rejected" for a checker who may not (App Flow, Journeys 2 and 3).
 */
export const summaryLine = (counts: SessionCounts, sends: boolean, ownerFirstName: string): string => {
  if (sends) {
    const list = listCounts([
      [counts.sent, 'sent'],
      [counts.rejected, 'rejected'],
      [counts.notYet, 'waiting to send'],
      [counts.cancelled, 'cancelled'],
      [counts.elsewhere, 'decided by someone else'],
    ]);
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
