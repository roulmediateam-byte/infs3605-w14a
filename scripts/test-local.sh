#!/usr/bin/env bash
# Runs the migrations, the seed and every pgTAP test against a plain local PostgreSQL server (15 or later)
# with pgTAP installed. No Docker needed. CI uses the Supabase CLI instead (supabase test db).
#
# Usage:
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres scripts/test-local.sh
# The script creates (and later drops) a scratch database named by TEST_DB (default getpaid_test).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${TEST_DB:-getpaid_test}"
KEEP_DB="${KEEP_DB:-0}"

run_psql() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "▶ Creating scratch database ${DB}"
run_psql -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"

echo "▶ Supabase stand-ins"
run_psql -d "${DB}" -f "${ROOT}/supabase/tests/local/supabase_stubs.sql" >/dev/null

echo "▶ Migrations"
for migration in "${ROOT}"/supabase/migrations/*.sql; do
  echo "  · $(basename "${migration}")"
  run_psql -d "${DB}" -f "${migration}" >/dev/null
done

echo "▶ Seed (synthetic Test data)"
run_psql -d "${DB}" -f "${ROOT}/supabase/seed.sql" >/dev/null

echo "▶ pgTAP tests"
status=0
results="$(mktemp)"
for test_file in "${ROOT}"/supabase/tests/database/*.sql; do
  name="$(basename "${test_file}")"
  if ! output="$(psql -X -q -t -A -v ON_ERROR_STOP=1 -d "${DB}" -f "${test_file}" 2>&1)"; then
    echo "  ✗ ${name}: SQL error"
    echo "${output}" | sed 's/^/      /' | tail -n 20
    status=1
    continue
  fi
  printf '%s\n' "${output}" > "${results}"
  python3 - "${name}" "${results}" <<'PY' || status=1
import re, sys
name, path = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf-8").read().splitlines()
plan = next((int(m.group(1)) for l in lines if (m := re.match(r"^1\.\.(\d+)$", l.strip()))), None)
oks = [l for l in lines if re.match(r"^ok \d+", l.strip())]
fails = [l for l in lines if re.match(r"^not ok \d+", l.strip())]
ran = len(oks) + len(fails)
if fails or plan is None or plan != ran:
    print(f"  ✗ {name}: {len(oks)} passed, {len(fails)} failed, planned {plan}, ran {ran}")
    for l in lines:
        s = l.strip()
        if s.startswith("not ok") or s.startswith("#"):
            print("      " + s)
    sys.exit(1)
print(f"  ✓ {name}: {len(oks)} of {plan} passed")
PY
done
rm -f "${results}"

if [ "${status}" -eq 0 ] && command -v node >/dev/null 2>&1; then
  echo "▶ End-to-end: job code against the database functions"
  TEST_DB="${DB}" node "${ROOT}/scripts/e2e-local.ts" || status=1
fi

if [ "${KEEP_DB}" != "1" ]; then
  run_psql -d postgres -c "drop database if exists ${DB}"
fi

if [ "${status}" -ne 0 ]; then
  echo "✗ Some tests failed"
  exit 1
fi
echo "✓ All tests passed"
