# Get-Paid Apprentice web app

The web app is where an owner or checker reviews the apprentice's drafts, sends them from their own email app and keeps invoices up to date. It is a React and TypeScript single-page app built with Vite, installable on a phone. It talks only to Supabase, with the publishable key, so the browser holds no secret. Every change goes through a database function that checks the person's role (ADR 0003), so the server enforces approval whatever the browser does.

It builds the eleven screens in the UI design brief, UI-01 to UI-11: sign-in with a code, Home, Review (with Edit, Reject and Send), Invoices, Import, Clients, the Activity log and Settings. The setup wizard (APP-01) is not built: the team sets up each owner in the proof of concept (ADR 0013).

## Run it on your computer

You need Node 22.18 or later, PostgreSQL 15 or later with `psql`, and bash (no Docker). The local stack runs the real migrations behind PostgREST, with a stand-in for Supabase's email codes and sign-in links. It is for development only: its signing secret is public.

PostgREST comes one of three ways:

- On Linux, the stack downloads PostgREST 12.2.3 into `.local-stack/` and checks its checksum. On Linux on ARM it also needs `libpq5` and `libgmp10`.
- On a Mac, install it first with `brew install postgrest`. The release's own Mac build expects Homebrew's PostgreSQL 14 in one fixed place.
- Anywhere, set `LOCAL_STACK_POSTGREST` to a PostgREST 12 binary. On Windows, run the stack in WSL.

```bash
# Once, from the repository root
npm ci && (cd web && npm ci)

# Terminal 1, from the repository root: builds database getpaid_dev from the migrations and the Test data seed,
# then serves the Supabase stand-in on http://127.0.0.1:54321
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres npm run stack

# Terminal 2
cd web && npm run dev       # http://127.0.0.1:5173
```

Sign in as `owner@example.test` (or `checker@example.test`). No email is sent: http://127.0.0.1:54321/__local/codes?email=owner@example.test shows the code and the sign-in link that the email would carry. The stack writes `web/.env.development.local` with its address and key, and git ignores that file.

Useful while developing:

- `curl -X POST http://127.0.0.1:54321/__local/reset` puts the database back to the seed.
- `LOCAL_STACK_OTP_INTERVAL=1` lets a new code be requested after 1 second instead of 60 (the tests use it).
- `LOCAL_STACK_SESSION_SECONDS` shortens sign-in sessions from 3,600 seconds, to try what happens when one ends.
- Run a weekly run by hand from the repository root, as in the main README, to get fresh drafts.

With the Supabase CLI instead (not yet tried with the web app): run `supabase start`, add the seed's owner as a user in Studio (Authentication > Add user), put the API address and publishable key in `web/.env.local`, and read sign-in emails in the local mail viewer.

## Check it

| Check | Command (in `web/`) | Needs |
| --- | --- | --- |
| Types | `npm run typecheck` | Nothing |
| Unit tests (Vitest), 21 | `npm test` | Nothing |
| The browser reads imports and edits as the database does, 877 inputs | `node scripts/check-parity.ts` | The local database |
| Database types match the migrations | `node ../scripts/gen-web-types.ts --check` | The local database |
| JavaScript under 200 KB compressed at first load | `npm run build:e2e && npm run size` | The local stack |
| End to end and accessibility (Playwright with axe), 45 tests on a phone (390 px) and a computer (1280 px) | `npm run build:e2e && npx playwright test` | The local stack, started with `LOCAL_STACK_OTP_INTERVAL=1` |
| The site as GitHub Pages serves it: deep links through `404.html`, the root and `/demo/` builds side by side, and the speed budgets, 6 tests on a phone | `npm run build:pages-e2e && npm run test:pages` | The local stack, as above |

`npm run build:e2e` builds against the local stack, as CI does. (A plain `npm run build` reads no `.env.development*` file, so without the variables below it shows "This build isn't set up".) The end-to-end tests reset the database before each test, sign in with codes or links from the stack, and use synthetic files only. Set `PW_CHROMIUM_PATH` to use a Chromium you already have; otherwise run `npx playwright install chromium` once. CI runs all of these in the "web" job (`.github/workflows/ci.yml`).

After a migration changes a table or function, regenerate the database types with `node scripts/gen-web-types.ts` from the repository root, then fix what the type check reports.

## Builds

