// A small router over the History API. The address always says where the person is (/review?draft=...), so email
// links, refresh and the back button all work (UI brief, Experience architecture). Paths are relative to the
// build's base, so the same code serves "/" locally and "/<repository>/" or "/<repository>/demo/" on GitHub Pages.
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { config } from './config.ts';

export type RouteName = 'home' | 'review' | 'invoices' | 'import' | 'clients' | 'log' | 'settings' | 'more' | 'sign-in' | 'not-found';

const ROUTES: Record<string, RouteName> = {
  '': 'home',
  review: 'review',
  invoices: 'invoices',
  import: 'import',
  clients: 'clients',
  log: 'log',
  settings: 'settings',
  more: 'more',
  'sign-in': 'sign-in',
};

const base = config.base.endsWith('/') ? config.base : `${config.base}/`;

/** The app-relative path for a link, such as "review?draft=..." becoming "/<base>/review?draft=...". */
export const toHref = (to: string): string => base + to.replace(/^\/+/, '');

const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());
let movedByApp = false;

// The preview runs inside a viewer frame that keeps its own address, so it keeps the location in memory instead.
const inMemory = import.meta.env.VITE_BACKEND === 'preview';
let memoryPath = base;

if (typeof window !== 'undefined' && !inMemory) {
  window.addEventListener('popstate', () => {
    movedByApp = true;
    notify();
  });
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = (): string => (inMemory ? memoryPath : window.location.pathname + window.location.search);

/** GitHub Pages serves 404.html for deep links, which sends them here as ?p=...; put the real address back. */
export const restoreDeepLink = (): void => {
  if (inMemory) return;
  const params = new URLSearchParams(window.location.search);
  const redirected = params.get('p');
  if (redirected === null) return;
  window.history.replaceState(null, '', toHref(redirected.replace(/^\/+/, '')) + window.location.hash);
};

export interface Location {
  name: RouteName;
  /** The app-relative path and query, such as "review?draft=...". */
  path: string;
  params: URLSearchParams;
}

const parse = (full: string): Location => {
  const url = new URL(full, window.location.origin);
  let relative = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname.replace(/^\/+/, '');
  relative = relative.replace(/\/+$/, '');
  return { name: ROUTES[relative] ?? 'not-found', path: `${relative}${url.search}`, params: url.searchParams };
};

export const useLocation = (): Location => parse(useSyncExternalStore(subscribe, snapshot, () => '/'));

export const currentLocation = (): Location => parse(snapshot());

export const navigate = (to: string, options: { replace?: boolean } = {}): void => {
  const href = toHref(to);
  if (href === snapshot() && !options.replace) return;
  if (inMemory) memoryPath = href;
  else if (options.replace) window.history.replaceState(null, '', href);
  else window.history.pushState(null, '', href);
  movedByApp = true;
  if (!options.replace) window.scrollTo({ top: 0 });
  notify();
};

/** True once after the person moves between screens, so the new screen's title can take focus (WCAG 2.4.3). */
export const takeMoveFlag = (): boolean => {
  const moved = movedByApp;
  movedByApp = false;
  return moved;
};

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  replace?: boolean;
  children: ReactNode;
}

export const Link = ({ to, replace, onClick, children, ...rest }: LinkProps) => {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to, { replace });
  };
  return (
    <a href={toHref(to)} onClick={handle} {...rest}>
      {children}
    </a>
  );
};
