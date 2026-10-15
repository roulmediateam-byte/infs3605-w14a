// Generates web/src/backend/database.types.ts from a local database, in the shape supabase-js expects, so a
// renamed column or a changed function argument breaks the web app's build rather than a screen (TRD, Web app).
// It reads the catalogue directly, so it needs only psql and a database built by scripts/local-stack/setup-db.sh.
// With the Supabase CLI, `supabase gen types typescript --local` produces an equivalent file.
//
// Usage: PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres node scripts/gen-web-types.ts [--check]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'web', 'src', 'backend', 'database.types.ts');
const database = process.env.LOCAL_DB ?? 'getpaid_dev';

const query = <T>(sql: string): T[] => {
  const out = execFileSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', `select coalesce(json_agg(q), '[]') from (${sql}) q`], {
    encoding: 'utf8',
  });
  return JSON.parse(out) as T[];
};

interface Column {
  relation: string;
  kind: 'r' | 'v';
  name: string;
  type: string;
  category: string;
  element: string | null;
  nullable: boolean;
  has_default: boolean;
  identity: string;
}

interface ForeignKey {
  name: string;
  relation: string;
  columns: string[];
  referenced: string;
  referenced_columns: string[];
  one_to_one: boolean;
}

interface FunctionArg {
  name: string;
  type: string;
  category: string;
  element: string | null;
}

interface Fn {
  name: string;
  args: FunctionArg[] | null;
  defaults: number;
  returns: string;
  returns_category: string;
  returns_set: boolean;
  table_columns: FunctionArg[] | null;
}

interface Enum {
  name: string;
  labels: string[];
}

const enums = query<Enum>(`
  select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname order by t.typname`);

const columns = query<Column>(`
  select c.relname as relation, c.relkind as kind, a.attname as name, t.typname as type, t.typcategory as category,
         et.typname as element, not a.attnotnull as nullable, a.atthasdef as has_default, a.attidentity as identity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
  where n.nspname = 'public' and c.relkind in ('r', 'v')
  order by c.relname, a.attnum`);

const foreignKeys = query<ForeignKey>(`
  select con.conname as name, cl.relname as relation,
         (select array_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(num, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.num) as columns,
         rc.relname as referenced,
         (select array_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(num, ord)
            join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.num) as referenced_columns,
         exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique and i.indpred is null
                   and i.indkey::int2[] @> con.conkey and con.conkey @> i.indkey::int2[]) as one_to_one
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_class rc on rc.oid = con.confrelid
  join pg_namespace n on n.oid = cl.relnamespace
  join pg_namespace rn on rn.oid = rc.relnamespace
  where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
  order by cl.relname, con.conname`);

const functions = query<Fn>(`
  select p.proname as name,
         (select json_agg(json_build_object('name', p.proargnames[k.ord], 'type', t.typname, 'category', t.typcategory, 'element', et.typname) order by k.ord)
            from unnest(p.proargtypes::oid[]) with ordinality k(typ, ord)
            join pg_type t on t.oid = k.typ
            left join pg_type et on et.oid = t.typelem and t.typcategory = 'A') as args,
         p.pronargdefaults as defaults,
         rt.typname as returns, rt.typcategory as returns_category, p.proretset as returns_set,
         (select json_agg(json_build_object('name', p.proargnames[k.ord], 'type', t.typname, 'category', t.typcategory, 'element', et.typname) order by k.ord)
            from unnest(p.proallargtypes, p.proargmodes) with ordinality k(typ, mode, ord)
            join pg_type t on t.oid = k.typ
            left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
           where k.mode = 't') as table_columns
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_type rt on rt.oid = p.prorettype
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('authenticated', p.oid, 'execute')
  order by p.proname`);

const enumNames = new Set(enums.map((e) => e.name));

const tsType = (type: string, category: string, element: string | null): string => {
  if (category === 'A' && element) return `${tsType(element, enumNames.has(element) ? 'E' : '', null)}[]`;
  if (enumNames.has(type)) return `Database['public']['Enums']['${type}']`;
  if (['uuid', 'text', 'varchar', 'bpchar', 'date', 'timestamptz', 'timestamp', 'time', 'timetz', 'interval', 'citext', 'inet'].includes(type)) return 'string';
  if (['int2', 'int4', 'int8', 'numeric', 'float4', 'float8', 'oid'].includes(type)) return 'number';
  if (type === 'bool') return 'boolean';
  if (type === 'json' || type === 'jsonb') return 'Json';
  if (type === 'void') return 'undefined';
  return 'unknown';
};

