# ADR 0008: Send reminders from the owner's own email app in the proof of concept

**Status:** Proposed (decisions D2 and D3, for feature lock)

## Context

Reminders must come from the owner's real address, and the system must never email clients in the proof of concept (Design Requirements v0.1 section 3). Sending through the owner's Gmail or Microsoft 365 needs OAuth scopes that take days to verify.

## Decision

The Send screen opens the user's email app with the recipient, subject and approved text (a mailto link), with copy buttons as a fallback. The user confirms "Sent" or "Not yet". By default only the owner sends; the owner can allow the checker to send when the checker uses the business mailbox (checker_may_send).

## Consequences

No sending infrastructure or mailbox permissions in the proof of concept. The app records a confirmation, not a delivery, so "Sent" depends on the user's word; the minimum viable product sends through the owner's mailbox (Gmail gmail.send or Microsoft Graph Mail.Send) to remove that gap.
