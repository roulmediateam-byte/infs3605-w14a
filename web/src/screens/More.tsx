// More: Import, Activity log, Settings (owner), Contact the team, Keyboard shortcuts (on a computer) and Sign out.
// "Contact the team" sits in the same place on every screen's More (WCAG 3.2.6) and sends the business's code only.
// The preview adds Sunday's drafting run at the top, the demo's key step, and "Reset demo data" at the bottom. The
// demonstration build adds the same drafting run for the owner of a Test data business (config.demoTools).
import { Building2, ChevronRight, FlaskConical, Keyboard, LogOut, MessageCircle, RotateCcw, ScrollText, Settings, Upload } from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { config, screenEnabled } from '../app/config.ts';
import { useMessages } from '../app/messages.tsx';
import { useAction, useBusinessRecord } from '../app/queries.ts';
import { Link } from '../app/router.tsx';
import { useBackend, useBusiness, useSession } from '../app/session.tsx';
import { KEYS, readItem, writeItem } from '../lib/storage.ts';
import { Button, IconTile, PageTitle } from '../ui/controls.tsx';
import { Sheet } from '../ui/Sheet.tsx';

const desktopQuery = '(hover: hover) and (pointer: fine)';
const subscribeDesktop = (listener: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};

/** A short code that identifies the business to the team without naming anyone (NFR-04). */
export const businessCode = (businessId: string): string => businessId.replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * "Run it now", Sunday's drafting run done straight away: in the preview (fixed templates, in the browser), and in the
 * demonstration build for the owner of a Test data business (the scheduled job's own run, through
 * supabase/functions/demo-weekly-run). More and the demo guide (DemoGuide.tsx) share it, so both do exactly the same
 * thing and say the same thing after.
 */
export const useRunDrafting = () => {
  const backend = useBackend();
  const { businessId } = useBusiness();
  const { run, busy } = useAction();
  const { show } = useMessages();
  const runNow = () =>
    void run(
      'weekly-run',
      async () => {
        if (backend.preview) return { ...(await backend.preview.runWeeklyRun()), claude: false, live: false };
        if (backend.runDraftingNow) return { ...(await backend.runDraftingNow(businessId)), live: true };
        return { drafted: 0, claude: false, live: false };
      },
      { refresh: 'wait' },
    ).then((result) => {
      if (!result.ok) {
        show({ text: result.error.message, tone: 'critical' });
        return;
      }
      const { drafted, claude, live } = result.value;
      const count = `Your apprentice drafted ${drafted === 1 ? '1 reminder' : `${drafted} reminders`}.`;
      const how = live && drafted > 0 ? (claude ? ' Claude wrote the wording.' : ' It used the ready-made templates.') : '';
      show({ text: `${count}${how}` });
    });
  return { runNow, busy: busy === 'weekly-run' };
};

/** The demonstration build's drafting run is for the owner of a Test data business only (as the function checks). */
export const useLiveDemoTools = (): boolean => {
  const backend = useBackend();
  const { role } = useBusiness();
  const business = useBusinessRecord();
  return !backend.preview && typeof backend.runDraftingNow === 'function' && role === 'owner' && business.data?.is_test_data === true;
};

/** Preview only: "Reset demo data", with a question first. */
const ResetDemo = () => {
  const backend = useBackend();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const stored = backend.preview?.storage.mode === 'stored';

  const reset = () => {
    setResetting(true);
    // It reloads the page when done; if anything goes wrong on the way, a reload still starts again.
    void (backend.preview?.resetDemo() ?? Promise.resolve()).catch(() => window.location.reload());
  };

  return (
    <section className="card stack-sm" aria-labelledby="preview-reset-heading">
      <h2 className="t-heading card-title" id="preview-reset-heading">
        <IconTile icon={RotateCcw} size="sm" />
        Reset demo data
      </h2>
      <p className="t-secondary">
        {stored ? 'Your changes stay in this browser, even after a reload. Reset to start again with fresh Test data.' : 'Start again with fresh Test data.'}
      </p>
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Reset demo data
        </Button>
      </div>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Reset the demo?"
        alert
        busy={resetting}
        initialFocus={keepRef}
        footer={
          <>
            <Button variant="primary" block busy={resetting} busyLabel="Resetting…" onClick={reset}>
              Reset the demo
            </Button>
            <Button ref={keepRef} variant="secondary" block unavailable={resetting} onClick={() => setOpen(false)}>
              Keep my changes
            </Button>
          </>
        }
      >
        <p>This deletes your changes in this browser and starts again with fresh Test data.</p>
      </Sheet>
    </section>
  );
};

