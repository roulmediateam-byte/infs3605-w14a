# Runbook

How to set up, run and recover the service. Every step uses Test data unless an owner has agreed in writing to test with real data (D7, NFR-02). Never paste names, emails or amounts into the team chat: use codes and links (PD-8).

## Set up a project (sprint 1, about 30 minutes)

1. Create two Supabase projects in the Sydney region (ap-southeast-2, NFR-17): `getpaid-dev` (Test data only) and `getpaid-pilot` (owner testing). The free plan allows two active projects.
2. Link and push the schema: `supabase link --project-ref <ref>` then `supabase db push`. Do not run `seed.sql` on the pilot project. For the dev project, Actions > "Set up the dev database" does this from GitHub instead, with the seed (Test data), and needs no command-line tools; it uses the secrets in step 6.
3. In Authentication: turn off new sign-ups; set the one-time link expiry to 3,600 seconds (FR-01, NFR-07); set the site URL to the GitHub Pages address; set custom SMTP to Resend (the built-in sender allows only 2 emails an hour); edit the magic-link and the invite-user email templates so each carries both the link (`{{ .ConfirmationURL }}`) and the 6-digit code (`{{ .Token }}`), because phones often open links in an email app's own browser. The team invites owners from Authentication, so the invite template is the first email an owner sees.
4. In Resend: add the sending domain and publish its SPF, DKIM and DMARC records (NFR-18). Send a test briefing to Gmail and Outlook and check it lands in the inbox.
5. In the Claude Console: create an API key and set a monthly spending limit (proposed A$20, NFR-15).
6. In GitHub, Settings > Secrets and variables > Actions. Each job runs once per project it targets, so the dev and pilot projects each have their own address and key:
   - secrets `SUPABASE_SERVICE_ROLE_KEY` (dev), `SUPABASE_SERVICE_ROLE_KEY_PILOT`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `ALERT_EMAIL`;
   - for "Set up the dev database": secrets `DEV_DB_URL` (the dev project's "Session pooler" connection string from Connect, with the database password; GitHub's runners can't reach the direct connection, which needs IPv6), `DEMO_OWNER_EMAIL` and `DEMO_CHECKER_EMAIL` (team inboxes; plus-addresses of one inbox work). Until custom SMTP is set up, Supabase's built-in sender only mails the project team's own addresses, so use the owner's Supabase sign-in address as `DEMO_OWNER_EMAIL`;
   - variables `SUPABASE_URL` (dev), `SUPABASE_URL_PILOT`, `APP_URL` (the demo build), `APP_URL_PILOT` (the owners' build), `EMAIL_FROM`, `AI_MODEL` (`claude-haiku-5-5`);
   - variable `JOB_TARGETS`: `["dev"]` until owner testing starts on Mon 2 Nov 2026, then `["dev","pilot"]`. The dev project keeps running after that, because the video (Thu 12 Nov) and the Week 10 Showcase are demonstrated on it, and its daily health check stops the free database from pausing.
7. Set the variable `JOBS_ENABLED` to `true` to switch the schedules on. Set it to `false` to stop them at once, on both projects.
8. Protect `main`: require a pull request, one approving review and the CI checks (NFR-08). Turn on Dependabot alerts. The exact settings are in the "Owner settings checklist" below.
9. Web app builds (SET-08): until Mon 2 Nov 2026 both builds use the dev project. From then on the owners' build at the site root uses the pilot project, and the demo build under `/demo/` stays on dev. Add both addresses to each project's redirect list. The navigation shows a screen only once it has passed its tests, so no build has a dead link. Steps in "Publish the web app" below.

## Publish the web app

GitHub Pages serves the app; the site is public even from a private repository, so it holds only the app and publishable keys. Pages is not for commercial use (UC-08), so it hosts the proof of concept only.

1. The repository owner needs GitHub Pro, Team or Enterprise for Pages from a private repository. Students get GitHub Pro free through the GitHub Student Developer Pack.
2. Settings > Pages > Build and deployment: set Source to "GitHub Actions".
3. Settings > Secrets and variables > Actions > Variables (variables, not secrets: the values end up in the public site):
   - `DEV_SUPABASE_URL` and `DEV_SUPABASE_PUBLISHABLE_KEY`, from the dev project's API settings. Never the secret or service role key.
   - `PILOT_SUPABASE_URL` and `PILOT_SUPABASE_PUBLISHABLE_KEY` on Mon 2 Nov 2026. Until they exist, the site root uses the dev project too.
   - `SUPPORT_EMAIL`, the team address behind "Contact the team" under More. It sends the business code only.
   - `DEMO_HIDE_SCREENS`, for example `invoices,clients,settings`, to leave screens out of the demonstration build's navigation. Empty shows every screen.
   - `SIGN_IN_EMAIL`: `link` while the project sends Supabase's built-in email. On a new free project its templates can't change without custom SMTP, so the email holds a link and no code. Sign-in then leads with the link and also takes it pasted, so a wrong Site URL or a phone's email app can't strand anyone. Leave it empty once the email carries the code.
4. In each Supabase project, Authentication > URL Configuration: add `https://OWNER.github.io/REPO/` and `https://OWNER.github.io/REPO/demo/` to the redirect URLs. The sign-in link returns to the build the person signed in from, and Supabase sends it only to listed addresses. Set the Site URL to the root until Mon 2 Nov 2026; then set the dev project's to `/demo/`.
5. Merge to `main`: any change under `web/` publishes both builds. To publish without a change, run Actions > "Deploy the web app" > Run workflow.
6. After each publish, open both builds on a phone and sign in with a code. Check that the browser console shows no "Content Security Policy" errors and that a briefing email's Review link opens the right draft.
7. To roll back, revert the pull request; the site republishes from `main`.

The workflow refuses to publish when the pilot address and key aren't set together, or when a key looks like a secret or service role key. Every Pages site on one account shares one web address (`OWNER.github.io`), and pages there can read each other's browser storage. So publish from an account or organisation with no other Pages sites, or give the site its own custom domain.

## Owner settings checklist

Only the account that owns the repository, `roulmediateam-byte`, can change these settings: collaborators have write access only. "Needs Pro" means the setting works on this private repository only once that account has GitHub Pro.

1. **GitHub Pro on the owning account (the Pro item itself).** Apply through the GitHub Student Developer Pack, then confirm the plan on the account's billing page. Actions minutes and plan features follow the account that owns the repository, not the person who pushes. Pro gives 3,000 Actions minutes a month instead of 2,000, protected branches and GitHub Pages for a private repository.
2. **Actions usage alerts and a budget (any plan).** Billing and licensing > Budgets and alerts: under "Included usage alerts", tick "Receive alerts when my included usage reaches 90% and 100%". If a payment method is ever added, also create an Actions budget with "Stop usage when budget limit is reached". Without a payment method, every workflow stops when the month's minutes run out, the scheduled briefings included.
3. **Protect `main` (needs Pro), after the CI change that adds the `checks` job has merged.** In Settings > Branches, add a branch protection rule for `main`:
   - Require a pull request before merging, with 1 approval.
   - Require status checks to pass: `checks`, `database` and `web`. They can be picked once CI has run with these names. Never require "Prompt evaluation": it runs only when the prompt changes, so other pull requests would wait for it forever.
   - Leave "Require branches to be up to date before merging" off. Otherwise every merge makes each open pull request run CI again.
   - Require conversation resolution before merging.
   - Leave force pushes and deletions off.
   - Leave "Do not allow bypassing the above settings" off, so admins are exempt and the owner keeps an emergency merge in demonstration week.
4. **Squash merging only (any plan).** Settings > General > Pull Requests: keep "Allow squash merging" and choose the pull request title as its default message. Turn off merge commits and rebase merging.
5. **Automatically delete head branches (any plan).** On the same page, tick "Automatically delete head branches".
6. **Dependabot alerts and security updates (any plan).** In the repository's security settings, turn both on. Security fixes keep arriving while version updates are paused.
7. **Resume Dependabot version updates after Thu 29 Oct 2026 (any plan).** In `.github/dependabot.yml`, restore `open-pull-requests-limit` to 5 on all three entries, through a pull request. Dependabot opens updates again at its next Monday run, at 8:00 am Sydney time.

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

Actions > choose the workflow > Run workflow. Choose the project (dev or pilot), fill in the business id to act on one business, and tick "force" to run again for a period that already succeeded. A forced briefing gets an email key of its own, so it is really sent again. Locally: copy `.env.example` to `.env`, fill it in, then `npm run job:weekly-run -- --business=<id> --force`.

After onboarding an owner, run "Weekly run" on the pilot with the new business's id, so their first drafts are waiting when they sign in. Force is not needed for a new business.

## When something goes wrong

| Symptom | Check | Fix |
| --- | --- | --- |
| "Alert: a briefing has not been sent" | Actions > Briefing: did it run? Table `job_runs` (job `briefing`, today): status and error | Run "Briefing" by hand for that business with force. If the database was paused, restore it in Supabase, then rerun |
| Weekly run failed | `job_runs` error for `weekly_run`; the run's log in Actions | Fix the cause, then run it by hand with force. Drafts already saved are kept; nothing is duplicated |
| Drafts all say "Template" | `reminder_drafts.fallback_reason` | `api_error`: key or spending limit. `timeout`: provider slow. `failed_checks`: run the prompt evaluation |
| An owner reports a wrong amount | The draft's `amount_shown_cents` against the invoice; the activity log | Should be impossible after approval (AT-02, BR-05). Treat as Critical: switch `JOBS_ENABLED` off, open a bug, add a test |
| The database is paused | Health check failed | Restore the project in the Supabase dashboard; the daily health check prevents this while the schedules run |

## Onboard an owner for testing (PoV, from Mon 2 Nov 2026)

In the proof of concept the team sets each owner up; the first-run wizard (APP-01) comes after the course. About 10 minutes per owner (OPS-01).

1. Ask whether Xero sends its own reminders for their organisation (FR-32). If it does, ask them to turn them off, or clients may be chased twice.
2. Create their business on the pilot project with a copy of the sample data (D7): `psql "<pilot connection string>" -v business_name='<business>' -v owner_name='<name>' -v owner_email='<email>' -v xero=off -f scripts/onboard-owner.sql` (use `on` or `unknown` for `xero` as they answered). The script sets `delete_after` to Wed 25 Nov 2026, so the business is deleted by Thu 26 Nov at the latest (PD-7). Never paste these details into the team chat (PD-8).
3. Invite them: Authentication > Invite user, with the same address. The invite email carries the link and the 6-digit code.
4. Run "Weekly run" on the pilot with the business id printed by step 2, so drafts are waiting at their first sign-in.
5. Real data only with their written agreement, filed outside GitHub. Then a team admin sets, in the pilot's SQL editor: `is_test_data = false` and `real_data_agreed_at` = the agreement date.
6. After their last session, a team admin brings `delete_after` forward to 2 weeks after it, never later than Wed 25 Nov 2026. The daily job deletes a business the day after its `delete_after` date, so Wed 25 Nov means deleted on Thu 26 Nov at 9:17 am (PD-7).
7. Once a business holds real data, team admins lose access to it automatically; support only when the owner asks, and say so in the team chat (codes only).

## Testers' sign-in accounts

The cold-user test (QA-02) and the acceptance tests put a tester's own email address into the dev project's sign-in accounts. Delete each tester's account (Authentication > Users) once their test is recorded, and by Mon 26 Oct 2026 for the cold-user test. The dev project holds Test data only.

## Delete data

- An owner: Settings > Delete all (types the business name). A receipt with counts stays in `deletion_receipts`.
- By date: the daily retention job deletes businesses past `delete_after`, then sign-in accounts that have no business and were created more than 14 days ago. A deleted owner's sign-in therefore goes within 14 days.
- Course end: every business is deleted from Thu 31 Dec 2026 (NFR-03, PD-7). Record the final receipts in the decision log.

## Live weekly run and briefing (AT-10)

AT-10 needs a real Sunday run and a real Monday briefing. Reset the dev project to the seed by Sat 24 Oct 2026 and run `scripts/demo-emails.sql` (below), with `JOBS_ENABLED` on. The scheduled weekly run on Sun 25 Oct at 9:07 pm drafts the week, and the briefing reaches the team's owner inbox by 7:00 am on Mon 26 Oct. Record both in the DEL-08 test log.

## Week 7 demonstration (Wed 28 Oct 2026, 2:00 pm)

The seed's addresses end in `.test`, which never receives mail, so point them at team inboxes first.

Without GitHub secrets: the Edge Function `demo-weekly-run` runs step 6 from the app itself. Deploy it to the dev project only: `supabase functions deploy demo-weekly-run --use-api --project-ref <dev ref>`. The demonstration build (`VITE_DEMO_TOOLS=on`) then shows the owner of a Test data business "Try the Week 7 demo" on Home and "Run it now" under More. Either runs the scheduled job's own code, forced, with the project's service key, which never reaches the browser. The function refuses anyone but the business's active owner, and any business that isn't Test data. Claude writes the wording once `ANTHROPIC_API_KEY` is set under Edge Functions > Secrets; until then the fixed templates do.

With sign-up (`VITE_DEMO_SIGN_UP=on`, the live `/demo/` build since Tue 27 Oct 2026), nobody needs a team inbox. Anyone opens the demonstration build, taps "Create an account", makes up an email ending in `.test` (for example `sam@demo.test`) and a password of 8 or more characters, and lands on Home with their own copy of the seed's Test data business. Nothing touches anyone else's copy. On Import, "Use the Week 7 demonstration file" builds the file from that copy, so its dates always match. The Edge Function `demo-sign-up` does this with the service key: deploy it to the dev project only, with JWT checking off (`supabase functions deploy demo-sign-up --no-verify-jwt --use-api --project-ref <dev ref>`), after migration 8 (`20261027090000_demo_sign_up.sql`). It takes made-up addresses only (reserved domains such as `.test`), so no real address is kept, and it sends no email. These accounts can't accept invitations. It allows 300 accounts, 60 an hour and 10 copies per account, and closes after Wed 25 Nov 2026; each copy has `delete_after` Wed 25 Nov 2026 (PD-7). Turn it off by deleting the function in the dashboard. The steps below are for the seed's own business and team inboxes.

Steps 1 to 4 in one go: Actions > "Set up the dev database" > Run workflow, type `RESET`, then download "demo-import" from the run's artifacts and sign in as in step 3. Run it again to start a rehearsal over; sign in again afterwards. The manual steps:

1. On the dev project, reset to the seed: `supabase db reset --linked` (dev only), or apply `seed.sql` in the SQL editor.
2. Point the seed's owner and checker at team inboxes: `psql "<dev connection string>" -v owner_email='<team inbox>' -v checker_email='<team inbox>' -f scripts/demo-emails.sql`. Plus-addresses of one inbox work. Never commit the addresses.
3. Add both addresses as users (Authentication > Add user), then open the demonstration build (`https://OWNER.github.io/REPO/demo/`) on the demonstration phone and sign in as the owner with the 6-digit code. With `SIGN_IN_EMAIL=link`, open the emailed link on that phone instead, or paste it into the sign-in screen.
4. Generate the import file: `psql "<dev connection string>" -f scripts/make-demo-csv.sql > demo-import.csv`. It closes 1043, lowers 1051 by A$450.00 (so its draft is cancelled and flagged), skips one bad row and adds 1078. After the import, Review holds 3 drafts: 1066, 1056 and 1062.
5. At 1:30 pm, run "Briefing" on dev with the seed business's id (`0d5e0000-0000-4000-8000-000000000001`). Force is needed only if a briefing already went that day.
6. During the demonstration, the evidence lead runs "Weekly run" on dev with the seed business's id and force ticked, and the narrator says so: in real use it runs every Sunday at 9:07 pm. Without GitHub secrets, the driver taps "Run Sunday's drafting" on Home instead. Force is needed because the seed already holds this week's run. 1051 is redrafted at A$8,000.00, so Review holds 4 drafts.
7. Follow the app flow's demonstration path. If the run is slow, carry on and return to 1051 at the end.
