// Daily health check and retention (NFR-03, NFR-10, PD-7).
// 1. Proves the database is awake (free Supabase projects pause after a week without activity) and flags failed
//    or stuck runs.
// 2. Deletes businesses past their delete date (and every business from Thu 31 Dec 2026), then deletes sign-in
//    accounts left with no business for 14 days.

import { loadConfig, parseFlags } from './lib/config.ts';
import { createRpc, type Rpc } from './lib/db.ts';
import { sendEmail } from './lib/email.ts';
import { escapeHtml } from './lib/render.ts';
import { type DueRow, isMain, log, runMain, safeMessage, type StartResult } from './lib/run.ts';

type Health = { ok: boolean; businesses: number; failed_runs_7d: number; stuck_runs: number };

export async function deleteAuthUser(supabaseUrl: string, serviceKey: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const headers: Record<string, string> = { apikey: serviceKey };
  if (serviceKey.startsWith('eyJ')) headers.Authorization = `Bearer ${serviceKey}`;
  const response = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Deleting a sign-in account failed with HTTP ${response.status}.`);
}

async function claim(rpc: Rpc, job: 'health_check' | 'retention', asOf: string, force: boolean, url: string | null): Promise<StartResult | null> {
  const due = await rpc<DueRow[]>('job_due', { p_job: job, p_as_of: asOf });
  if (due.length === 0 && !force) return null;
  const periodKey = due[0]?.period_key ?? (await rpc<string>('job_period_key', { p_job: job, p_as_of: asOf }));
  const start = await rpc<StartResult>('job_start', {
    p_job: job,
    p_business_id: null,
    p_period_key: periodKey,
    p_trigger: force ? 'manual' : 'schedule',
    p_github_run_url: url,
    p_force: force,
  });
  return start.proceed ? start : null;
}

if (isMain(import.meta.url)) {
  await runMain('health-check', async () => {
    const config = loadConfig();
    const flags = parseFlags();
    const rpc = createRpc(config.supabaseUrl, config.serviceKey);
    const asOf = flags.asOf ?? new Date().toISOString();
    let exitCode = 0;

    const health = await claim(rpc, 'health_check', asOf, flags.force, config.githubRunUrl);
    if (health) {
      const report = await rpc<Health>('job_health', { p_as_of: asOf });
      const problems = report.failed_runs_7d + report.stuck_runs;
      await rpc('job_finish', { p_run_id: health.run_id, p_status: 'succeeded', p_stats: report });
      log('health-check', problems > 0 ? 'problems' : 'healthy', { failed_runs_7d: report.failed_runs_7d, stuck_runs: report.stuck_runs });
      if (problems > 0) {
        exitCode = 1;
        if (config.alertEmail) {
          const text = `Health check: ${report.failed_runs_7d} failed run(s) in 7 days and ${report.stuck_runs} stuck run(s). See job_runs and docs/runbook.md.`;
          await sendEmail(
            { to: config.alertEmail, subject: 'Alert: scheduled jobs need a look', text, html: `<p>${escapeHtml(text)}</p>`, idempotencyKey: `alert:health:${health.run_id}` },
            { apiKey: config.resendKey, from: config.emailFrom },
          );
        }
      }
    }

    const retention = await claim(rpc, 'retention', asOf, flags.force, config.githubRunUrl);
    if (retention) {
      try {
        const purge = await rpc<{ businesses_deleted: number }>('job_retention_purge', { p_as_of: asOf });
        const orphans = await rpc<Array<{ user_id: string }>>('job_orphan_users', { p_as_of: asOf });
        for (const orphan of orphans) await deleteAuthUser(config.supabaseUrl, config.serviceKey, orphan.user_id);
        const stats = { businesses_deleted: purge.businesses_deleted, accounts_deleted: orphans.length };
        await rpc('job_finish', { p_run_id: retention.run_id, p_status: 'succeeded', p_stats: stats });
        log('retention', 'finished', stats);
      } catch (error) {
        exitCode = 1;
        await rpc('job_finish', { p_run_id: retention.run_id, p_status: 'failed', p_error: safeMessage(error) }).catch(() => undefined);
        log('retention', 'failed', { error: safeMessage(error) });
      }
    }
    return exitCode;
  });
}
