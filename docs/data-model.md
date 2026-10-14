# Data model

Eleven tables hold everything, and every business-owned row carries `business_id`, so one database serves many businesses and a bookkeeper can later check for several builders. Amounts and dates live only in `invoices`; a draft copies the amount, number and due date when it is made, so any later change is caught before anything is sent (BR-05).

```mermaid
erDiagram
  businesses ||--o{ memberships : "has team"
  businesses ||--o{ clients : "is owed by"
  businesses ||--o{ imports : "receives"
  businesses ||--o{ invoices : "issues"
  businesses ||--o{ job_runs : "runs"
  businesses ||--o{ reminder_drafts : "drafts"
  businesses ||--o{ attention_items : "flags"
  businesses ||--o{ activity_log : "records"
  businesses ||--o{ quotes : "sends"
  clients ||--o{ invoices : "owes"
  clients ||--o{ quotes : "receives"
  imports ||--o{ invoices : "last saw"
  invoices ||--o{ reminder_drafts : "is chased by"
  invoices ||--o{ attention_items : "needs"
  job_runs ||--o{ reminder_drafts : "made"
  auth_users ||--o{ memberships : "signs in as"

  businesses {
    uuid id PK
    text name
    smallint overdue_threshold_days "BR-01, default 7"
    smallint cooldown_days "BR-04, default 6 (D6)"
    smallint briefing_weekday "Mon to Fri"
    time briefing_time "07:00 or 18:00"
    boolean checker_may_send "D3"
    boolean is_test_data "RI-9"
    date delete_after "NFR-03"
  }
  memberships {
    uuid id PK
    uuid business_id FK
    uuid user_id FK "set at first sign-in"
    text invited_email
    member_role role "owner, checker, admin"
    member_status status "invited, active, removed"
  }
  clients {
    uuid id PK
    uuid business_id FK
    text name "unique, ignoring capitals"
    text email "null means flagged"
    tone tone "gentle, standard, firm"
    boolean paused "BR-11"
  }
  invoices {
    uuid id PK
    uuid business_id FK
    uuid client_id FK
    text invoice_number "unique per business"
    date due_date
    bigint amount_due_cents "BR-14"
    invoice_status status "open, paid, closed"
    timestamptz last_reminder_sent_at "starts cool-down"
  }
  imports {
    uuid id PK
    uuid business_id FK
    int rows_read "= saved + skipped"
    bigint file_total_cents
    jsonb errors "row and reason"
  }
  reminder_drafts {
    uuid id PK
    uuid invoice_id FK "one live draft per invoice"
    uuid run_id FK
    text subject_template "placeholders"
    bigint amount_shown_cents "copied at creation"
    draft_source source "ai or template"
    draft_status status "waiting to sent"
    text final_body "frozen at approval"
  }
  attention_items {
    uuid id PK
    uuid invoice_id FK
    attention_kind kind "amount or due date changed"
    timestamptz resolved_at
  }
  activity_log {
    bigint id PK
    uuid business_id FK
    text actor_role "owner, checker, admin, system"
    activity_action action
    jsonb details "never names or emails"
  }
  job_runs {
    uuid id PK
    uuid business_id FK "null for daily jobs"
    job_name job
    text period_key "unique per job and business"
    job_status status
  }
  quotes {
    uuid id PK
    uuid client_id FK
    text quote_number
    quote_status status "Could, FR-28"
  }
```

Two more tables are not shown: `deletion_receipts` (proof of deletion, counts only, readable by the team only) and, in the private schema, `banned_phrases` and `reminder_templates`. Every column is described in [data-dictionary.md](data-dictionary.md), which is generated from the database.

## Rules the structure enforces

| Rule | How the database holds it | Test |
| --- | --- | --- |
| Money is exact (BR-14) | `bigint` cents; amounts must be more than 0 | 001, 010 |
| "Overdue" is never stale (BR-06) | No stored overdue flag; days overdue come from `private.days_overdue` in Sydney dates | 001, 010, 060 |
| One reminder in flight per invoice (AT-08) | Partial unique index `reminder_drafts_one_live` on waiting and approved drafts | 020 |
| Facts cannot drift (BR-05) | Drafts copy number, amount and due date; a trigger freezes them; approval re-checks them | 030, 040 |
| What was approved is what is sent (FR-15) | `final_subject` and `final_body` are written once at approval and frozen by a trigger | 040 |
| The log is permanent (FR-21) | Append-only trigger for every role; no update or delete privilege, even for the service role | 050 |
| Jobs never repeat (NFR-09) | `job_runs` unique on job, business and period | 020, 070 |
| Real data has a written agreement and a deletion date (D7, NFR-03) | Check constraints on `businesses`; nothing may be kept past Thu 31 Dec 2026 | 050, 070 |
| One owner and at most one checker | Partial unique indexes on `memberships` | 050 |

## Why these choices

- **Multi-business from day one.** It costs one column per table and avoids a risky migration when a bookkeeper checks for several builders (PRD section 17). See [ADR 0002](adr/0002-multi-business-from-day-one.md).
- **Writes through functions.** Each write checks the role and logs in the same transaction, so the log cannot miss an action. See [ADR 0003](adr/0003-reads-through-rls-writes-through-functions.md).
- **Placeholders in drafts, filled at approval.** The AI never sees a fact, and the approved text is frozen exactly. See [ADR 0005](adr/0005-placeholders-and-locked-facts.md).
- **Missing emails are calculated, changed amounts are stored.** Fixing an email clears its flag at once; an amount change is an event the owner should see until a new draft replaces it.

## Indexes

Every foreign key has an index, and every policy column (`business_id`) leads at least one index. The briefing reads `invoices (business_id, status, due_date)`; the review queue reads `reminder_drafts (business_id, status)`; the log reads `activity_log (business_id, at desc)`.
