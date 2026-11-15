import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createBackend, watchBoot } from '@backend';
import { App } from './app/App.tsx';
import { config } from './app/config.ts';
import { MessagesProvider } from './app/messages.tsx';
import { createQueryClient } from './app/queries.ts';
import { restoreDeepLink } from './app/router.tsx';
import { BackendProvider, SessionProvider } from './app/session.tsx';
import type { Backend } from './backend/types.ts';
import { BrandFrame } from './ui/BrandFrame.tsx';
import './styles.css';

restoreDeepLink();

const root = createRoot(document.getElementById('root') as HTMLElement);
const preview = import.meta.env.VITE_BACKEND === 'preview';

// The preview's loading screen. A first visit builds the demo in the browser; a later one opens the copy kept there.
const BOOT_WORDS = {
  build: ['Getting the demo ready…', 'Loading made-up invoices…', 'Almost ready…'],
  open: ['Opening your demo…', 'Opening your demo…', 'Almost ready…'],
} as const;

/**
 * Which of the three steps each start-up event belongs to (src/backend/preview.ts, BootStep): the download; starting
 * the database and loading the Test data; saving it in this browser. Opening a kept copy is all one step.
 */
const BOOT_STEP: Record<string, number> = { download: 0, open: 0, start: 1, migrate: 1, save: 2, ready: 2 };

/** Done steps are filled, the current one half filled; the words above say the same, so colour is not needed. */
const segment = (index: number, step: number): string => `boot-step${index < step ? ' is-done' : index === step ? ' is-current' : ''}`;

const BootScreen = ({ step, opening }: { step: number; opening: boolean }) => {
  const words = (opening ? BOOT_WORDS.open : BOOT_WORDS.build)[step] ?? '';
  return (
    <BrandFrame>
      <div className="stack-lg">
        {/* A polite live region: each new step is read out once. The bar has no text, so it adds nothing to that. */}
        <div role="status" className="stack-sm">
          <div className="row" style={{ gap: 12 }}>
            <span className="spinner" aria-hidden="true" style={{ flex: 'none' }} />
            <h1 className="t-title">{words}</h1>
          </div>
          <div
            role="progressbar"
            aria-label="Starting the demo"
            aria-valuemin={0}
            aria-valuemax={3}
            aria-valuenow={step + 1}
            aria-valuetext={`Step ${step + 1} of 3: ${words}`}
            className="boot-steps"
          >
            {[0, 1, 2].map((index) => (
              <span key={index} className={segment(index, step)} />
            ))}
          </div>
          <p className="t-caption">Step {step + 1} of 3</p>
        </div>
        <div className="stack">
          <p>Payprentice drafts polite payment reminders for your overdue invoices. You check each one, then send it from your own email.</p>
          <p>Your apprentice is the helper that drafts reminders for you. It never sends anything.</p>
        </div>
        <p className="t-caption">Everything runs in this browser with made-up Test data. Nothing is sent.</p>
      </div>
    </BrandFrame>
  );
};

const notice = (title: string, lines: string[]) =>
  root.render(
    <BrandFrame>
      <div className="stack">
        <h1 className="t-title">{title}</h1>
        {lines.map((line) => (
          <p key={line} className={line.startsWith('·') ? 't-caption' : undefined} role={line === lines[0] ? 'status' : undefined}>
            {line.replace(/^·/, '')}
          </p>
        ))}
      </div>
    </BrandFrame>,
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

// The preview starts a database in the browser first, which takes a few seconds: say what is happening, and what the
// product is. A later visit opens the copy this browser kept, which is quicker.
if (preview) {
  let step = 0;
  let opening = false;
  root.render(<BootScreen step={step} opening={opening} />);
  // The preview reports more steps than the Supabase build's type lists, so take any step name. Each step is drawn
  // straight away, because the database work that follows keeps the page busy.
  watchBoot((event: string) => {
    if (event === 'open') opening = true;
    if (event === 'start') opening = false;
    step = Math.max(step, BOOT_STEP[event] ?? step);
    flushSync(() => root.render(<BootScreen step={step} opening={opening} />));
  });
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
