// More: Import, Activity log, Settings (owner), Contact the team, Keyboard shortcuts (on a computer) and Sign out.
// "Contact the team" sits in the same place on every screen's More (WCAG 3.2.6) and sends the business's code only.
import { Building2, ChevronRight, Keyboard, LogOut, MessageCircle, ScrollText, Settings, Upload } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { config, screenEnabled } from '../app/config.ts';
import { useMessages } from '../app/messages.tsx';
import { useAction } from '../app/queries.ts';
import { Link } from '../app/router.tsx';
import { useBackend, useBusiness, useSession } from '../app/session.tsx';
import { KEYS, readItem, writeItem } from '../lib/storage.ts';
import { Button, PageTitle } from '../ui/controls.tsx';

const desktopQuery = '(hover: hover) and (pointer: fine)';
const subscribeDesktop = (listener: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};

/** A short code that identifies the business to the team without naming anyone (NFR-04). */
export const businessCode = (businessId: string): string => businessId.replace(/-/g, '').slice(0, 8).toUpperCase();

export const MoreScreen = () => {
  const { role, businessId } = useBusiness();
  const { memberships, signOut } = useSession();
  const backend = useBackend();
  const { run, busy } = useAction();
  const { show } = useMessages();
  const [shortcuts, setShortcuts] = useState(readItem(KEYS.shortcuts) === 'on');
  const onComputer = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopQuery).matches, () => false);
  const code = businessCode(businessId);
  const contactHref = config.supportEmail
    ? `mailto:${config.supportEmail}?subject=${encodeURIComponent('Get-Paid Apprentice help')}&body=${encodeURIComponent(`Business code: ${code}\r\n\r\n`)}`
    : null;

  return (
    <div className="page stack-lg">
      <div className="page-head">
        <PageTitle documentTitle="More">More</PageTitle>
      </div>
      <ul className="menu">
        <li>
          <Link to="import">
            <Upload size={20} strokeWidth={1.5} aria-hidden="true" /> Import invoices <ChevronRight className="chev" size={20} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to="log">
            <ScrollText size={20} strokeWidth={1.5} aria-hidden="true" /> Activity log <ChevronRight className="chev" size={20} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </li>
        {role === 'owner' && screenEnabled('settings') ? (
          <li>
            <Link to="settings">
              <Settings size={20} strokeWidth={1.5} aria-hidden="true" /> Settings <ChevronRight className="chev" size={20} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </li>
        ) : null}
        {memberships.length > 1 ? (
          <li>
            <Link to="?choose=1">
              <Building2 size={20} strokeWidth={1.5} aria-hidden="true" /> Switch business <ChevronRight className="chev" size={20} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </li>
        ) : null}
        <li>
          {contactHref ? (
            <a href={contactHref}>
              <MessageCircle size={20} strokeWidth={1.5} aria-hidden="true" /> Contact the team
              <ChevronRight className="chev" size={20} strokeWidth={1.5} aria-hidden="true" />
            </a>
          ) : (
            <button type="button" disabled style={{ cursor: 'default' }}>
              <MessageCircle size={20} strokeWidth={1.5} aria-hidden="true" /> Contact the team in your usual team channel
            </button>
          )}
        </li>
        <li>
          <button type="button" onClick={() => void signOut()}>
            <LogOut size={20} strokeWidth={1.5} aria-hidden="true" /> Sign out
          </button>
        </li>
      </ul>
      <p className="t-caption">
        Your business code is <strong className="num">{code}</strong>. Give it to the team if you need help; it names nobody.
      </p>
      {onComputer ? (
        <section className="card stack-sm" aria-labelledby="shortcuts-heading">
          <h2 className="t-heading row" id="shortcuts-heading">
            <Keyboard size={20} strokeWidth={1.5} aria-hidden="true" /> Keyboard shortcuts
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
      {backend.preview && role !== 'admin' ? (
        <section className="card stack-sm" aria-labelledby="preview-run-heading">
          <h2 className="t-heading" id="preview-run-heading">
            Preview: Sunday's drafting run
          </h2>
          <p className="t-secondary">
            In the app this runs every Sunday at 9:07 pm. Here it drafts with the fallback templates, because the preview has no AI. Like the real run, it
            replaces last week's unsent drafts.
          </p>
          <Button
            variant="secondary"
            busy={busy === 'weekly-run'}
            busyLabel="Drafting…"
            onClick={() =>
              void run('weekly-run', () => backend.preview?.runWeeklyRun() ?? Promise.resolve({ drafted: 0 }), { refresh: 'wait' }).then((result) =>
                show({ text: result.ok ? `Your apprentice drafted ${result.value.drafted === 1 ? '1 reminder' : `${result.value.drafted} reminders`}.` : result.error.message }),
              )
            }
          >
            Run it now
          </Button>
        </section>
      ) : null}
    </div>
  );
};
