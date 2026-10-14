# ADR 0011: Run the jobs on Node 22 with no runtime dependencies

**Status:** Accepted

## Context

The jobs run in GitHub Actions and handle secrets. Every dependency is code that must be trusted and kept up to date (NFR-08).

## Decision

The jobs are TypeScript files run directly by Node 22.18 or later, which strips types at load. They call Supabase, Claude and Resend with the built-in fetch. TypeScript and Node types are development dependencies only, for type checking.

## Consequences

No npm install in the scheduled workflows, so they start fast and have nothing to patch. Only erasable TypeScript syntax is allowed (no enums or parameter properties), enforced by the erasableSyntaxOnly compiler option.
