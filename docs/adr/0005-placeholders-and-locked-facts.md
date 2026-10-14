# ADR 0005: Keep facts as placeholders until approval, then freeze the exact text

**Status:** Accepted

## Context

The AI must never see names, emails or amounts (AI-03) and must never invent facts (AI-05). An edited message must keep the invoice number and amount (FR-15), and what was approved must be exactly what is sent.

## Decision

The AI writes a subject and body with placeholders (AI-02). A draft stores that template and copies the invoice number, amount and due date from the record. Approval fills the placeholders, adds the signature from settings, checks any edit keeps the locked facts, and freezes the result in final_subject and final_body. A trigger stops anyone changing it afterwards.

## Consequences

Personal data never leaves the system for the AI. A changed amount is caught at import and again at approval (BR-05). The signature comes from settings, so the AI writes no sign-off; v1 fallback templates were lengthened to meet AI-06's 40-word minimum (see ADR 0010).
