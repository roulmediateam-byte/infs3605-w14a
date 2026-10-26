# Instructions for AI coding tools

Payprentice drafts payment reminders for small construction businesses, and nothing reaches a client until the owner or a named checker approves it. This repository holds its Supabase database, scheduled jobs, AI prompt and React web app, with synthetic Test data only.

Read [README.md](README.md) for how it works, [CONTRIBUTING.md](CONTRIBUTING.md) for the flow and [docs/testing.md](docs/testing.md) for every test suite.

## Run the checks

From the repository root, with Node 22.18 or later:

```bash
npm ci && npm test                                    # types, then the scheduled-job unit tests
bash scripts/check-hygiene.sh                         # no secrets, and no email addresses outside reserved domains
(cd web && npm ci && npm run typecheck && npm test)   # the web app's types and unit tests
supabase db start && supabase test db                 # the pgTAP database tests (Supabase command-line tool and Docker)
PGHOST=localhost PGUSER=postgres scripts/test-local.sh   # or the same tests on PostgreSQL 15+ with pgTAP
scripts/ci-changes.sh origin/main                     # which continuous integration (CI) jobs this branch will run
```

The browser tests and the database-types check need the local stack running (`web/README.md`): `node scripts/gen-web-types.ts --check`, then `(cd web && npm run build:e2e && npx playwright test)`. To see the app with no database: `(cd web && npm run demo)`.

## Rules the code must keep

- **Test data only.** Seeds, fixtures, examples and screenshots are synthetic and labelled "Test data". Never real names, emails, invoices, interview notes or course materials.
- **Reserved email domains only:** `.example`, `.test` or `example.com`, such as `owner@example.test`. The hygiene check fails CI on any other address.
- **Money in whole cents.** Amounts are integer cents (`bigint` in the database), shown with `formatAud` in the web app. Never floating-point dollars (architecture decision record ADR 0004).
- **Overdue is calculated, never stored.** Days overdue are today's Sydney date minus the due date, worked out wherever they are shown (ADR 0004).
- **Every write goes through a role-checked database function.** Tables have row-level security and no write policies. Each write function checks the caller's role first (`private.require_role`) and sets `search_path = ''` (ADR 0003). Screens call a function, then refetch.
- **The AI never writes facts, only placeholders** such as `{amount_due}` and `{due_date}`. The app fills them in from the records at approval (ADR 0005). Never send personal data to the model (AI-03).
- **No secrets.** Keys live in GitHub Actions secrets or a local `.env` that Git ignores. The browser gets only Supabase's publishable key.
- **Australian English copy,** in the words of the App Flow and the UI design brief: "$1,250.00", "Mon 12 Oct 2026", "14 days overdue". Say "draft", never "AI-generated".
- **Migrations are append-only.** Add a new one; never edit a migration that has reached `main`.
- **Jobs stay dependency-free.** They use erasable TypeScript only and no runtime dependencies (ADR 0011).
- **Tests are named by the ID they prove,** for example `'AT-03: the waiting draft for the changed amount is cancelled'`.

## AI use the team must disclose

The team must acknowledge AI help (UNSW Code of Conduct and Values, 3.2.2), so:

- A teammate reads, runs and owns everything you write before it merges. Until then it is a draft.
- Say which files you wrote or changed, so the teammate can fill in the pull request's "AI help used" field. Never tick the accountability box ("I have seen this code, I have run it, and I take responsibility for it") for them.
- A document shared outside the team ends with the team's AI-use line. Keep the tool list exactly as written below; the Scrum Master completes it before anything is submitted.

  > AI use: Team W14A-5 used [AI tools: completed at final assembly] to help [choose what applies: draft, structure, summarise de-identified notes, check against the course criteria, write code]. Every claim, figure and quote was checked against its source by a team member, and the team takes responsibility for the content.

- Never put personal data, client details, keys or course materials into a prompt, a test, a commit or an issue.
- Never invent requirement IDs, test results, interview findings or quotes. If something is missing, say so and ask.

AI use: Team W14A-5 used [AI tools: completed at final assembly] to help draft and structure this document. Every claim, figure and quote was checked against its source by a team member, and the team takes responsibility for the content.
