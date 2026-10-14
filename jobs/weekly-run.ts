// Weekly run (FR-07 to FR-10): every Sunday at 9:00 pm Sydney time, draft one reminder for each invoice that
// meets BR-01. Safe to repeat (NFR-09, AT-08). Usage:
//   node jobs/weekly-run.ts                      scheduled: drafts for every business that is due
//   node jobs/weekly-run.ts --business=<id> --force    by hand, for one business (setup step 5)

import { readFileSync } from 'node:fs';
import { askClaude, type AiRequest, type AiReply } from './lib/claude.ts';
import { loadConfig, parseFlags, type Flags } from './lib/config.ts';
import { createRpc, type Rpc } from './lib/db.ts';
import { draftWithFallback, type PlannedInvoice, type Template } from './lib/drafting.ts';
import { type DueRow, isMain, log, mapLimit, runMain, safeMessage, type StartResult } from './lib/run.ts';

export const PROMPT_VERSION = 'reminder-draft/v1';

export type WeeklyDeps = {
  rpc: Rpc;
  ask: ((request: AiRequest) => Promise<AiReply>) | null;
  model: string;
  flags: Flags;
  githubRunUrl: string | null;
  concurrency?: number;
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
      continue;
    }

    const stats = { planned: 0, ai: 0, template: 0, skipped: 0 };
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
    } catch (error) {
      failures += 1;
      log('weekly-run', 'failed', { business_id: businessId, period: periodKey, error: safeMessage(error) });
      await rpc('job_finish', { p_run_id: start.run_id, p_status: 'failed', p_stats: stats, p_error: safeMessage(error) }).catch(() => undefined);
    }
  }
  return failures > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  await runMain('weekly-run', async () => {
    const config = loadConfig();
    const system = readFileSync(new URL('../prompts/reminder-draft/v1/system.md', import.meta.url), 'utf8');
    const schema = JSON.parse(readFileSync(new URL('../prompts/reminder-draft/v1/output.schema.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    const apiKey = config.anthropicKey;
    return runWeekly({
      rpc: createRpc(config.supabaseUrl, config.serviceKey),
      ask: apiKey
        ? (request) => askClaude(request, { apiKey, model: config.aiModel, temperature: config.aiTemperature, timeoutMs: config.aiTimeoutMs, system, schema })
        : null,
      model: config.aiModel,
      flags: parseFlags(),
      githubRunUrl: config.githubRunUrl,
      concurrency: Number(process.env.AI_CONCURRENCY ?? 3),
    });
  });
}
