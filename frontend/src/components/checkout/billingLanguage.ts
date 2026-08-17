import { formatCurrency, formatDate } from "@/lib/format";
import type { AppliedCoupon, BillingInterval, OfferBilling } from "@/lib/commerceApi";

/**
 * Turning a pricing row into a sentence a customer cannot misread.
 *
 * This file exists because of one specific chargeback: a buyer who reads
 * "$1,250" on a three-payment plan, agrees to it, and then watches $3,750 leave
 * their account over three months. Every recurring or instalment offer therefore
 * states the number of charges, the amount of each, when the first one happens
 * and what the whole thing comes to — in words, next to the button.
 *
 * No arithmetic on money happens here beyond reading figures the server already
 * calculated. The only thing counted locally is how many charges come after the
 * first, which is a count, not a price.
 */

const INTERVAL_NOUN: Record<BillingInterval, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

const CADENCE_ADVERB: Record<BillingInterval, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  year: "yearly",
};

/** "a month" / "every 3 months" — reads naturally straight after a price. */
export function describeInterval(interval: BillingInterval, count: number): string {
  const noun = INTERVAL_NOUN[interval];
  return count <= 1 ? `a ${noun}` : `every ${count} ${noun}s`;
}

/** "monthly" / "every 3 months" — reads naturally after "then". */
export function describeCadence(interval: BillingInterval, count: number): string {
  return count <= 1 ? CADENCE_ADVERB[interval] : `every ${count} ${INTERVAL_NOUN[interval]}s`;
}

export interface BillingWording {
  /** Short label for the pill beside the offer title. */
  badge: string;
  /** Label on the total row: what today's figure actually is. */
  totalLabel: string;
  /** True when a trial means the total row should read as nothing charged now. */
  nothingDueToday: boolean;
  /** The commitment in one sentence. Empty when there is only one charge. */
  commitment: string;
  /** Supporting reassurance. Empty when there is nothing more to say. */
  detail: string;
}

export function describeBilling(input: {
  billing: OfferBilling;
  /** The offer's own per-charge price, as configured — never a computed total. */
  amountCents: number;
  currency: string;
  coupon: AppliedCoupon | null;
  /** Whether a one-off add-on is riding along with the first charge. */
  hasBumps?: boolean;
}): BillingWording {
  const { billing, amountCents, currency, coupon, hasBumps = false } = input;
  const each = formatCurrency(amountCents, currency);
  // A 'forever' coupon discounts every charge, so the sentence about future
  // charges has to change rather than quote an amount that will not be taken.
  const foreverCode = coupon?.duration === "forever" ? coupon.code : null;

  switch (billing.pricingType) {
    case "free":
      return {
        badge: "Free",
        totalLabel: "Total",
        nothingDueToday: false,
        commitment: "",
        detail: "No payment needed — access is granted as soon as you finish.",
      };

    case "pwyw":
      return {
        badge: "Pay what you want",
        totalLabel: "Total",
        nothingDueToday: false,
        commitment: "",
        detail:
          billing.minAmountCents && billing.minAmountCents > 0
            ? `The minimum is ${formatCurrency(billing.minAmountCents, currency)}. One payment, nothing renews.`
            : "One payment, nothing renews.",
      };

    case "subscription": {
      if (!billing.interval) break;
      const price = `${each} ${describeInterval(billing.interval, billing.intervalCount)}`;

      if (billing.trialDays > 0) {
        const firstCharge = new Date(Date.now() + billing.trialDays * 86_400_000).toISOString();
        return {
          badge: "Free trial",
          totalLabel: "Due today",
          nothingDueToday: true,
          commitment: `Free for ${billing.trialDays} days, then ${price}.`,
          detail:
            `Nothing is charged today. Your first payment is on ${formatDate(firstCharge)}, ` +
            `and you can cancel before then at no cost.` +
            (hasBumps ? " Your add-ons are charged with that first payment." : ""),
        };
      }

      return {
        badge: "Membership",
        totalLabel: "Due today",
        nothingDueToday: false,
        commitment: `${price}, starting today.`,
        detail: `It renews ${describeCadence(billing.interval, billing.intervalCount)} until you cancel, and you can cancel any time from your account.`,
      };
    }

    case "payment_plan": {
      const count = billing.installmentCount;
      if (!billing.interval || !count || count < 2) break;
      const installment = formatCurrency(billing.installmentCents ?? amountCents, currency);
      const remaining = count - 1;
      const planTotal =
        billing.planTotalCents === null ? null : formatCurrency(billing.planTotalCents, currency);

      const detailParts: string[] = [];
      if (planTotal) {
        detailParts.push(
          foreverCode
            ? `That is ${planTotal} before your ${foreverCode} discount, which comes off every payment.`
            : `That is ${planTotal} in total.`
        );
      } else if (foreverCode) {
        detailParts.push(`Your ${foreverCode} discount comes off every payment.`);
      }
      if (hasBumps) detailParts.push("Your add-ons are charged once, with today's payment.");

      return {
        badge: "Payment plan",
        totalLabel: "Due today",
        nothingDueToday: false,
        commitment: `${count} payments of ${installment} — first today, then ${describeCadence(
          billing.interval,
          billing.intervalCount
        )} for ${remaining} more.`,
        detail: detailParts.join(" "),
      };
    }

    case "one_time":
      break;
  }

  return {
    badge: "One payment",
    totalLabel: "Total",
    nothingDueToday: false,
    commitment: "",
    detail: "One payment. Nothing renews and there is no subscription.",
  };
}
