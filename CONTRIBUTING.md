# Contributing

New to the team? Start with [docs/first-day.md](docs/first-day.md).

## The flow

1. Pick an issue from "This sprint" that you own. If it is not ready (no testable acceptance criteria, an unresolved dependency or no owner), raise it at the next stand-up instead.
2. Branch from `main`, named by kind and then ID: `feat/fr-14-review-one-draft`, `fix/…` or `docs/…` (also `test/…`, `ci/…` or `chore/…`).
3. Write the test first when you can, named with the ID it proves.
4. Open a draft pull request early, using the template. Name the IDs it covers and link the issue ("Closes #12").
5. When its checks pass, select "Ready for review". One teammate other than the author reviews it (see "Reviewing").
6. Green checks and one approval are required to merge (NFR-08). Merge with "Squash and merge".
7. Move the issue to Done only when the definition of done is met.

## Pull request titles

The title becomes the commit message on `main`, so write it in the Conventional Commits style: `type(scope): what changes`.

- **Type:** `feat` (new behaviour), `fix`, `docs`, `test`, `refactor`, `ci` or `chore`.
- **Scope:** the area it touches, such as `review`, `import`, `db`, `jobs`, `prompts`, `web` or `ci`.
- **Summary:** what the change does, starting with a verb, with the main ID in brackets when there is one.

For example: `feat(review): open each next draft at the top (UI-03)` or `docs(runbook): add the owner settings checklist`.

## Reviewing

Review within one working day of being asked. Put small suggestions in comments rather than blocking the merge.

1. Read the description, the IDs it covers and the linked issue's acceptance criteria.
2. Check that continuous integration (CI) passed: `checks`, `database` and `web`. "Skipped" counts as passed.
3. Check out the branch and follow the author's "How to review" steps. For a screen, `cd web && npm run demo` is often enough.
4. Read the diff against the rules: tests named by ID, Test data only, money in cents, writes through role-checked functions and no secrets.
5. For a screen, check it at 360 px wide, by keyboard and with the accessibility checker.
6. Approve, or ask for changes with a reason. Use "Request changes" only when the definition of done isn't met.

## Accountability and AI help

Every pull request carries the author's accountability line. Tick it only when it is true:

> I have seen this code, I have run it, and I take responsibility for it.

Record any AI help in the template's "AI help used" field: the tool and what it did. For example, "An AI assistant drafted the tests; I checked and edited them." Write "None" when there was none. These records back the team's AI-use statement. Never paste personal data, client details, keys or course materials into an AI tool.

## Definition of ready

An item has testable acceptance criteria (copied from the product requirements document, PRD), one owner, a size, and no unresolved dependency.

## Definition of done

- It meets its acceptance criteria, and its tests pass in CI.
- A teammate has reviewed and merged it.
- It works on a 360 px phone screen and passes the accessibility checks for its screen (Web Content Accessibility Guidelines, WCAG 2.2 AA).
- No personal data sits in its code, issue, tests or logs.
- Its pull request names the IDs it covers.

## Database changes

- Add a new migration with `supabase migration new <name>`; never edit a migration that has reached `main`.
- Keep the conventions in [docs/security-model.md](docs/security-model.md): row-level security on every table, writes through functions that call `private.require_role`, `search_path = ''`, and `select private.apply_function_grants();` at the end of any migration that creates functions.
- Add or update pgTAP tests, then regenerate the data dictionary (`scripts/gen-data-dictionary.sh`).

## Job and prompt changes

- Jobs use only erasable TypeScript syntax and no runtime dependencies (architecture decision record ADR 0011). `npm test` must pass.
- Prompt changes get a new version folder and must pass the 30-case evaluation (prompts/README.md).

## Writing

Australian English, plain words, short sentences. Amounts read "$1,250.00", dates "Mon 12 Oct 2026", lateness "14 days overdue". Say "draft", never "AI-generated". Errors say what happened and what to do next.
