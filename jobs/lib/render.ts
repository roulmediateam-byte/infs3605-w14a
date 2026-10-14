// EM-01 (Monday briefing) and EM-02 (checker nudge). Real text, not images, with a plain-text version
// (Design Requirements v0.1 section 8). The numbers come straight from the database's briefing (AT-06).

export type BriefingInvoice = {
  invoice_id: string;
  invoice_number: string;
  client_name: string;
  amount_due_cents: number;
  days_overdue: number;
  call_first: boolean;
  client_paused: boolean;
};

export type Briefing = {
  business: { id: string; name: string; owner_name: string; is_test_data: boolean };
  as_of_date: string;
  totals: {
    owed_cents: number;
    overdue_cents: number;
    open_count: number;
    overdue_count: number;
    due_this_week_cents: number;
    due_this_week_count: number;
  };
  drafts_waiting: number;
  first_draft_id: string | null;
  overdue: BriefingInvoice[];
  needs_attention: Array<{ kind: string; invoice_number: string; client_name: string; amount_due_cents: number }>;
  paused_clients: Array<{ name: string; overdue_cents: number }>;
  recipient?: { email: string; name: string };
  reply_to?: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

// BR-14: "$1,250.00", the same format as the database's private.format_aud.
export function formatAud(cents: number): string {
  return money.format(cents / 100);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

const attentionReason: Record<string, string> = {
  email_missing: 'no email address, so no reminder was drafted. Add one in Xero and import again, or in Clients.',
  amount_changed: 'the amount changed in your latest import, so its reminder was cancelled. A new one comes on Sunday.',
  due_date_changed: 'the due date changed in your latest import, so its reminder was cancelled. A new one comes on Sunday.',
};

export function renderBriefing(briefing: Briefing, appUrl: string): RenderedEmail {
  const prefix = briefing.business.is_test_data ? '[Test data] ' : '';
  const firstName = briefing.business.owner_name.split(/\s+/)[0] ?? briefing.business.owner_name;
  const reviewUrl = briefing.first_draft_id ? `${appUrl}/review?draft=${encodeURIComponent(briefing.first_draft_id)}` : `${appUrl}/`;
  const top = briefing.overdue.slice(0, 5);
  const more = briefing.overdue.length - top.length;
  const nothingOverdue = briefing.totals.overdue_count === 0;

  const subject = nothingOverdue
    ? `${prefix}This week: nothing to chase`
    : `${prefix}This week: ${formatAud(briefing.totals.overdue_cents)} overdue, ${plural(briefing.drafts_waiting, 'reminder', 'reminders')} to review`;

  const lines: string[] = [`Hi ${firstName},`, ''];
  if (nothingOverdue) {
    lines.push('Nothing to chase this week. Your apprentice checked every open invoice.', '');
  }
  lines.push(
    `Owed to you: ${formatAud(briefing.totals.owed_cents)} across ${plural(briefing.totals.open_count, 'invoice', 'invoices')}`,
    `Overdue: ${formatAud(briefing.totals.overdue_cents)} across ${plural(briefing.totals.overdue_count, 'invoice', 'invoices')}`,
    `Due in the next 7 days: ${formatAud(briefing.totals.due_this_week_cents)}`,
    '',
  );
  if (top.length > 0) {
    lines.push('Biggest overdue:');
    for (const invoice of top) lines.push(`- ${describe(invoice)}`);
    if (more > 0) lines.push(`- and ${more} more in the app`);
    lines.push('');
  }
  if (briefing.drafts_waiting > 0) {
    lines.push(`Your apprentice drafted ${plural(briefing.drafts_waiting, 'reminder', 'reminders')}. Nothing is sent until you approve it.`);
    lines.push(`Review drafts: ${reviewUrl}`, '');
  }
  if (briefing.needs_attention.length > 0) {
    lines.push(`Needs attention (${briefing.needs_attention.length}):`);
    for (const item of briefing.needs_attention) {
      lines.push(`- ${item.client_name}, invoice ${item.invoice_number}: ${attentionReason[item.kind] ?? 'check it in the app.'}`);
    }
    lines.push('');
  }
  if (briefing.paused_clients.length > 0) {
    lines.push(`Paused: ${briefing.paused_clients.map((client) => `${client.name} (${formatAud(client.overdue_cents)} overdue)`).join('; ')}`, '');
  }
  lines.push('Get-Paid Apprentice. Every reminder waits for your approval. Change the briefing time in Settings.');
  const text = lines.join('\n');

  return {
    subject,
    text,
    html: toHtml(subject, text, briefing.drafts_waiting > 0 ? { label: 'Review drafts', url: reviewUrl } : null, PREVIEW_TEXT),
  };
}

export function renderNudge(
  nudge: { recipient: { name: string }; business: { name: string; is_test_data: boolean }; drafts_waiting: number },
  appUrl: string,
): RenderedEmail {
  const prefix = nudge.business.is_test_data ? '[Test data] ' : '';
  const count = plural(nudge.drafts_waiting, 'reminder still needs', 'reminders still need');
  const subject = `${prefix}${count} approval`;
  const firstName = nudge.recipient.name.split(/\s+/)[0] ?? nudge.recipient.name;
  const text = [
    `Hi ${firstName},`,
    '',
    `${count} approval for ${nudge.business.name}. You can approve, edit or reject them while the owner is on site.`,
    '',
    `Review drafts: ${appUrl}/review`,
    '',
    'Get-Paid Apprentice. You get this email once a week at most.',
  ].join('\n');
  return { subject, text, html: toHtml(subject, text, { label: 'Review drafts', url: `${appUrl}/review` }, PREVIEW_TEXT) };
}

function describe(invoice: BriefingInvoice): string {
  const extras = [invoice.call_first ? 'consider a call' : null, invoice.client_paused ? 'paused' : null].filter(Boolean);
  return [
    invoice.client_name,
    `invoice ${invoice.invoice_number}`,
    formatAud(invoice.amount_due_cents),
    `${plural(invoice.days_overdue, 'day', 'days')} overdue`,
    ...extras,
  ].join(', ');
}

// A plain, accessible HTML version of the text: one column, 16px text, a single button, no images.
// Lines starting with "- " become list items; the "Review drafts: <link>" line becomes the button.
// Shown by email apps beside the subject (UI design brief, "The emails"); hidden in the body itself.
export const PREVIEW_TEXT = 'Nothing is sent until you approve it.';

function toHtml(title: string, text: string, button: { label: string; url: string } | null, preview: string): string {
  const blocks = text
    .split('\n\n')
    .map((block) => {
      const rows = block.split('\n').filter((row) => !(button && row.startsWith(`${button.label}: `)));
      const lines = rows.filter((row) => !row.startsWith('- '));
      const items = rows.filter((row) => row.startsWith('- '));
      const paragraph = lines.length > 0 ? `<p style="margin:0 0 8px">${lines.map(escapeHtml).join('<br>')}</p>` : '';
      const list =
        items.length > 0
          ? `<ul style="margin:0 0 8px;padding-left:20px">${items.map((item) => `<li style="margin:0 0 4px">${escapeHtml(item.slice(2))}</li>`).join('')}</ul>`
          : '';
      return paragraph || list ? `<div style="margin:0 0 16px">${paragraph}${list}</div>` : '';
    })
    .join('');
  const action = button
    ? `<p style="margin:0 0 24px"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#1f4fd1;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(button.label)}</a></p>`
    : '';
  return [
    '<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
    `<title>${escapeHtml(title)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#ffffff;color:#14181f;font:16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">',
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</div>`,
    `<div style="max-width:600px;margin:0 auto">${blocks}${action}</div></body></html>`,
  ].join('');
}