| Variable | What it does |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | The Supabase project the build talks to. Both are public by design. Never put the secret or service role key here |
| `VITE_SUPPORT_EMAIL` | Where "Contact the team" under More sends email. Empty shows "Contact the team in your usual team channel" |
| `VITE_HIDE_SCREENS` | Screens to leave out of the navigation, for example `invoices,clients,settings` for the demonstration build until they pass their tests |
| `BASE_PATH` | Where the build is served, for example `/getpaid-apprentice/` on GitHub Pages |
| `SUB_APPS` | Builds published under this one (`demo/`), which the service worker and the 404 page leave alone |
| `VITE_BACKEND=preview` | The in-browser preview below, instead of Supabase |

`.github/workflows/pages.yml` publishes two builds on every merge to `main` that changes `web/`: the owners' build at the site root and the demonstration build under `/demo/` (runbook, "Publish the web app"). It refuses to publish if the pilot address and key aren't set together, or if a secret or service role key was put where the publishable key belongs.

Because GitHub Pages cannot send response headers, the build adds a Content Security Policy meta tag that allows connections only to the Supabase project. It also adds a service worker that caches the app shell only, never business data, and a `404.html` that sends deep links such as `/review?draft=…` to the right build. The two builds share one web address, so each keeps its own shell cache, and each Supabase project's sign-in session is stored under its own key.

## The click-through preview

The preview is the same app with its backend swapped for PGlite, PostgreSQL compiled to WebAssembly. It runs `supabase/local/supabase_stubs.sql`, the seven migrations and the seed in the browser, so every click goes through the real functions, row-level security and role checks. It is for showing the app to people who have no local stack; it is not a test environment.

```bash
VITE_BACKEND=preview npx vite build --outDir dist-preview --emptyOutDir
npx vite preview --outDir dist-preview --port 4174    # http://127.0.0.1:4174
```

What differs from the real app:

- The sign-in code appears on screen, with a "Use it" button, because no email is sent.
- Send shows a preview step instead of opening the email app, and downloads are switched off.
- More has "Run it now", which runs Sunday's drafting run with the fallback templates (there is no AI).
- Everything lives in the browser: nothing is sent anywhere. The demo's data is kept in this browser's storage (IndexedDB), so a reload carries on where you were; More, "Reset demo data", starts again from the seed. Where the browser can't keep it, or the demo is open in another tab, that tab runs in memory and a reload starts again.

The engine files sit next to the page in `pglite/`. The file-system bundle ships as gzip-compressed base64 in `pglite-data.json`, because artifact hosting serves web file types only. In testing it reached sign-in in about 4 seconds.

## How the code is organised

| Path | What |
| --- | --- |
| `src/backend/` | The `Backend` interface (`types.ts`), the Supabase adapter, the preview adapter, error messages by database error code (`errors.ts`) and the generated `database.types.ts` |
| `src/app/` | Router (addresses always say where you are), session and roles, data fetching with TanStack Query, messages with Undo, the shell and its banners |
| `src/screens/` | One file or folder per screen |
| `src/ui/` | Buttons, fields, chips, banners and sheets (native `<dialog>`), styled with the UI brief's tokens in `src/styles.css` |
| `src/lib/` | Pure logic with unit tests: money, Sydney dates, import rows, draft checks and the email link, activity log sentences, CSV export |
| `src/workers/` | Reads CSV files off the main thread |
| `build/plugins.ts` | The security policy, service worker, 404 page and the preview's engine files |
| `e2e/` | Playwright tests against the local stack |
| `e2e-pages/`, `scripts/serve-pages.ts` | Tests of the Pages-shaped build, through a small stand-in for GitHub Pages |

Rules the code keeps:

- Money is whole cents, shown with `formatAud`; dates and times are Sydney time (ADR 0004).
- Screens never change money or dates on their own: they call a function, then refetch.
- No change is queued while offline: the app says "You're offline. Your place is saved." and the change is not made. A screen that hasn't loaded yet says "You're offline. This will load when you're back online." rather than looking empty.
- Signing out forgets the session and the person's details on this device, even offline.
- No third-party scripts, fonts or trackers, and no personal data in the console.
- Words come from the App Flow and the UI brief, in Australian English. Test data is always labelled "Test data".

AI use: Team W14A-5 used [AI tools: completed at final assembly] to help draft and structure this document. Every claim, figure and quote was checked against its source by a team member, and the team takes responsibility for the content.
