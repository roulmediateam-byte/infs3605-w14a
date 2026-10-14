// Late-briefing alert (NFR-10): 30 minutes after a briefing slot, alert the team if any briefing has not gone.
// The run also fails (red in GitHub Actions), so the team is notified even without an alert address.

import { loadConfig, parseFlags } from './lib/config.ts';
import { createRpc } from './lib/db.ts';
import { sendEmail } from './lib/email.ts';
import { escapeHtml } from './lib/render.ts';
import { type DueRow, isMain, log, runMain } from './lib/run.ts';

if (isMain(import.meta.url)) {
  await runMain('briefing-check', async () => {
    const config = loadConfig();
    const flags = parseFlags();
    const rpc = createRpc(config.supabaseUrl, config.serviceKey);
    const asOf = flags.asOf ?? new Date().toISOString();
    const late = await rpc<DueRow[]>('job_due', { p_job: 'briefing_check', p_as_of: asOf });
    if (late.length === 0) {
      log('briefing-check', 'all_sent');
      return 0;
    }
    const ids = late.map((row) => row.business_id).join(', ');
    const text = [
      `The briefing has not gone for ${late.length} business(es): ${ids}.`,
      '',
      'What to do (docs/runbook.md, "Briefing late"):',
      '1. Open Actions > Briefing > Run workflow, with the business id and "force".',
      '2. Check job_runs for the error, fix it, and note it in the team chat (codes and links only).',
    ].join('\n');
    if (config.alertEmail) {
      await sendEmail(
        {
          to: config.alertEmail,
          subject: 'Alert: a briefing has not been sent',
          text,
          html: `<pre style="font:14px/1.5 monospace">${escapeHtml(text)}</pre>`,
          idempotencyKey: `alert:briefing:${late[0]?.period_key ?? 'unknown'}`,
        },
        { apiKey: config.resendKey, from: config.emailFrom },
      );
    }
    log('briefing-check', 'late', { count: late.length });
    return 1;
  });
}
