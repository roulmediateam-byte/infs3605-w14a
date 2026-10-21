// The in-browser preview backend: the repository's own migrations and seed, running in PostgreSQL compiled to
// WebAssembly (PGlite), with Test data only. Every call goes through the same database functions, row-level
// security and role checks as on Supabase; each runs as the signed-in person, with the same JSON Web Token claims
// PostgREST would set. Only sign-in differs: there is no email, so the code is shown on screen.
// Nothing leaves the browser. The database is kept in this browser's IndexedDB, so a reload carries on where the demo
// was, and "Reset demo data" under More starts again from the seed (preview-store.ts). Where the browser can't keep
// it, or another tab already does, the preview runs in memory and a reload starts again.
import type { IdbFs, PGlite, Transaction } from '@electric-sql/pglite';
import stubsSql from '../../../supabase/local/supabase_stubs.sql?raw';
import seedSql from '../../../supabase/seed.sql?raw';
import type { LogEntry } from '../lib/activity.ts';
import { AppError, fromDatabaseError, MESSAGES } from './errors.ts';
import {
  STORE_DATA_DIR,
  STORE_NAME,
  deleteStoredCopy,
  fingerprint,
  forgetPreviewKeys,
  holdStorageLock,
  indexedDbWorks,
  readSavedSession,
  saveSession,
  storedCopyExists,
} from './preview-store.ts';
import type {
  ApproveResult,
  AuthEvent,
  AuthUser,
  Backend,
  Briefing,
  Business,
  Client,
  ConfirmSentResult,
  DeleteResult,
  DraftRecord,
  ImportResult,
  ImportSummary,
  InvoiceListRow,
  MarkPaidResult,
  Member,
  Membership,
  OpenAttentionItem,
  PreviewStorage,
  QueueItem,
  RejectResult,
  SendPayload,
  TrustSummary,
  WeeklyRun,
} from './types.ts';

const migrations = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const migrationNames = Object.keys(migrations).sort();

/**
 * Progress for the loading screen while the database starts. The engine downloads first; then a copy this browser
 * kept is opened ("open"), or a new database is made ("start"), loaded ("migrate") and saved ("save").
 */
export type BootStep = 'download' | 'open' | 'start' | 'migrate' | 'save' | 'ready';
let onBootStep: (step: BootStep) => void = () => undefined;
export const watchBoot = (listener: (step: BootStep) => void): void => {
  onBootStep = listener;
};

/**
 * Reports a step and lets the page paint it. The database work runs on the page's own thread and only awaits finished
 * promises between statements, so without this pause the screen would jump from the first step to the last.
 */
const announce = async (step: BootStep): Promise<void> => {
  onBootStep(step);
  await new Promise<void>((resolve) => {
    // After the next frame, or after a moment in a background tab, where frames don't run.
    const fallback = setTimeout(resolve, 100);
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(fallback);
        resolve();
      }, 0),
    );
  });
};

/**
 * Changes when the way the preview builds or keeps its database changes. The SQL itself is read into the fingerprint,
 * so editing a migration or the seed rebuilds a kept copy on its own.
 */
const BUILD_RECIPE = 'preview build 1: 1 MB WAL files; fingerprint in preview_meta.build';

/** 1 MB write-ahead log files instead of 16 MB: each save writes the current file whole, so smaller files save faster. */
const INITDB_ARGS = ['--wal-segsize=1'];

const LOCK_WAIT_MS = 3000;
const INDEXEDDB_WAIT_MS = 5000;
const DELETE_WAIT_MS = 5000;

/** One of the engine's files, next to the page (build/plugins.ts, previewEngine). Fails clearly if it is missing. */
const engineFile = async (name: string): Promise<Response> => {
  const response = await fetch(new URL(`pglite/${name}`, document.baseURI).toString());
  if (!response.ok) throw new Error(`The database engine file ${name} didn't load (HTTP ${response.status}).`);
  return response;
};

