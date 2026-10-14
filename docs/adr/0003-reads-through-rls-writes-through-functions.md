# ADR 0003: Read through row-level security; write only through functions

**Status:** Accepted

## Context

Every action must be logged with who, when and why (FR-21), the server must check every request against the user's role (NFR-05), and a reminder must never be sendable without approval (FR-17).

## Decision

Signed-in users get SELECT on tables, filtered by row-level security. Every write is a security definer function that checks the role first (private.require_role), does its work and writes the activity log in the same transaction. Scheduled jobs call job_* functions that only the service role may execute. Every function sets search_path to an empty string.

## Consequences

The log cannot miss an action, because the action and its log entry commit together. Business rules live in one place, tested by pgTAP. The browser cannot bypass a rule by writing to a table. The cost is more SQL to write; the conventions test (001) keeps new functions in line.
