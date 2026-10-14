# ADR 0002: Design for many businesses from day one

**Status:** Accepted

## Context

Design Requirements v0.1 assumed one business per installation. The PRD notes that a bookkeeper could check for several builders (section 17), and owner testing will put several businesses on one pilot project.

## Decision

Every business-owned table carries business_id. Memberships link people to businesses with a role. Row-level security filters every read by the caller's memberships.

## Consequences

One extra column per table and an index on it. No migration is needed when the product grows from one business to many. Two Supabase projects (dev and pilot) remain within the free plan.
