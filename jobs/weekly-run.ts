// Weekly run (FR-07 to FR-10): every Sunday at 9:00 pm Sydney time, draft one reminder for each invoice that
// meets BR-01. Safe to repeat (NFR-09, AT-08). Usage:
//   node jobs/weekly-run.ts                      scheduled: drafts for every business that is due
//   node jobs/weekly-run.ts --business=<id> --force    by hand, for one business (setup step 5)
// The run itself is in lib/weekly.ts, which the demonstration build's "Run it now" Edge Function shares.

import { readFileSync } from 'node:fs';
import { askClaude } from './lib/claude.ts';
import { loadConfig, parseFlags } from './lib/config.ts';
import { createRpc } from './lib/db.ts';
import { isMain, runMain } from './lib/run.ts';
import { runWeekly } from './lib/weekly.ts';

export { PROMPT_VERSION, runWeekly, type WeeklyDeps, type WeeklyOutcome, type WeeklyStats } from './lib/weekly.ts';

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
