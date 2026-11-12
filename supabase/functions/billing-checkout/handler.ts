// Stripe Checkout in TEST MODE for a plan: Solo $29, Crew $49 or Company $79 a month, with 80% off the intro months
// the business still has (a coupon of 1 to 3 months). No real money: the function refuses any key that is not a
// Stripe test key, and the database refuses any checkout id that is not a test one (job_record_checkout).
//
//   action "start":   the owner asks for a checkout; the reply is Stripe's hosted page to send them to.
//   action "confirm": back from Stripe; the function asks Stripe whether that checkout was paid, then records it.
//
// Secrets (Edge Functions > Secrets, set by the team, never in Git): STRIPE_SECRET_KEY (sk_test_ or rk_test_ only),
// APP_ORIGINS (comma-separated origins the app may return to). Supabase provides SUPABASE_URL and the keys.
import { type Env, personRpc, readBody, refuse, reply, requireOwner, serviceRpc } from '../_shared/owner.ts';

const PLANS = ['solo', 'crew', 'company'] as const;
type Plan = (typeof PLANS)[number];
const DEFAULT_ORIGINS = 'https://roulmediateam-byte.github.io,http://127.0.0.1:4173,http://localhost:5173';

interface Billing {
  catalogue: { plans: { id: Plan; name: string; price_cents: number }[] };
  checkout_intro_months: number;
}

export const isTestKey = (key: string | undefined): key is string => /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key?.trim() ?? '');

const stripe = async <T>(key: string, path: string, fetchImpl: typeof fetch, form?: Record<string, string>): Promise<{ status: number; body: T }> => {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: (await response.json()) as T };
};

/** The coupon for n intro months at 80% off, made once in the Stripe test account and reused. */
const ensureCoupon = async (key: string, months: number, fetchImpl: typeof fetch): Promise<string> => {
  const id = `payprentice-intro-80-${months}m`;
  const found = await stripe(key, `coupons/${id}`, fetchImpl);
  if (found.status === 200) return id;
  const made = await stripe(key, 'coupons', fetchImpl, {
    id,
    percent_off: '80',
    duration: 'repeating',
    duration_in_months: String(months),
    name: `Payprentice intro: 80% off for ${months} ${months === 1 ? 'month' : 'months'}`,
  });
  if (made.status !== 200) throw new Error(`coupon ${made.status}`);
  return id;
};

export const allowedReturn = (returnTo: string, origins: string): URL | null => {
  try {
    const url = new URL(returnTo);
    const allowed = origins.split(',').map((o) => o.trim()).filter(Boolean);
    return allowed.includes(url.origin) ? url : null;
  } catch {
    return null;
  }
};

export async function handle(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  if (request.method !== 'POST') return refuse(405, 'method', 'Use POST.');
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return refuse(503, 'not_configured', "Card payments aren't set up in this build yet. Your plan works without a card in test mode.");
  if (!isTestKey(key)) return refuse(503, 'live_key_refused', 'This build only takes Stripe test keys, so no real money can move. Ask the team to fix the setting.');

  const body = await readBody(request);
  const businessId = typeof body.business_id === 'string' ? body.business_id : '';
  try {
    const owner = await requireOwner(request, env, businessId, fetchImpl);
    if (owner instanceof Response) return owner;

    if (body.action === 'start') {
      const plan = PLANS.find((p) => p === body.plan);
      if (!plan) return refuse(400, 'plan', 'Choose Solo, Crew or Company.');
      const back = allowedReturn(typeof body.return_to === 'string' ? body.return_to : '', env.APP_ORIGINS ?? DEFAULT_ORIGINS);
      if (!back) return refuse(400, 'return_to', "Payments can only return to the app's own address.");
      const billing = await personRpc<Billing>(owner, 'get_billing', { p_business_id: businessId }, fetchImpl);
      const info = billing.catalogue.plans.find((p) => p.id === plan);
      if (!info) return refuse(400, 'plan', 'Choose Solo, Crew or Company.');
      const months = Math.max(0, Math.min(3, billing.checkout_intro_months));
      const success = new URL(back);
      success.searchParams.set('checkout', 'done');
      const cancel = new URL(back);
      cancel.searchParams.set('checkout', 'cancelled');
      const form: Record<string, string> = {
        mode: 'subscription',
        // Stripe fills in {CHECKOUT_SESSION_ID}; URLSearchParams would escape the braces, so it is added as text.
        success_url: `${success.toString()}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancel.toString(),
        client_reference_id: businessId,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'aud',
        'line_items[0][price_data][unit_amount]': String(info.price_cents),
        'line_items[0][price_data][recurring][interval]': 'month',
        'line_items[0][price_data][product_data][name]': `Payprentice ${info.name} (test mode)`,
        'metadata[business_id]': businessId,
        'metadata[plan]': plan,
        'metadata[intro_months]': String(months),
        'subscription_data[metadata][business_id]': businessId,
      };
      if (months > 0) form['discounts[0][coupon]'] = await ensureCoupon(key, months, fetchImpl);
      const session = await stripe<{ url?: string }>(key, 'checkout/sessions', fetchImpl, form);
      if (session.status !== 200 || !session.body.url) return refuse(502, 'stripe', "Stripe didn't open the payment page. Try again in a minute.");
      return reply(200, { url: session.body.url });
    }

    if (body.action === 'confirm') {
      const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
      if (!/^cs_test_[A-Za-z0-9_]{1,200}$/.test(sessionId)) return refuse(400, 'session', 'That payment is not a Stripe test-mode checkout.');
      const found = await stripe<{
        status?: string;
        payment_status?: string;
        customer?: string | null;
        subscription?: string | null;
        metadata?: Record<string, string>;
      }>(key, `checkout/sessions/${sessionId}`, fetchImpl);
      const s = found.body;
      if (found.status !== 200 || s.metadata?.business_id !== businessId) return refuse(404, 'session', "That payment isn't for this business.");
      if (s.status !== 'complete' || !['paid', 'no_payment_required'].includes(s.payment_status ?? '')) {
        return refuse(409, 'not_paid', "Stripe hasn't confirmed the payment yet. Your plan is unchanged.");
      }
      const billing = await serviceRpc<unknown>(
        owner,
        'job_record_checkout',
        {
          p_business_id: businessId,
          p_plan: s.metadata?.plan,
          p_checkout_id: sessionId,
          p_customer_id: s.customer ?? null,
          p_subscription_id: s.subscription ?? null,
          p_intro_months: Number(s.metadata?.intro_months ?? 0),
        },
        fetchImpl,
      );
      return reply(200, { billing });
    }
    return refuse(400, 'action', 'Unknown action.');
  } catch {
    return refuse(502, 'failed', "That didn't work. Try again in a minute.");
  }
}
