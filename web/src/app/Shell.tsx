// The frame around every screen except Review: five destinations, never more, in a bottom bar on phones and a side
// bar from 768 px; standing banners for Test data, offline and Xero reminders (UI brief, Experience architecture).
// The preview and Test data share one compact strip, so the screen's own decision stays above the fold on a phone.
import { ChevronDown, Ellipsis, FileText, FlaskConical, House, Inbox, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { screenEnabled } from './config.ts';
import { useOnline } from './online.ts';
import { useBriefing, useBusinessRecord } from './queries.ts';
import { Link, type RouteName } from './router.tsx';
import { useBackend } from './session.tsx';
import type { PreviewStorage } from '../backend/types.ts';
import { AppMark } from '../ui/AppMark.tsx';
import { Banner } from '../ui/controls.tsx';
import { XeroOffSteps } from '../ui/XeroSteps.tsx';

interface NavItem {
  to: string;
  route: RouteName;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

const MORE_ROUTES: RouteName[] = ['more', 'import', 'log', 'settings'];

/** What a reload does to the preview's data, in the strip's "Details" (src/backend/preview-store.ts). */
const keptNote = (storage: PreviewStorage): string =>
  storage.mode === 'stored'
    ? 'Your changes stay in this browser until you reset the demo under More.'
    : storage.reason === 'other-tab'
      ? "The demo is open in another tab, so this tab's changes go when you reload."
      : "This browser can't keep the demo's data, so a reload starts again.";

export const Shell = ({ route, children }: { route: RouteName; children: ReactNode }) => {
  const briefing = useBriefing();
  const business = useBusinessRecord();
  const online = useOnline();
  const backend = useBackend();
  const waiting = briefing.data?.drafts_waiting ?? 0;

  const items: NavItem[] = [
    { to: '', route: 'home', label: 'Home', icon: House },
    { to: 'review', route: 'review', label: 'Review', icon: Inbox, badge: waiting },
    ...(screenEnabled('invoices') ? [{ to: 'invoices', route: 'invoices' as const, label: 'Invoices', icon: FileText }] : []),
    ...(screenEnabled('clients') ? [{ to: 'clients', route: 'clients' as const, label: 'Clients', icon: Users }] : []),
    { to: 'more', route: 'more', label: 'More', icon: Ellipsis },
  ];
  const current = MORE_ROUTES.includes(route) ? 'more' : route;
  const testData = Boolean(business.data?.is_test_data);
  const banners = [
    backend.preview || testData ? (
      // One strip for the preview and Test data, at most two lines on a phone; the rest waits behind "Details".
      <div key="data" className="data-strip">
        {backend.preview ? (
          <details>
            <summary className="data-strip-line">
              <FlaskConical size={16} strokeWidth={1.5} aria-hidden="true" className="data-strip-icon" />
              <span className="data-strip-text">
                <strong>Preview</strong>
                {testData ? ' · made-up Test data' : ''} · nothing is sent
              </span>
              <span className="data-strip-more">
                Details
                <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
              </span>
            </summary>
            <p className="data-strip-note">This copy of the app runs in your browser, with the same rules as the real one. {keptNote(backend.preview.storage)}</p>
          </details>
        ) : (
          <p className="data-strip-line">
            <FlaskConical size={16} strokeWidth={1.5} aria-hidden="true" className="data-strip-icon" />
            <span className="data-strip-text">
              <strong>Test data</strong> · made-up invoices for testing
            </span>
          </p>
        )}
        {testData && route === 'import' ? (
          <p className="data-strip-note">Import only made-up invoices until the team records your written agreement to use real ones.</p>
        ) : null}
      </div>
    ) : null,
    !online ? (
      <Banner key="offline" tone="warning" role="status">
        You're offline. Your place is saved.
      </Banner>
    ) : null,
    business.data?.xero_reminders === 'on' ? (
      <Banner key="xero" tone="warning">
        <strong>Xero may send reminders too,</strong> so clients could get two. <XeroOffSteps />
      </Banner>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="app app-with-nav">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="nav" aria-label="Main">
        {/* On a computer the side bar starts with the app's mark and name, and the business underneath. */}
        <div className="nav-brand">
          <AppMark size={32} />
          <p className="nav-brand-text">
            <span className="nav-app">Get-Paid Apprentice</span>
            <span className="nav-business">{business.data?.name ?? briefing.data?.business.name ?? ''}</span>
          </p>
        </div>
        <ul className="nav-list">
          {items.map((item) => (
            <li key={item.route}>
              <Link
                className="nav-link"
                to={item.to}
                aria-current={current === item.route ? 'page' : undefined}
                aria-label={item.badge ? `${item.label}, ${item.badge} ${item.badge === 1 ? 'draft' : 'drafts'} waiting` : undefined}
              >
                <span className="nav-icon">
                  <item.icon size={22} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="nav-link-label">{item.label}</span>
                {item.badge ? (
                  <span className="nav-badge" aria-hidden="true">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="main" id="main" tabIndex={-1}>
        {banners.length > 0 ? <div className="banners">{banners}</div> : null}
        {children}
      </main>
    </div>
  );
};
