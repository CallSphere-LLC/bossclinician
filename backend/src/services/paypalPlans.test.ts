import { describe, expect, it } from 'vitest';
import { computeOrderTotal, type PricedOffer } from './pricing';
import {
  PayPalPlanError,
  buildPayPalPlanSpec,
  membershipStatus,
  paidInstallmentCount,
  payPalPlanBody,
  type PlanSpecInput,
} from './paypalPlans';
import type { PayPalSubscription } from './paypalClient';

/** A spec input built the way checkout builds it: from computeOrderTotal. */
function input(offer: Partial<PricedOffer> & { amountCents: number }, extra: {
  bumps?: number[];
  coupon?: { percentOff?: number; amountOffCents?: number; duration: 'first' | 'forever' };
} = {}): PlanSpecInput {
  const priced: PricedOffer = {
    id: 7, title: 'The Club', currency: 'usd', pricingType: 'payment_plan', minAmountCents: 0,
    interval: 'month', intervalCount: 1, installmentCount: 6, trialDays: 0, ...offer,
  };
  const coupon = extra.coupon
    ? { id: 1, code: 'SAVE', percentOff: extra.coupon.percentOff ?? null, amountOffCents: extra.coupon.amountOffCents ?? null, duration: extra.coupon.duration }
    : null;
  const total = computeOrderTotal({
    offer: priced,
    bumps: (extra.bumps ?? []).map((cents, i) => ({ id: i + 1, productId: i + 1, title: `Bump ${i + 1}`, amountCents: cents })),
    coupon,
  });
  return {
    offerId: priced.id, pricingOptionId: 3, title: priced.title, currency: priced.currency,
    pricingType: priced.pricingType, interval: priced.interval, intervalCount: priced.intervalCount,
    installmentCount: priced.installmentCount, trialDays: priced.trialDays,
    lines: total.lines, subtotalCents: total.subtotalCents, discountCents: total.discountCents,
    couponDuration: coupon?.duration ?? null,
  };
}

describe('PayPal plan for a fixed-installment payment plan', () => {
  it('"$397 x 6" stops after six monthly charges', () => {
    const spec = buildPayPalPlanSpec(input({ amountCents: 39700, installmentCount: 6 }));
    expect(spec.billingCycles).toEqual([{
      frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 6,
      pricing_scheme: { fixed_price: { currency_code: 'USD', value: '397.00' } },
    }]);
    expect(spec.dueAtActivationCents).toBe(39700);
    expect(spec.installmentCount).toBe(6);
    expect(spec.pricedSequences).toEqual([1]);
  });

  it('"9 x $612" with a first-payment coupon: one discounted cycle, then eight full ones', () => {
    const spec = buildPayPalPlanSpec(input({ amountCents: 61200, installmentCount: 9 }, { coupon: { amountOffCents: 10000, duration: 'first' } }));
    expect(spec.billingCycles.map((c) => [c.tenure_type, c.total_cycles, c.pricing_scheme?.fixed_price.value])).toEqual([
      ['TRIAL', 1, '512.00'],
      ['REGULAR', 8, '612.00'],
    ]);
    expect(spec.firstCycleCents).toBe(51200);
    expect(spec.recurringCents).toBe(61200);
    expect(spec.pricedSequences).toEqual([1, 2]);
  });

  it('a forever coupon discounts every installment, matching Stripe', () => {
    const spec = buildPayPalPlanSpec(input({ amountCents: 39700, installmentCount: 6 }, { coupon: { percentOff: 10, duration: 'forever' } }));
    expect(spec.billingCycles).toHaveLength(1);
    expect(spec.billingCycles[0]).toMatchObject({ tenure_type: 'REGULAR', total_cycles: 6, pricing_scheme: { fixed_price: { value: '357.30' } } });
  });

  it('bumps become a one-off setup fee, net of their share of the discount', () => {
    // $397 plan + $100 bump, 10% off the whole order = $447.30 first payment.
    const data = input({ amountCents: 39700, installmentCount: 6 }, { bumps: [10000], coupon: { percentOff: 10, duration: 'first' } });
    const spec = buildPayPalPlanSpec(data);
    expect(data.subtotalCents - data.discountCents).toBe(44730);
    expect(spec.firstCycleCents + spec.setupFeeCents).toBe(44730);
    expect(spec.setupFeeCents).toBe(9000);
    const body = payPalPlanBody(spec, 'PROD-XXXXXXXXXXXXXXXXX');
    expect(body.payment_preferences).toMatchObject({ setup_fee: { value: '90.00' }, setup_fee_failure_action: 'CANCEL', auto_bill_outstanding: true });
  });
});

