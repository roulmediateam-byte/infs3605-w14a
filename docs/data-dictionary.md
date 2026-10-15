# Data dictionary

Generated from the database comments by `scripts/gen-data-dictionary.sh`. Do not edit by hand: change the
comment in a migration, then regenerate. Money is in whole cents (BR-14); times are UTC, shown in Sydney time.

## businesses

One row per business, with the settings the PRD calls the job card (FR-02, FR-29).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | no | gen_random_uuid() |  |
| name | text | no |  | Business name, used in reminders and the briefing. |
| owner_name | text | no |  | Fills {owner_name} and the signature. |
| sign_off | text | no | 'Thanks,'::text | First line of the signature the app adds below every reminder, for example "Thanks,". |
| reply_to_email | text | no |  | Where client replies go; shown on the Send screen. |
| overdue_threshold_days | smallint | no | 7 | Days past due before a reminder is drafted (BR-01). Default 7; 1 to 60. |
| cooldown_days | smallint | no | 6 | No new draft within this many Sydney days of a confirmed send (BR-04). Default 6 (decision D6, proposed). |
| briefing_weekday | smallint | no | 1 | ISO weekday of the briefing, 1 = Monday to 5 = Friday (FR-02). Drafting runs on Sunday at 9:00 pm. |
| briefing_time | time without time zone | no | '07:00:00'::time without time zone | Briefing slot in Sydney time: 07:00 or 18:00. The briefing job is due from 45 minutes before it (BR-13). |
| time_zone | text | no | 'Australia/Sydney'::text | Fixed to Australia/Sydney for the PoC. |
| trust_level | trust_level | no | 'drafts_only'::trust_level | Trust ladder rung. Fixed at drafts_only until FR-30 is built. |
| checker_may_send | boolean | no | false | Decision D3 (proposed): the owner sends; set true when the checker uses the business mailbox. |
| style_note | text | yes |  | Owner's voice (FR-27): up to 300 characters, no digits, @ or $ outside placeholders, so it is safe to send to the AI (AI-03). |
| example_reminder | text | yes |  | One past reminder in the owner's words (FR-27), with names replaced by placeholders; no digits, @ or $. |
| call_first_threshold_cents | bigint | yes |  | Invoices at or above this amount show "Consider a call" (FR-33). Null turns it off. |
| xero_reminders | xero_reminders_status | no | 'unknown'::xero_reminders_status | Answer to the setup check (FR-32): are Xero's own invoice reminders on? |
| column_mapping | jsonb | yes |  | Remembered CSV column mapping (FR-04). |
| is_test_data | boolean | no | true | True for synthetic "Test data" (RI-9). Real data needs written agreement (D7, NFR-02). |
| real_data_agreed_at | timestamp with time zone | yes |  | When the owner agreed in writing to test with real data. |
| delete_after | date | yes |  | Retention date (NFR-03, PD-7). The retention job deletes the business after this Sydney date. |
| created_at | timestamp with time zone | no | now() |  |
| updated_at | timestamp with time zone | no | now() |  |

## memberships

Who may act for a business: one owner, at most one named checker, and team admins (test data only).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | no | gen_random_uuid() |  |
| business_id | uuid | no |  |  |
| user_id | uuid | yes |  | Set when the invited person first signs in (accept_invitations). |
| invited_email | text | no |  | The email the invitation was sent to; matched at first sign-in. |
| display_name | text | no |  |  |
| role | member_role | no |  | owner, checker or admin. Admins see test data only and never approve. |
| status | member_status | no | 'invited'::member_status |  |
| invited_by | uuid | yes |  |  |
| invited_at | timestamp with time zone | no | now() |  |
| accepted_at | timestamp with time zone | yes |  |  |
| removed_at | timestamp with time zone | yes |  |  |

## clients

The businesses and people who owe money. Tone and pause are relationship decisions kept by the owner (FR-23, FR-26).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | no | gen_random_uuid() |  |
| business_id | uuid | no |  |  |
| name | text | no |  | Unique per business, ignoring capitals and outer spaces. |
| contact_name | text | yes |  | Fills {client_name}; falls back to name. |
| email | text | yes |  | Missing means flagged under Needs attention, never drafted (BR-05, FR-10). |
| tone | tone | no | 'standard'::tone | gentle, standard or firm; default standard (FR-23). |
| client_group | client_group | yes |  | Head contractor, homeowner or other (FR-34, Could). Head contractors never auto-send. |
| paused | boolean | no | false | Paused clients get no new drafts and their live drafts are cancelled (BR-11). |
| paused_at | timestamp with time zone | yes |  |  |
| external_ref | text | yes |  | Reserved for the Xero ContactID (FR-31, minimum viable product). |
| created_at | timestamp with time zone | no | now() |  |
| updated_at | timestamp with time zone | no | now() |  |

