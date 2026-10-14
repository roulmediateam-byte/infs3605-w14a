# Contributing

## The flow

1. Pick an issue from "This sprint" that you own. If it is not ready (no testable acceptance criteria, an unresolved dependency or no owner), raise it at the next stand-up instead.
2. Branch from `main`: `fr-14-review-one-draft`.
3. Write the test first when you can, named with the ID it proves.
4. Open a pull request using the template. Name the IDs it covers and link the issue ("Closes #12").
5. One teammate reviews. Green checks and one approval are required to merge (NFR-08).
6. Move the issue to Done only when the definition of done is met.

## Definition of ready

An item has testable acceptance criteria (copied from the PRD), one owner, a size, and no unresolved dependency.

## Definition of done

- It meets its acceptance criteria, and its tests pass in CI.
- A teammate has reviewed and merged it.
- It works on a 360 px phone screen and passes the accessibility checks for its screen (WCAG 2.2 AA).
- No personal data sits in its code, issue, tests or logs.
- Its pull request names the IDs it covers.

## Database changes

- Add a new migration with `supabase migration new <name>`; never edit a migration that has reached `main`.
- Keep the conventions in [docs/security-model.md](docs/security-model.md): row-level security on every table, writes through functions that call `private.require_role`, `search_path = ''`, and `select private.apply_function_grants();` at the end of any migration that creates functions.
- Add or update pgTAP tests, then regenerate the data dictionary (`scripts/gen-data-dictionary.sh`).

## Job and prompt changes

- Jobs use only erasable TypeScript syntax and no runtime dependencies (ADR 0011). `npm test` must pass.
- Prompt changes get a new version folder and must pass the 30-case evaluation (prompts/README.md).

## Writing

Australian English, plain words, short sentences. Amounts read "$1,250.00", dates "Mon 12 Oct 2026", lateness "14 days overdue". Say "draft", never "AI-generated". Errors say what happened and what to do next.
