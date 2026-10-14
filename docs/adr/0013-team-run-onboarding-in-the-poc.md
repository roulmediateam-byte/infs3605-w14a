# ADR 0013: The team sets up each owner in the proof of concept

**Status:** Proposed (implementation plan v1.1, for planning on Mon 19 Oct 2026)

## Context

The App Flow's first-run wizard (APP-01) needs its step stored rather than inferred: `xero_reminders` defaults to `unknown`, which is also what "Not sure" stores, and a single client without an email would block it. Building that properly costs hours the plan does not have before owner testing. Owners in testing start on a copy of the sample data anyway (D7), which the team prepares.

## Decision

In the proof of concept the team sets up each owner with `scripts/onboard-owner.sql` (a Test data business, the sample invoices and an owner invitation), invites them from Supabase Authentication, and runs the first weekly run by hand (runbook, "Onboard an owner"). The wizard moves to after the course, with its step stored explicitly.

## Consequences

Owners still get in unaided: the invitation email carries the link and the 6-digit code, and drafts are waiting at first sign-in (DEL-08, owner access in Weeks 8 and 9). The Xero question is asked by the team at onboarding and again in Settings (FR-32). The sample data now lives in two files, `supabase/seed.sql` and `scripts/onboard-owner.sql`, which must be kept in step; the local test checks the onboarding script's totals.
