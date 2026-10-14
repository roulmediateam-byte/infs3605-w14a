# ADR 0010: Keep the AI-06 checks and fallback templates in the database

**Status:** Accepted

## Context

Every AI reply and every fallback template must pass the same checks (AI-06, FR-09). Two copies of the rules, one in the job and one in the database, would drift.

## Decision

private.check_reminder_template holds the checks and private.banned_phrases the banned words. The job calls job_check_template before saving and retries once (AI-07); job_save_draft checks again. Fallback templates live in private.reminder_templates, versioned by migration (AI-09).

## Consequences

One tested definition of a safe reminder. Version template/v1 adds one sentence to the v0.1 standard and firm templates, which had 32 and 35 words without the signature, below AI-06's 40-word minimum.
