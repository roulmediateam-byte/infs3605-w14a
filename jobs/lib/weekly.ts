// The weekly run itself (FR-07 to FR-10), shared by the scheduled job (jobs/weekly-run.ts) and the demonstration
// build's "Run it now" (supabase/functions/demo-weekly-run). It reads no files and no environment, so it runs on
// Node and on Supabase's Edge Functions (Deno) alike. Safe to repeat (NFR-09, AT-08).

import type { AiReply, AiRequest } from './claude.ts';
import type { Flags } from './config.ts';
import type { Rpc } from './db.ts';
import { draftWithFallback, type PlannedInvoice, type Template } from './drafting.ts';
import { type DueRow, log, mapLimit, safeMessage, type StartResult } from './run.ts';

export const PROMPT_VERSION = 'reminder-draft/v1';

export type WeeklyStats = { planned: number; ai: number; template: number; skipped: number };

/** How one business's run ended: drafted (with counts), skipped (already done or running) or failed. */
export type WeeklyOutcome =
  | { business_id: string | null; status: 'succeeded'; stats: WeeklyStats }
  | { business_id: string | null; status: 'skipped'; reason: string }
  | { business_id: string | null; status: 'failed'; stats: WeeklyStats; error: string };

export type WeeklyDeps = {
  rpc: Rpc;
  ask: ((request: AiRequest) => Promise<AiReply>) | null;
  model: string;
  flags: Flags;
  githubRunUrl: string | null;
  concurrency?: number;
  /** Told how each business's run ended, for a caller that reports it (the demonstration's "Run it now"). */
  onOutcome?: (outcome: WeeklyOutcome) => void;
};

export async function runWeekly(deps: WeeklyDeps): Promise<number> {
  const { rpc, flags } = deps;
  const asOf = flags.asOf ?? new Date().toISOString();
  const due: DueRow[] = flags.businessId
    ? [{ business_id: flags.businessId, period_key: await rpc<string>('job_period_key', { p_job: 'weekly_run', p_as_of: asOf }) }]
    : await rpc<DueRow[]>('job_due', { p_job: 'weekly_run', p_as_of: asOf });
  const templates = await rpc<Template[]>('job_get_templates');
  let failures = 0;

  for (const { business_id: businessId, period_key: periodKey } of due) {
    const start = await rpc<StartResult>('job_start', {
      p_job: 'weekly_run',
      p_business_id: businessId,
      p_period_key: periodKey,
      p_trigger: flags.businessId || flags.force ? 'manual' : 'schedule',
      p_github_run_url: deps.githubRunUrl,
      p_force: flags.force,
    });
    if (!start.proceed) {
      log('weekly-run', 'skipped', { business_id: businessId, period: periodKey, reason: start.reason });
      deps.onOutcome?.({ business_id: businessId, status: 'skipped', reason: start.reason });
      continue;
    }

    const stats: WeeklyStats = { planned: 0, ai: 0, template: 0, skipped: 0 };
    try {
      const planned = await rpc<PlannedInvoice[]>('job_plan_weekly_run', { p_run_id: start.run_id, p_as_of: asOf });
      stats.planned = planned.length;
      await mapLimit(planned, deps.concurrency ?? 3, async (item) => {
        const draft = await draftWithFallback(item, {
          ask: deps.ask,
          check: (subject, body, tone) => rpc<string[]>('job_check_template', { p_subject: subject, p_body: body, p_tone: tone }),
          templates,
          promptVersion: PROMPT_VERSION,
          model: deps.model,
        });
        const draftId = await rpc<string | null>('job_save_draft', {
          p_run_id: start.run_id,
          p_invoice_id: item.invoice_id,
          p_subject: draft.subject,
          p_body: draft.body,
          p_source: draft.source,
          p_prompt_version: draft.version,
          p_model: draft.model,
          p_ai_attempts: draft.attempts,
          p_fallback_reason: draft.fallbackReason,
        });
        if (draftId === null) stats.skipped += 1;
        else stats[draft.source] += 1;
      });
      await rpc('job_finish', { p_run_id: start.run_id, p_status: 'succeeded', p_stats: stats });
      log('weekly-run', 'finished', { business_id: businessId, period: periodKey, ...stats });
      deps.onOutcome?.({ business_id: businessId, status: 'succeeded', stats });
    } catch (error) {
      failures += 1;
      log('weekly-run', 'failed', { business_id: businessId, period: periodKey, error: safeMessage(error) });
      await rpc('job_finish', { p_run_id: start.run_id, p_status: 'failed', p_stats: stats, p_error: safeMessage(error) }).catch(() => undefined);
      deps.onOutcome?.({ business_id: businessId, status: 'failed', stats, error: safeMessage(error) });
    }
  }
  return failures > 0 ? 1 : 0;
}
