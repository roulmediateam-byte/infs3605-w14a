# Testing

Automated tests guard the behaviour that matters most: nothing is sent without approval, and nothing shows a wrong amount or date. Four suites cover the backend and four the web app.

| Suite | What it proves | How to run | Where it runs |
| --- | --- | --- | --- |
| Database (pgTAP), 235 tests in 8 files | Business rules BR-01 to BR-15, acceptance tests AT-01 to AT-10, permissions, row-level security, the append-only log, retention, and the security conventions | `supabase test db`, or `scripts/test-local.sh` without Docker | Every pull request (CI) |
| Job code (Node), 34 tests | The AI request holds only five fields (AI-03); one retry then the template (AI-07); emails render correctly, with preview text and no time-of-day greeting; a forced briefing gets its own email key; jobs record success and failure | `npm test` | Every pull request (CI) |
| End-to-end (local) | The job code and the database agree on every function, argument and result; a weekly run and a briefing work start to finish; the demonstration-inbox and owner-onboarding scripts produce the expected records and refuse bad input | `scripts/test-local.sh` runs it last | Locally, before merging job or schema changes |
| Prompt evaluation, 30 cases | Real model replies pass AI-06 across 3 tones and 10 situations; a teammate reads 10 for tone | `npm run eval:prompt` | Pull requests that change `prompts/` |
| Web app units (Vitest), 21 tests | Money and Sydney dates; CSV import rules and column matching; locked facts and the email link; the review session, including drafts that leave it; activity sentences; CSV export guards formula cells | `cd web && npm test` | Every pull request (CI, "web" job) |
| Web app parity, 877 inputs | The browser's import and edit checks agree with the database's functions, so the preview of an import matches what is saved | `node web/scripts/check-parity.ts` (needs the local database) | Every pull request (CI) |
| Web app end to end (Playwright with axe), 45 tests, each on a phone (390 px) and a computer (1280 px) | The screens against the real functions: sign-in by code and by link, signing out (also offline), the review loop, import, two people deciding, every other screen, offline states, accessibility (WCAG 2.2 AA rules, focus never under a sticky bar, 320 px layout), the security policy | `cd web && npm run build:e2e && npx playwright test`, with the local stack running (`web/README.md`) | Every pull request (CI) |
| Web app as GitHub Pages serves it (Playwright), 6 tests on a phone | Deep links through `404.html`, the root and `/demo/` builds side by side with separate caches, and the speed budgets: largest content within 2.5 s and layout shift under 0.1 on first load, progress within 200 ms of a tap, an approval back within 1 s | `cd web && npm run build:pages-e2e && npm run test:pages` | Every pull request (CI) |

## Database test files

| File | Covers |
| --- | --- |
| `001_conventions.test.sql` | Row-level security on every table; no write policies; grants by role; `search_path` on every function; views obey RLS; money in cents |
| `010_business_rules.test.sql` | Sydney dates across daylight saving; money and date formats; CSV value parsing; placeholders; every AI-06 check; locked facts (AT-07) |
| `020_weekly_run.test.sql` | AT-04, AT-05 (6-day and 7-day cool-down), AT-08, BR-10, BR-11, AI-03, AI-06 at save time |
| `030_import.test.sql` | FR-04 to FR-06, BR-03, BR-15, AT-03, AT-06, reopening, paid invoices kept, the mass-close guard |
| `040_review_and_send.test.sql` | AT-01, AT-02, AT-07, FR-14 to FR-20, FR-24, FR-25, BR-05 at approval, BR-08, BR-09, D3 |
| `050_permissions.test.sql` | AT-09, isolation between businesses, anonymous access, team admins on test data only, the append-only log, invitations, export and delete |
| `060_briefing.test.sql` | FR-11 to FR-13, AT-06, BR-06, BR-07, Needs attention, paused clients, call-first (FR-33) |
| `070_jobs.test.sql` | AT-10 schedule windows, NFR-09 claims and retries, NFR-10 alert, the noon nudge, retention and orphaned accounts |

Tests pin every moment in Sydney time (for example Sun 8 Nov 2026, 9:00 pm), so they pass on any day. Each file runs in a transaction and rolls back.

## Web app test files

| File | Covers |
| --- | --- |
| `sign-in.spec.ts` | UI-01: an uninvited email, a wrong code, the right code, the emailed link (once, and kept out of the browser history), a deep link kept through sign-in, the session ending mid-task, signing out (also offline with an expired session), opening offline, switching business |
| `review.spec.ts` | UI-03 to UI-06: approve then send, "Did it send?" (also after a reload), copy instead, an amount edit refused and a reworded one saved and shown as approved text, focus into and out of Edit, closing with changes, reject reasons, the summary and the logged review, a draft that gives way when its invoice changes, a review reopened after an import, the computer layout and shortcuts |
| `import.spec.ts` | UI-08: the demonstration file (preview, problems, what will change, result, Home), the mass-close guard, a file that is not a CSV, matching columns by hand |
| `team.spec.ts` | D3: the checker approves and the owner sends from Ready to send; two people deciding the same draft; the server refuses a checker who may not send |
| `screens.spec.ts` | UI-07, UI-09 to UI-11 and More: invoice chips, search and filters; Mark paid with Undo; client emails, tones and pausing; the evening briefing; Xero's reminders (FR-32); export; delete with the typed name; the log's filters; Contact the team; screens opened offline |
| `a11y.spec.ts` | Axe on every screen and sheet, focus returning when a sheet closes, focus never under a sticky bar, and the layout at 320 px (including the import's check step) |
| `security.spec.ts` | The Content Security Policy, no requests to other sites, and API responses never cached |
| `e2e-pages/deep-links.spec.ts` | Through a stand-in for GitHub Pages (`web/scripts/serve-pages.ts`): an emailed `/review?draft=` link through `404.html` and sign-in, the app's own not-found screen, the `/demo/` build and its hidden screens, separate shell caches |
| `e2e-pages/performance.spec.ts` | The TRD's speed budgets under Lighthouse's mobile throttling (a processor 4 times slower; 150 ms round trips at 1.6 Mbit/s) |

The speed budgets are measured in Playwright with Lighthouse's mobile throttling settings rather than by Lighthouse itself, so they run on every pull request with no other tool. A Lighthouse run on the dev project stays part of the performance pass (QA-05) before owner testing.

Each test starts from the seed (the stack's `/__local/reset`) and signs in with a code read from the stack, so tests never depend on each other. Files used in tests are made at run time from the seed and are synthetic.

## Writing a new test

- Name the test with the ID it proves, for example `'AT-03: the waiting draft for the changed amount is cancelled'`.
- Use invented data labelled "Test data" and reserved domains (`.example`, `.test`). `scripts/check-hygiene.sh` fails the build on anything else.
- Act as the right person: `select tests.as_user('<uuid>')` for a signed-in user, `reset role` for the database owner.
- When a test passes for the wrong reason, it is worse than no test: check it fails first by breaking the rule on purpose.

## Manual checks before the demonstration

- Accessibility: the automated checker runs on every screen in CI; add keyboard-only and screen-reader passes on Home and Review (NFR-13).
- A cold-user test on Sun 25 Oct 2026: someone outside the team imports and clears a review without help (NFR-12).
- AT-10 live: record the times of the first scheduled Sunday run and Monday briefing on the dev project in the DEL-08 test log.
