# Security and privacy model

The server, not the screen, decides who may do what (NFR-05). Four layers each stop a different mistake, and the pgTAP suite checks all four on every pull request.

| Layer | What it stops | Where |
| --- | --- | --- |
| Row-level security | A signed-in person reading another business's rows | `20261015090400_row_level_security.sql` |
| Table privileges | Anyone writing to a table directly, even their own business's rows | same file |
| Role checks in functions | A checker changing a tone, a team admin approving, a stranger calling an action | `private.require_role` in every write function |
| Triggers | Any writer, including the service role, skipping a lifecycle step or editing the log | `20261015090300_triggers.sql` |

## Who may do what

From Design Requirements v0.1 section 4, as built.

| Action | Owner | Checker | Team admin | Function |
| --- | --- | --- | --- | --- |
| See the briefing, invoices and log | Yes | Yes | Test data only | RLS policies, `get_briefing` |
| Import invoices | Yes | Yes | Test data only | `confirm_import` |
| Approve, edit or reject a draft | Yes | Yes | No | `approve_draft`, `reject_draft` |
| Send an approved reminder | Yes | Only if `checker_may_send` (D3) | No | `get_send_payload`, `confirm_sent` |
| Mark an invoice paid | Yes | Yes | No | `mark_paid`, `undo_mark_paid` |
| Fix a client's email | Yes | Yes | No | `update_client_contact` |
| Set a tone, pause a client, set a group | Yes | No | No | `set_client_tone`, `set_client_paused`, `set_client_group` |
| Change settings | Yes | No | No | `update_settings` |
| Invite or remove the checker | Yes | No | No | `invite_checker`, `remove_member` |
| Export or delete everything | Yes | No | No | `export_business_data`, `delete_business` |

Scheduled jobs use the service role and may call only `job_*` functions. Team admins lose access to a business the moment it holds real data (`is_test_data = false`).

## Conventions every migration must keep

- Row-level security is on for every table; members read through `business_id in (select private.my_business_ids())`.
- No policy allows insert, update or delete. Writes go through functions.
- Every function sets `search_path = ''` and uses fully qualified names.
- `anon` executes nothing; signed-in users execute app functions only; the service role executes job functions.
- Views use `security_invoker = true`, so they obey the caller's row-level security.

`tests/database/001_conventions.test.sql` reads the catalogue and fails the build if a new table, view or function breaks one of these.

## Threats considered

| Threat | Example | Control | Test |
| --- | --- | --- | --- |
| Sending without approval | A bug or a crafted request marks a draft sent | No waiting-to-sent transition; send functions refuse and log | AT-01 in 040 |
| Wrong amount reaches a client | An import changes an amount while a draft waits | Facts copied and re-checked at approval; drafts cancelled and flagged | AT-03 in 030, BR-05 in 040 |
| Tampered approved text | Text changed after approval | Approved text frozen by trigger | 040 |
| Reading another business's data | Guessing an id | RLS on reads; role check on every write, even with a known id | 050 |
| Erasing evidence | Deleting log entries | Append-only trigger; no privilege, even for the service role | 050 |
| Personal data sent to the AI | Names or amounts in the prompt | The request holds five fields only (AI-03); the style note and example refuse digits, @ and $ | 020, job unit tests |
| Prompt injection through data | A client name containing instructions | Client data never enters the prompt; replies are checked (AI-06) before saving | 010 |
| Leaked keys | A key committed to the repository | Keys only in Actions secrets; hygiene check in CI | `scripts/check-hygiene.sh` |
| Shell injection from the "Run workflow" form | A crafted business id | Inputs passed as environment variables and validated as UUIDs | job unit tests |
| Duplicate emails to the owner | A job retried after sending | Run claims per period; Resend idempotency keys | 070, job unit tests |
| Formula injection in exports | A client name such as =HYPERLINK(...) runs when the CSV is opened | The app prefixes cells starting with =, +, -, @ or a tab with an apostrophe | FR-03 acceptance test |
| Data kept too long | Testing ends but data stays | `delete_after` required for real data, and set to Wed 25 Nov 2026 for every owner-testing business by `scripts/onboard-owner.sql`; daily purge; everything deleted from Thu 31 Dec 2026 | 070; scripts check |

