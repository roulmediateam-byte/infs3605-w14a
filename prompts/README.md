# Prompts

The AI writes only the wording of one reminder at a time. Facts are placeholders, the records fill them in, and a person approves every message (PRD section 12).

| Path | What it is |
| --- | --- |
| `reminder-draft/v1/system.md` | The system prompt: the job, placeholders, tones, earlier reminders, the never list, the owner's voice and the format |
| `reminder-draft/v1/output.schema.json` | The structured-output schema: a subject and a body |
| `reminder-draft/evals/cases.jsonl` | 30 fixed cases: 3 tones by 10 situations |

Fallback templates and the AI-06 checks live in the database (`private.reminder_templates`, `private.check_reminder_template`), so the job and the tests use one definition (ADR 0010).

## Changing the prompt (AI-09)

1. Copy `v1` to `v2`; never edit a version that has made drafts, because each draft stores the version it came from.
2. Change `PROMPT_VERSION` in `jobs/weekly-run.ts`.
3. Open a pull request. The "Prompt evaluation" workflow runs the 30 cases; all must pass AI-06.
4. A teammate reads the 10 samples in the workflow log for tone, against the tone table in the PRD, and approves in the review.

## What the AI receives

Only `tone`, `days_overdue`, `reminders_sent_before`, `style_note` and `example_reminder` (AI-03). The style note and example are refused by the database if they contain digits, `@` or `$`, so they cannot carry amounts, dates or addresses. Ask owners to write client names as `{client_name}` in their example.
