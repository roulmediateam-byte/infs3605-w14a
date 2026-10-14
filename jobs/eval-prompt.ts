// AI output tests (Design Requirements v0.1 section 14): 30 fixed cases, 3 tones by 10 situations, run against
// the real model. Every reply must pass AI-06 (checked by the database), and a teammate reads 10 for tone.
// Run before merging any change to prompts/:  node jobs/eval-prompt.ts
// Needs ANTHROPIC_API_KEY and a database with the migrations (local Supabase is fine).

import { readFileSync } from 'node:fs';
import { askClaude, type AiRequest } from './lib/claude.ts';
import { loadConfig } from './lib/config.ts';
import { createRpc } from './lib/db.ts';
import { isMain, runMain, safeMessage } from './lib/run.ts';

type Case = { id: string; about: string; input: AiRequest };

// Sample facts used only to show a teammate what a filled-in reminder reads like.
const SAMPLE_FACTS: Record<string, string> = {
  client_name: 'Sam',
  invoice_number: '1043',
  amount_due: '$1,250.00',
  due_date: 'Thu 1 Oct 2026',
  days_overdue: '14',
  owner_name: 'Alex',
  business_name: 'Harbour Line Electrical (Test data)',
};

const fill = (text: string): string => text.replace(/\{([a-z_]+)\}/g, (match, key: string) => SAMPLE_FACTS[key] ?? match);

if (isMain(import.meta.url)) {
  await runMain('eval-prompt', async () => {
    const config = loadConfig();
    if (!config.anthropicKey) throw new Error('Set ANTHROPIC_API_KEY to run the prompt evaluation.');
    const apiKey = config.anthropicKey;
    const rpc = createRpc(config.supabaseUrl, config.serviceKey);
    const dir = new URL('../prompts/reminder-draft/', import.meta.url);
    const system = readFileSync(new URL('v1/system.md', dir), 'utf8');
    const schema = JSON.parse(readFileSync(new URL('v1/output.schema.json', dir), 'utf8')) as Record<string, unknown>;
    const cases = readFileSync(new URL('evals/cases.jsonl', dir), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Case);

    let failed = 0;
    const samples: string[] = [];
    for (const [index, testCase] of cases.entries()) {
      try {
        const reply = await askClaude(testCase.input, {
          apiKey,
          model: config.aiModel,
          temperature: config.aiTemperature,
          timeoutMs: config.aiTimeoutMs,
          system,
          schema,
        });
        const problems = await rpc<string[]>('job_check_template', { p_subject: reply.subject, p_body: reply.body, p_tone: testCase.input.tone });
        if (problems.length > 0) failed += 1;
        console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'} ${testCase.id}${problems.length ? `: ${problems.join(', ')}` : ''}`);
        if (index % 3 === 0 && samples.length < 10) {
          samples.push(`--- ${testCase.id} (${testCase.about})\nSubject: ${fill(reply.subject)}\n\n${fill(reply.body)}\n`);
        }
      } catch (error) {
        failed += 1;
        console.log(`FAIL ${testCase.id}: ${safeMessage(error)}`);
      }
    }
    console.log(`\n${cases.length - failed} of ${cases.length} replies passed AI-06 (${config.aiModel}).`);
    console.log('\nTen samples for a teammate to read for tone (sample facts filled in):\n');
    console.log(samples.join('\n'));
    return failed === 0 ? 0 : 1;
  });
}
