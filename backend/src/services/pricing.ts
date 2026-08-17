/**
 * Order arithmetic.
 *
 * Every function here is pure and works in integer cents. Nothing in this file
 * touches the database, Stripe, or the clock unless a time is passed in — which
 * is what makes it testable, and money code that cannot be tested is money code
 * that will eventually be wrong.
 *
 * Two rules hold throughout:
 *  - Cents are integers. A float anywhere in a price is a bug waiting for the
 *    third installment of $416.6666666 to round the wrong way.
 *  - Discounts never exceed what they discount, and totals never go negative.
 *    Stripe rejects a negative charge, so clamping here turns a data-entry
 *    mistake into a $0 order rather than a 500 at the till.
 */

export type PricingType = "one_time" | "subscription" | "payment_plan" | "free" | "pwyw";
export type BillingInterval = "day" | "week" | "month" | "year";

export interface PricedOffer {
  id: number;
  title: string;
  currency: string;
  pricingType: PricingType;
  amountCents: number;
  minAmountCents: number;
  interval: BillingInterval | null;
  intervalCount: number;
  installmentCount: number | null;
  trialDays: number;
}

export interface PricedBump {
  id: number;
  productId: number;
  title: string;
  amountCents: number;
}

export interface AppliedCoupon {
  id: number;
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  /** 'first' discounts only the first charge; 'forever' discounts every charge. */
  duration: "first" | "forever";
}

