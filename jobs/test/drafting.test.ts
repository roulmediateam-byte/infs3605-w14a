import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InvalidReplyError, parseReply, type AiReply, type AiRequest } from '../lib/claude.ts';
import { buildAiRequest, draftWithFallback, type PlannedInvoice, type Template } from '../lib/drafting.ts';

const planned: PlannedInvoice = {
  invoice_id: '11111111-1111-4111-8111-111111111111',
  tone: 'standard',
  days_overdue: 14,
  reminders_sent_before: 1,
  style_note: 'Short and friendly.',
  example_reminder: null,
};

const templates: Template[] = [
  { tone: 'gentle', version: 'template/v1', subject: 'Gentle {invoice_number}', body: 'gentle body' },
  { tone: 'standard', version: 'template/v1', subject: 'Invoice {invoice_number} is overdue', body: 'standard body' },
  { tone: 'firm', version: 'template/v1', subject: 'Overdue: invoice {invoice_number}', body: 'firm body' },
];

const good: AiReply = { subject: 'Invoice {invoice_number}', body: 'a good body' };
const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });

describe('AI-03: the request', () => {
  it('holds only tone, days overdue, reminders sent before and the owner style', () => {
    const request = buildAiRequest({ ...planned, client_name: 'Somebody', amount_due_cents: 125000 } as PlannedInvoice);
    assert.deepEqual(Object.keys(request).sort(), ['days_overdue', 'example_reminder', 'reminders_sent_before', 'style_note', 'tone']);
    assert.equal('invoice_id' in request, false);
  });
});

describe('AI-06 and AI-07: retry once, then the template', () => {
  it('uses the first reply that passes the checks', async () => {
    const draft = await draftWithFallback(planned, {
      ask: async () => good,
      check: async () => [],
      templates,
      promptVersion: 'reminder-draft/v1',
      model: 'claude-haiku-5-5',
    });
    assert.deepEqual(
      { source: draft.source, attempts: draft.attempts, version: draft.version, model: draft.model, reason: draft.fallbackReason },
      { source: 'ai', attempts: 1, version: 'reminder-draft/v1', model: 'claude-haiku-5-5', reason: null },
    );
  });

  it('retries once when the first reply fails the checks', async () => {
    let calls = 0;
    const draft = await draftWithFallback(planned, {
      ask: async () => good,
      check: async () => (++calls === 1 ? ['digits_outside_placeholders'] : []),
      templates,
      promptVersion: 'reminder-draft/v1',
      model: 'claude-haiku-5-5',
    });
    assert.equal(draft.source, 'ai');
    assert.equal(draft.attempts, 2);
  });

  it('falls back to the template for the tone after two failed replies', async () => {
    const draft = await draftWithFallback(planned, {
      ask: async () => good,
      check: async () => ['body_length'],
      templates,
      promptVersion: 'reminder-draft/v1',
      model: 'claude-haiku-5-5',
    });
    assert.deepEqual(
      { source: draft.source, subject: draft.subject, attempts: draft.attempts, reason: draft.fallbackReason, model: draft.model },
      { source: 'template', subject: 'Invoice {invoice_number} is overdue', attempts: 2, reason: 'failed_checks', model: null },
    );
  });

  it('records a timeout as the reason (20-second limit)', async () => {
    const draft = await draftWithFallback(planned, {
      ask: async () => {
        throw timeout;
      },
      check: async () => [],
      templates,
      promptVersion: 'reminder-draft/v1',
      model: 'claude-haiku-5-5',
    });
    assert.equal(draft.fallbackReason, 'timeout');
  });

  it('uses the template straight away when the AI is switched off', async () => {
    const draft = await draftWithFallback(planned, { ask: null, check: async () => [], templates, promptVersion: 'v', model: 'm' });
    assert.deepEqual({ source: draft.source, attempts: draft.attempts, reason: draft.fallbackReason }, { source: 'template', attempts: 0, reason: 'ai_disabled' });
  });

  it('never sends the request anywhere but the ask function', async () => {
    const seen: AiRequest[] = [];
    await draftWithFallback(planned, {
      ask: async (request) => {
        seen.push(request);
        return good;
      },
      check: async () => [],
      templates,
      promptVersion: 'v',
      model: 'm',
    });
    assert.equal(JSON.stringify(seen).includes(planned.invoice_id), false);
  });
});

describe('Claude replies', () => {
  const message = (text: string, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text }] });

  it('reads a structured reply', () => {
    assert.deepEqual(parseReply(message('{"subject":" S ","body":" B "}')), { subject: 'S', body: 'B' });
  });
  it('rejects text that is not JSON', () => {
    assert.throws(() => parseReply(message('Here is your reminder')), InvalidReplyError);
  });
  it('rejects a reply cut off by the token limit', () => {
    assert.throws(() => parseReply(message('{"subject":"S"', 'max_tokens')), InvalidReplyError);
  });
  it('rejects a reply without a body', () => {
    assert.throws(() => parseReply(message('{"subject":"S"}')), InvalidReplyError);
  });
});
