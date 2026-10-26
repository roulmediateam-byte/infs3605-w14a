// The real backend: supabase-js against the Supabase project (TRD, Architecture). The browser holds only the
// publishable key; row-level security and the role check at the top of every function decide what happens.
import { createClient, FunctionsHttpError, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../app/config.ts';
import type { LogEntry } from '../lib/activity.ts';
import { readSignInLink } from '../lib/sign-in-link.ts';
import type { Database } from './database.types.ts';
import { AppError, fromAuthError, fromDatabaseError, MESSAGES } from './errors.ts';
import type {
  ApproveResult,
  AuthUser,
  Backend,
  Briefing,
  Business,
  Client,
  ConfirmSentResult,
  DeleteResult,
  DraftRecord,
  DraftingRunResult,
  DraftStatus,
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

interface PostgrestResponse<T> {
  data: T | null;
  error: { code?: string; message?: string; hint?: string | null; details?: string | null } | null;
  status?: number;
  count?: number | null;
}

const PAGE = 1000;

const check = <T>(response: PostgrestResponse<T>): T => {
  if (response.error) {
    if (response.error.code === 'PGRST116') throw new AppError('not-found', MESSAGES.notFound, { code: 'PGRST116' });
    throw fromDatabaseError({ ...response.error, status: response.status });
  }
  return response.data as T;
};

const DRAFT_COLUMNS =
  'id, invoice_id, status, source, tone_used, invoice_number_shown, amount_shown_cents, due_date_shown, edited, final_subject, final_body, approved_by, approver_role, approved_at, rejected_by, rejected_at, reject_reason, sent_confirmed_by, sent_confirmed_at, cancelled_at, cancel_reason, created_at';

const BUSINESS_COLUMNS =
  'id, name, owner_name, sign_off, reply_to_email, overdue_threshold_days, cooldown_days, briefing_weekday, briefing_time, checker_may_send, style_note, example_reminder, call_first_threshold_cents, xero_reminders, column_mapping, is_test_data, delete_after, created_at';

/** The preview build reports start-up progress; the real backend has nothing to start. */
export const watchBoot = (_listener: (step: 'download' | 'start' | 'migrate' | 'ready') => void): void => undefined;

/** The app's backend for this build: the Supabase project named at build time, or null when none is set. */
export const createBackend = async (): Promise<Backend | null> =>
  config.supabaseUrl && config.supabaseKey ? createSupabaseBackend(config.supabaseUrl, config.supabaseKey) : null;

/** supabase-js refreshes a session 90 seconds before its access token expires (its EXPIRY_MARGIN_MS). */
const REFRESH_MARGIN_MS = 90_000;

interface StoredSession {
  access_token?: string;
  expires_at?: number;
}

/**
 * Where supabase-js keeps the session on this device ("<key>-user" sits beside it). One key per Supabase project:
 * the owners' build and the demonstration build share one web address, so their sessions must not mix.
 */
const authKey = (url: string): string => `gpa.auth.${new URL(url).host}`;

/** The session as stored on this device, read without any network call. */
const storedSession = (key: string): StoredSession | null => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
};

/** Removes the stored session, and anything stored beside it, from this device. */
const forgetStoredSession = (key: string): void => {
  try {
    for (const item of Object.keys(window.localStorage)) {
      if (item === key || item.startsWith(`${key}-`)) window.localStorage.removeItem(item);
    }
  } catch {
    // Storage is unavailable, so nothing was kept.
  }
};

/** What to say about a sign-in link that didn't work: send a new code, or a new link when the email has no code. */
const badLinkMessage = (): string => (config.signInEmail === 'link' ? MESSAGES.badLinkOnly : MESSAGES.badLink);

/**
 * The emailed sign-in link lands with the session in the address's fragment (#access_token=...&refresh_token=...).
 * The fragment is taken out with replaceState before anything else, so the tokens are never kept in the browser's
 * history, where Back on a shared computer would show a working token (Engineering review). supabase-js would remove
 * it with a new history entry instead, so its own detection is off.
 */
const takeSessionFromLink = async (client: SupabaseClient<Database>): Promise<string | null> => {
  const fragment = window.location.hash;
  if (!/[#&](access_token|error|error_code)=/.test(fragment)) return null;
  const params = new URLSearchParams(fragment.slice(1));
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return badLinkMessage();
  const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (!error) return null;
  return isAuthRetryableFetchError(error) ? MESSAGES.network : badLinkMessage();
};

/** The demonstration "Run it now" function's refusal (supabase/functions/demo-weekly-run/handler.ts), as an AppError. */
const fromDraftingRefusal = async (error: unknown): Promise<AppError> => {
  if (!(error instanceof FunctionsHttpError)) {
    return navigator.onLine === false ? new AppError('offline', MESSAGES.offline) : new AppError('network', MESSAGES.network);
  }
  const response = error.context as Response;
  let body: { error?: string; code?: string } = {};
  try {
    body = (await response.json()) as { error?: string; code?: string };
  } catch {
    // Not the function's own answer (the platform refused first): fall back on the status.
  }
  if (response.status === 401 || body.code === 'signed_out') return new AppError('signed-out', MESSAGES.signedOut);
  if (body.code === 'not_owner') return new AppError('permission', body.error ?? MESSAGES.permission);
  if (body.code === 'not_test_data' || body.code === 'busy' || body.code === 'business') return new AppError('rule', body.error ?? MESSAGES.unknown);
  return new AppError('unknown', body.error ?? MESSAGES.unknown);
};

export const createSupabaseBackend = async (url: string, publishableKey: string): Promise<Backend> => {
  const storageKey = authKey(url);
  const client = createClient<Database>(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit', storageKey },
  });
  let linkProblem = await takeSessionFromLink(client);

  /**
   * The current session, or null when nobody is signed in. Offline with an access token that needs refreshing, it
   * says the app is offline rather than signed out, so nobody is sent for a code that can't arrive (TRD, Web app).
   */
  const currentSession = async () => {
    const stored = storedSession(storageKey);
    const needsRefresh = typeof stored?.expires_at === 'number' && stored.expires_at * 1000 - Date.now() < REFRESH_MARGIN_MS;
    if (stored && needsRefresh && navigator.onLine === false) throw new AppError('offline', MESSAGES.offline);
    const { data, error } = await client.auth.getSession();
    if (data.session) return data.session;
    if (error && isAuthRetryableFetchError(error)) {
      throw navigator.onLine === false ? new AppError('offline', MESSAGES.offline) : new AppError('network', MESSAGES.network);
    }
    return null;
  };

  /**
   * Without a session supabase-js falls back to the anonymous key, and the database answers "permission denied".
   * That is a signed-out person, not a refusal, so it opens the sign-in sheet instead (App Flow, Journey 2).
   */
  const ensureSession = async (): Promise<void> => {
    if (!(await currentSession())) throw new AppError('signed-out', MESSAGES.signedOut);
  };

  const rpc = async <T>(fn: keyof Database['public']['Functions'], args: Record<string, unknown>): Promise<T> => {
    await ensureSession();
    // The generated types check argument names at each call site below; this helper only unwraps the result.
    const response = (await (client.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<PostgrestResponse<T>>)(fn, args)) as PostgrestResponse<T>;
    return check(response);
  };

  /** Reads every page of a list, because the API returns at most 1,000 rows at a time. */
  const readAll = async <T>(page: (from: number, to: number) => PromiseLike<PostgrestResponse<T[]>>): Promise<T[]> => {
    await ensureSession();
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const batch = check(await page(from, from + PAGE - 1)) ?? [];
      rows.push(...batch);
      if (batch.length < PAGE) return rows;
    }
  };

  const userOf = (user: { id: string; email?: string | null } | null | undefined): AuthUser | null =>
    user ? { id: user.id, email: user.email ?? '' } : null;

  const tables = {
    count: async (table: 'clients' | 'invoices' | 'reminder_drafts' | 'imports' | 'activity_log' | 'attention_items' | 'memberships', businessId: string) => {
      const response = await client.from(table).select('id', { count: 'exact', head: true }).eq('business_id', businessId);
      check(response as PostgrestResponse<unknown>);
      return response.count ?? 0;
    },
  };

  return {
    kind: 'supabase',
    auth: {
      async currentUser() {
        return userOf((await currentSession())?.user);
      },
      takeLinkProblem() {
        const problem = linkProblem;
        linkProblem = null;
        return problem;
      },
      onChange(listener) {
        const { data } = client.auth.onAuthStateChange((event, session) => listener(event, userOf(session?.user)));
        return () => data.subscription.unsubscribe();
      },
      async sendCode(email, redirectTo) {
        const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
        if (error) throw fromAuthError(error);
      },
      async verifyCode(email, code) {
        const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw fromAuthError(error);
        const user = userOf(data.user);
        if (!user) throw new AppError('code', MESSAGES.badCode);
        return user;
      },
      async signInWithLink(pasted) {
        // The emailed link, or the address it opened: either finishes the sign-in here, on this device, whichever page
        // the link opened (a phone's email app, or Supabase's default Site URL, http://localhost:3000).
        const link = readSignInLink(pasted);
        if (!link) throw new AppError('code', MESSAGES.notALink);
        if (link.kind === 'expired') throw new AppError('code', badLinkMessage());
        const { data, error } =
          link.kind === 'session'
            ? await client.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
            : await client.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
        if (error) {
          const appError = fromAuthError(error);
          if (appError.kind === 'network' || appError.kind === 'offline' || appError.kind === 'rate-limit') throw appError;
          throw new AppError('code', badLinkMessage(), { code: appError.code });
        }
        const user = userOf(data.user);
        if (!user) throw new AppError('code', badLinkMessage());
        return user;
      },
      async signOut() {
        // Forget the session on this device first. supabase-js keeps it when it can't refresh an expired token
        // before signing out (offline), which would leave a shared phone signed in (Engineering review).
        const accessToken = storedSession(storageKey)?.access_token;
        forgetStoredSession(storageKey);
        // With nothing stored, the library clears its own state and tells other tabs, without a network call. It
        // can wait behind a refresh that is retrying, so the app doesn't wait more than 3 seconds for it.
        await Promise.race([client.auth.signOut({ scope: 'local' }).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3000))]);
        // Then the server, so this session can't be refreshed anywhere else. Offline, it simply expires.
        if (accessToken && navigator.onLine !== false) void client.auth.admin.signOut(accessToken, 'local').catch(() => undefined);
      },
    },

    ...(config.demoTools
      ? {
          // The demonstration build's "Run it now": the scheduled job's run, started by the owner of a Test data business.
          async runDraftingNow(businessId: string): Promise<DraftingRunResult> {
            await ensureSession();
            const { data, error } = await client.functions.invoke<{ drafted?: number; claude?: boolean }>('demo-weekly-run', {
              body: { business_id: businessId },
            });
            if (error) throw await fromDraftingRefusal(error);
            return { drafted: data?.drafted ?? 0, claude: data?.claude === true };
          },
        }
      : {}),

    acceptInvitations: () => rpc<Membership[]>('accept_invitations', {}),
    getBriefing: (businessId) => rpc<Briefing>('get_briefing', { p_business_id: businessId } satisfies Database['public']['Functions']['get_briefing']['Args']),
    getTrustSummary: (businessId) =>
      rpc<TrustSummary>('get_trust_summary', { p_business_id: businessId } satisfies Database['public']['Functions']['get_trust_summary']['Args']),
    reviewQueue: (businessId) =>
      rpc<QueueItem[]>('review_queue', { p_business_id: businessId } satisfies Database['public']['Functions']['review_queue']['Args']),
    approveDraft: (draftId, edit) =>
      rpc<ApproveResult>('approve_draft', {
        p_draft_id: draftId,
        ...(edit ? { p_subject: edit.subject, p_body: edit.body } : {}),
      } satisfies Database['public']['Functions']['approve_draft']['Args']),
    rejectDraft: (draftId, reason, note) =>
      rpc<RejectResult>('reject_draft', {
        p_draft_id: draftId,
        p_reason: reason,
        ...(note ? { p_note: note } : {}),
      } satisfies Database['public']['Functions']['reject_draft']['Args']),
    getSendPayload: (draftId) =>
      rpc<SendPayload>('get_send_payload', { p_draft_id: draftId } satisfies Database['public']['Functions']['get_send_payload']['Args']),
    confirmSent: (draftId, method) =>
      rpc<ConfirmSentResult>('confirm_sent', { p_draft_id: draftId, p_method: method } satisfies Database['public']['Functions']['confirm_sent']['Args']),
    markPaid: (invoiceId, paidDate) =>
      rpc<MarkPaidResult>('mark_paid', {
        p_invoice_id: invoiceId,
        ...(paidDate ? { p_paid_date: paidDate } : {}),
      } satisfies Database['public']['Functions']['mark_paid']['Args']),
    undoMarkPaid: (invoiceId) => rpc<void>('undo_mark_paid', { p_invoice_id: invoiceId } satisfies Database['public']['Functions']['undo_mark_paid']['Args']),
    dismissAttention: (itemId) => rpc<void>('dismiss_attention', { p_item_id: itemId } satisfies Database['public']['Functions']['dismiss_attention']['Args']),
    confirmImport: (request) =>
      rpc<ImportResult>('confirm_import', {
        p_business_id: request.businessId,
        p_file_name: request.fileName,
        p_format: request.format,
        p_mapping: request.mapping as Database['public']['Functions']['confirm_import']['Args']['p_mapping'],
        p_rows: request.rows as unknown as Database['public']['Functions']['confirm_import']['Args']['p_rows'],
        p_expected_rows: request.expectedRows,
        // A bigint total too large for a JSON number travels as a string, which Postgres casts exactly.
        p_expected_total_cents: request.expectedTotalCents as number,
        p_allow_mass_close: request.allowMassClose,
      } satisfies Database['public']['Functions']['confirm_import']['Args']),
    logReviewSession: (businessId, stats) =>
      rpc<void>('log_review_session', {
        p_business_id: businessId,
        p_stats: { ...stats },
      } satisfies Database['public']['Functions']['log_review_session']['Args']),
    updateSettings: (businessId, changes) =>
      rpc<void>('update_settings', {
        p_business_id: businessId,
        p_changes: changes as Database['public']['Functions']['update_settings']['Args']['p_changes'],
      } satisfies Database['public']['Functions']['update_settings']['Args']),
    inviteChecker: (businessId, email, displayName) =>
      rpc<string>('invite_checker', {
        p_business_id: businessId,
        p_email: email,
        p_display_name: displayName,
      } satisfies Database['public']['Functions']['invite_checker']['Args']),
    removeMember: (membershipId) => rpc<void>('remove_member', { p_membership_id: membershipId } satisfies Database['public']['Functions']['remove_member']['Args']),
    updateClientContact: (clientId, email, contactName) =>
      rpc<void>('update_client_contact', {
        p_client_id: clientId,
        p_email: email,
        ...(contactName ? { p_contact_name: contactName } : {}),
      } satisfies Database['public']['Functions']['update_client_contact']['Args']),
    setClientTone: (clientId, tone) =>
      rpc<void>('set_client_tone', { p_client_id: clientId, p_tone: tone } satisfies Database['public']['Functions']['set_client_tone']['Args']),
    setClientPaused: (clientId, paused) =>
      rpc<{ paused: boolean; drafts_cancelled: number }>('set_client_paused', {
        p_client_id: clientId,
        p_paused: paused,
      } satisfies Database['public']['Functions']['set_client_paused']['Args']),
    exportBusinessData: (businessId) =>
      rpc<Record<string, unknown>>('export_business_data', { p_business_id: businessId } satisfies Database['public']['Functions']['export_business_data']['Args']),
    deleteBusiness: (businessId, confirmName) =>
      rpc<DeleteResult>('delete_business', {
        p_business_id: businessId,
        p_confirm_name: confirmName,
      } satisfies Database['public']['Functions']['delete_business']['Args']),

    async businesses() {
      await ensureSession();
      return check(await client.from('businesses').select('id, name, is_test_data').order('name')) as { id: string; name: string; is_test_data: boolean }[];
    },
    async business(businessId) {
      await ensureSession();
      return check(await client.from('businesses').select(BUSINESS_COLUMNS).eq('id', businessId).single()) as unknown as Business;
    },
    async members(businessId) {
      await ensureSession();
      return check(
        await client.from('memberships').select('id, user_id, invited_email, display_name, role, status').eq('business_id', businessId).order('invited_at'),
      ) as Member[];
    },
    async invoices(businessId) {
      const rows = await readAll((from, to) =>
        client.from('invoice_list').select('*').eq('business_id', businessId).order('due_date').order('invoice_number').range(from, to),
      );
      return rows as unknown as InvoiceListRow[];
    },
    async clients(businessId) {
      const rows = await readAll((from, to) =>
        client
          .from('clients')
          .select('id, name, contact_name, email, tone, client_group, paused, paused_at')
          .eq('business_id', businessId)
          .order('name')
          .range(from, to),
      );
      return rows as Client[];
    },
    async drafts(businessId, statuses: DraftStatus[]) {
      const rows = await readAll((from, to) =>
        client
          .from('reminder_drafts')
          .select(DRAFT_COLUMNS)
          .eq('business_id', businessId)
          .in('status', statuses)
          .order('created_at', { ascending: false })
          .range(from, to),
      );
      return rows as DraftRecord[];
    },
    async draft(draftId) {
      await ensureSession();
      return check(await client.from('reminder_drafts').select(DRAFT_COLUMNS).eq('id', draftId).maybeSingle()) as DraftRecord | null;
    },
    async openAttention(businessId) {
      await ensureSession();
      return check(
        await client.from('attention_items').select('id, invoice_id, kind').eq('business_id', businessId).is('resolved_at', null),
      ) as OpenAttentionItem[];
    },
    async activity(businessId, { before, limit, invoiceId }) {
      await ensureSession();
      let query = client
        .from('activity_log')
        .select('id, at, actor_user_id, actor_role, action, invoice_id, draft_id, client_id, import_id, run_id, details')
        .eq('business_id', businessId);
      if (before !== undefined) query = query.lt('id', before);
      if (invoiceId) query = query.eq('invoice_id', invoiceId);
      return check(await query.order('id', { ascending: false }).limit(limit)) as unknown as LogEntry[];
    },
    async lastImport(businessId) {
      await ensureSession();
      return check(
        await client
          .from('imports')
          .select('id, uploaded_at, file_name, rows_read, rows_saved, rows_skipped')
          .eq('business_id', businessId)
          .order('uploaded_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ) as ImportSummary | null;
    },
    async weeklyRuns(businessId, sinceDate) {
      await ensureSession();
      return check(
        await client
          .from('job_runs')
          .select('period_key, status, started_at, finished_at')
          .eq('business_id', businessId)
          .eq('job', 'weekly_run')
          .gte('period_key', sinceDate),
      ) as WeeklyRun[];
    },
    async recordCounts(businessId) {
      await ensureSession();
      const names = ['clients', 'invoices', 'reminder_drafts', 'imports', 'activity_log', 'attention_items', 'memberships'] as const;
      const counts = await Promise.all(names.map((name) => tables.count(name, businessId)));
      return Object.fromEntries(names.map((name, i) => [name, counts[i] ?? 0]));
    },
  };
};
