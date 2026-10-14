// AI-03, AI-06 and AI-07: build the request, check the reply with the database's AI-06 function, retry once,
// then fall back to the fixed template for the tone (FR-09).

import type { AiReply, AiRequest, Tone } from './claude.ts';

export type PlannedInvoice = {
  invoice_id: string;
  tone: Tone;
  days_overdue: number;
  reminders_sent_before: number;
  style_note: string | null;
  example_reminder: string | null;
};

export type Template = { tone: Tone; version: string; subject: string; body: string };

export type FallbackReason = 'ai_disabled' | 'timeout' | 'api_error' | 'failed_checks' | 'invalid_reply';

export type Draft = {
  subject: string;
  body: string;
  source: 'ai' | 'template';
  version: string;
  model: string | null;
  attempts: number;
  fallbackReason: FallbackReason | null;
};

export type DraftingDeps = {
  ask: ((request: AiRequest) => Promise<AiReply>) | null;
  check: (subject: string, body: string, tone: Tone) => Promise<string[]>;
  templates: Template[];
  promptVersion: string;
  model: string;
  maxAttempts?: number;
};

// AI-03: exactly these five fields leave our system. Nothing else from the invoice is copied in.
export function buildAiRequest(item: PlannedInvoice): AiRequest {
  return {
    tone: item.tone,
    days_overdue: item.days_overdue,
    reminders_sent_before: item.reminders_sent_before,
    style_note: item.style_note ?? null,
    example_reminder: item.example_reminder ?? null,
  };
}

export async function draftWithFallback(item: PlannedInvoice, deps: DraftingDeps): Promise<Draft> {
  const maxAttempts = deps.maxAttempts ?? 2;
  let reason: FallbackReason = 'ai_disabled';
  let attempts = 0;

  if (deps.ask) {
    for (attempts = 1; attempts <= maxAttempts; attempts += 1) {
      try {
        const reply = await deps.ask(buildAiRequest(item));
        const problems = await deps.check(reply.subject, reply.body, item.tone);
        if (problems.length === 0) {
          return { ...reply, source: 'ai', version: deps.promptVersion, model: deps.model, attempts, fallbackReason: null };
        }
        reason = 'failed_checks';
      } catch (error) {
        reason = classify(error);
      }
    }
    attempts = maxAttempts;
  }

  const template = deps.templates.find((candidate) => candidate.tone === item.tone);
  if (!template) throw new Error(`No active fallback template for tone "${item.tone}".`);
  return {
    subject: template.subject,
    body: template.body,
    source: 'template',
    version: template.version,
    model: null,
    attempts,
    fallbackReason: reason,
  };
}

export function classify(error: unknown): FallbackReason {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  if (name === 'InvalidReplyError') return 'invalid_reply';
  return 'api_error';
}
