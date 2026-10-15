# ADR 0014: Build the web app as a thin React client over the database functions

**Status:** Proposed (built Thu 15 Oct 2026, for planning on Mon 19 Oct 2026)

## Context

The database already enforces every rule: role checks and the log in each function (ADR 0003), locked facts (ADR 0005) and one briefing for email and Home (ADR 0006). The web app must be phone-first, meet WCAG 2.2 AA (NFR-13) and stay light for phones on mobile data. GitHub Pages hosts it and cannot set response headers (TRD, Web app). The team must be able to test it in CI without Docker, and people outside the team need to see it before a Supabase project exists.

## Decision

- React 19, TypeScript and Vite 7, with TanStack Query for data from the server. No router or component library: a small router over the History API, and components built from the UI brief's tokens.
- Screens call the database through one `Backend` interface. The Supabase adapter is the real one. A preview adapter runs the same migrations in the browser with PGlite (PostgreSQL compiled to WebAssembly), for the click-through preview only.
- Screens never change money or dates on their own: they call a function, then refetch. Nothing is queued while offline, because an approval only counts once the server has it.
- The database types are generated from the migrations by `scripts/gen-web-types.ts`, and CI fails if they drift.
- The browser repeats the import and edit checks only to explain problems early; the database decides. `web/scripts/check-parity.ts` shows both agree on 877 inputs.
- End-to-end tests run against a local stand-in for Supabase: the real migrations behind PostgREST 12.2.3, with a small shim for email codes and sign-in links (`scripts/local-stack/`). CI also builds the site as GitHub Pages serves it and tests deep links, both builds and the speed budgets through a stand-in for Pages.
- Security without response headers: a Content Security Policy meta tag that allows connections only to the Supabase project, no third-party scripts, and a service worker that caches the app shell only. The session from an emailed link is taken out of the address before it can enter the browser's history, and signing out forgets it on the device even offline.

## Consequences

- First-load JavaScript is about 160 KB compressed against a 200 KB budget, and CI checks it on every pull request.
- The stand-in is not Supabase Auth. Rate limits, email templates and redirect addresses still need checking on the dev project (runbook, "Publish the web app").
- The preview needs WebAssembly and about 13 MB of engine files. It is for showing the app, not for testing it.
- Building components by hand costs design time but matches the UI brief exactly. Moving to a component library later would touch every screen.
- Each build carries one adapter: the real build has no database engine, and the preview build has no Supabase client.
