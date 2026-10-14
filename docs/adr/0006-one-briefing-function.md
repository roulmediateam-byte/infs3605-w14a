# ADR 0006: Build the briefing once, for both the email and the Home screen

**Status:** Accepted

## Context

FR-13 requires the Home screen to show the same briefing as the email, and AT-06 requires the totals to match the invoice list exactly.

## Decision

private.build_briefing produces the briefing as JSON. get_briefing serves the app; job_get_briefing serves the email job and adds the recipient. The email renderer only formats what it is given.

## Consequences

The two views cannot disagree; test 060 compares them field by field. Formatting changes in the email cannot change a number.
