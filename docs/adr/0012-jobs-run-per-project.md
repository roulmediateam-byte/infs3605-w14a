# ADR 0012: Run every scheduled job on each Supabase project in use

**Status:** Proposed (implementation plan v1.1, for planning on Mon 19 Oct 2026)

## Context

Owner testing runs on the pilot project from Mon 2 Nov 2026, where the seed must never run. The video (Thu 12 Nov 2026) and the Week 10 Showcase still need a scripted demonstration on Test data, which lives on the dev project. A free Supabase project pauses after a week without activity, so a dev project that no job touches would be paused on Showcase day.

## Decision

Each scheduled workflow runs once per project listed in the `JOB_TARGETS` variable: `["dev"]` until owner testing, then `["dev","pilot"]`. Each project has its own address and key (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for dev; the same names ending in `_PILOT` for the pilot). "Run workflow" acts on the one project chosen in its form. A target with no address or key fails loudly instead of falling back to the other project. The web app has two builds from Mon 2 Nov: the owners' build at the site root on the pilot, and the demo build under `/demo/` on the dev project.

## Consequences

Repository secrets work on any GitHub plan, unlike environment secrets on a private repository. The daily health check keeps both free databases awake. Running jobs on dev keeps sending the seed's briefing, so the seed's addresses must point at team inboxes (`scripts/demo-emails.sql`) or the briefing goes nowhere. Actions minutes roughly double, still well inside the free allowance (TRD, Capacity).
