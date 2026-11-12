// Plans and billing: three plans, 80% off the first 3 months, then the full price. The owner chooses, changes,
// cancels or keeps the plan, and can add a card through Stripe Checkout in test mode (no real money). Everyone on the
// team can see the plan. Prices, phase and the next charge come from the database (get_billing), never from here.
import { useQuery } from '@tanstack/react-query';
import { BadgeDollarSign, Check, CreditCard, Users } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useMessages } from '../app/messages.tsx';
import { useAction } from '../app/queries.ts';
import { navigate, toHref, useLocation } from '../app/router.tsx';
import { useBackend, useBusiness } from '../app/session.tsx';
import type { Billing, PlanId } from '../backend/types.ts';
import { formatDateLong } from '../lib/dates.ts';
import { PLANS, introApplies, phaseLine, price, priceLine } from '../lib/plans.ts';
import { Banner, Button, Chip, IconTile, LoadingBlock, PageTitle } from '../ui/controls.tsx';
import { NoData } from '../ui/QueryState.tsx';

export const useBilling = () => {
  const backend = useBackend();
  const { businessId } = useBusiness();
  return useQuery({ queryKey: ['b', businessId, 'billing'], queryFn: () => backend.getBilling(businessId), staleTime: 30_000 });
};

const StatusCard = ({ billing }: { billing: Billing }) => {
  const plan = PLANS.find((p) => p.id === billing.plan);
  const limit = billing.usage.clients_limit;
  return (
    <section className="card stack" aria-labelledby="plan-now">
      <div className="row">
        <IconTile icon={BadgeDollarSign} tone="action" />
        <div className="stack-sm">
          <h2 id="plan-now" className="t-heading">
            {plan ? `${plan.name} plan` : 'No plan yet'}
          </h2>
          <span className="t-secondary">{phaseLine(billing)}</span>
        </div>
      </div>
      {billing.phase !== 'none' && billing.phase !== 'ended' ? (
        <dl className="data-strip">
          <div className="data-strip-line">
            <dt className="t-caption">This month</dt>
            <dd className="t-figure">{price(billing.price_now_cents ?? 0)}</dd>
          </div>
          {billing.next_charge_on ? (
            <div className="data-strip-line">
              <dt className="t-caption">Next charge</dt>
              <dd>
                {price(billing.next_charge_cents ?? 0)} on {formatDateLong(billing.next_charge_on)}
              </dd>
            </div>
          ) : null}
          {billing.intro_ends_on && billing.had_intro ? (
            <div className="data-strip-line">
              <dt className="t-caption">Full price from</dt>
              <dd>
                {formatDateLong(billing.intro_ends_on)}: {price(billing.full_price_cents ?? 0)} a month
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <p className="t-secondary">
        <Users size={16} aria-hidden="true" /> {billing.usage.active_clients} {billing.usage.active_clients === 1 ? 'client' : 'clients'} with open invoices
        {limit ? ` of ${limit} on this plan` : ''}. {billing.usage.has_checker ? 'You have a checker.' : 'No checker yet.'}
      </p>
      {billing.over_limit ? (
        <Banner tone="warning">You have more clients than this plan covers. Everything keeps working; think about moving up a plan.</Banner>
      ) : null}
      {billing.payment?.mode === 'stripe_test' && billing.payment.verified_at ? (
        <Chip tone="paid" icon={CreditCard}>
          Card added with Stripe (test mode, no real money)
        </Chip>
      ) : null}
    </section>
  );
};

export const PlansScreen = () => {
  const backend = useBackend();
  const { businessId, role } = useBusiness();
  const billing = useBilling();
  const { run, busy } = useAction();
  const { show } = useMessages();
  const location = useLocation();
  const confirmed = useRef(false);
  const owner = role === 'owner';

  // Back from Stripe Checkout: confirm with Stripe through the Edge Function, then tidy the address.
  const sessionId = location.params.get('session_id');
  useEffect(() => {
    if (!sessionId || confirmed.current || !backend.confirmCheckout) return;
    confirmed.current = true;
    void run('confirm', () => backend.confirmCheckout!(businessId, sessionId), { refresh: 'wait' }).then((result) => {
      show(result.ok ? { text: 'Card added. Your plan is set up (Stripe test mode, no real money).' } : { text: result.error.message, tone: 'critical' });
      navigate('plans', { replace: true });
    });
  }, [sessionId, backend, businessId, run, show]);
  useEffect(() => {
    if (location.params.get('checkout') === 'cancelled') {
      show({ text: 'No card was added. Your plan is unchanged.', tone: 'info' });
      navigate('plans', { replace: true });
    }
  }, [location, show]);

  if (billing.data === undefined) return <NoData query={billing} loading={<LoadingBlock label="Loading your plan" />} />;
  const b = billing.data;
  const withIntro = introApplies(b);

  const choose = (plan: PlanId) =>
    void run(`choose-${plan}`, () => backend.choosePlan(businessId, plan), { refresh: 'wait' }).then((result) => {
      const name = PLANS.find((p) => p.id === plan)?.name ?? plan;
      show(result.ok ? { text: `You're on ${name}.${result.value.phase === 'intro' ? ' 80% off until the intro ends.' : ''}` } : { text: result.error.message, tone: 'critical' });
    });
  const cancel = () =>
    void run('cancel', () => backend.cancelPlan(businessId), { refresh: 'wait' }).then((result) => {
      show(result.ok ? { text: `Cancelled. Your plan runs until ${result.value.ends_on ? formatDateLong(result.value.ends_on) : 'the end of the month'}.` } : { text: result.error.message, tone: 'critical' });
    });
  const resume = () =>
    void run('resume', () => backend.resumePlan(businessId), { refresh: 'wait' }).then((result) => {
      show(result.ok ? { text: 'Your plan keeps going.' } : { text: result.error.message, tone: 'critical' });
    });
  const addCard = () => {
    if (!backend.startCheckout || !b.plan) return;
    const plan = b.plan;
    void run('checkout', () => backend.startCheckout!(businessId, plan, window.location.origin + toHref('plans')), { refresh: 'none' }).then((result) => {
      if (result.ok) window.location.assign(result.value.url);
      else show({ text: result.error.message, tone: 'critical' });
    });
  };
  const cardNeeded = owner && backend.startCheckout && b.plan && (b.phase === 'intro' || b.phase === 'full') && !b.payment?.verified_at;

  return (
    <div className="page stack-lg">
      <PageTitle documentTitle="Plans and billing">Plans and billing</PageTitle>
      <StatusCard billing={b} />
      {cardNeeded ? (
        <div className="stack-sm">
          <Button variant="primary" onClick={addCard} busy={busy === 'checkout'} busyLabel="Opening Stripe…">
            <CreditCard size={18} aria-hidden="true" /> Add a card with Stripe (test mode)
          </Button>
          <span className="t-caption">Test mode: use the card 4242 4242 4242 4242, any future date and any CVC. No real money is taken.</span>
        </div>
      ) : null}
      {!owner ? <Banner>Only the owner can change the plan.</Banner> : null}

      <section className="stack" aria-labelledby="plans-heading">
        <h2 id="plans-heading" className="t-subheading">
          {withIntro ? 'Every plan: 80% off your first 3 months, then the full price' : 'Plans'}
        </h2>
        <ul className="plans-grid">
          {PLANS.map((plan) => {
            const current = b.plan === plan.id && b.phase !== 'ended';
            return (
              <li key={plan.id} className={`card stack plan-card${plan.recommended ? ' plan-card-recommended' : ''}${current ? ' plan-card-current' : ''}`}>
                <div className="spread">
                  <h3 className="t-heading">{plan.name}</h3>
                  {current ? <Chip tone="selected">Your plan</Chip> : plan.recommended ? <Chip tone="apprentice" icon={null}>Recommended</Chip> : null}
                </div>
                <p className="plan-price">
                  <span className="t-figure">{price(withIntro ? plan.introCents : plan.priceCents)}</span> <span className="t-secondary">a month</span>
                </p>
                <p className="t-caption">{priceLine(plan, withIntro)}</p>
                <ul className="plan-points">
                  {[plan.who, plan.clients, ...plan.extras].map((point) => (
                    <li key={point}>
                      <Check size={16} aria-hidden="true" /> {point}
                    </li>
                  ))}
                </ul>
                {owner && !current ? (
                  <Button variant={plan.recommended ? 'primary' : 'secondary'} onClick={() => choose(plan.id)} busy={busy === `choose-${plan.id}`} busyLabel="Choosing…">
                    {b.plan && b.phase !== 'ended' ? `Move to ${plan.name}` : `Start ${plan.name}`}
                  </Button>
                ) : null}
                {owner && current && b.phase === 'cancelling' ? (
                  <Button variant="primary" onClick={resume} busy={busy === 'resume'} busyLabel="Keeping it…">
                    Keep my plan
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {owner && (b.phase === 'intro' || b.phase === 'full') ? (
        <section className="stack-sm">
          <Button variant="quiet" onClick={cancel} busy={busy === 'cancel'} busyLabel="Cancelling…">
            Cancel my plan
          </Button>
          <span className="t-caption">It runs to the end of the month already paid for. You can keep it going until then.</span>
        </section>
      ) : null}
      <p className="t-caption">
        Prices in Australian dollars, charged monthly. The 3-month intro is once per business. Solo is for one person; Crew and Company add a
        checker. Client limits are a guide: nothing stops working if you go over. This build uses Stripe's test mode, so no real money is ever taken.
      </p>
    </div>
  );
};
