# Your first day

Start here. In about 30 minutes you will have the app running, know where things are and know how to make a change.

## What Get-Paid Apprentice is

Get-Paid Apprentice drafts payment reminders and a Monday briefing for small construction businesses, in the owner's voice. Nothing reaches a client until the owner or a named checker approves it. Team W14A-5 is building it as a proof of concept for INFS3605 at UNSW in Term 3 2026.

The demonstration is on Wed 28 Oct 2026 at 2:00 pm AEDT (Australian Eastern Daylight Time).

## Install

- **Node.js 22, version 22.18 or later.** The scripts run TypeScript files directly, which needs 22.18. Check with `node --version`.
- **Git.** On Windows, install Git for Windows. The repository's `.gitattributes` keeps every text file's line endings as LF (line feed), so the bash scripts work whatever your Git settings.
- **Windows and the database tools.** The local stack and the database tests are bash scripts that need PostgreSQL. Run them in WSL (Windows Subsystem for Linux).
- **Only for database work:** PostgreSQL 15 or later with pgTAP, or the Supabase command-line tool with Docker. The [README's quick start](../README.md#quick-start) has the commands.
- **Editor.** Visual Studio Code (VS Code) offers the team's recommended extensions when you open the folder.

## See the app in 5 minutes

Accept the GitHub invitation first. Then:

```bash
git clone https://github.com/roulmediateam-byte/infs3605-w14a.git
cd infs3605-w14a/web
npm ci
npm run demo
```

Open http://127.0.0.1:4174 and sign in as `owner@example.test`. No email is sent: the code appears on screen, with a "Use it" button.

This click-through preview runs the real database migrations and the Test data seed inside your browser tab. Nothing is sent anywhere, and a reload starts again from the seed. Press Ctrl+C in the terminal to stop it. It needs no bash and no database, so it is also the quickest start on Windows.

Try the review loop: open Review, approve a draft, then send it. Under More, "Run it now" drafts Sunday's reminders with the fallback templates.

## Where things are

| Path | What |
| --- | --- |
| `web/` | The web app (React, Vite and TypeScript): screens UI-01 to UI-11, unit tests and browser tests |
| `supabase/` | The database: migrations, the Test data seed and the pgTAP tests |
| `jobs/` | Scheduled jobs: the weekly run, the briefing and its check, the nudge, the health check and retention |
| `prompts/` | The AI prompt, its output format and 30 evaluation cases |
| `scripts/` | The local stack, test runners, the hygiene check and the check that picks CI's jobs |
| `docs/` | How it works: data model, security model, testing, runbook and decision records |
| `.github/` | Continuous integration (CI), the scheduled workflows, issue forms and the pull request template |
| `planning/backlog.csv` | The backlog that the GitHub issues came from |

IDs connect everything. FR is a functional requirement, NFR a non-functional one, UI a screen and EM an email. AI is an AI-behaviour rule, BR a business rule, AT an acceptance test and ADR an architecture decision record. Tests are named by the ID they prove.

## Make a change

1. Take an issue you own from "This sprint" on the board. If it isn't ready, raise it at stand-up.
2. Branch from `main`, named by kind and then ID: `feat/fr-14-review-one-draft`, `fix/…` or `docs/…`.
3. Open a draft pull request as soon as you first push, using the template. A draft runs the quick checks only.
4. When the checks pass and the work is done, select "Ready for review". That run adds the browser tests.
5. One teammate other than you reviews and approves, following [the review steps](../CONTRIBUTING.md#reviewing).
6. Squash and merge. The pull request title becomes the commit message on `main`, so write it as `feat(review): …` ([titles](../CONTRIBUTING.md#pull-request-titles)).
7. Move the issue to Done once the definition of done is met.

## Rules that are non-negotiable

- **Test data only.** The repository holds code and synthetic data labelled "Test data". It never holds course materials, interview notes, or anyone's real names, emails or invoices.
- **Reserved email domains only,** such as `owner@example.test` or `accounts@builder.example`. The hygiene check fails CI on any other address.
- **Nothing is sent without approval.** Every reminder needs an approval record, and the database enforces it. No change may weaken that.
- **No secrets in the repository.** Keys live in GitHub Actions secrets or a local `.env` file that Git ignores. If a key leaks, follow [SECURITY.md](../SECURITY.md) at once.
- **Own and record AI help.** Read and run anything an AI tool wrote for you; you take responsibility for it. Record the help in the pull request's "AI help used" field.
- **Keep data out of AI tools.** Never paste personal data, keys or course materials into one.
- **Disclose AI use.** Documents shared outside the team end with the team's AI-use line, as in the [README's last paragraph](../README.md#not-licensed-for-reuse).

## Who to ask

Ask in the team chat, with codes and links only, never data.

| Role | Ask about |
| --- | --- |
| Scrum Master | The board, the sprint and blockers; access to the repository and the product documents; secrets and repository settings |
| Product Owner | What to build, priorities and acceptance criteria; owner testing |
| Dev lead | Setup problems, the database, the web app's code and CI |
| Dev 2 (jobs and AI) | Scheduled jobs, emails, the AI prompt and the Supabase projects |
| UX lead | Screens, words, design and accessibility |

A security or personal-data problem goes to the Scrum Master and the Dev lead at once ([SECURITY.md](../SECURITY.md)).

## Read next

- [README.md](../README.md): how it works, the quick start and the repository's rules
- [CONTRIBUTING.md](../CONTRIBUTING.md): the flow, pull request titles, reviewing and the definition of done
- [docs/testing.md](testing.md): every test suite, and what CI runs for each change
- [docs/runbook.md](runbook.md): setting up, publishing, schedules and what to do when something breaks
- [AGENTS.md](../AGENTS.md): the rules any AI coding tool must follow here

AI use: Team W14A-5 used [AI tools: completed at final assembly] to help draft and structure this document. Every claim, figure and quote was checked against its source by a team member, and the team takes responsibility for the content.