/** The engine's file-system bundle arrives as gzip, written as base64 in JSON (see build/plugins.ts for why). */
const readBundle = async (response: Response): Promise<Blob> => {
  const { encoding, data } = (await response.json()) as { encoding?: string; data?: string };
  if (encoding !== 'gzip+base64' || typeof data !== 'string') throw new Error("The database engine's file bundle is in a format this preview doesn't know.");
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).blob();
};

type Engine = typeof import('@electric-sql/pglite');

interface EngineFiles {
  pgliteWasmModule: WebAssembly.Module;
  initdbWasmModule: WebAssembly.Module;
  fsBundle: Blob;
}

/** How changes reach this browser's storage. In memory every method does nothing but run the work. */
interface Keeper {
  /** Saves now. PGlite saves after each statement, but not after a transaction's COMMIT. */
  save(): Promise<void>;
  /** Runs several statements, then saves once: a drafting run writes one copy, not one per draft. */
  batch<T>(work: () => Promise<T>): Promise<T>;
  /** Stops saving and deletes the stored copy (Reset). True once it is gone, or if there was none. */
  discard(): Promise<boolean>;
}

interface Started {
  db: PGlite;
  keeper: Keeper;
  storage: PreviewStorage;
}

/** The parts of Emscripten's file system the kept copy reads. */
interface FileSystemView {
  readdir(path: string): string[];
  stat(path: string): { mode: number; mtime: Date | number };
  isDir(mode: number): boolean;
}

/** Every file and folder in the data directory with when it last changed. Quick: it is all in memory. */
const fileTimes = (fs: FileSystemView, root: string): Map<string, number> => {
  const times = new Map<string, number>();
  const walk = (dir: string) => {
    for (const name of fs.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const path = `${dir}/${name}`;
      const stat = fs.stat(path);
      times.set(path, typeof stat.mtime === 'number' ? stat.mtime : stat.mtime.getTime());
      if (fs.isDir(stat.mode)) walk(path);
    }
  };
  walk(root);
  return times;
};

const sameTimes = (a: Map<string, number>, b: Map<string, number>): boolean => a.size === b.size && [...a].every(([path, time]) => b.get(path) === time);

/**
 * PGlite's IndexedDB file system, with three changes:
 *   * saving pauses while `held` is above 0, so a build or a drafting run is saved once;
 *   * a save is skipped when nothing in the data directory changed since the last one: PGlite saves after every
 *     statement, and each save reads back the whole stored list of files, which made reads slow;
 *   * if the browser refuses a save (storage full, or taken away), saving stops and the tab carries on in memory:
 *     otherwise every later query would fail too.
 * Only one tab writes the copy (holdStorageLock), so what was last saved is what the copy holds.
 */
const keptFileSystem = (Base: typeof IdbFs, onFail: () => void) => {
  const root = `/pglite/${STORE_NAME}`;
  class KeptFs extends Base {
    held = 0;
    failed = false;
    saved: Map<string, number> | null = null;

    times(): Map<string, number> {
      return fileTimes(this.pg?.Module.FS as FileSystemView, root);
    }

    override async initialSyncFs(): Promise<void> {
      await super.initialSyncFs();
      this.saved = this.times();
    }

    override async syncToFs(relaxedDurability?: boolean): Promise<void> {
      if (this.held > 0 || this.failed) return;
      const now = this.times();
      if (this.saved && sameTimes(now, this.saved)) return;
      try {
        await super.syncToFs(relaxedDurability);
        // Taken before the save: a change made while it ran shows up as different next time.
        this.saved = now;
      } catch {
        this.failed = true;
        onFail();
      }
    }
  }
  return new KeptFs(STORE_NAME);
};

type KeptFs = ReturnType<typeof keptFileSystem>;