export interface OrderLine {
  kind: "offer" | "bump" | "upsell";
  offerId?: number;
  productId?: number;
  title: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface OrderTotal {
  lines: OrderLine[];
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
}

export interface ComputeTotalInput {
  offer: PricedOffer;
  /** Only the bumps the buyer actually ticked. */
  bumps?: PricedBump[];
  coupon?: AppliedCoupon | null;
  /** Tax rate in basis points: 8.875% is 887 (not 8.875, not 0.08875). */
  taxRateBps?: number;
  /** Pay-what-you-want amount. Ignored unless pricingType is 'pwyw'. */
  pwywAmountCents?: number;
}

/** Rejects NaN, Infinity, negatives and non-integers before they reach Stripe. */
function assertCents(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer number of cents, got ${value}`);
  }
  if (value < 0) {
    throw new RangeError(`${label} must not be negative, got ${value}`);
  }
  return value;
}

/**
 * The charge for one billing cycle of an offer, before bumps, discounts and tax.
 *
 * For a payment plan this is ONE installment, not the total — the customer is
 * charged $1,250 today, not $3,750, and every downstream figure follows the
 * charge rather than the contract value.
 */
export function baseAmountCents(offer: PricedOffer, pwywAmountCents?: number): number {
  switch (offer.pricingType) {
    case "free":
      return 0;
    case "pwyw": {
      const chosen = pwywAmountCents ?? offer.minAmountCents;
      assertCents(chosen, "pay-what-you-want amount");
      // The floor is a floor, not a suggestion.
      return Math.max(chosen, offer.minAmountCents);
    }
    case "one_time":
    case "subscription":
    case "payment_plan":
      return assertCents(offer.amountCents, "offer amount");
    default: {
      // Exhaustiveness: a new pricing_type added to the migration without a
      // branch here fails to compile rather than silently charging zero.
      const never: never = offer.pricingType;
      throw new RangeError(`Unsupported pricing type: ${String(never)}`);
    }
  }
}

/**
 * The discount a coupon takes off a given amount.
 *
 * Percentages round to the nearest cent, matching Stripe, and the result is
 * capped at the amount itself so a $50-off coupon on a $27 product discounts
 * $27 rather than handing back $23.
 */
export function couponDiscountCents(amountCents: number, coupon: AppliedCoupon | null | undefined): number {
  if (!coupon || amountCents <= 0) return 0;

  if (coupon.percentOff !== null && coupon.percentOff !== undefined) {
    if (coupon.percentOff <= 0) return 0;
    const pct = Math.min(coupon.percentOff, 100);
    return Math.min(amountCents, Math.round((amountCents * pct) / 100));
  }

  if (coupon.amountOffCents !== null && coupon.amountOffCents !== undefined) {
    if (coupon.amountOffCents <= 0) return 0;
    return Math.min(amountCents, coupon.amountOffCents);
  }

  return 0;
}

/**
 * Tax on a taxable base, in basis points.
 *
 * Applied AFTER the discount, which is what every US jurisdiction expects: tax
 * is owed on what was actually paid, not on the list price.
 */
export function taxCents(taxableCents: number, rateBps: number): number {
  if (taxableCents <= 0 || rateBps <= 0) return 0;
  return Math.round((taxableCents * rateBps) / 10_000);
}

/**
 * The full order breakdown for a checkout.
 *
 * Order of operations — the part that is easy to get wrong and expensive when
 * it is: subtotal (offer + bumps) -> discount -> tax on the discounted base ->
 * total. The coupon discounts the whole subtotal including bumps, matching what
 * a buyer reasonably expects from "20% off your order".
 */
export function computeOrderTotal(input: ComputeTotalInput): OrderTotal {
  const { offer, bumps = [], coupon = null, taxRateBps = 0, pwywAmountCents } = input;

  const offerAmount = baseAmountCents(offer, pwywAmountCents);

  const lines: OrderLine[] = [
    {
      kind: "offer",
      offerId: offer.id,
      title: offer.title,
      quantity: 1,
      unitCents: offerAmount,
      amountCents: offerAmount,
    },
  ];

  for (const bump of bumps) {
    assertCents(bump.amountCents, `bump "${bump.title}" amount`);
    lines.push({
      kind: "bump",
      productId: bump.productId,
      title: bump.title,
      quantity: 1,
      unitCents: bump.amountCents,
      amountCents: bump.amountCents,
    });
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const discountCents = couponDiscountCents(subtotalCents, coupon);
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const tax = taxCents(taxableCents, taxRateBps);

  return {
    lines,
    subtotalCents,
    discountCents,
    taxableCents,
    taxCents: tax,
    totalCents: taxableCents + tax,
    currency: offer.currency,
  };
}

/** The contract value of a payment plan — what the customer owes in total. */
export function paymentPlanTotalCents(offer: PricedOffer): number {
  if (offer.pricingType !== "payment_plan") return baseAmountCents(offer);
  const count = offer.installmentCount ?? 1;
  return assertCents(offer.amountCents, "offer amount") * count;
}

export interface ScheduledInstallment {
  sequence: number;
  amountCents: number;
  dueAt: Date;
}

/**
 * Advances a date by N billing intervals.
 *
 * `setMonth` overflow is the subtlety: adding one month to 31 January lands on
 * 3 March, not 28 February. Charging a customer on a date that does not exist
 * in the target month is a real support ticket, so the day is clamped to the
 * last day of the destination month instead.
 */
export function addInterval(from: Date, interval: BillingInterval, count: number): Date {
  const d = new Date(from.getTime());
  switch (interval) {
    case "day":
      d.setUTCDate(d.getUTCDate() + count);
      return d;
    case "week":
      d.setUTCDate(d.getUTCDate() + count * 7);
      return d;
    case "year":
      return addMonthsClamped(d, count * 12);
    case "month":
      return addMonthsClamped(d, count);
    default: {
      const never: never = interval;
      throw new RangeError(`Unsupported interval: ${String(never)}`);
    }
  }
}

function addMonthsClamped(from: Date, months: number): Date {
  const day = from.getUTCDate();
  const d = new Date(from.getTime());
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDayOfTarget = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTarget));
  return d;
}

/**
 * The charge schedule for a payment plan.
 *
 * The first installment is due immediately (it is the checkout charge). Any
 * rounding remainder lands on the FINAL installment rather than the first: a
 * customer who sees "$3,500 in 3 payments" should be quoted the round number up
 * front, and the odd cent is far less noticeable at the end.
 */
export function buildInstallmentSchedule(input: {
  totalCents: number;
  installmentCount: number;
  interval: BillingInterval;
  intervalCount?: number;
  startAt: Date;
}): ScheduledInstallment[] {
  const { totalCents, installmentCount, interval, intervalCount = 1, startAt } = input;

  assertCents(totalCents, "payment plan total");
  if (!Number.isInteger(installmentCount) || installmentCount < 1) {
    throw new RangeError(`installmentCount must be a positive integer, got ${installmentCount}`);
  }

  const per = Math.floor(totalCents / installmentCount);
  const remainder = totalCents - per * installmentCount;

  const schedule: ScheduledInstallment[] = [];
  for (let i = 0; i < installmentCount; i += 1) {
    schedule.push({
      sequence: i + 1,
      amountCents: i === installmentCount - 1 ? per + remainder : per,
      dueAt: i === 0 ? new Date(startAt.getTime()) : addInterval(startAt, interval, intervalCount * i),
    });
  }
  return schedule;
}

export interface ProrationResult {
  /** Unused value on the old price, credited back. */
  creditCents: number;
  /** Value of the new price for the remainder of the period. */
  chargeCents: number;
  /** chargeCents - creditCents. Negative means the customer is owed a credit. */
  netCents: number;
}

/**
 * Proration for a mid-period plan change.
 *
 * Time-based, to the second, matching Stripe's own model: the customer is
 * credited the unused fraction of what they paid and charged the same fraction
 * of the new price. Changing on the last day of a period is therefore nearly
 * free, and changing on day one costs nearly the full difference.
 */
export function prorate(input: {
  oldAmountCents: number;
  newAmountCents: number;
  periodStart: Date;
  periodEnd: Date;
  changeAt: Date;
}): ProrationResult {
  const { oldAmountCents, newAmountCents, periodStart, periodEnd, changeAt } = input;

  assertCents(oldAmountCents, "old amount");
  assertCents(newAmountCents, "new amount");

  const total = periodEnd.getTime() - periodStart.getTime();
  if (total <= 0) {
    throw new RangeError("Billing period must end after it starts");
  }

  // A change outside the period is not a proration. Clamping keeps the fraction
  // in [0,1] rather than producing a credit larger than the original charge.
  const clamped = Math.min(Math.max(changeAt.getTime(), periodStart.getTime()), periodEnd.getTime());
  const remainingFraction = (periodEnd.getTime() - clamped) / total;

  const creditCents = Math.round(oldAmountCents * remainingFraction);
  const chargeCents = Math.round(newAmountCents * remainingFraction);

  return { creditCents, chargeCents, netCents: chargeCents - creditCents };
}

/**
 * When access bought today should expire.
 *
 * `null` means never, which is the common case — a course bought outright does
 * not stop working.
 */
export function accessExpiresAt(grantedAt: Date, expiresAfterDays: number | null): Date | null {
  if (expiresAfterDays === null || expiresAfterDays === undefined) return null;
  if (!Number.isInteger(expiresAfterDays) || expiresAfterDays <= 0) {
    throw new RangeError(`accessExpiresAfterDays must be a positive integer, got ${expiresAfterDays}`);
  }
  return addInterval(grantedAt, "day", expiresAfterDays);
}

/** How a partner is paid on one sale. Mirrors `affiliate_commission_rules`. */
export interface CommissionRule {
  type: "percent" | "fixed" | "none";
  /** Basis points: 30% is 3000, not 30 and not 0.3. */
  rateBps: number;
  fixedCents: number;
}

/**
 * What a partner earns on one commission-bearing payment.
 *
 * Capped at the basis in both directions, which is the whole point of putting it
 * here rather than inline: a rate typed as 30000 instead of 3000, or a $50 flat
 * fee on a $27 tripwire, would otherwise pay out more than the sale collected.
 * Negative and non-integer bases are refused for the same reason `assertCents`
 * exists — a commission computed from a float is a rounding argument nobody can
 * settle a month later.
 *
 * Percentages round to the nearest cent, matching `couponDiscountCents` above,
 * so the two halves of an order's arithmetic round the same way.
 */
export function commissionCents(basisCents: number, rule: CommissionRule): number {
  assertCents(basisCents, "commission basis");
  if (basisCents === 0 || rule.type === "none") return 0;

  if (rule.type === "fixed") {
    if (rule.fixedCents <= 0) return 0;
    return Math.min(basisCents, Math.floor(rule.fixedCents));
  }

  if (rule.rateBps <= 0) return 0;
  const bps = Math.min(rule.rateBps, 10_000);
  return Math.min(basisCents, Math.round((basisCents * bps) / 10_000));
}

/** Formats cents for display. Presentation only — never feed this back into arithmetic. */
export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
