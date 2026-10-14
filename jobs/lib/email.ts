// Emails to the owner and the checker only (EM-01, EM-02, team alerts). The system never emails clients in the
// proof of concept (decision D2). Sent through Resend from a domain with SPF, DKIM and DMARC set up (NFR-18).

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
  idempotencyKey: string;
};

export type SendOptions = { apiKey: string | null; from: string; fetchImpl?: typeof fetch };

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailError';
  }
}

// Returns the provider's message id. Without an API key (local runs, CI) it prints a preview instead.
export async function sendEmail(email: OutgoingEmail, options: SendOptions): Promise<string> {
  if (!options.apiKey) {
    console.log(`[email preview] ${email.subject}\n${email.text}\n`);
    return `preview-${email.idempotencyKey}`;
  }
  const response = await (options.fetchImpl ?? fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      // A retried job reuses the key, so Resend sends the email once (NFR-09).
      'Idempotency-Key': email.idempotencyKey,
    },
    body: JSON.stringify({
      from: options.from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new EmailError(`Resend returned HTTP ${response.status}.`);
  }
  const data = (await response.json()) as { id?: string };
  if (!data.id) throw new EmailError('Resend did not return a message id.');
  return data.id;
}
