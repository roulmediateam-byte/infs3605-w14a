import { describe, expect, it } from 'vitest';
import type { Billing } from '../backend/types.ts';
import { INTRO_PERCENT_OFF, PLANS, introApplies, phaseLine, price, priceLine } from './plans.ts';

const billing = (over: Partial<Billing>): Billing => ({
  catalogue: { currency: 'AUD', intro_months: 3, intro_percent_off: 80, plans: [] },
  plan: 'crew',
  phase: 'intro',
  checkout_intro_months: 3,
  usage: { active_clients: 6, has_checker: false, clients_limit: 100, checker_allowed: true },
  over_limit: false,
  ...over,
});

describe('Plans', () => {
  it('Plans: Solo $29, Crew $49 and Company $79, each 80% off for the first 3 months', () => {
    expect(PLANS.map((p) => `${p.id}:${p.priceCents}:${p.introCents}`)).toEqual(['solo:2900:580', 'crew:4900:980', 'company:7900:1580']);
    for (const plan of PLANS) expect(plan.introCents).toBe(Math.round((plan.priceCents * (100 - INTRO_PERCENT_OFF)) / 100));
  });

  it('Plans: prices read as the pricing page says them', () => {
    expect(price(2900)).toBe('$29');
    expect(price(580)).toBe('$5.80');
    expect(priceLine(PLANS[1]!, true)).toBe('$9.80 a month for 3 months, then $49');
    expect(priceLine(PLANS[1]!, false)).toBe('$49 a month');
  });

  it('Plans: the intro applies before any plan and while it still runs, never after', () => {
    expect(introApplies(undefined)).toBe(true);
    expect(introApplies(billing({ phase: 'none', plan: null }))).toBe(true);
    expect(introApplies(billing({ phase: 'intro', intro_days_left: 40 }))).toBe(true);
    expect(introApplies(billing({ phase: 'full', intro_days_left: 0 }))).toBe(false);
    expect(introApplies(billing({ phase: 'ended', intro_days_left: 0 }))).toBe(false);
  });

  it('Plans: the status line says how long the intro has left', () => {
    expect(phaseLine(billing({ phase: 'intro', intro_days_left: 1 }))).toBe('Intro price: 1 day left at 80% off');
    expect(phaseLine(billing({ phase: 'cancelling', ends_on: '2026-12-13' }))).toBe('Cancelled. It ends Sun 13 Dec 2026.');
  });
});
