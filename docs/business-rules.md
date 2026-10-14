# Business rules and acceptance tests: where each is enforced and tested

Every rule in Design Requirements v0.1 section 11 and every acceptance test in section 14 maps to the code that enforces it and the test that proves it. Test files are in `supabase/tests/database/` (pgTAP) and `jobs/test/` (Node).

## Business rules

| ID | Rule (short) | Enforced in | Tested in |
| --- | --- | --- | --- |
| BR-01 | Draft an open invoice at least the threshold days overdue, client not paused and with an email, no live draft, not in cool-down | `private.ineligibility`, `job_plan_weekly_run`, re-checked in `job_save_draft` | 020 (AT-04) |
| BR-02 | Never send a draft without approval | `private.reminder_draft_guard` (no waiting-to-sent), `get_send_payload`, `confirm_sent` | 040 (AT-01) |
| BR-03 | Paid or missing from the latest import: cancel live drafts, leave the briefing | `mark_paid`, `confirm_import` step 7 | 030, 040 |
| BR-04 | No new draft within the cool-down after a confirmed send | `private.ineligibility` with `businesses.cooldown_days` (default 6, D6) | 020 (AT-05) |
| BR-05 | No email, or the amount no longer matches: no draft, no send; Needs attention | `private.ineligibility`, `confirm_import` step 6, `approve_draft` | 030 (AT-03), 040, 060 |
| BR-06 | Overdue = open and past the due date in Sydney; due this week = next 7 days | `private.days_overdue`, `private.build_briefing`, `invoice_list` view | 010, 060 |
| BR-07 | Briefing order: amount, largest first; then days overdue | `private.build_briefing`, `review_queue` | 040, 060 |
| BR-08 | An edited approval sends exactly the edit and is not a clean approval | `approve_draft` (`edited`), frozen text | 040 |
| BR-09 | Rejection needs a reason; the invoice can be drafted next run | `reject_draft`, `private.ineligibility` | 040 |
| BR-10 | A draft still live at the next weekly run is replaced | `job_plan_weekly_run` (superseded) | 020 |
| BR-11 | A paused client gets no drafts; live drafts cancelled; listed as paused | `set_client_paused`, `private.ineligibility`, briefing | 020, 060 |
| BR-12 | Drafts still waiting at noon: one email to the checker | `job_due('nudge')`, `jobs/nudge.ts` | 070 |
| BR-13 | Sunday run due from 9:00 pm (cron 9:07 pm); briefing by its slot, 7:00 am or 6:00 pm Monday (job due from 45 minutes before); nudge at 12:07 pm; Sydney time | Workflow schedules with `timezone`, `job_due` | 070 (AT-10) |
| BR-14 | Whole cents, shown as $1,250.00; UTC stored, Sydney shown | `bigint` columns, `private.format_aud`, `formatAud` | 001, 010, job unit tests |
| BR-15 | Invoice numbers match after trimming; a number twice in one file rejects both rows | `confirm_import` step 2 | 030 |

## Acceptance tests

| ID | Given / when / then (short) | Proved by |
| --- | --- | --- |
| AT-01 | A waiting draft cannot be sent by the app or directly against the server; the attempt is logged | 040: send screen and confirm refused and logged; direct update denied; service role blocked by trigger |
| AT-02 | Invoice 1043 for $1,250.00: the approved message shows exactly $1,250.00 and 1043 | 040 |
| AT-03 | An import changes $1,250.00 to $1,000.00: the draft is cancelled and the invoice flagged | 030 |
| AT-04 | 6, 7 and 30 days overdue with threshold 7; a paused client; a client with no email | 020 |
| AT-05 | Cool-down across the Sunday run | 020 (6 days per D6; 7 days shown to skip a week) |
| AT-06 | The briefing's totals equal the file's sums; largest first | 030, 060 (email and Home identical) |
| AT-07 | Deleting the amount in Edit blocks saving with the reason | 010, 040 |
| AT-08 | Running the weekly run twice creates no duplicates | 020, `scripts/e2e-local.ts` |
| AT-09 | A checker cannot change a tone or a setting | 050 |
| AT-10 | Sunday 9:00 pm run; briefing sent by 7:00 am Monday Sydney time | 070 (due times); live check on the dev project on Sun 25 and Mon 26 Oct 2026 |

AT-10 also needs one live observation, because only GitHub can prove its scheduler fired: record the run times of the first Sunday run and Monday briefing on the dev project in the DEL-08 test log (runbook, "Live weekly run and briefing").
