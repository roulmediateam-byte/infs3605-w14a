// Checker nudge (FR-25, BR-12, EM-02): at noon on a morning-briefing day, one email to the named checker if
// drafts still wait. At most once per business per day (NFR-09).

import { loadConfig, parseFlags, type Flags } from './lib/config.ts';
import { createRpc, type Rpc } from './lib/db.ts';
import { sendEmail, type OutgoingEmail } from './lib/email.ts';
import { renderNudge } from './lib/render.ts';
import { type DueRow, isMain, log, runMain, safeMessage, type StartResult } from './lib/run.ts';

type Nudge = {
  recipient: { email: string; name: string };
  business: { id: string; name: string; is_test_data: boolean };
  drafts_waiting: number;
};

export async function runNudges(deps: {
  rpc: Rpc;
  send: (email: OutgoingEmail) => Promise<string>;
  appUrl: string;
  flags: Flags;
  githubRunUrl: string | null;
}): Promise<number> {
  const { rpc, flags } = deps;
  const asOf = flags.asOf ?? new Date().toISOString();
  const due = await rpc<DueRow[]>('job_due', { p_job: 'nudge', p_as_of: asOf });
  let failures = 0;

  for (const { business_id: businessId, period_key: periodKey } of due) {
    const start = await rpc<StartResult>('job_start', {
      p_job: 'nudge',
      p_business_id: businessId,
      p_period_key: periodKey,
      p_trigger: 'schedule',
      p_github_run_url: deps.githubRunUrl,
      p_force: false,
    });
    if (!start.proceed) continue;
    try {
      const nudge = await rpc<Nudge | null>('job_get_nudge', { p_business_id: businessId });
      if (!nudge || nudge.drafts_waiting === 0) {
        await rpc('job_finish', { p_run_id: start.run_id, p_status: 'skipped', p_stats: { reason: 'nothing_waiting' } });
        continue;
      }
      const email = renderNudge(nudge, deps.appUrl);
      const messageId = await deps.send({ to: nudge.recipient.email, ...email, idempotencyKey: `nudge:${businessId}:${periodKey}` });
      await rpc('job_record_email', { p_run_id: start.run_id, p_provider_message_id: messageId });
      await rpc('job_finish', { p_run_id: start.run_id, p_status: 'succeeded', p_stats: { drafts_waiting: nudge.drafts_waiting } });
      log('nudge', 'sent', { business_id: businessId, period: periodKey });
    } catch (error) {
      failures += 1;
      log('nudge', 'failed', { business_id: businessId, error: safeMessage(error) });
      await rpc('job_finish', { p_run_id: start.run_id, p_status: 'failed', p_error: safeMessage(error) }).catch(() => undefined);
    }
  }
  return failures > 0 ? 1 : 0;
}

if (isMain(import.meta.url)) {
  await runMain('nudge', async () => {
    const config = loadConfig();
    return runNudges({
      rpc: createRpc(config.supabaseUrl, config.serviceKey),
      send: (email) => sendEmail(email, { apiKey: config.resendKey, from: config.emailFrom }),
      appUrl: config.appUrl,
      flags: parseFlags(),
      githubRunUrl: config.githubRunUrl,
    });
  });
}
