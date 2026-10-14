# Database API

The web app and the jobs call these functions through Supabase (`supabase.rpc('name', { ... })` or `POST /rest/v1/rpc/name`). Arguments are named; errors come back with a plain-words message the app can show as it is. Reads that are not listed here use the tables and the `invoice_list` view directly, filtered by row-level security.

## For the web app (signed-in users)

| Function | Who | What it does | Returns |
| --- | --- | --- | --- |
| `accept_invitations()` | Anyone signed in | Call after every sign-in. Activates invitations for the user's email | `[{business_id, role}]`; empty means "Ask the owner to invite you" (FR-01) |
| `create_business(p_name, p_owner_name, p_reply_to_email, p_sign_off?)` | Anyone signed in | First setup; the caller becomes owner; starts as Test data (D7) | business id |
| `update_settings(p_business_id, p_changes)` | Owner | Changes listed settings (FR-02, FR-27, FR-32, FR-33, D3) | nothing |
| `invite_checker(p_business_id, p_email, p_display_name)` | Owner | Records the invitation (FR-25); the invite-member Edge Function creates the sign-in account | membership id |
| `remove_member(p_membership_id)` | Owner | Removes the checker | nothing |
| `update_client_contact(p_client_id, p_email, p_contact_name?)` | Owner, checker | Fixes an email, which clears its Needs attention flag | nothing |
| `set_client_tone(p_client_id, p_tone)` | Owner | FR-23 | nothing |
| `set_client_paused(p_client_id, p_paused)` | Owner | FR-26, BR-11; cancels live drafts | `{paused, drafts_cancelled}` |
| `set_client_group(p_client_id, p_group)` | Owner | FR-34 | nothing |
| `confirm_import(p_business_id, p_file_name, p_format, p_mapping, p_rows, p_expected_rows, p_expected_total_cents, p_allow_mass_close?)` | Owner, checker, admin (test data) | FR-04 to FR-06 in one transaction | counts and `errors` |
| `review_queue(p_business_id)` | Owner, checker, admin (test data) | Waiting drafts, largest first, with facts and signature filled in (FR-14) | rows |
| `approve_draft(p_draft_id, p_subject?, p_body?)` | Owner, checker | Approves, optionally with edited text that keeps the locked facts (FR-15, FR-17) | `{status: 'approved', changed: true, edited, draft_id, next_draft_id}`; `{status: 'cancelled', changed: true, reason, draft_id}` when a fact no longer matches the records (BR-05); `{status, changed: false, draft_id}` when the draft was already decided |
| `reject_draft(p_draft_id, p_reason, p_note?)` | Owner, checker | FR-16 | `{status: 'rejected', changed: true, draft_id}`; `{status, changed: false, draft_id}` when already decided |
| `get_send_payload(p_draft_id)` | Owner; checker if allowed (D3) | Recipient and the exact approved text, or a logged refusal (AT-01) | `{ok, to, subject, body}` or `{ok: false, code, message}` |
| `confirm_sent(p_draft_id, p_method?)` | Owner; checker if allowed | Records "Sent" and the last reminder date (FR-18, FR-20); safe to tap twice | `{ok, changed, draft_id}`; `changed: false` when already recorded |
| `mark_paid(p_invoice_id, p_paid_date?)` | Owner, checker | FR-24; cancels live drafts | `{status: 'paid', changed: true, drafts_cancelled}`; `{status: 'paid', changed: false}` when already paid |
| `undo_mark_paid(p_invoice_id)` | Owner, checker | Undo for a mistaken "Mark paid" | nothing |
| `dismiss_attention(p_item_id)` | Owner, checker | Clears a Needs attention item | nothing |
| `get_briefing(p_business_id, p_as_of?)` | Owner, checker, admin (test data) | The Home screen briefing; the same function as the email (AT-06) | JSON |
| `get_trust_summary(p_business_id, p_as_of?)` | Owner, checker, admin (test data) | FR-22 | JSON |
| `log_review_session(p_business_id, p_stats)` | Owner, checker | FR-19 and the review-time metric; numbers only | nothing |
| `export_business_data(p_business_id)` | Owner | FR-03; every record as JSON for CSV download. When writing the CSV files, prefix any cell that starts with =, +, -, @ or a tab with an apostrophe, so a spreadsheet never runs it as a formula | JSON |
| `delete_business(p_business_id, p_confirm_name)` | Owner | FR-03; deletes everything after the name is typed | `{deleted, receipt_id, row_counts}` |

Errors to handle in the interface:

| Code | Meaning | Show |
| --- | --- | --- |
| `28000` | Not signed in | Send to sign-in |
| `42501` | Not allowed for this role or business, including an id that belongs to another business | "You don't have permission to do that." |
| `22023` | A rule was broken; the message says which | The message, next to the field it names |
| `P0001` with hint `confirm_mass_close` | The import would close most open invoices | A confirmation dialog, then call again with `p_allow_mass_close = true` |
| `P0002` | Not found (deleted, or never existed) | "This item is no longer available." |
| `23505` | Already exists (for example a second checker) | The message |

## For the scheduled jobs (service role only)

| Function | Used by | What it does |
| --- | --- | --- |
| `job_due(p_job, p_as_of?)` | All jobs | The businesses and periods to handle now, in Sydney time (AT-10) |
| `job_period_key(p_job, p_as_of?)` | Manual runs | The period a run belongs to |
| `job_start(p_job, p_business_id, p_period_key, p_trigger?, p_github_run_url?, p_force?)` | All jobs | Claims a period once (NFR-09) |
| `job_finish(p_run_id, p_status, p_stats?, p_error?)` | All jobs | Records the outcome |
| `job_plan_weekly_run(p_run_id, p_as_of?)` | Weekly run | Replaces last week's drafts (BR-10), flags missing emails (FR-10) and lists the invoices to draft with only the fields the AI may see (AI-03) |
| `job_check_template(p_subject, p_body, p_tone)` | Weekly run, prompt evaluation | The AI-06 checks |
| `job_get_templates()` | Weekly run | Fallback templates (FR-09) |
| `job_save_draft(...)` | Weekly run | Saves a draft with its facts copied; ignores invoices that no longer qualify |
| `job_get_briefing(p_business_id, p_as_of?)` | Briefing | EM-01 content and the owner's address |
| `job_get_nudge(p_business_id)` | Nudge | EM-02 content and the checker's address |
| `job_record_email(p_run_id, p_provider_message_id)` | Briefing, nudge | Logs `briefing_sent` or `nudge_sent` |
| `job_health(p_as_of?)` | Health check | Failed and stuck runs |
| `job_retention_purge(p_as_of?)` | Health check | Deletes businesses past their delete date, and all from Thu 31 Dec 2026 |
| `job_orphan_users(p_as_of?)` | Health check | Sign-in accounts with no business for 14 days, for deletion through the Auth admin API |
