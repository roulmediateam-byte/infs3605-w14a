# Testing

Four kinds of automated test guard the behaviour that matters most: nothing is sent without approval, and nothing shows a wrong amount or date.

| Suite | What it proves | How to run | Where it runs |
| --- | --- | --- | --- |
| Database (pgTAP), 233 tests in 8 files | Business rules BR-01 to BR-15, acceptance tests AT-01 to AT-10, permissions, row-level security, the append-only log, retention, and the security conventions | `supabase test db`, or `scripts/test-local.sh` without Docker | Every pull request (CI) |
| Job code (Node), 31 tests | The AI request holds only five fields (AI-03); one retry then the template (AI-07); emails render correctly; jobs record success and failure | `npm test` | Every pull request (CI) |
| End-to-end (local) | The job code and the database agree on every function, argument and result; a weekly run and a briefing work start to finish | `scripts/test-local.sh` runs it last | Locally, before merging job or schema changes |
| Prompt evaluation, 30 cases | Real model replies pass AI-06 across 3 tones and 10 situations; a teammate reads 10 for tone | `npm run eval:prompt` | Pull requests that change `prompts/` |

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

## Writing a new test

- Name the test with the ID it proves, for example `'AT-03: the waiting draft for the changed amount is cancelled'`.
- Use invented data labelled "Test data" and reserved domains (`.example`, `.test`). `scripts/check-hygiene.sh` fails the build on anything else.
- Act as the right person: `select tests.as_user('<uuid>')` for a signed-in user, `reset role` for the database owner.
- When a test passes for the wrong reason, it is worse than no test: check it fails first by breaking the rule on purpose.

## Manual checks before the demonstration

- Accessibility: an automated checker on every screen, then keyboard-only and screen-reader passes on Home and Review (NFR-13).
- A cold-user test on Fri 23 Oct 2026: someone outside the team imports and clears a review without help (NFR-12).
- AT-10 live: record the times of the first scheduled Sunday run and Monday briefing on the dev project in the DEL-08 test log.
