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
| Data kept too long | Testing ends but data stays | `delete_after` required for real data; daily purge; everything deleted from Thu 31 Dec 2026 | 070 |

## Secrets

| Secret or variable | Where it lives | Used by |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Actions secret | Scheduled jobs |
| `ANTHROPIC_API_KEY` | Actions secret; spending cap set in the Claude Console (NFR-15) | Weekly run, prompt evaluation |
| `RESEND_API_KEY` | Actions secret | Briefing, nudge, alerts |
| `ALERT_EMAIL` | Actions secret (it is a person's address) | Alerts |
| `SUPABASE_URL`, `EMAIL_FROM`, `APP_URL`, `AI_MODEL`, `JOBS_ENABLED` | Actions variables (not secret) | Jobs |
| The Supabase publishable (anon) key | The web app's build settings | Browser; safe because RLS does the checking |

Rotate a key at once if it may have leaked: create the new one, update the secret, revoke the old one, and record it in the decision log (codes and links only).

## Privacy

- Minimum data (NFR-01): client name, contact name, email and invoice facts. No bank details, no notes about clients.
- No personal data in AI requests, logs, error reports or GitHub (NFR-04). Job logs carry ids and counts; errors are redacted.
- The AI provider does not train on API data by default; plan for its retention policy (TRD, "AI"). Xero data must never train AI models (Xero developer terms).
- Sydney region for the database (NFR-17).
- Retention (NFR-03, PD-7): each test business is deleted within 2 weeks of its testing; all business data by Thu 31 Dec 2026. Deletion leaves a receipt with counts only.
