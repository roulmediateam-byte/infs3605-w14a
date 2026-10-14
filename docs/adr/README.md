# Architecture decision records

Each record states one decision, why it was made and what follows from it. Team decisions D1 to D7 are also kept in the decision log (DEL-17) in the MIN-1 format.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-coded-web-app-on-github.md) | Build a coded web app on GitHub with Supabase | Accepted (decision D1, Thu 15 Oct 2026, Scrum Master) |
| [0002](0002-multi-business-from-day-one.md) | Design for many businesses from day one | Accepted |
| [0003](0003-reads-through-rls-writes-through-functions.md) | Read through row-level security; write only through functions | Accepted |
| [0004](0004-money-time-and-overdue.md) | Store money in cents and calculate overdue in Sydney dates | Accepted |
| [0005](0005-placeholders-and-locked-facts.md) | Keep facts as placeholders until approval, then freeze the exact text | Accepted |
| [0006](0006-one-briefing-function.md) | Build the briefing once, for both the email and the Home screen | Accepted |
| [0007](0007-idempotent-jobs.md) | Make every scheduled job ask what is due and claim each period once | Accepted |
| [0008](0008-send-from-my-email.md) | Send reminders from the owner's own email app in the proof of concept | Proposed (decisions D2 and D3, for feature lock) |
| [0009](0009-cool-down-setting.md) | Make the cool-down a setting with a default of 6 days | Proposed (decision D6, for feature lock) |
| [0010](0010-ai-checks-in-the-database.md) | Keep the AI-06 checks and fallback templates in the database | Accepted |
| [0011](0011-zero-dependency-jobs.md) | Run the jobs on Node 22 with no runtime dependencies | Accepted |
