#!/usr/bin/env bash
# Works out which CI jobs a change needs, so a docs-only change bills 1 minute instead of 12 (docs/testing.md,
# "What CI runs, and when"). The "checks" job in .github/workflows/ci.yml runs it and passes the answers on as job
# outputs; the "database" and "web" jobs skip themselves when theirs is false. A skipped job counts as passed.
#
#   database  supabase/ or scripts/test-local.sh changed
#   web       web/, supabase/ (the web tests run the real migrations and seed), scripts/local-stack/,
#             scripts/gen-web-types.ts or scripts/make-demo-csv.sql (the import tests' file) changed
#   both      a file every job shares changed (ci.yml, this script, the root package files, .nvmrc, .gitattributes),
#             or the change can't be worked out: a manual run, a new branch, a force push or missing history
#
# On a pull request, the checkout is GitHub's test merge of the branch into its base. Its first parent is the base as
# it is now, so the diff is exactly what merging would change, however the branch was pushed. On a push to main, the
# diff runs from the commit main was on before the push.
#
# Locally, to see what CI would run for your branch: scripts/ci-changes.sh origin/main
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

shared='^(\.github/workflows/ci\.yml|scripts/ci-changes\.sh|package\.json|package-lock\.json|\.nvmrc|\.gitattributes)$'
database='^(supabase/|scripts/test-local\.sh$)'
web='^(web/|supabase/|scripts/local-stack/|scripts/gen-web-types\.ts$|scripts/make-demo-csv\.sql$)'

word() { if [ "$1" = true ]; then echo "runs"; else echo "skipped"; fi; }

# answer DATABASE WEB WHY: prints the answer and, under GitHub Actions, hands it to the workflow.
answer() {
  echo "database=$1"
  echo "web=$2"
  echo "Why: $3"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'database=%s\nweb=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
  fi
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '**Jobs this change needs:** database %s, web %s (%s).\n' "$(word "$1")" "$(word "$2")" "$3" >>"$GITHUB_STEP_SUMMARY"
  fi
  exit 0
}
everything() { answer true true "$1"; }

head=HEAD
case "${GITHUB_EVENT_NAME:-}" in
  pull_request)
    git rev-parse --quiet --verify 'HEAD^2' >/dev/null || everything "no test merge commit to compare with"
    base='HEAD^1'
    ;;
  push)
    before="${PUSH_BEFORE:-}"
    [ "${PUSH_FORCED:-false}" != true ] || everything "a force push, so the commit before it may be gone"
    [ -n "${before//0/}" ] || everything "a new branch, so there is no earlier commit to compare with"
    if ! git cat-file -e "${before}^{commit}" 2>/dev/null; then
      git fetch --quiet --no-tags --depth=1 origin "$before" 2>/dev/null ||
        everything "the commit before the push can't be fetched"
    fi
    base="$before"
    ;;
  workflow_dispatch)
    everything "a manual run"
    ;;
  '')
    if [ $# -lt 1 ]; then
      echo "Usage: scripts/ci-changes.sh BASE [HEAD], for example scripts/ci-changes.sh origin/main" >&2
      exit 2
    fi
    head="${2:-HEAD}"
    base="$(git merge-base "$1" "$head")"
    ;;
  *)
    everything "a ${GITHUB_EVENT_NAME} event"
    ;;
esac

# --no-renames lists both sides of a move, so moving a file out of supabase/ still counts as a change there.
files="$(git diff --name-only --no-renames "$base" "$head" 2>/dev/null)" ||
  everything "git can't compare ${base} with ${head}"

count="$(grep -c . <<<"$files" || true)"
echo "Changed since ${base}: ${count} file(s)"
if [ "$count" -gt 0 ]; then sed -n '1,100s/^/  /p' <<<"$files"; fi

if grep -qE "$shared" <<<"$files"; then
  everything "a file every job shares changed"
fi
db=false
wb=false
if grep -qE "$database" <<<"$files"; then db=true; fi
if grep -qE "$web" <<<"$files"; then wb=true; fi
answer "$db" "$wb" "${count} file(s) changed"
