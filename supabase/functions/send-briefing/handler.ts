// The Monday briefing (EM-01) by email now, to the signed-in owner, through Resend. It is the same briefing as Home
// and the scheduled job (job_get_briefing, renderBriefing), so the numbers cannot differ (AT-06). Clients are never
// emailed (D2). Reserved Test-data addresses (.test, .example, example.com) can't receive mail, so they get a clear
// refusal instead of a silent failure.
//
// Secrets: RESEND_API_KEY, and RESEND_FROM (default "Payprentice <onboarding@resend.dev>", which Resend lets an
// account use before its own domain is set up: it then delivers only to the Resend account's own address).
// APP_URL is where the email's buttons point (default: the live demo).
import { renderBriefing, type Briefing } from '../../../jobs/lib/render.ts';
import { sendEmail } from '../../../jobs/lib/email.ts';
import { type Env, readBody, refuse, reply, requireOwner, serviceRpc } from '../_shared/owner.ts';

export const RESERVED = /(\.test|\.example|@example\.com)$/i;

export async function handle(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  if (request.method !== 'POST') return refuse(405, 'method', 'Use POST.');
  const body = await readBody(request);
  const businessId = typeof body.business_id === 'string' ? body.business_id : '';
  try {
    const owner = await requireOwner(request, env, businessId, fetchImpl);
    if (owner instanceof Response) return owner;
    const to = owner.email?.trim().toLowerCase() ?? '';
    const briefing = await serviceRpc<Briefing & { reply_to?: string }>(owner, 'job_get_briefing', { p_business_id: businessId }, fetchImpl);
    const email = renderBriefing(briefing, env.APP_URL?.trim() || 'https://roulmediateam-byte.github.io/infs3605-w14a/demo/');
    if (body.action === 'preview') return reply(200, { subject: email.subject, text: email.text });
    if (body.action !== 'send_now') return refuse(400, 'action', 'Unknown action.');
    if (!to || RESERVED.test(to)) {
      return refuse(422, 'test_address', 'Your sign-in address is a made-up Test data one, so it can’t receive email. Sign in with a real inbox to get the briefing by email.');
    }
    const apiKey = env.RESEND_API_KEY?.trim() || null;
    if (!apiKey) return refuse(503, 'not_configured', "Briefing emails aren't set up in this build yet.");
    const minute = new Date().toISOString().slice(0, 16);
    await sendEmail(
      { to, subject: email.subject, text: email.text, html: email.html, replyTo: null, idempotencyKey: `briefing-now-${businessId}-${minute}` },
      { apiKey, from: env.RESEND_FROM?.trim() || 'Payprentice <onboarding@resend.dev>', fetchImpl },
    );
    return reply(200, { sent_to: to });
  } catch {
    return refuse(502, 'failed', "The briefing email didn't go. Try again in a minute.");
  }
}