export const MoreScreen = () => {
  const { role, businessId } = useBusiness();
  const { memberships, signOut } = useSession();
  const backend = useBackend();
  const drafting = useRunDrafting();
  const liveDemo = useLiveDemoTools();
  const [shortcuts, setShortcuts] = useState(readItem(KEYS.shortcuts) === 'on');
  const onComputer = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopQuery).matches, () => false);
  const code = businessCode(businessId);
  const contactHref = config.supportEmail
    ? `mailto:${config.supportEmail}?subject=${encodeURIComponent('Payprentice help')}&body=${encodeURIComponent(`Business code: ${code}\r\n\r\n`)}`
    : null;

  return (
    <div className="page stack-lg">
      <div className="page-head">
        <PageTitle documentTitle="More">More</PageTitle>
      </div>
      {(backend.preview && role !== 'admin') || liveDemo ? (
        // The demo's key step, so it is the screen's one primary button, in an information-toned preview card.
        <section className="card card-info stack-sm" aria-labelledby="preview-run-heading">
          <h2 className="t-heading card-title" id="preview-run-heading">
            <IconTile icon={FlaskConical} tone="info" size="sm" />
            {backend.preview ? "Preview: Sunday's drafting run" : "Demo: Sunday's drafting run"}
          </h2>
          <p className="t-secondary">
            {backend.preview
              ? "In the app this runs every Sunday at 9:07 pm. The preview has no AI, so it drafts from ready-made templates. Like the real run, it replaces last week's unsent drafts."
              : "This runs every Sunday at 9:07 pm. For Test data, you can run it now. Claude writes the wording once the team's Claude key is set; until then, ready-made templates do. Like every run, it replaces last week's unsent drafts."}
          </p>
          <div>
            <Button variant="primary" busy={drafting.busy} busyLabel="Drafting…" onClick={drafting.runNow}>
              Run it now
            </Button>
          </div>
        </section>
      ) : null}
      <ul className="menu">
        <li>
          <Link to="import">
            <IconTile icon={Upload} tone="action" size="sm" /> Import invoices <ChevronRight className="chev" size={20} strokeWidth={2} aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to="log">
            <IconTile icon={ScrollText} tone="action" size="sm" /> Activity log <ChevronRight className="chev" size={20} strokeWidth={2} aria-hidden="true" />
          </Link>
        </li>
        {role === 'owner' && screenEnabled('settings') ? (
          <li>
            <Link to="settings">
              <IconTile icon={Settings} tone="action" size="sm" /> Settings <ChevronRight className="chev" size={20} strokeWidth={2} aria-hidden="true" />
            </Link>
          </li>
        ) : null}
        {memberships.length > 1 ? (
          <li>
            <Link to="?choose=1">
              <IconTile icon={Building2} tone="action" size="sm" /> Switch business <ChevronRight className="chev" size={20} strokeWidth={2} aria-hidden="true" />
            </Link>
          </li>
        ) : null}
        <li>
          {contactHref ? (
            <a href={contactHref}>
              <IconTile icon={MessageCircle} tone="action" size="sm" /> Contact the team
              <ChevronRight className="chev" size={20} strokeWidth={2} aria-hidden="true" />
            </a>
          ) : (
            <button type="button" disabled style={{ cursor: 'default' }}>
              <IconTile icon={MessageCircle} size="sm" /> Contact the team in your usual team channel
            </button>
          )}
        </li>
        <li>
          <button type="button" onClick={() => void signOut()}>
            <IconTile icon={LogOut} size="sm" /> Sign out
          </button>
        </li>
      </ul>
      <p className="t-caption">
        Your business code is <strong className="num">{code}</strong>. Give it to the team if you need help; it names nobody.
      </p>
      {onComputer ? (
        <section className="card stack-sm" aria-labelledby="shortcuts-heading">
          <h2 className="t-heading card-title" id="shortcuts-heading">
            <IconTile icon={Keyboard} size="sm" />
            Keyboard shortcuts
          </h2>
          <label className="check">
            <input
              type="checkbox"
              checked={shortcuts}
              onChange={(event) => {
                setShortcuts(event.target.checked);
                writeItem(KEYS.shortcuts, event.target.checked ? 'on' : null);
              }}
            />
            <span>
              Use keyboard shortcuts in Review on this device
              <span className="t-caption" style={{ display: 'block' }}>
                Shift+A approves, E edits, R rejects, and J and K move to the next and previous draft. Nothing happens while you type in a field.
              </span>
            </span>
          </label>
        </section>
      ) : null}
      <p className="t-caption">Signing out ends your session on this device only.</p>
      {backend.preview ? <ResetDemo /> : null}
    </div>
  );
};
