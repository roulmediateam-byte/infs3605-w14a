# ADR 0009: Make the cool-down a setting with a default of 6 days

**Status:** Proposed (decision D6, for feature lock)

## Context

With a Sunday run, a 7-day cool-down skips a week whenever a reminder is sent after Sunday night, which makes reminders fortnightly (AT-05).

## Decision

businesses.cooldown_days defaults to 6 and can be set from 1 to 28. The cool-down compares Sydney calendar dates.

## Consequences

A reminder sent on Monday allows a new draft the next Sunday, keeping a weekly rhythm; one sent on Tuesday waits a week. Test 020 shows both cases and the 7-day behaviour, so the team can decide D6 on evidence.
