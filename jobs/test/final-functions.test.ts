// The final version's Edge Functions on Node with stand-ins: Stripe test mode only, returns only to the app, and
// briefing emails never go to made-up Test data addresses.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowedReturn, handle as billing, isTestKey } from '../../supabase/functions/billing-checkout/handler.ts';
import { handle as briefing, RESERVED } from '../../supabase/functions/send-briefing/handler.ts';

const ENV = { SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' };
const BIZ = '0d5e0000-0000-4000-8000-000000000001';
const post = (body: unknown) =>
  new Request('https://fn.example', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const noNetwork: typeof fetch = async () => {
  throw new Error('no network in this test');
};

describe('billing-checkout', () => {
  it('Stripe: only test keys are accepted, so no real money can move', () => {
    assert.equal(isTestKey('sk_test_abc123'), true);
    assert.equal(isTestKey('rk_test_abc123'), true);
    assert.equal(isTestKey('sk_live_abc123'), false);
    assert.equal(isTestKey(undefined), false);
  });

  it('Stripe: a live key is refused before anything else happens', async () => {
    const response = await billing(post({ action: 'start', business_id: BIZ, plan: 'crew' }), { ...ENV, STRIPE_SECRET_KEY: 'sk_live_abc' }, noNetwork);
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { code: string }).code, 'live_key_refused');
  });

  it('Stripe: without a key the app is told card payments are not set up', async () => {
    const response = await billing(post({ action: 'start', business_id: BIZ, plan: 'crew' }), ENV, noNetwork);
    assert.equal(((await response.json()) as { code: string }).code, 'not_configured');
  });

  it('Stripe: checkout returns only to the app\'s own addresses', () => {
    const origins = 'https://roulmediateam-byte.github.io,http://127.0.0.1:4173';
    assert.ok(allowedReturn('https://roulmediateam-byte.github.io/infs3605-w14a/demo/plans', origins));
    assert.equal(allowedReturn('https://elsewhere.example/plans', origins), null);
    assert.equal(allowedReturn('not a url', origins), null);
  });
});

describe('send-briefing', () => {
  it('Briefing email: made-up Test data addresses are recognised, real inboxes are not', () => {
    assert.ok(RESERVED.test('owner@demo.test'));
    assert.ok(RESERVED.test('pay@northshore-homes.example'));
    assert.ok(RESERVED.test('someone@example.com'));
    assert.equal(RESERVED.test('owner@gmail.com'), false);
  });

  it('Briefing email: a signed-out request is refused', async () => {
    const response = await briefing(new Request('https://fn.example', { method: 'POST', body: '{}' }), ENV, noNetwork);
    assert.equal(response.status, 401);
  });
});