## invoices

Open, paid and closed invoices. "Overdue" is calculated from due_date in Sydney time (BR-06).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | no | gen_random_uuid() |  |
| business_id | uuid | no |  |  |
| client_id | uuid | no |  |  |
| invoice_number | text | no |  | Matched exactly after trimming spaces (BR-15). Unique per business. |
| issue_date | date | no |  |  |
| due_date | date | no |  |  |
| amount_due_cents | bigint | no |  | Outstanding amount in whole cents (BR-14), greater than 0. |
| currency | text | no | 'AUD'::text |  |
| status | invoice_status | no | 'open'::invoice_status | open, paid or closed. Paid by a person (FR-24); closed when missing from the latest import (BR-03). |
| paid_date | date | yes |  |  |
| closed_at | timestamp with time zone | yes |  |  |
| close_reason | close_reason | yes |  |  |
| last_reminder_sent_at | timestamp with time zone | yes |  | Set when a send is confirmed (FR-20); starts the cool-down (BR-04). |
| reminders_sent_count | integer | no | 0 | Confirmed sends; tells the AI how many reminders came before (AI-03, AI-08). |
| first_seen_import_id | uuid | yes |  |  |
| last_seen_import_id | uuid | yes |  |  |
| external_ref | text | yes |  | Reserved for the Xero InvoiceID (FR-31, minimum viable product). |
| created_at | timestamp with time zone | no | now() |  |
| updated_at | timestamp with time zone | no | now() |  |

## imports

One row per confirmed CSV import (FR-04 to FR-06). Nothing is saved until the user confirms (FR-05).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | no | gen_random_uuid() |  |
| business_id | uuid | no |  |  |
| uploaded_by | uuid | no |  |  |
| uploaded_at | timestamp with time zone | no | now() |  |
| file_name | text | no |  |  |
| source_format | import_format | no |  |  |
| column_mapping | jsonb | no |  |  |
| rows_read | integer | no |  | Data rows in the file, 1 to 2,000; equals rows_saved + rows_skipped. |
| rows_saved | integer | no |  |  |
| rows_skipped | integer | no |  |  |
| file_total_cents | bigint | no |  | Sum of every readable amount in the file; must match the preview the user confirmed. |
| saved_total_cents | bigint | no |  | Sum of the amounts saved. |
| invoices_added | integer | no | 0 |  |
| invoices_updated | integer | no | 0 |  |
| invoices_reopened | integer | no | 0 |  |
| invoices_kept_paid | integer | no | 0 |  |
| invoices_closed | integer | no | 0 |  |
| drafts_cancelled | integer | no | 0 |  |
| errors | jsonb | no | '[]'::jsonb | Skipped rows: [{"row": file line, "reason": text}]. No client names or emails. |

## reminder_drafts

One reminder for one overdue invoice. Facts are copied at creation so any later change is caught before sending (BR-05).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | no | gen_random_uuid() |  |
| business_id | uuid | no |  |  |
| invoice_id | uuid | no |  |  |
| run_id | uuid | yes |  |  |
| tone_used | tone | no |  |  |
| subject_template | text | no |  | Subject with placeholders, from the AI or the fallback template (AI-02). |
| body_template | text | no |  | Body with placeholders, without the signature (the app adds it from settings). |
| invoice_number_shown | text | no |  |  |
| amount_shown_cents | bigint | no |  | Amount copied from the invoice when the draft was made; must still match at approval (BR-05). |
| due_date_shown | date | no |  |  |
| source | draft_source | no |  | ai, or template when the AI failed or its reply failed the checks (FR-09, AI-07). |
| prompt_version | text | yes |  | Prompt version used (AI-09), for example reminder-draft/v1. |
| model | text | yes |  | Model used (AI-09), for example claude-haiku-5-5. |
| ai_attempts | smallint | no | 0 |  |
| fallback_reason | text | yes |  |  |
| status | draft_status | no | 'waiting'::draft_status |  |
| edited | boolean | no | false | True when the approved text differs from the generated text; not a clean approval (BR-08, FR-22). |
| final_subject | text | yes |  | Subject exactly as approved; frozen once approved (FR-15). |
| final_body | text | yes |  | Body and signature exactly as approved; what the email app receives (FR-15, FR-18). |
| approved_by | uuid | yes |  |  |
| approver_role | member_role | yes |  |  |
| approved_at | timestamp with time zone | yes |  |  |
| rejected_by | uuid | yes |  |  |
| rejected_at | timestamp with time zone | yes |  |  |
| reject_reason | reject_reason | yes |  |  |
| reject_note | text | yes |  |  |
| sent_confirmed_by | uuid | yes |  |  |
| sent_confirmed_at | timestamp with time zone | yes |  |  |
| send_method | send_method | yes |  |  |
| cancelled_at | timestamp with time zone | yes |  |  |
| cancel_reason | cancel_reason | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |
| updated_at | timestamp with time zone | no | now() |  |

