#!/usr/bin/env bash
# Sets up the GitHub repository from planning/backlog.csv: labels, one milestone per sprint and one issue per row.
# Safe to run again: existing labels are updated, and milestones and issues that already exist are skipped.
#
# Usage:
#   gh auth login
#   scripts/bootstrap-github.sh OWNER/REPO
# Then create the board: GitHub > Projects > New project > Board, add the columns Backlog, This sprint,
# In progress, In review and Done, and add the repository's issues (docs/runbook.md, "Board").
set -euo pipefail

REPO="${1:?Usage: scripts/bootstrap-github.sh OWNER/REPO}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v gh >/dev/null || { echo "Install the GitHub CLI (gh) first."; exit 1; }

echo "▶ Labels"
while IFS='|' read -r name color description; do
  gh label create "$name" --repo "$REPO" --color "$color" --description "$description" --force >/dev/null
  echo "  · $name"
done <<'LABELS'
Must|b60205|PoC scope: built first, every one tested before any Should
Should|d93f0b|Built only after every Must passes its tests
Could|fbca04|Nice to have, if time allows
Won't|cfd3d7|Not this time; specified for later
requirement|1d76db|A functional or non-functional requirement (FR-, NFR-)
screen|0e8a16|A screen or email (UI-, EM-)
setup|5319e7|Accounts, environments and tooling
quality|006b75|Tests, accessibility and performance
ops|0052cc|Running the service: jobs, secrets, retention
deliverable|c5def5|A course deliverable on the same board (DEL-)
bug|ee0701|Something does not work as specified
area:db|bfdadc|Database, row-level security and functions
area:jobs|bfdadc|Scheduled jobs and emails
area:web|bfdadc|The web app
area:ai|bfdadc|The AI step and prompts
area:privacy|bfdadc|Privacy, retention and deletion
area:docs|bfdadc|Documents and evidence
area:quality|bfdadc|Testing and quality
area:ops|bfdadc|Operations
LABELS

echo "▶ Milestones"
existing_milestones="$(gh api "repos/$REPO/milestones?state=all&per_page=100" --jq '.[].title')"
while IFS='|' read -r title due description; do
  if grep -Fxq "$title" <<<"$existing_milestones"; then
    echo "  · $title (exists)"
  else
    gh api "repos/$REPO/milestones" -f title="$title" -f due_on="$due" -f description="$description" >/dev/null
    echo "  · $title"
  fi
done <<'MILESTONES'
Sprint 1|2026-10-18T12:59:00Z|Mon 12 to Sun 18 Oct 2026: foundations, sign-in and import
Sprint 2|2026-10-25T12:59:00Z|Mon 19 to Sun 25 Oct 2026 (Flex Week): the review, send and briefing flow
Demo week|2026-11-01T12:59:00Z|Mon 26 Oct to Sun 1 Nov 2026: dry run Mon 26 Oct, demonstration Wed 28 Oct at 2:00 pm
PoV round 1|2026-11-08T12:59:00Z|Mon 2 to Sun 8 Nov 2026: first owner testing round
PoV round 2|2026-11-12T12:59:00Z|Mon 9 to Thu 12 Nov 2026: change list, then the second round
After the course|2026-12-31T12:59:00Z|Minimum viable product and later
MILESTONES

echo "▶ Issues"
existing_titles="$(gh issue list --repo "$REPO" --state all --limit 500 --json title --jq '.[].title')"
python3 - "$ROOT/planning/backlog.csv" <<'PY' | while IFS=$'\t' read -r title labels milestone body; do
import csv, sys
for row in csv.DictReader(open(sys.argv[1], encoding="utf-8")):
    title = f"{row['key']} {row['title']}"
    labels = ",".join(filter(None, [row["priority"], row["type"], f"area:{row['area']}"]))
    body = (
        f"**Owner (role):** {row['owner_role']}  \n"
        f"**Size:** {row['size']} ({row['estimate_hours']} h estimated)  \n"
        f"**Depends on:** {row['depends_on'] or 'nothing'}  \n"
        f"**Acceptance criteria:** {row['acceptance_ref']}  \n\n"
        "Definition of done: meets its acceptance criteria with tests passing in CI; reviewed and merged by a teammate; "
        "works at 360 px and passes the accessibility checks for its screen; no personal data in code, issue or logs; "
        "the pull request names the IDs it covers."
    )
    print("\t".join([title, labels, row["sprint"], body.replace("\n", "\\n")]))
PY
  if grep -Fxq "$title" <<<"$existing_titles"; then
    echo "  · $title (exists)"
    continue
  fi
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --milestone "$milestone" --body "$(printf '%b' "$body")" >/dev/null
  echo "  · $title"
done

echo "✓ Done. Next: create the board and set each issue's assignee at sprint planning."
