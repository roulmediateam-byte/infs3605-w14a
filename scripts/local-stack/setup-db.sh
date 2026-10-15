#!/usr/bin/env bash
# Builds the local stack's database: Supabase stand-ins, every migration and the seed, plus the
# "authenticator" login that PostgREST uses (as on Supabase). Synthetic Test data only (RI-9).
#
# Usage: PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres scripts/local-stack/setup-db.sh
# The database is named by LOCAL_DB (default getpaid_dev) and is dropped and rebuilt every time.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${LOCAL_DB:-getpaid_dev}"

run_psql() { PGOPTIONS='-c client_min_messages=warning' psql -X -q -v ON_ERROR_STOP=1 "$@"; }

run_psql -d postgres -c "drop database if exists ${DB} with (force)" -c "create database ${DB}" >/dev/null
run_psql -d "${DB}" -f "${ROOT}/supabase/local/supabase_stubs.sql" >/dev/null
for migration in "${ROOT}"/supabase/migrations/*.sql; do
  run_psql -d "${DB}" -f "${migration}" >/dev/null
done
run_psql -d "${DB}" -f "${ROOT}/supabase/seed.sql" >/dev/null

# PostgREST signs in as "authenticator" and switches to anon, authenticated or service_role per request.
run_psql -d postgres >/dev/null <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator-local-only';
  end if;
end;
$$;
grant anon, authenticated, service_role to authenticator;
SQL
run_psql -d "${DB}" -c "grant connect on database ${DB} to authenticator" >/dev/null
echo "Local database ${DB} is ready: migrations and seed applied."