const indent = (text: string, spaces: number): string =>
  text
    .split('\n')
    .map((line) => (line ? ' '.repeat(spaces) + line : line))
    .join('\n');

const relationships = (relation: string): string => {
  const keys = foreignKeys.filter((key) => key.relation === relation);
  if (keys.length === 0) return 'Relationships: [];';
  const items = keys.map(
    (key) =>
      `{\n  foreignKeyName: '${key.name}';\n  columns: [${key.columns.map((c) => `'${c}'`).join(', ')}];\n  isOneToOne: ${key.one_to_one};\n  referencedRelation: '${key.referenced}';\n  referencedColumns: [${key.referenced_columns.map((c) => `'${c}'`).join(', ')}];\n}`,
  );
  return `Relationships: [\n${indent(items.join(',\n'), 2)},\n];`;
};

const relationBlock = (relation: string, kind: 'r' | 'v'): string => {
  const cols = columns.filter((c) => c.relation === relation);
  const field = (c: Column, optional: boolean, forceNullable: boolean): string =>
    `${c.name}${optional ? '?' : ''}: ${tsType(c.type, c.category, c.element)}${c.nullable || forceNullable ? ' | null' : ''};`;
  const row = cols.map((c) => field(c, false, kind === 'v')).join('\n');
  if (kind === 'v') return `${relation}: {\n  Row: {\n${indent(row, 4)}\n  };\n${indent(relationships(relation), 2)}\n};`;
  const insert = cols
    .filter((c) => c.identity !== 'a')
    .map((c) => field(c, c.nullable || c.has_default || c.identity === 'd', false))
    .join('\n');
  const update = cols
    .filter((c) => c.identity !== 'a')
    .map((c) => field(c, true, false))
    .join('\n');
  return `${relation}: {\n  Row: {\n${indent(row, 4)}\n  };\n  Insert: {\n${indent(insert, 4)}\n  };\n  Update: {\n${indent(update, 4)}\n  };\n${indent(relationships(relation), 2)}\n};`;
};

const relations = (kind: 'r' | 'v'): string[] => [...new Set(columns.filter((c) => c.kind === kind).map((c) => c.relation))];

const functionBlock = (fn: Fn): string => {
  const args = fn.args ?? [];
  const firstOptional = args.length - fn.defaults;
  const argLines = args.map((arg, i) => `${arg.name}${i >= firstOptional ? '?' : ''}: ${tsType(arg.type, arg.category, arg.element)};`);
  const argsType = argLines.length ? `{\n${indent(argLines.join('\n'), 2)}\n}` : 'Record<PropertyKey, never>';
  let returns: string;
  if (fn.table_columns && fn.table_columns.length) {
    returns = `{\n${indent(fn.table_columns.map((c) => `${c.name}: ${tsType(c.type, c.category, c.element)};`).join('\n'), 2)}\n}[]`;
  } else {
    returns = `${tsType(fn.returns, fn.returns_category, null)}${fn.returns_set ? '[]' : ''}`;
  }
  return `${fn.name}: {\n  Args: ${indent(argsType, 2).trimStart()};\n  Returns: ${indent(returns, 2).trimStart()};\n};`;
};

const output = `// Generated by scripts/gen-web-types.ts from the migrations in supabase/migrations/. Do not edit by hand:
// change a migration, rebuild the local database and run the script again.
/* eslint-disable */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
${indent(relations('r').map((r) => relationBlock(r, 'r')).join('\n'), 6)}
    };
    Views: {
${indent(relations('v').map((r) => relationBlock(r, 'v')).join('\n'), 6)}
    };
    Functions: {
${indent(functions.map(functionBlock).join('\n'), 6)}
    };
    Enums: {
${indent(enums.map((e) => `${e.name}: ${e.labels.map((l) => `'${l}'`).join(' | ')};`).join('\n'), 6)}
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
`;

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== output) {
    console.error('web/src/backend/database.types.ts is out of date. Run: node scripts/gen-web-types.ts');
    process.exit(1);
  }
  console.log('web/src/backend/database.types.ts matches the migrations.');
} else {
  writeFileSync(target, output);
  console.log(`Wrote ${path.relative(root, target)}: ${relations('r').length} tables, ${relations('v').length} views, ${functions.length} functions, ${enums.length} enums.`);
}
