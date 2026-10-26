<!-- Title: type(scope): what changes, for example "feat(review): open each next draft at the top (UI-03)".
     It becomes the commit message on main (CONTRIBUTING.md, "Pull request titles"). Open it as a draft first. -->

## What this changes

<!-- One or two sentences. Lead with the outcome for the owner or checker. -->

## IDs covered

<!-- For example: Closes #12. FR-14, UI-03, BR-07, AT-01 -->

## How to review

<!-- Numbered steps a teammate can follow on Test data to see the change work, for example:
     1. cd web && npm run demo, then sign in as owner@example.test (the code appears on screen).
     2. Open Review and approve the first draft.
     3. The next draft opens at the top of the page. -->

1.
2.
3.

## How it was tested

- [ ] `npm test` passes (types and job unit tests)
- [ ] `supabase test db` passes (or `scripts/test-local.sh`)
- [ ] New behaviour has a test, named with its ID
- [ ] Screens: checked at 360 px wide, by keyboard, and with the accessibility checker (WCAG 2.2 AA)

## Privacy and safety (NFR-04, NFR-06, RI-9)

- [ ] No real names, emails, invoices or screenshots of real data in code, tests, issues or this pull request
- [ ] No keys or secrets; new settings are documented in `.env.example`
- [ ] Nothing can reach a client without an approval record (FR-17, AT-01)

## Accountability and AI help

- [ ] I have seen this code, I have run it, and I take responsibility for it.

**AI help used:** <!-- The tool and what it did, for example "An AI assistant drafted the tests; I checked and edited them". Write "None" if there was none. -->

## For the reviewer

<!-- Anything to look at closely, and anything left for a follow-up issue. -->
