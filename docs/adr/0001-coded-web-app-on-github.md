# ADR 0001: Build a coded web app on GitHub with Supabase

**Status:** Accepted (decision D1, Thu 15 Oct 2026, Scrum Master)

## Context

The team compared a coded web app on GitHub, Copilot Studio with Power Automate and SharePoint, and Airtable with Make (Design Requirements v0.1 section 16). The review screen must lock facts, show one draft at a time and enforce approval on the server. The Copilot Studio trial cannot publish (UC-09b).

## Decision

Build a React, Vite and TypeScript web app, installable on a phone, hosted on GitHub Pages for the proof of concept. Supabase provides Postgres, one-time-link sign-in, row-level security and the API. GitHub Actions runs the scheduled jobs. Claude Haiku 5.5 writes the wording (D4, proposed). Resend sends the owner's and checker's emails.

## Consequences

Full control of the review screen and the approval gate; free tiers apart from AI calls (NFR-15); one private repository holds code, tasks, tests and schedules (NFR-16). GitHub Pages is not for commercial software (UC-08), so the minimum viable product moves hosting (PRD release R2). Scheduled runs can be delayed or dropped, which ADR 0007 handles.
