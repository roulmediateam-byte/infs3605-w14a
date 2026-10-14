#!/usr/bin/env bash
# Regenerates docs/data-dictionary.md from the database's own comments, so the dictionary always matches the
# migrations. Needs a database with the migrations applied, for example:
#   KEEP_DB=1 scripts/test-local.sh && PGDATABASE=getpaid_test scripts/gen-data-dictionary.sh
#   PGDATABASE=postgres PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres scripts/gen-data-dictionary.sh   (local Supabase)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/docs/data-dictionary.md"
{
  echo "# Data dictionary"
  echo
  echo "Generated from the database comments by \`scripts/gen-data-dictionary.sh\`. Do not edit by hand: change the"
  echo "comment in a migration, then regenerate. Money is in whole cents (BR-14); times are UTC, shown in Sydney time."
  echo
  psql -X -q -t -A -v ON_ERROR_STOP=1 <<'SQL'
with tables as (
  select c.oid, c.relname, obj_description(c.oid, 'pg_class') as comment
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v')
  order by case c.relname when 'businesses' then 1 when 'memberships' then 2 when 'clients' then 3 when 'invoices' then 4
                          when 'imports' then 5 when 'reminder_drafts' then 6 when 'attention_items' then 7
                          when 'activity_log' then 8 when 'job_runs' then 9 when 'quotes' then 10 else 11 end, c.relname
)
select string_agg(section, E'\n' order by ord) from (
  select row_number() over () as ord,
         format(E'## %s\n\n%s\n\n| Column | Type | Null | Default | Meaning |\n| --- | --- | --- | --- | --- |\n%s\n',
                t.relname, coalesce(t.comment, ''),
                (select string_agg(format('| %s | %s | %s | %s | %s |', a.attname, format_type(a.atttypid, a.atttypmod),
                                          case when a.attnotnull then 'no' else 'yes' end,
                                          coalesce(replace(pg_get_expr(d.adbin, d.adrelid), '|', '\|'), ''),
                                          coalesce(replace(col_description(t.oid, a.attnum), '|', '\|'), '')), E'\n' order by a.attnum)
                 from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                 where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped)) as section
  from tables t
) s;
SQL
} > "$OUT"
echo "Wrote ${OUT}"
