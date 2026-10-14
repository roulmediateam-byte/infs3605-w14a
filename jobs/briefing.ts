// Monday briefing (FR-11, EM-01): from 45 minutes before each business's slot, email the owner the same
// briefing the Home screen shows (AT-06). Safe to repeat: one briefing per business per day (NFR-09).
//   node jobs/briefing.ts                       scheduled
//   node jobs/briefing.ts --business=<id> --force     resend by hand (NFR-10 runbook)

import { loadConfig, parseFlags, type Flags } from './lib/config.ts';
import { createRpc, type Rpc } from './lib/db.ts';
import { sendEmail, type OutgoingEmail } from './lib/email.ts';
import { renderBriefing, type Briefing } from './lib/render.ts';
import { type DueRow, isMain, log, runMain, safeMessage, type StartResult } from './lib/run.ts';

export type BriefingDeps = {
  rpc: Rpc;
  send: (email: OutgoingEmail) => Promise<string>;
  appUrl: string;
  flags: Flags;
  githubRunUrl: string | null;
};

export async function runBriefings(deps: BriefingDeps): Promise<number> {
  const { rpc, flags } = deps;
  const asOf = flags.asOf ?? new Date().toISOString();
  const due: DueRow[] = flags.businessId
    ? [{ business_id: flags.businessId, period_key: await rpc<string>('job_period_key', { p_job: 'briefing', p_as_of: asOf }) }]
    : await rpc<DueRow[]>('job_due', { p_job: 'briefing', p_as_of: asOf });
  let failures = 0;

  for (const { business_id: businessId, period_key: periodKey } of due) {
    const start = await rpc<StartResult>('job_start', {
      p_job: 'briefing',
      p_business_id: businessId,
      p_period_key: periodKey,
      p_trigger: flags.businessId || flags.force ? 'manual' : 'schedule',
      p_github_run_url: deps.githubRunUrl,
      p_force: flags.force,
    });
    if (!start.proceed) {
      log('briefing', 'skipped', { business_id: businessId, period: periodKey, reason: start.reason });
      continue;
    }
    try {
      const briefing = await rpc<Briefing>('job_get_briefing', { p_business_id: businessId, p_as_of: asOf });
      if (!briefing.recipient) throw new Error('The briefing has no recipient.');
      const email = renderBriefing(briefing, deps.appUrl);
      // The key stops a retried job from sending twice. A forced re-send is deliberate, so it gets a key of its
      // own; otherwise the email provider would treat it as a repeat for 24 hours and drop it.
      const idempotencyKey = flags.force ? `briefing:${businessId}:${periodKey}:${start.run_id}` : `briefing:${businessId}:${periodKey}`;
      const messageId = await deps.send({ to: briefing.recipient.email, replyTo: null, ...email, idempotencyKey });
      await rpc('job_record_email', { p_run_id: start.run_id, p_provider_message_id: messageId });
      await rpc('job_finish', {
        p_run_id: start.run_id,
        p_status: 'succeeded',
        p_stats: { overdue_count: briefing.totals.overdue_count, drafts_waiting: briefing.drafts_waiting },
      });
      log('briefing', 'sent', { business_id: businessId, period: periodKey });
    } catch (error) {
      failures += 1;
      log('briefing', 'failed', { business_id: businessId, period: periodKey, error: safeMessage(error) });
      await rpc('job_finish', { p_run_id: start.run_id, p_status: 'failed', p_error: safeMessage(error) }).catch(() => undefined);
    }
  }
  return failures > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  await runMain('briefing', async () => {
    const config = loadConfig();
    return runBriefings({
      rpc: createRpc(config.supabaseUrl, config.serviceKey),
      send: (email) => sendEmail(email, { apiKey: config.resendKey, from: config.emailFrom }),
      appUrl: config.appUrl,
      flags: parseFlags(),
      githubRunUrl: config.githubRunUrl,
    });
  });
}