/** A keeper for the database: `fs` is the kept file system, or undefined in memory. */
const keeperFor = (db: PGlite, fs?: KeptFs): Keeper => {
  const save = async (): Promise<void> => {
    if (!fs) return;
    try {
      await db.syncToFs();
    } catch {
      // The change stands in this tab; only the copy in browser storage missed it (for example, storage is full).
    }
  };

  const batch = async <T>(work: () => Promise<T>): Promise<T> => {
    if (!fs) return work();
    fs.held += 1;
    try {
      return await work();
    } finally {
      fs.held -= 1;
      await save();
    }
  };

  const discard = async (): Promise<boolean> => {
    if (!fs) return true;
    // Unmark the copy first, so the next start builds afresh even if deleting it is held up.
    try {
      await db.exec('drop schema if exists preview_meta cascade');
    } catch {
      // The copy is deleted next anyway.
    }
    fs.held += 1;
    // Close this page's connection to the copy, or deleting it would wait for the page to close.
    try {
      db.Module.FS.filesystems.IDBFS.quit();
    } catch {
      // Already closed.
    }
    return deleteStoredCopy(DELETE_WAIT_MS);
  };

  return { save, batch, discard };
};

/** The SQL the preview runs, in order: Supabase's stand-ins, the 7 migrations and the seed. */
const buildDatabase = async (db: PGlite, print: string): Promise<void> => {
  await db.exec(stubsSql);
  for (const name of migrationNames) await db.exec(migrations[name] ?? '');
  await db.exec(seedSql);
  // The fingerprint goes in last, so a build that was cut short has none and is built again.
  await db.exec('create schema preview_meta; create table preview_meta.build (fingerprint text not null, built_at timestamptz not null default now())');
  await db.query('insert into preview_meta.build (fingerprint) values ($1)', [print]);
};

/**
 * What a copy opened from browser storage holds: this build, nothing yet, or something else (older or cut short).
 * A copy whose Test business was deleted (Settings, Delete all) counts as something else, so a reload starts again
 * with fresh Test data, as it always did: with no business, nobody could reach More to reset it.
 */
const inspectCopy = async (db: PGlite, print: string): Promise<'current' | 'empty' | 'other'> => {
  const marked = await db.query<{ marked: boolean }>("select to_regclass('preview_meta.build') is not null as marked");
  if (marked.rows[0]?.marked) {
    const kept = await db.query<{ current: boolean }>(
      'select exists (select 1 from preview_meta.build where fingerprint = $1) and exists (select 1 from public.businesses) as current',
      [print],
    );
    return kept.rows[0]?.current ? 'current' : 'other';
  }
  const used = await db.query<{ used: boolean }>(
    `select exists (select 1 from pg_namespace where nspname in ('auth', 'extensions', 'private'))
         or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public') as used`,
  );
  return used.rows[0]?.used ? 'other' : 'empty';
};

const closeQuietly = async (db: PGlite | undefined): Promise<void> => {
  if (!db || db.closed) return;
  try {
    await db.close();
  } catch {
    // It is being thrown away.
  }
};

/**
 * Opens the copy this browser kept, or builds one and saves it. A copy from other SQL, or one that won't open, is
 * deleted and built again, once. Null if the browser won't keep a copy: the preview then runs in memory.
 */
const startStored = async (engine: Engine, files: EngineFiles, print: string, hadCopy: boolean): Promise<Started | null> => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const opening = attempt === 1 && hadCopy;
    if (!opening) await announce('start');
    let db: PGlite | undefined;
    try {
      // Reported to the screens; if a later save fails, it says the data is no longer kept.
      const storage: PreviewStorage = { mode: 'stored', reused: false };
      const fs = keptFileSystem(engine.IdbFs, () => {
        storage.mode = 'memory';
        storage.reason = 'unavailable';
      });
      // Saving waits while the copy opens or is built, then happens once.
      fs.held += 1;
      db = await engine.PGlite.create({ ...files, dataDir: STORE_DATA_DIR, fs, initDbStartParams: INITDB_ARGS });
      const state = await inspectCopy(db, print);
      if (state === 'current') {
        fs.held -= 1;
        storage.reused = true;
        return { db, keeper: keeperFor(db, fs), storage };
      }
      if (state === 'empty') {
        // A copy that holds nothing yet (an earlier first visit closed too soon) is built like a first visit.
        if (opening) onBootStep('start');
        await announce('migrate');
        await buildDatabase(db, print);
        await announce('save');
        fs.held -= 1;
        const keeper = keeperFor(db, fs);
        // The first save (about 30 MB) finishes while sign-in shows; the app's own calls wait for it. If the page
        // closes first, nothing was stored, and the next visit builds again.
        void keeper.save();
        return { db, keeper, storage };
      }
    } catch {
      // A damaged copy, or the browser refused to store one: delete it and try once more from nothing.
    }
    await closeQuietly(db);
    if (!(await deleteStoredCopy(DELETE_WAIT_MS))) break;
  }
  return null;
};

