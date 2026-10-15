// The in-browser preview backend: the repository's own migrations and seed, running in PostgreSQL compiled to
// WebAssembly (PGlite), with Test data only. Every call goes through the same database functions, row-level
// security and role checks as on Supabase; each runs as the signed-in person, with the same JSON Web Token claims
// PostgREST would set. Only sign-in differs: there is no email, so the code is shown on screen.
// Nothing leaves the browser, and a reload starts again from the seed.
import type { PGlite, Transaction } from '@electric-sql/pglite';
import stubsSql from '../../../supabase/local/supabase_stubs.sql?raw';
import seedSql from '../../../supabase/seed.sql?raw';
import type { LogEntry } from '../lib/activity.ts';
import { AppError, fromDatabaseError, MESSAGES } from './errors.ts';
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
  QueueItem,
  RejectResult,
  SendPayload,
  TrustSummary,
  WeeklyRun,
} from './types.ts';

const migrations = import.meta.glob('../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Progress for the loading screen while the database starts. */
export type BootStep = 'download' | 'start' | 'migrate' | 'ready';
let onBootStep: (step: BootStep) => void = () => undefined;
export const watchBoot = (listener: (step: BootStep) => void): void => {
  onBootStep = listener;
};

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

const startDatabase = async (): Promise<PGlite> => {
  onBootStep('download');
  const [pgliteWasm, initdbWasm, fsBundle] = await Promise.all([
    engineFile('pglite.wasm').then((r) => r.arrayBuffer()),
    engineFile('initdb.wasm').then((r) => r.arrayBuffer()),
    engineFile('pglite-data.json').then(readBundle),
  ]);
  onBootStep('start');
  const [{ PGlite: Engine }, pgliteWasmModule, initdbWasmModule] = await Promise.all([
    import('@electric-sql/pglite'),
    WebAssembly.compile(pgliteWasm),
    WebAssembly.compile(initdbWasm),
  ]);
  const db = await Engine.create({ pgliteWasmModule, initdbWasmModule, fsBundle });
  onBootStep('migrate');
  await db.exec(stubsSql);
  for (const name of Object.keys(migrations).sort()) await db.exec(migrations[name] ?? '');
  await db.exec(seedSql);
  onBootStep('ready');
  return db;
};

const BUSINESS_ID = '0d5e0000-0000-4000-8000-000000000001';

export const createBackend = async (): Promise<Backend | null> => createPreviewBackend(await startDatabase());

export const createPreviewBackend = (db: PGlite): Backend => {
  let user: AuthUser | null = null;
  const listeners = new Set<(event: AuthEvent, user: AuthUser | null) => void>();
  const codes = new Map<string, string>();
  const emit = (event: AuthEvent) => listeners.forEach((listener) => listener(event, user));

  /** Runs SQL as the signed-in person: role "authenticated" and their token's claims, as PostgREST does. */
  const asUser = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    if (!user) throw new AppError('signed-out', MESSAGES.signedOut);
    const claims = JSON.stringify({ sub: user.id, role: 'authenticated', email: user.email });
    try {
      return await db.transaction(async (tx: Transaction) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [claims]);
        await tx.exec('set local role authenticated');
        return (await tx.query<T>(sql, params)).rows;
      });
    } catch (error) {
      throw fromDatabaseError(error as { code?: string; message?: string; hint?: string });
    }
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

    async runWeeklyRun() {
      // What the Sunday job does (jobs/weekly-run.ts), with the fallback templates because the preview has no AI.
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
        emit('SIGNED_IN');
        return user;
      },
      async signOut() {
        user = null;
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
