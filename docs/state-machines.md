# Lifecycles

Each record moves only along the arrows below. Triggers enforce the arrows for every writer, including the service role, so a bug in the app or a job cannot skip a step.

## Reminder draft

The approval gate (FR-17, BR-02, AT-01): there is no arrow from `waiting` to `sent`.

```mermaid
stateDiagram-v2
  [*] --> waiting: weekly run saves a draft (FR-07)
  waiting --> approved: owner or checker approves, text frozen (FR-15, FR-17)
  waiting --> rejected: reason given (FR-16, BR-09)
  waiting --> cancelled: paid, closed, paused, facts changed or superseded
  approved --> sent: "Sent" confirmed (FR-18, FR-20)
  approved --> cancelled: paid, closed, paused, facts changed or superseded
  sent --> [*]
  rejected --> [*]
  cancelled --> [*]
```

| Cancel reason | When | Rule |
| --- | --- | --- |
| `invoice_paid` | A person marks the invoice paid | BR-03, FR-24 |
| `invoice_closed` | The invoice is missing from the latest import | BR-03 |
| `amount_changed`, `due_date_changed` | An import or approval finds the facts no longer match | BR-05, AT-03 |
| `client_paused` | The owner pauses the client | BR-11 |
| `email_missing` | Approval finds the client's email gone | BR-05 |
| `superseded` | The next weekly run replaces last week's draft, so days overdue stay true | BR-10 |

BR-10 is applied to approved drafts that were never sent as well as waiting ones, because their frozen text states last week's days overdue. The Send screen warns about this when the user taps "Not yet".

## Invoice

```mermaid
stateDiagram-v2
  [*] --> open: first import (FR-06)
  open --> paid: marked paid (FR-24)
  open --> closed: missing from the latest import (BR-03)
  closed --> open: seen again in a later import
  paid --> open: "Mark paid" undone
```

"Overdue", "due soon" and "due" are display states calculated from the due date in Sydney time (BR-06), never stored. A paid invoice that still appears in an export stays paid: Xero may not have caught up.

## Scheduled job run

```mermaid
stateDiagram-v2
  [*] --> running: job_start claims the period
  running --> succeeded: job_finish
  running --> failed: job_finish with a short error
  running --> skipped: nothing to do
  failed --> running: retried (attempts + 1)
  running --> running: taken over after 30 minutes stuck
  succeeded --> running: forced rerun by hand
```

One row exists per job, business and Sydney date (for the weekly run, the Sunday). A second scheduled start for the same period does nothing, which makes every job safe to repeat (NFR-09).

## Team membership

```mermaid
stateDiagram-v2
  [*] --> invited: owner invites the checker (FR-25)
  invited --> active: first sign-in (accept_invitations)
  active --> removed: owner removes them
  invited --> removed: owner withdraws the invitation
```

The owner's membership starts `active` when they create the business, or `invited` when the team sets the business up for them.