const startDatabase = async (): Promise<Started> => {
  onBootStep('download');
  // Whether this tab may keep the data, and whether there is a copy to open, are worked out while the engine downloads.
  const plan = Promise.all([holdStorageLock(LOCK_WAIT_MS), storedCopyExists()]).then(async ([lock, hadCopy]) => {
    const canStore = lock.state !== 'busy' && (await indexedDbWorks(INDEXEDDB_WAIT_MS));
    if (canStore && hadCopy) onBootStep('open');
    return { lock, canStore, hadCopy };
  });
  const [pgliteWasm, initdbWasm, fsBundle] = await Promise.all([
    engineFile('pglite.wasm').then((r) => r.arrayBuffer()),
    engineFile('initdb.wasm').then((r) => r.arrayBuffer()),
    engineFile('pglite-data.json').then(readBundle),
  ]);
  const [engine, pgliteWasmModule, initdbWasmModule] = await Promise.all([
    import('@electric-sql/pglite'),
    WebAssembly.compile(pgliteWasm),
    WebAssembly.compile(initdbWasm),
  ]);
  const files: EngineFiles = { pgliteWasmModule, initdbWasmModule, fsBundle };
  const print = fingerprint([
    BUILD_RECIPE,
    stubsSql,
    ...migrationNames.flatMap((name) => [name, migrations[name] ?? '']),
    seedSql,
    `engine ${pgliteWasm.byteLength} ${initdbWasm.byteLength} ${fsBundle.size}`,
  ]);

  const { lock, canStore, hadCopy } = await plan;
  if (canStore) {
    const stored = await startStored(engine, files, print, hadCopy);
    if (stored) {
      onBootStep('ready');
      return stored;
    }
  }
  // This tab keeps nothing, so another tab that can is free to.
  lock.release();
  await announce('start');
  const db = await engine.PGlite.create({ ...files, initDbStartParams: INITDB_ARGS });
  await announce('migrate');
  await buildDatabase(db, print);
  onBootStep('ready');
  return { db, keeper: keeperFor(db), storage: { mode: 'memory', reason: lock.state === 'busy' ? 'other-tab' : 'unavailable', reused: false } };
};

/** The Test person who was signed in before the reload, if they are still in the kept database. */
const restoreSession = async ({ db, storage }: Started): Promise<AuthUser | null> => {
  // In memory the database is new, so nobody from before is in it; any saved session belongs to a tab that keeps data.
  if (storage.mode !== 'stored') return null;
  const saved = readSavedSession();
  if (!saved) return null;
  try {
    const found = await db.query<{ id: string }>('select id::text as id from auth.users where id::text = $1 and email = $2', [saved.id, saved.email]);
    if (found.rows[0]) return { id: saved.id, email: saved.email };
  } catch {
    // Treated as signed out.
  }
  saveSession(null);
  return null;
};

const BUSINESS_ID = '0d5e0000-0000-4000-8000-000000000001';

export const createBackend = async (): Promise<Backend | null> => {
  const started = await startDatabase();
  return createPreviewBackend(started.db, { ...started, user: await restoreSession(started) });
};

