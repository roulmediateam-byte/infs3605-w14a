# Runbook

How to set up, run and recover the service. Every step uses Test data unless an owner has agreed in writing to test with real data (D7, NFR-02). Never paste names, emails or amounts into the team chat: use codes and links (PD-8).

## Set up a project (sprint 1, about 30 minutes)

1. Create two Supabase projects in the Sydney region (ap-southeast-2, NFR-17): `getpaid-dev` (Test data only) and `getpaid-pilot` (owner testing). The free plan allows two active projects.
2. Link and push the schema: `supabase link --project-ref <ref>` then `supabase db push`. Do not run `seed.sql` on the pilot project.
3. In Authentication: turn off new sign-ups; set the one-time link expiry to 3,600 seconds (FR-01, NFR-07); set the site URL to the GitHub Pages address; set custom SMTP to Resend (the built-in sender allows only 2 emails an hour).
4. In Resend: add the sending domain and publish its SPF, DKIM and DMARC records (NFR-18). Send a test briefing to Gmail and Outlook and check it lands in the inbox.
5. In the Claude Console: create an API key and set a monthly spending limit (proposed A$20, NFR-15).
6. In GitHub, Settings > Secrets and variables > Actions:
   - secrets `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `ALERT_EMAIL`;
   - variables `SUPABASE_URL`, `EMAIL_FROM`, `APP_URL`, `AI_MODEL` (`claude-haiku-5-5`).
   The secrets point at the dev project until owner testing starts on Mon 2 Nov 2026, then at the pilot project.
7. Set the variable `JOBS_ENABLED` to `true` to switch the schedules on. Set it to `false` to stop them at once.
8. Protect `main`: require a pull request, one approving review and the CI checks (NFR-08). Turn on Dependabot alerts.

## Board

Run `scripts/bootstrap-github.sh OWNER/REPO` once; it creates labels, milestones and one issue per row of `planning/backlog.csv`. Then create a Projects board with the columns Backlog, This sprint, In progress, In review and Done, add the issues, and assign each to its owner at sprint planning.

## Schedules (Sydney time)

| Workflow | When | What |
| --- | --- | --- |
| Weekly run | Sun 9:07 pm; catch-up Mon 5:07 am | Drafts reminders (FR-07) |
| Briefing | Mon to Fri 6:37 and 6:52 am; 5:37 and 5:52 pm | Sends the briefings due at 7:00 am or 6:00 pm (FR-11) |
| Briefing check | Mon to Fri 7:37 am and 6:37 pm | Alerts if a briefing has not gone (NFR-10) |
| Checker nudge | Mon to Fri 12:07 pm | Nudges the checker once if drafts wait (FR-25) |
| Health check and retention | Daily 9:17 am | Keeps the free database awake; deletes data past its date (NFR-03) |

Minutes avoid the top of the hour because GitHub delays or drops scheduled runs at busy times. Every job asks the database what is due, so a late run catches up and a repeated run does nothing.

## Run a job by hand

Actions > choose the workflow > Run workflow. Fill in the business id to act on one business, and tick "force" to run again for a period that already succeeded. Locally: copy `.env.example` to `.env`, fill it in, then `npm run job:weekly-run -- --business=<id> --force`.

Setup step 5 in the app flow ("a team member starts the first weekly run by hand") is this: run "Weekly run" with the new business's id and force ticked.

## When something goes wrong

| Symptom | Check | Fix |
| --- | --- | --- |
| "Alert: a briefing has not been sent" | Actions > Briefing: did it run? Table `job_runs` (job `briefing`, today): status and error | Run "Briefing" by hand for that business with force. If the database was paused, restore it in Supabase, then rerun |
| Weekly run failed | `job_runs` error for `weekly_run`; the run's log in Actions | Fix the cause, then run it by hand with force. Drafts already saved are kept; nothing is duplicated |
| Drafts all say "Template" | `reminder_drafts.fallback_reason` | `api_error`: key or spending limit. `timeout`: provider slow. `failed_checks`: run the prompt evaluation |
| An owner reports a wrong amount | The draft's `amount_shown_cents` against the invoice; the activity log | Should be impossible after approval (AT-02, BR-05). Treat as Critical: switch `JOBS_ENABLED` off, open a bug, add a test |
| The database is paused | Health check failed | Restore the project in the Supabase dashboard; the daily health check prevents this while the schedules run |

## Onboard an owner for testing (PoV, from Mon 2 Nov 2026)

1. Start them on a copy of the sample data (D7). Real data only with their written agreement, filed outside GitHub.
2. For real data, a team admin sets, in the SQL editor of the pilot project: `is_test_data = false`, `real_data_agreed_at` = the agreement date, and `delete_after` = 2 weeks after their last session (no later than Thu 26 Nov 2026 for round 2 testers).
3. Team admins lose access to that business automatically; support only when the owner asks, and say so in the team chat (codes only).
4. Check Xero's own reminders are off for their organisation (FR-32), or clients may be chased twice.

## Delete data

- An owner: Settings > Delete all (types the business name). A receipt with counts stays in `deletion_receipts`.
- By date: the daily retention job deletes businesses past `delete_after`, then sign-in accounts left without a business for 14 days.
- Course end: every business is deleted from Thu 31 Dec 2026 (NFR-03, PD-7). Record the final receipts in the decision log.

## Week 7 demonstration (Wed 28 Oct 2026, 2:00 pm)

1. On the dev project, reset to the seed: `supabase db reset --linked` (dev only), or apply `seed.sql` in the SQL editor.
2. Sign in as `owner@example.test` (create the user in Authentication first).
3. Generate the import file: `psql "<dev connection string>" -f scripts/make-demo-csv.sql > demo-import.csv`. It closes 1043, flags 1051's changed amount, skips one bad row and adds 1078.
4. Follow the demo script in Design Requirements v0.1 section 14 and the app flow's demo path.
