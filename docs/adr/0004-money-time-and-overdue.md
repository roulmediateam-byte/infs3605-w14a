# ADR 0004: Store money in cents and calculate overdue in Sydney dates

**Status:** Accepted

## Context

Amounts must always be exact (AT-02), and "overdue" changes every day. The proof of concept runs in Sydney, across daylight saving (BR-13).

## Decision

Amounts are bigint cents (BR-14). Times are stored in UTC. "Overdue" is never stored: days overdue are today's Sydney date minus the due date (BR-06), calculated wherever they are shown.

## Consequences

No rounding errors and no stale overdue flags. Every calculation goes through private.sydney_date, so daylight saving needs no special handling. Tests pin moments in Sydney time, so they never depend on the day they run.
