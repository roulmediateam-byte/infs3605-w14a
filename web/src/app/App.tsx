// Routing and the sign-in gate. Deep links survive sign-in: a signed-out tap on "Review drafts" goes to sign-in,
// then straight to that draft (App Flow, Navigation map). Screens hidden until they ship are not reachable.
import { useQuery } from '@tanstack/react-query';
import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { HomeScreen } from '../screens/Home.tsx';
import { MoreScreen } from '../screens/More.tsx';
import { ReviewScreen } from '../screens/review/Review.tsx';
import { SignInScreen } from '../screens/SignIn.tsx';
import { ChooseBusinessScreen, LoadErrorScreen, NoBusinessScreen, NotFoundScreen } from '../screens/Gates.tsx';
import { KEYS, readItem, writeItem } from '../lib/storage.ts';
import { Button, LoadingBlock } from '../ui/controls.tsx';
import { NoData } from '../ui/QueryState.tsx';
import { screenEnabled } from './config.ts';
import { PendingSendPrompt, SessionEndedSheet } from './Prompts.tsx';
import { onSignedOutError } from './queries.ts';
import { navigate, useLocation, type RouteName } from './router.tsx';
import { useBackend, useSession } from './session.tsx';
import { Shell } from './Shell.tsx';

const ImportScreen = lazy(() => import('../screens/Import.tsx').then((m) => ({ default: m.ImportScreen })));
const InvoicesScreen = lazy(() => import('../screens/invoices/Invoices.tsx').then((m) => ({ default: m.InvoicesScreen })));
const ClientsScreen = lazy(() => import('../screens/clients/Clients.tsx').then((m) => ({ default: m.ClientsScreen })));
const LogScreen = lazy(() => import('../screens/Log.tsx').then((m) => ({ default: m.LogScreen })));
const SettingsScreen = lazy(() => import('../screens/Settings.tsx').then((m) => ({ default: m.SettingsScreen })));

/** Only app paths may follow sign-in, never another site. */
export const safeNext = (next: string | null): string | null => {
  if (!next) return null;
  return /^(review|invoices|import|clients|log|settings|more)?(\?[A-Za-z0-9=&%._-]*)?$/.test(next) ? next : null;
};

/** If a lazily loaded screen fails, usually because a newer version was published or the signal dropped, say which. */
class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return (
      <div className="page stack" role="alert">
        <h1 className="t-title">This screen didn't load</h1>
        <p>{offline ? "You're offline. Reload when you're back online." : 'A newer version of the app may be out, or the connection dropped. Reload to try again.'}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

const screenFor = (route: RouteName): ReactNode => {
  switch (route) {
    case 'home':
      return <HomeScreen />;
    case 'import':
      return <ImportScreen />;
    case 'invoices':
      return screenEnabled('invoices') ? <InvoicesScreen /> : <NotFoundScreen />;
    case 'clients':
      return screenEnabled('clients') ? <ClientsScreen /> : <NotFoundScreen />;
    case 'log':
      return <LogScreen />;
    case 'settings':
      return screenEnabled('settings') ? <SettingsScreen /> : <NotFoundScreen />;
    case 'more':
      return <MoreScreen />;
    default:
      return <NotFoundScreen />;
  }
};

const BusinessChooser = () => {
  const backend = useBackend();
  const names = useQuery({ queryKey: ['business-names'], queryFn: () => backend.businesses() });
  if (names.data === undefined) return <NoData query={names} loading={<LoadingBlock label="Loading your businesses" />} />;
  return <ChooseBusinessScreen names={Object.fromEntries((names.data ?? []).map((b) => [b.id, b.name]))} />;
};

export const App = () => {
  const session = useSession();
  const location = useLocation();
  const { reportSignedOut } = session;

  useEffect(() => onSignedOutError(reportSignedOut), [reportSignedOut]);

  // Signed out: go to sign-in, keeping where the person was going.
  useEffect(() => {
    if (session.status === 'signed-out' && location.name !== 'sign-in') {
      const next = location.path && location.name !== 'home' ? location.path : null;
      navigate(next ? `sign-in?next=${encodeURIComponent(next)}` : 'sign-in', { replace: true });
    }
  }, [session.status, location.name, location.path]);

  // Signed in: leave sign-in for the deep link (or Home); a sign-in through the emailed link lands on Home first.
  useEffect(() => {
    if (session.status !== 'signed-in') return;
    if (location.name === 'sign-in') {
      const next = safeNext(location.params.get('next')) ?? safeNext(readItem(KEYS.nextAfterSignIn)) ?? '';
      writeItem(KEYS.nextAfterSignIn, null);
      navigate(next, { replace: true });
      return;
    }
    const stored = safeNext(readItem(KEYS.nextAfterSignIn));
    if (stored !== null) {
      writeItem(KEYS.nextAfterSignIn, null);
      if (location.name === 'home' && stored !== '') navigate(stored, { replace: true });
    }
  }, [session.status, location.name, location.params]);

  if (session.status === 'loading') {
    return (
      <div className="center-screen">
        <LoadingBlock label="Opening Get-Paid Apprentice" />
      </div>
    );
  }
  if (session.status === 'error') return <LoadErrorScreen />;
  if (session.status === 'signed-out' || location.name === 'sign-in') {
    return session.status === 'signed-out' ? <SignInScreen next={safeNext(location.params.get('next'))} /> : null;
  }
  if (session.memberships.length === 0) return <NoBusinessScreen />;
  if (!session.businessId || location.params.get('choose') === '1') {
    return <BusinessChooser />;
  }

  return (
    <>
      {location.name === 'review' ? (
        <div className="review-open">
          <ReviewScreen key={session.businessId} />
        </div>
      ) : (
        <Shell route={location.name}>
          <ChunkBoundary key={location.name}>
            <Suspense fallback={<LoadingBlock label="Loading" />}>{screenFor(location.name)}</Suspense>
          </ChunkBoundary>
        </Shell>
      )}
      <PendingSendPrompt />
      <SessionEndedSheet />
    </>
  );
};