## In the browser

The web app holds no secret and decides nothing the server doesn't check again, so these controls protect the person and the device rather than the data's rules (TRD, Web app; ADR 0014).

| Threat | Example | Control | Test |
| --- | --- | --- | --- |
| Script injection | A client name that holds HTML | React escapes all text; no raw HTML anywhere; a Content Security Policy meta tag allows only the site's own scripts and connections to the Supabase project; no third-party scripts | `web/e2e/security.spec.ts` |
| A shared phone | The next person opens the app the owner used | Signing out forgets the session on the device before anything else, even offline with an expired token, and forgets the email, business and open "Did it send?" questions; those questions are kept per person anyway | `web/e2e/sign-in.spec.ts` |
| Tokens left in the browser's history | Back on a shared computer shows the emailed link's tokens | The app removes the address's fragment with replaceState before starting the session | `web/e2e/sign-in.spec.ts` |
| Business data left on the device | A cached API answer read later | The service worker caches the app's own files only, in a cache per build; API answers are never cached | `web/e2e/security.spec.ts`, `web/e2e-pages/` |
| Sessions mixing between the two builds | The demo build sends the owners' token to the dev project | Each Supabase project's session has its own storage key (`gpa.auth.<project host>`) | Code review: `web/src/backend/supabase.ts` (both test builds use one local project) |
| A secret key published in the site | A service role key pasted as the publishable key | The deploy workflow refuses secret and service role keys | `.github/workflows/pages.yml` |
| Other sites on the same address | Another Pages site on the account reads this one's storage | Publish from an account or organisation with no other Pages sites, or a custom domain (runbook, "Publish the web app") | Manual check |
| Redirects to another site | A crafted deep link | `404.html` only redirects within the build's own path; after sign-in, only the app's own addresses are followed | `web/e2e-pages/deep-links.spec.ts` |

## Secrets

| Secret or variable | Where it lives | Used by |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY_PILOT` | Actions secrets, one per project (dev, pilot) | Scheduled jobs |
| `ANTHROPIC_API_KEY` | Actions secret; spending cap set in the Claude Console (NFR-15) | Weekly run, prompt evaluation |
| `RESEND_API_KEY` | Actions secret | Briefing, nudge, alerts |
| `ALERT_EMAIL` | Actions secret (it is a person's address) | Alerts |
| `SUPABASE_URL`, `SUPABASE_URL_PILOT`, `APP_URL`, `APP_URL_PILOT`, `EMAIL_FROM`, `AI_MODEL`, `JOBS_ENABLED`, `JOB_TARGETS` | Actions variables (not secret) | Jobs |
| The Supabase publishable (anon) key | Actions variables `DEV_SUPABASE_PUBLISHABLE_KEY` and `PILOT_SUPABASE_PUBLISHABLE_KEY`, built into the public site | Browser; safe because RLS does the checking |

Rotate a key at once if it may have leaked: create the new one, update the secret, revoke the old one, and record it in the decision log (codes and links only).

## Privacy

- Minimum data (NFR-01): client name, contact name, email and invoice facts. No bank details, no notes about clients.
- No personal data in AI requests, logs, error reports or GitHub (NFR-04). Job logs carry ids and counts; errors are redacted.
- The AI provider does not train on API data by default; plan for its retention policy (TRD, "AI"). Xero data must never train AI models (Xero developer terms).
- Sydney region for the database (NFR-17).
- Processors to name in the written agreement for real data (D7): Supabase (database and sign-in, Sydney); Resend (emails to the owner and checker, processed overseas; the briefing carries client names and amounts); Anthropic (wording only, no personal data, overseas); GitHub (code and job logs, no personal data).
- Retention (NFR-03, PD-7): each test business is deleted within 2 weeks of its testing; all business data by Thu 31 Dec 2026. Deletion leaves a receipt with counts only.
