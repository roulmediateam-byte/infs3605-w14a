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

if [ "${status}" -eq 0 ]; then
  echo "▶ Scripts: demo emails and owner onboarding"
  if run_psql -d "${DB}" -v owner_email='team+owner@inbox.example' -v checker_email='team+checker@inbox.example' \
       -f "${ROOT}/scripts/demo-emails.sql" >/dev/null 2>&1 \
     && run_psql -d "${DB}" -v business_name='Sample Owner Co' -v owner_name='Sam Sample' \
       -v owner_email='sam@sample-owner.example' -v xero=off -f "${ROOT}/scripts/onboard-owner.sql" >/dev/null 2>&1 \
     && ! run_psql -d "${DB}" -v business_name='Sample Owner Co' -v owner_name='Sam Sample' \
       -v owner_email='sam@sample-owner.example' -f "${ROOT}/scripts/onboard-owner.sql" >/dev/null 2>&1; then
    check="$(psql -X -q -t -A -d "${DB}" <<'SQL'
select concat_ws(',',
  (select count(*) from public.memberships where business_id = '0d5e0000-0000-4000-8000-000000000001'
     and invited_email in ('team+owner@inbox.example', 'team+checker@inbox.example')),
  (select count(*) from public.businesses where name = 'Sample Owner Co (Test data)' and is_test_data and xero_reminders = 'off'),
  (select count(*) from public.invoices i join public.businesses b on b.id = i.business_id where b.name = 'Sample Owner Co (Test data)'),
  (select sum(i.amount_due_cents) from public.invoices i join public.businesses b on b.id = i.business_id where b.name = 'Sample Owner Co (Test data)'),
  (select count(*) from public.memberships m join public.businesses b on b.id = m.business_id
     where b.name = 'Sample Owner Co (Test data)' and m.role = 'owner' and m.status = 'invited'),
  (select count(*) from public.clients c join public.businesses b on b.id = c.business_id
     where b.name = 'Sample Owner Co (Test data)' and c.paused));
SQL
)"
    if [ "${check}" = "2,1,12,6244000,1,1" ]; then
      echo "  ✓ demo-emails.sql points both invitations at team inboxes"
      echo "  ✓ onboard-owner.sql creates a Test data business with 12 sample invoices, refuses a second run"
    else
      echo "  ✗ Script results not as expected: ${check}"
      status=1
    fi
  else
    echo "  ✗ A script failed"
    status=1
  fi
fi

if [ "${KEEP_DB}" != "1" ]; then
  run_psql -d postgres -c "drop database if exists ${DB}"
fi

if [ "${status}" -ne 0 ]; then
  echo "✗ Some tests failed"
  exit 1
fi
echo "✓ All tests passed"