export const createPreviewBackend = (
  db: PGlite,
  options: { keeper?: Keeper; storage?: PreviewStorage; user?: AuthUser | null } = {},
): Backend => {
  const keeper = options.keeper ?? keeperFor(db);
  const storage: PreviewStorage = options.storage ?? { mode: 'memory', reason: 'unavailable', reused: false };
  let user: AuthUser | null = options.user ?? null;
  const listeners = new Set<(event: AuthEvent, user: AuthUser | null) => void>();
  const codes = new Map<string, string>();
  const emit = (event: AuthEvent) => listeners.forEach((listener) => listener(event, user));

  /** Runs SQL as the signed-in person: role "authenticated" and their token's claims, as PostgREST does. */
  const asUser = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    if (!user) throw new AppError('signed-out', MESSAGES.signedOut);
    const claims = JSON.stringify({ sub: user.id, role: 'authenticated', email: user.email });
    let rows: T[];
    try {
      rows = await db.transaction(async (tx: Transaction) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [claims]);
        await tx.exec('set local role authenticated');
        return (await tx.query<T>(sql, params)).rows;
      });
    } catch (error) {
      throw fromDatabaseError(error as { code?: string; message?: string; hint?: string });
    }
    // Saved before the screen hears back, so a reload straight after still shows the change.
    await keeper.save();
    return rows;
  };

  /** One JSON value back from a function or an aggregate. */
  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await asUser<{ r: T }>(sql, params))[0]?.r as T;
  const list = <T>(select: string, params: unknown[] = []): Promise<T[]> =>
    one<T[]>(`select coalesce(json_agg(t), '[]'::json) as r from (${select}) t`, params);

  /** Calls a function with named arguments, leaving out the ones not given so their defaults apply. */
  const call = <T>(fn: string, args: [name: string, value: unknown, type: string][]): Promise<T> => {
    const given = args.filter(([, value]) => value !== undefined);
    const list = given.map(([name, , type], i) => `${name} => $${i + 1}::${type}`).join(', ');
    return one<T>(`select public.${fn}(${list}) as r`, given.map(([, value, type]) => (type === 'jsonb' ? JSON.stringify(value) : value)));
  };

  const asSystem = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;

  const tools = {
    codeFor: (email: string) => codes.get(email.trim().toLowerCase()) ?? null,

    async sampleImportFile() {
      // scripts/make-demo-csv.sql, as one query: 1043 missing, 1051 down A$450.00, 1078 new and one bad date.
      const rows = await asSystem<{ line: string }>(`
        with rows as (
          select c.name as client, coalesce(c.email, '') as email, coalesce(c.contact_name, '') as contact, i.invoice_number,
                 to_char(i.issue_date, 'DD/MM/YYYY') as issue_date, to_char(i.due_date, 'DD/MM/YYYY') as due_date,
                 case when i.invoice_number = '1051' then i.amount_due_cents - 45000 else i.amount_due_cents end as cents
          from public.invoices i join public.clients c on c.id = i.client_id
          where i.business_id = '${BUSINESS_ID}' and i.status = 'open' and i.invoice_number <> '1043'
        )
        select format('"%s",%s,%s,%s,%s,%s,"%s"', client, email, contact, invoice_number, issue_date, due_date,
                      to_char(cents / 100.0, 'FM999999990.00')) as line from rows
        union all
        select format('"%s",%s,%s,%s,%s,%s,"%s"', 'Harbourside Cafe (Test data)', 'owner@harbourside-cafe.example', 'Lou', '1078',
                      to_char(current_date - 20, 'DD/MM/YYYY'), to_char(current_date + 10, 'DD/MM/YYYY'), '760.00')
        union all
        select format('"%s",%s,%s,%s,%s,%s,"%s"', 'Coastline Fitouts (Test data)', '', '', '1080', '31/02/2026', '15/03/2026', '410.00')`);
      const text = ['Client,Email,Contact,Invoice number,Issue date,Due date,Amount due', ...rows.map((row) => row.line), ''].join('\n');
      return new File([text], 'demo-import.csv', { type: 'text/csv' });
    },

    runWeeklyRun: () =>
      // What the Sunday job does (jobs/weekly-run.ts), with the fallback templates because the preview has no AI.
      // Saved to browser storage once, at the end, rather than after every draft.
      keeper.batch(async () => {
        const start = (
          await asSystem<{ r: { run_id: string; proceed: boolean } }>(
            "select public.job_start('weekly_run', $1::uuid, public.job_period_key('weekly_run'), 'manual', null, true) as r",
            [BUSINESS_ID],
          )
        )[0]?.r;
        if (!start?.proceed) return { drafted: 0 };
        const templates = await asSystem<{ tone: string; version: string; subject: string; body: string }>('select * from public.job_get_templates()');
        const planned = await asSystem<{ invoice_id: string; tone: string }>('select invoice_id, tone from public.job_plan_weekly_run($1::uuid)', [start.run_id]);
        let drafted = 0;
        for (const item of planned) {
          const template = templates.find((t) => t.tone === item.tone) ?? templates[0];
          if (!template) continue;
          const saved = await asSystem<{ id: string | null }>(
            "select public.job_save_draft($1::uuid, $2::uuid, $3, $4, 'template', $5, null, 0::smallint, 'ai_disabled') as id",
            [start.run_id, item.invoice_id, template.subject, template.body, template.version],
          );
          if (saved[0]?.id) drafted += 1;
        }
        await asSystem("select public.job_finish($1::uuid, 'succeeded', $2::jsonb)", [
          start.run_id,
          JSON.stringify({ planned: planned.length, ai: 0, template: drafted, skipped: planned.length - drafted }),
        ]);
        return { drafted };
      }),

    storage,

    async resetDemo() {
      // A tab running in memory beside one that keeps the data leaves that tab's copy and keys alone: a reload resets it.
      if (storage.reason !== 'other-tab') {
        await keeper.discard();
        forgetPreviewKeys();
      }
      window.location.reload();
    },
  };

  return {
    kind: 'preview',
    preview: tools,
    auth: {
      async currentUser() {
        return user;
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async sendCode(email) {
        const address = email.trim().toLowerCase();
        const invited = await asSystem<{ ok: boolean }>(
          "select exists (select 1 from public.memberships where lower(invited_email) = $1 and status <> 'removed') as ok",
          [address],
        );
        if (!invited[0]?.ok) throw new AppError('uninvited', MESSAGES.uninvited, { code: 'otp_disabled' });
        codes.set(address, String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'));
      },
      async verifyCode(email, code) {
        const address = email.trim().toLowerCase();
        if (!codes.has(address) || codes.get(address) !== code.trim()) throw new AppError('code', MESSAGES.badCode, { code: 'otp_expired' });
        codes.delete(address);
        await asSystem('insert into auth.users (id, email) values (gen_random_uuid(), $1) on conflict (email) do nothing', [address]);
        const found = await asSystem<{ id: string }>('select id from auth.users where email = $1', [address]);
        user = { id: found[0]?.id ?? '', email: address };
        // Kept on this device like the real app's session, so a reload stays signed in. Only where the data is kept too.
        if (storage.mode === 'stored') saveSession(user);
        emit('SIGNED_IN');
        return user;
      },
      async signOut() {
        user = null;
        if (storage.mode === 'stored') saveSession(null);
        emit('SIGNED_OUT');
      },
    },

    acceptInvitations: () => one<Membership[]>('select public.accept_invitations() as r'),
    getBriefing: (businessId) => call<Briefing>('get_briefing', [['p_business_id', businessId, 'uuid']]),
    getTrustSummary: (businessId) => call<TrustSummary>('get_trust_summary', [['p_business_id', businessId, 'uuid']]),
    reviewQueue: (businessId) =>
      one<QueueItem[]>("select coalesce(json_agg(q order by q.queue_position), '[]'::json) as r from public.review_queue($1::uuid) q", [businessId]),
    approveDraft: (draftId, edit) =>
      call<ApproveResult>('approve_draft', [
        ['p_draft_id', draftId, 'uuid'],
        ['p_subject', edit?.subject, 'text'],
        ['p_body', edit?.body, 'text'],
      ]),
    rejectDraft: (draftId, reason, note) =>
      call<RejectResult>('reject_draft', [
        ['p_draft_id', draftId, 'uuid'],
        ['p_reason', reason, 'public.reject_reason'],
        ['p_note', note || undefined, 'text'],
      ]),
    getSendPayload: (draftId) => call<SendPayload>('get_send_payload', [['p_draft_id', draftId, 'uuid']]),
    confirmSent: (draftId, method) =>
      call<ConfirmSentResult>('confirm_sent', [
        ['p_draft_id', draftId, 'uuid'],
        ['p_method', method, 'public.send_method'],
      ]),
    markPaid: (invoiceId, paidDate) =>
      call<MarkPaidResult>('mark_paid', [
        ['p_invoice_id', invoiceId, 'uuid'],
        ['p_paid_date', paidDate, 'date'],
      ]),
    undoMarkPaid: async (invoiceId) => {
      await call('undo_mark_paid', [['p_invoice_id', invoiceId, 'uuid']]);
    },
    dismissAttention: async (itemId) => {
      await call('dismiss_attention', [['p_item_id', itemId, 'uuid']]);
    },
    confirmImport: (request) =>
      call<ImportResult>('confirm_import', [
        ['p_business_id', request.businessId, 'uuid'],
        ['p_file_name', request.fileName, 'text'],
        ['p_format', request.format, 'public.import_format'],
        ['p_mapping', request.mapping, 'jsonb'],
        ['p_rows', request.rows, 'jsonb'],
        ['p_expected_rows', request.expectedRows, 'integer'],
        ['p_expected_total_cents', String(request.expectedTotalCents), 'bigint'],
        ['p_allow_mass_close', request.allowMassClose, 'boolean'],
      ]),
    logReviewSession: async (businessId, stats) => {
      await call('log_review_session', [
        ['p_business_id', businessId, 'uuid'],
        ['p_stats', stats, 'jsonb'],
      ]);
    },
    updateSettings: async (businessId, changes) => {
      await call('update_settings', [
        ['p_business_id', businessId, 'uuid'],
        ['p_changes', changes, 'jsonb'],
      ]);
    },
    inviteChecker: async (businessId, email, displayName) => {
      // In the preview, the invited person can sign in at once: there is no invite email to wait for.
      return call<string>('invite_checker', [
        ['p_business_id', businessId, 'uuid'],
        ['p_email', email, 'text'],
        ['p_display_name', displayName, 'text'],
      ]);
    },
    removeMember: async (membershipId) => {
      await call('remove_member', [['p_membership_id', membershipId, 'uuid']]);
    },
    updateClientContact: async (clientId, email, contactName) => {
      await call('update_client_contact', [
        ['p_client_id', clientId, 'uuid'],
        ['p_email', email, 'text'],
        ['p_contact_name', contactName, 'text'],
      ]);
    },
    setClientTone: async (clientId, tone) => {
      await call('set_client_tone', [
        ['p_client_id', clientId, 'uuid'],
        ['p_tone', tone, 'public.tone'],
      ]);
    },
    setClientPaused: (clientId, paused) =>
      call<{ paused: boolean; drafts_cancelled: number }>('set_client_paused', [
        ['p_client_id', clientId, 'uuid'],
        ['p_paused', paused, 'boolean'],
      ]),
    exportBusinessData: (businessId) => call<Record<string, unknown>>('export_business_data', [['p_business_id', businessId, 'uuid']]),
    deleteBusiness: (businessId, confirmName) =>
      call<DeleteResult>('delete_business', [
        ['p_business_id', businessId, 'uuid'],
        ['p_confirm_name', confirmName, 'text'],
      ]),

    businesses: () => list<{ id: string; name: string; is_test_data: boolean }>('select id, name, is_test_data from public.businesses order by name'),
    async business(businessId) {
      const rows = await list<Business>(
        `select id, name, owner_name, sign_off, reply_to_email, overdue_threshold_days, cooldown_days, briefing_weekday, briefing_time,
                checker_may_send, style_note, example_reminder, call_first_threshold_cents, xero_reminders, column_mapping, is_test_data,
                delete_after, created_at
           from public.businesses where id = $1::uuid`,
        [businessId],
      );
      if (!rows[0]) throw new AppError('not-found', MESSAGES.notFound);
      return rows[0];
    },
    members: (businessId) =>
      list<Member>('select id, user_id, invited_email, display_name, role, status from public.memberships where business_id = $1::uuid order by invited_at', [
        businessId,
      ]),
    invoices: (businessId) => list<InvoiceListRow>('select * from public.invoice_list where business_id = $1::uuid order by due_date, invoice_number', [businessId]),
    clients: (businessId) =>
      list<Client>(
        'select id, name, contact_name, email, tone, client_group, paused, paused_at from public.clients where business_id = $1::uuid order by name',
        [businessId],
      ),
    drafts: (businessId, statuses) =>
      list<DraftRecord>(
        `select id, invoice_id, status, source, tone_used, invoice_number_shown, amount_shown_cents, due_date_shown, edited, final_subject, final_body,
                approved_by, approver_role, approved_at, rejected_by, rejected_at, reject_reason, sent_confirmed_by, sent_confirmed_at,
                cancelled_at, cancel_reason, created_at
           from public.reminder_drafts where business_id = $1::uuid and status::text = any ($2::text[]) order by created_at desc`,
        [businessId, statuses],
      ),
    async draft(draftId) {
      const rows = await list<DraftRecord>(
        `select id, invoice_id, status, source, tone_used, invoice_number_shown, amount_shown_cents, due_date_shown, edited, final_subject, final_body,
                approved_by, approver_role, approved_at, rejected_by, rejected_at, reject_reason, sent_confirmed_by, sent_confirmed_at,
                cancelled_at, cancel_reason, created_at
           from public.reminder_drafts where id = $1::uuid`,
        [draftId],
      );
      return rows[0] ?? null;
    },
    openAttention: (businessId) =>
      list<OpenAttentionItem>('select id, invoice_id, kind from public.attention_items where business_id = $1::uuid and resolved_at is null', [businessId]),
    activity: (businessId, { before, limit, invoiceId }) =>
      list<LogEntry>(
        `select id, at, actor_user_id, actor_role, action, invoice_id, draft_id, client_id, import_id, run_id, details
           from public.activity_log
          where business_id = $1::uuid and ($2::bigint is null or id < $2::bigint) and ($3::uuid is null or invoice_id = $3::uuid)
          order by id desc limit $4::integer`,
        [businessId, before ?? null, invoiceId ?? null, limit],
      ),
    async lastImport(businessId) {
      const rows = await list<ImportSummary>(
        'select id, uploaded_at, file_name, rows_read, rows_saved, rows_skipped from public.imports where business_id = $1::uuid order by uploaded_at desc limit 1',
        [businessId],
      );
      return rows[0] ?? null;
    },
    weeklyRuns: (businessId, sinceDate) =>
      list<WeeklyRun>(
        "select period_key, status, started_at, finished_at from public.job_runs where business_id = $1::uuid and job = 'weekly_run' and period_key >= $2",
        [businessId, sinceDate],
      ),
    async recordCounts(businessId) {
      return one<Record<string, number>>(
        `select json_build_object(
            'clients', (select count(*) from public.clients where business_id = $1::uuid),
            'invoices', (select count(*) from public.invoices where business_id = $1::uuid),
            'reminder_drafts', (select count(*) from public.reminder_drafts where business_id = $1::uuid),
            'imports', (select count(*) from public.imports where business_id = $1::uuid),
            'activity_log', (select count(*) from public.activity_log where business_id = $1::uuid),
            'attention_items', (select count(*) from public.attention_items where business_id = $1::uuid),
            'memberships', (select count(*) from public.memberships where business_id = $1::uuid)) as r`,
        [businessId],
      );
    },
  };
};
