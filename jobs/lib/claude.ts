// The AI step (AI-01 to AI-10): one request per reminder, wording only, through the Claude Messages API with a
// structured-output schema. The key stays server-side (AI-10); the request holds no personal data (AI-03).

export type Tone = 'gentle' | 'standard' | 'firm';

export type AiRequest = {
  tone: Tone;
  days_overdue: number;
  reminders_sent_before: number;
  style_note: string | null;
  example_reminder: string | null;
};

export type AiReply = { subject: string; body: string };

export type AskOptions = {
  apiKey: string;
  model: string;
  temperature: number | null;
  timeoutMs: number;
  system: string;
  schema: Record<string, unknown>;
  fetchImpl?: typeof fetch;
};

export class InvalidReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReplyError';
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`Claude API returned HTTP ${status}: ${message}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function askClaude(request: AiRequest, options: AskOptions): Promise<AiReply> {
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: 800,
    system: options.system,
    messages: [{ role: 'user', content: JSON.stringify(request) }],
    output_config: { format: { type: 'json_schema', schema: options.schema } },
  };
  if (options.temperature !== null) body.temperature = options.temperature;

  const response = await (options.fetchImpl ?? fetch)('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    throw new ApiError(response.status, (await response.text()).slice(0, 200));
  }
  return parseReply(await response.json());
}

// AI-06, first part: a valid structured reply with a subject and a body. The database checks the rest.
export function parseReply(data: unknown): AiReply {
  const message = data as { stop_reason?: string; content?: Array<{ type?: string; text?: string }> };
  if (message.stop_reason && message.stop_reason !== 'end_turn') {
    throw new InvalidReplyError(`The model stopped with "${message.stop_reason}".`);
  }
  const text = message.content?.find((block) => block.type === 'text')?.text;
  if (typeof text !== 'string') throw new InvalidReplyError('The reply has no text.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidReplyError('The reply is not JSON.');
  }
  const reply = parsed as Partial<AiReply>;
  if (typeof reply.subject !== 'string' || typeof reply.body !== 'string') {
    throw new InvalidReplyError('The reply lacks a subject or body.');
  }
  return { subject: reply.subject.trim(), body: reply.body.trim() };
}
