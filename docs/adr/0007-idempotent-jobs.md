# ADR 0007: Make every scheduled job ask what is due and claim each period once

**Status:** Accepted

## Context

GitHub Actions schedules can be delayed or dropped at busy times, and NFR-09 requires every job to be safe to repeat and runnable by hand.

## Decision

Workflows run at fixed off-the-hour Sydney times, with a second attempt or a catch-up run. Each run asks the database what is due (job_due), claims the business and period (job_start, unique per job, business and Sydney date) and records the outcome. Drafts have at most one live row per invoice. Emails carry an idempotency key. A repository variable, JOBS_ENABLED, switches every schedule off at once.

## Consequences

A dropped run is caught up; a repeated run does nothing; a failed run can be retried and keeps its history. A late briefing raises an alert 37 minutes after its slot (NFR-10).
