import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBackend, watchBoot } from '@backend';
import { App } from './app/App.tsx';
import { config } from './app/config.ts';
import { MessagesProvider } from './app/messages.tsx';
import { createQueryClient } from './app/queries.ts';
import { restoreDeepLink } from './app/router.tsx';
import { BackendProvider, SessionProvider } from './app/session.tsx';
import type { Backend } from './backend/types.ts';
import './styles.css';

restoreDeepLink();

const root = createRoot(document.getElementById('root') as HTMLElement);
const preview = import.meta.env.VITE_BACKEND === 'preview';

const notice = (title: string, lines: string[]) =>
  root.render(
    <main className="sign-in" id="main">
      <div className="stack">
        <h1 className="t-title">{title}</h1>
        {lines.map((line) => (
          <p key={line} className={line.startsWith('·') ? 't-caption' : undefined} role={line === lines[0] ? 'status' : undefined}>
            {line.replace(/^·/, '')}
          </p>
        ))}
      </div>
    </main>,
  );

const start = (backend: Backend) => {
  const queryClient = createQueryClient();
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BackendProvider backend={backend}>
          <SessionProvider>
            <MessagesProvider>
              <App />
            </MessagesProvider>
          </SessionProvider>
        </BackendProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
};

// The preview starts a database in the browser first, which takes a few seconds: say what is happening.
if (preview) {
  const steps = {
    download: 'Downloading the database engine…',
    start: 'Starting PostgreSQL in your browser…',
    migrate: 'Running the 7 real migrations and the Test data seed…',
    ready: 'Ready.',
  };
  const caption = '·Everything runs in this browser tab with made-up Test data. Nothing is sent, and a reload starts again.';
  notice('Get-Paid Apprentice preview', [steps.download, caption]);
  watchBoot((step) => notice('Get-Paid Apprentice preview', [steps[step], caption]));
}

// "@backend" is the Supabase adapter, or the in-browser preview adapter in the preview build (vite.config.ts).
createBackend().then(
  (backend) => {
    if (backend) start(backend);
    else
      notice("This build isn't set up", [
        'It has no Supabase project address or publishable key. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then build again.',
      ]);
  },
  (error: unknown) =>
    notice(preview ? "The preview couldn't start" : "The app couldn't start", [
      preview
        ? 'This browser blocked the database engine the preview runs on. Try a recent Chrome, Edge, Firefox or Safari, or run the app with the local stack (web/README.md).'
        : 'Reload the page. If it keeps happening, contact the team.',
      `·${error instanceof Error ? error.message : String(error)}`,
    ]),
);

// The service worker caches the app shell only (TRD, Web app). Not in development, and not in the preview build.
if (import.meta.env.PROD && !preview && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${config.base}sw.js`, { scope: config.base }).catch(() => {
      // Without it the app still works; it just can't open offline.
    });
  });
}
