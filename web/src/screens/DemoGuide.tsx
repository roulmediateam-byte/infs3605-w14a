// "Try the Week 7 demo", a card for Home with the three steps of the Week 7 demonstration: in the preview, and in the
// demonstration build for the owner of a Test data business (config.demoTools). Each step ticks off from the
// business's own records (the activity log), never from anything the other screens remember, so it is right after a
// reload, and for the owner and the checker alike. "Hide this" is remembered on this device.
//
// Mount it on Home with no props: <DemoGuide />. It needs the app's providers, which Home already has, and renders
// nothing in other builds, for a team admin, or once hidden.
import { useQuery } from '@tanstack/react-query';
import { Check, FlaskConical } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { config } from '../app/config.ts';
import { useMessages } from '../app/messages.tsx';
import { Link } from '../app/router.tsx';
import { useBackend, useBusiness } from '../app/session.tsx';
import { PREVIEW_KEYS } from '../backend/preview-store.ts';
import type { LogEntry } from '../lib/activity.ts';
import { readItem, writeItem } from '../lib/storage.ts';
import { IconTile } from '../ui/controls.tsx';
import { useLiveDemoTools, useRunDrafting } from './More.tsx';
import './DemoGuide.css';

export interface DemoProgress {
  imported: boolean;
  drafted: boolean;
  reviewed: boolean;
}

const DECISIONS: ReadonlySet<LogEntry['action']> = new Set<LogEntry['action']>(['draft_approved', 'draft_rejected', 'reminder_sent']);

/**
 * Which demo steps are done, from activity log entries in any order:
 *   1. someone imported a file (the seed's own invoices come without an import entry);
 *   2. a drafting run finished after that first import, so the seed's own run doesn't count;
 *   3. someone approved, rejected or sent a reminder after that run.
 * The log only grows, so a step that is done stays done.
 */
export const demoProgress = (entries: readonly LogEntry[]): DemoProgress => {
  const inOrder = [...entries].sort((a, b) => a.id - b.id);
  const imported = inOrder.find((entry) => entry.action === 'import_completed' && entry.actor_role !== 'system');
  const drafted = imported ? inOrder.find((entry) => entry.action === 'weekly_run_completed' && entry.id > imported.id) : undefined;
  const reviewed = drafted
    ? inOrder.find((entry) => DECISIONS.has(entry.action) && entry.actor_role !== 'system' && entry.id > drafted.id)
    : undefined;
  return { imported: Boolean(imported), drafted: Boolean(drafted), reviewed: Boolean(reviewed) };
};

/** How much of the log the guide reads. A demo writes a few dozen entries. */
const LOG_LIMIT = 500;

const NOTHING_DONE: DemoProgress = { imported: false, drafted: false, reviewed: false };

/** The card, in the preview build and the demonstration build only. */
export const DemoGuide = () => (import.meta.env.VITE_BACKEND === 'preview' || config.demoTools ? <DemoGuideCard /> : null);

const DemoGuideCard = () => {
  const backend = useBackend();
  const { businessId, role } = useBusiness();
  const { show } = useMessages();
  const drafting = useRunDrafting();
  const liveDemo = useLiveDemoTools();
  const [hidden, setHidden] = useState(() => readItem(PREVIEW_KEYS.demoGuideHidden) === 'yes');
  const shown = ((Boolean(backend.preview) && role !== 'admin') || liveDemo) && !hidden;
  // Read again each time the card appears (Review's decisions don't refresh other screens' data), and after any change
  // made through the app's actions, which refresh everything under the business's key.
  const progress = useQuery({
    queryKey: ['b', businessId, 'demo-guide'],
    queryFn: async () => demoProgress(await backend.activity(businessId, { limit: LOG_LIMIT })),
    enabled: shown,
    staleTime: 0,
  });
  // Nothing until the log has been read, rather than a moment of "0 of 3" that isn't true. If it can't be read, the
  // steps show without ticks.
  if (!shown || (progress.data === undefined && !progress.isError)) return null;

  const done = progress.data ?? NOTHING_DONE;

  const hide = () => {
    // readItem and writeItem catch storage errors: without storage the card stays hidden until the page reloads.
    writeItem(PREVIEW_KEYS.demoGuideHidden, 'yes');
    setHidden(true);
    // The button goes with the card, so focus moves to the page's title.
    document.querySelector<HTMLElement>('#main h1')?.focus({ preventScroll: true });
    show({
      text: 'Demo guide hidden.',
      tone: 'info',
      action: {
        label: 'Undo',
        run: () => {
          writeItem(PREVIEW_KEYS.demoGuideHidden, null);
          setHidden(false);
        },
      },
    });
  };

  const steps: { key: string; done: boolean; action: ReactNode }[] = [
    {
      key: 'import',
      done: done.imported,
      action: (
        <Link className="demo-step-action" to="import">
          Import the Week 7 file
        </Link>
      ),
    },
    {
      key: 'draft',
      done: done.drafted,
      action: (
        <button
          type="button"
          className="demo-step-action"
          aria-busy={drafting.busy || undefined}
          aria-disabled={drafting.busy || undefined}
          onClick={() => {
            if (!drafting.busy) drafting.runNow();
          }}
        >
          {drafting.busy ? (
            <>
              <span className="spinner" aria-hidden="true" /> Drafting…
            </>
          ) : (
            "Run Sunday's drafting"
          )}
        </button>
      ),
    },
    {
      key: 'review',
      done: done.reviewed,
      action: (
        <Link className="demo-step-action" to="review">
          Review the drafts
        </Link>
      ),
    },
  ];
  const count = steps.filter((step) => step.done).length;
  const next = steps.findIndex((step) => !step.done);

  return (
    <section className="card demo-guide" aria-labelledby="demo-guide-title">
      <div className="demo-guide-head">
        <h2 className="t-heading" id="demo-guide-title">
          <IconTile icon={FlaskConical} tone="info" size="sm" />
          Try the Week 7 demo
        </h2>
        <button type="button" className="btn btn-quiet" onClick={hide}>
          Hide this
        </button>
      </div>
      <p className="t-secondary">Your apprentice is the helper that drafts reminders for you. It never sends anything.</p>
      {/* role="list" keeps the list's meaning for screen readers, which drop it when list markers are hidden. */}
      <ol className="demo-steps" role="list">
        {steps.map((step, index) => (
          <li key={step.key} className={`demo-step${step.done ? ' is-done' : ''}`}>
            <span className="demo-step-mark" aria-hidden="true">
              {step.done ? <Check size={16} strokeWidth={2.5} /> : index + 1}
            </span>
            {step.action}
            {step.done ? <span className="demo-step-state">Done</span> : null}
            {index === next ? <span className="demo-step-state demo-step-next">Next</span> : null}
          </li>
        ))}
      </ol>
      <p className="t-caption" role="status">
        {count === steps.length ? 'All 3 steps done.' : `${count} of 3 steps done.`}
      </p>
    </section>
  );
};