## attention_items

Things the system will not draft for until a person looks, such as an amount changed by an import (BR-05, AT-03).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | no | gen_random_uuid() |  |
| business_id | uuid | no |  |  |
| invoice_id | uuid | no |  |  |
| kind | attention_kind | no |  |  |
| detail | jsonb | no | '{}'::jsonb |  |
| created_at | timestamp with time zone | no | now() |  |
| resolved_at | timestamp with time zone | yes |  |  |
| resolved_by | uuid | yes |  |  |
| resolution | text | yes |  |  |

## activity_log

Append-only log of every import, draft, flag, approval, edit, rejection, send, cancellation and payment (FR-21).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | bigint | no |  |  |
| business_id | uuid | no |  |  |
| at | timestamp with time zone | no | now() | Stored in UTC, shown in Sydney time (BR-14). |
| actor_user_id | uuid | yes |  |  |
| actor_role | text | no |  | owner, checker, admin or system (scheduled jobs). |
| action | activity_action | no |  |  |
| invoice_id | uuid | yes |  |  |
| draft_id | uuid | yes |  |  |
| client_id | uuid | yes |  |  |
| import_id | uuid | yes |  |  |
| run_id | uuid | yes |  |  |
| details | jsonb | no | '{}'::jsonb | Reasons and counts. Never names, emails or message text (NFR-04). |

## job_runs

One row per job, business and Sydney date. The unique key makes reruns safe (NFR-09); failures are visible (NFR-10).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | no | gen_random_uuid() |  |
| business_id | uuid | yes |  |  |
| job | job_name | no |  |  |
| period_key | text | no |  | Sydney date the run belongs to, YYYY-MM-DD. For weekly_run, the Sunday. |
| status | job_status | no | 'running'::job_status |  |
| trigger | job_trigger | no |  |  |
| started_at | timestamp with time zone | no | now() |  |
| finished_at | timestamp with time zone | yes |  |  |
| attempts | integer | no | 1 |  |
| stats | jsonb | no | '{}'::jsonb |  |
| error | text | yes |  | Short error text. Never personal data (NFR-04). |
| github_run_url | text | yes |  |  |

## quotes

Open quotes for "quotes gone quiet" (FR-28, Could). Follow-ups are likely commercial messages under the Spam Act (R-02).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | no | gen_random_uuid() |  |
| business_id | uuid | no |  |  |
| client_id | uuid | no |  |  |
| quote_number | text | no |  |  |
| amount_cents | bigint | no |  |  |
| date_sent | date | no |  |  |
| status | quote_status | no | 'open'::quote_status |  |
| last_contact_date | date | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |
| updated_at | timestamp with time zone | no | now() |  |

## deletion_receipts

Proof of deletion with row counts and no personal data. Readable by the team only (no row-level security policy).

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | bigint | no |  |  |
| business_id | uuid | no |  |  |
| deleted_at | timestamp with time zone | no | now() |  |
| deleted_by | uuid | yes |  |  |
| reason | text | no |  |  |
| was_test_data | boolean | no |  |  |
| row_counts | jsonb | no |  |  |

## invoice_list

Invoices with their client and derived display status for UI-07. Obeys the caller's row-level security.

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| id | uuid | yes |  |  |
| business_id | uuid | yes |  |  |
| client_id | uuid | yes |  |  |
| client_name | text | yes |  |  |
| client_has_email | boolean | yes |  |  |
| client_paused | boolean | yes |  |  |
| client_tone | tone | yes |  |  |
| invoice_number | text | yes |  |  |
| issue_date | date | yes |  |  |
| due_date | date | yes |  |  |
| amount_due_cents | bigint | yes |  |  |
| status | invoice_status | yes |  |  |
| paid_date | date | yes |  |  |
| close_reason | close_reason | yes |  |  |
| last_reminder_sent_at | timestamp with time zone | yes |  |  |
| reminders_sent_count | integer | yes |  |  |
| days_past_due | integer | yes |  |  |
| display_status | text | yes |  |  |

