// The three plans, as the pricing page describes them. Prices come from the database (private.plan_catalogue) and
// must match these; plans.test.ts checks the copy against the same numbers. Australian dollars, whole cents.
import type { Billing, PlanId } from '../backend/types.ts';
import { formatDateLong } from './dates.ts';
import { formatAud } from './money.ts';

export interface PlanCopy {
  id: PlanId;
  name: string;
  priceCents: number;
  introCents: number;
  who: string;
  clients: string;
  extras: string[];
  recommended?: boolean;
}

export const INTRO_MONTHS = 3;
export const INTRO_PERCENT_OFF = 80;

export const PLANS: PlanCopy[] = [
  {
    id: 'solo',
    name: 'Solo',
    priceCents: 2900,
    introCents: 580,
    who: 'Just you',
    clients: 'Up to 25 clients',
    extras: ['Weekly reminder drafts you approve', 'Monday briefing', 'Tone presets and promises to pay'],
  },
  {
    id: 'crew',
    name: 'Crew',
    priceCents: 4900,
    introCents: 980,
    who: 'You and a checker',
    clients: 'Up to 100 clients',
    extras: ['Everything in Solo', 'A checker can approve for you', 'Firmer by itself, if you turn it on'],
    recommended: true,
  },
  {
    id: 'company',
    name: 'Company',
    priceCents: 7900,
    introCents: 1580,
    who: 'You and a checker',
    clients: 'Unlimited clients',
    extras: ['Everything in Crew', 'Priority help from the team'],
  },
];

/** "$29" for whole dollars, "$5.80" otherwise. */
export const price = (cents: number): string => formatAud(cents).replace(/\.00$/, '');

/** Whether choosing a plan today would come with the intro: before any plan, and while the intro still runs. */
export const introApplies = (billing: Billing | undefined): boolean =>
  !billing || billing.phase === 'none' || ((billing.phase === 'intro' || billing.phase === 'cancelling') && (billing.intro_days_left ?? 0) > 0);

/** "$9.80 a month for 3 months, then $49" or "$49 a month". */
export const priceLine = (plan: PlanCopy, withIntro: boolean): string =>
  withIntro ? `${price(plan.introCents)} a month for ${INTRO_MONTHS} months, then ${price(plan.priceCents)}` : `${price(plan.priceCents)} a month`;

/** One line for the plan as it stands, such as "Intro price: 64 days left at 80% off". */
export const phaseLine = (billing: Billing): string => {
  switch (billing.phase) {
    case 'none':
      return 'No plan yet. Every plan starts with 3 months at 80% off.';
    case 'intro': {
      const days = billing.intro_days_left ?? 0;
      return `Intro price: ${days === 1 ? '1 day' : `${days} days`} left at ${INTRO_PERCENT_OFF}% off`;
    }
    case 'full':
      return 'Full price';
    case 'cancelling':
      return billing.ends_on ? `Cancelled. It ends ${formatDateLong(billing.ends_on)}.` : 'Cancelled';
    case 'ended':
      return 'This plan has ended. Choose a plan to start again.';
  }
};