describe('PayPal plan for a membership', () => {
  it('monthly membership runs until cancelled', () => {
    const spec = buildPayPalPlanSpec(input({ pricingType: 'subscription', amountCents: 4700, installmentCount: null }));
    expect(spec.billingCycles).toEqual([expect.objectContaining({ tenure_type: 'REGULAR', total_cycles: 0, frequency: { interval_unit: 'MONTH', interval_count: 1 } })]);
    expect(spec.installmentCount).toBeNull();
  });

  it('yearly membership with a free trial: nothing due at activation', () => {
    const spec = buildPayPalPlanSpec(input({ pricingType: 'subscription', amountCents: 49700, installmentCount: null, interval: 'year', trialDays: 14 }));
    expect(spec.billingCycles[0]).toEqual({ frequency: { interval_unit: 'DAY', interval_count: 14 }, tenure_type: 'TRIAL', sequence: 1, total_cycles: 1 });
    expect(spec.billingCycles[1]).toMatchObject({ frequency: { interval_unit: 'YEAR', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 2, total_cycles: 0 });
    expect(spec.dueAtActivationCents).toBe(0);
    expect(spec.pricedSequences).toEqual([2]);
  });

  it('the hash changes with the price, so repricing mints a new plan', () => {
    const a = buildPayPalPlanSpec(input({ pricingType: 'subscription', amountCents: 4700, installmentCount: null }));
    const b = buildPayPalPlanSpec(input({ pricingType: 'subscription', amountCents: 4900, installmentCount: null }));
    const again = buildPayPalPlanSpec(input({ pricingType: 'subscription', amountCents: 4700, installmentCount: null }));
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).toBe(again.hash);
  });
});

describe('PayPal plan refusals', () => {
  it('refuses what PayPal cannot bill', () => {
    expect(() => buildPayPalPlanSpec(input({ amountCents: 100, currency: 'eur' }))).toThrow(PayPalPlanError);
    expect(() => buildPayPalPlanSpec(input({ amountCents: 100, interval: 'month', intervalCount: 13 }))).toThrow(PayPalPlanError);
    expect(() => buildPayPalPlanSpec(input({ amountCents: 100, interval: 'year', intervalCount: 2 }))).toThrow(PayPalPlanError);
    expect(() => buildPayPalPlanSpec(input({ amountCents: 100, pricingType: 'one_time' }))).toThrow(PayPalPlanError);
    expect(() => buildPayPalPlanSpec(input({ pricingType: 'subscription', amountCents: 4700, installmentCount: null }, { coupon: { percentOff: 100, duration: 'forever' } }))).toThrow(PayPalPlanError);
  });
});

describe('PayPal installments paid', () => {
  const spec = buildPayPalPlanSpec(input({ amountCents: 39700, installmentCount: 6 }));
  const sub = (completed: number): PayPalSubscription => ({
    id: 'I-1', status: 'ACTIVE', billing_info: { cycle_executions: [{ tenure_type: 'REGULAR', sequence: 1, cycles_completed: completed }] },
  });
  const sale = (id: string, time: string, value = '397.00') => ({ id, status: 'COMPLETED', time, amount_with_breakdown: { gross_amount: { currency_code: 'USD', value } } });

  it('follows PayPal cycle count, or the payments when the count lags', () => {
    const sales = [sale('S1', '2026-10-01T00:00:00Z'), sale('S2', '2026-11-01T00:00:00Z')];
    const openingEnds = new Date('2026-10-01T00:30:00Z').getTime();
    expect(paidInstallmentCount(sub(2), spec, sales, openingEnds)).toBe(2);
    expect(paidInstallmentCount(sub(1), spec, sales, openingEnds)).toBe(2);
  });

  it('does not count a setup fee taken as its own payment', () => {
    const withBump = buildPayPalPlanSpec(input({ amountCents: 39700, installmentCount: 6 }, { bumps: [5000] }));
    const sales = [sale('FEE', '2026-10-01T00:00:00Z', '50.00'), sale('S1', '2026-10-01T00:00:05Z')];
    expect(paidInstallmentCount(sub(1), withBump, sales, new Date('2026-10-01T00:30:00Z').getTime())).toBe(1);
  });

  it('maps PayPal states to the local subscription status', () => {
    expect(membershipStatus({ id: 'I', status: 'ACTIVE' }, spec, false)).toBe('active');
    expect(membershipStatus({ id: 'I', status: 'SUSPENDED' }, spec, false)).toBe('past_due');
    expect(membershipStatus({ id: 'I', status: 'SUSPENDED' }, spec, true)).toBe('active');
    expect(membershipStatus({ id: 'I', status: 'CANCELLED' }, spec, false)).toBe('canceled');
  });
});
