import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import type { AppliedCoupon } from "./pricing";

/**
 * Coupon eligibility — "may this code be used, here, by this person, right now".
 *
 * Deliberately separate from `services/pricing.ts`: pricing answers what a
 * discount is worth, this answers whether it exists at all. Keeping the two
 * apart means the arithmetic stays pure and testable while the eligibility
 * rules, which are all database state and wall-clock time, live in one place.
 *
 * The answer is a value, not an exception. A shopper mistyping a code is the
 * common case rather than an error condition, and the checkout page needs the
 * reason to put next to the field.
 */

type Queryable = Pick<PoolClient, "query"> | typeof pool;

export interface ValidatedCoupon extends AppliedCoupon {
  currency: string;
  scope: "global" | "offers";
  /** Set when the coupon has been mirrored into Stripe, which recurring charges need. */
  stripeCouponId: string | null;
}

export type CouponResult =
  | { ok: true; coupon: ValidatedCoupon }
  | { ok: false; reason: string };

/** Buyer-facing eligibility results. The quote route is rate-limited, so useful
 * feedback wins over making a legitimate customer guess why their code did not
 * change the total. None of these messages reveals the value of a discount. */
const COUPON_ERROR = {
  unknown: "We couldn't find that discount code.",
  inactive: "That discount code is no longer active.",
  notStarted: "That discount code isn't active yet.",
  expired: "That discount code has expired.",
  offer: "That discount code isn't valid for this offer.",
  limit: "That discount code has reached its usage limit.",
  currency: "That discount code can't be used with this currency.",
} as const;

/** Codes are stored and compared uppercase, so `save20` and `SAVE20` are one code. */
export function normaliseCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

interface CouponRow {
  id: number;
  code: string;
  percent_off: number | null;
  amount_off_cents: number | null;
  currency: string;
  duration: string;
  scope: string;
  active: boolean;
  starts_at: Date | null;
  expires_at: Date | null;
  max_redemptions: number | null;
  redeemed: number;
  max_per_contact: number | null;
  stripe_coupon_id: string | null;
}

const COUPON_COLUMNS = `id, code, percent_off, amount_off_cents, currency, duration,
                        scope, active, starts_at, expires_at, max_redemptions,
                        redeemed, max_per_contact, stripe_coupon_id`;

const SELECT_COUPON = `SELECT ${COUPON_COLUMNS} FROM coupons WHERE code = $1`;
const SELECT_COUPON_LOCKED = `${SELECT_COUPON} FOR UPDATE`;

export interface ValidateCouponOptions {
  /** Runs inside a caller's transaction — charge-time revalidation needs this. */
  client?: Queryable;
  /**
   * Takes a row lock on the coupon. Two shoppers redeeming the last of a
   * limited code at the same moment would otherwise both read `redeemed` below
   * `max_redemptions` and both be let through.
   */
  lock?: boolean;
}

/**
 * Whether `code` may be applied to `offerId` by `email`.
 *
 * The result is a snapshot, not a reservation: a code with one redemption left
 * can be taken by somebody else between a quote and the charge, which is why
 * every caller that actually moves money revalidates with `lock: true` inside
 * the transaction that creates the order.
 */
export async function validateCoupon(
  code: string,
  offerId: number,
  email?: string | null,
  options: ValidateCouponOptions = {}
): Promise<CouponResult> {
  const normalised = normaliseCouponCode(code);
  if (!normalised) return { ok: false, reason: COUPON_ERROR.unknown };

  const db = options.client ?? pool;
  const res = await db.query<CouponRow>(
    options.lock ? SELECT_COUPON_LOCKED : SELECT_COUPON,
    [normalised]
  );

  const row = res.rows[0];
  if (!row) return { ok: false, reason: COUPON_ERROR.unknown };
  if (!row.active) return { ok: false, reason: COUPON_ERROR.inactive };

  const percentOff = row.percent_off !== null && row.percent_off > 0 ? row.percent_off : null;
  const amountOffCents =
    row.amount_off_cents !== null && row.amount_off_cents > 0 ? row.amount_off_cents : null;
  if (percentOff === null && amountOffCents === null) {
    return { ok: false, reason: COUPON_ERROR.unknown };
  }

  const now = Date.now();
  if (row.starts_at && row.starts_at.getTime() > now) return { ok: false, reason: COUPON_ERROR.notStarted };
  if (row.expires_at && row.expires_at.getTime() <= now) return { ok: false, reason: COUPON_ERROR.expired };

  if (row.scope === "offers") {
    const scoped = await db.query(
      `SELECT 1 FROM coupon_offers WHERE coupon_id = $1 AND offer_id = $2`,
      [row.id, offerId]
    );
    if (scoped.rows.length === 0) return { ok: false, reason: COUPON_ERROR.offer };
  }

  // Counted from the ledger, not from `coupons.redeemed`. The denormalised
  // counter is maintained for the admin list, but a cap enforced against a
  // cached number is a cap that silently stops existing the moment anything
  // fails to increment it.
  if (row.max_redemptions !== null) {
    const taken = await db.query<{ used: number }>(
      `SELECT count(*)::int AS used
         FROM coupon_redemptions
        WHERE coupon_id = $1 AND released_at IS NULL`,
      [row.id]
    );
    if ((taken.rows[0]?.used ?? 0) >= row.max_redemptions) {
      return { ok: false, reason: COUPON_ERROR.limit };
    }
  }

  // A fixed-amount coupon carries its own currency, and the arithmetic that
  // spends it only knows how to subtract cents from cents. A `5000 usd` code on
  // a EUR offer therefore takes €50 off — right sum, wrong money, and wrong by
  // whatever the exchange rate happens to be that day. Percentages have no
  // currency and are safe on any offer, which is why only this branch checks.
  if (amountOffCents !== null) {
    const offerRow = await db.query<{ currency: string }>(
      `SELECT currency FROM offers WHERE id = $1`,
      [offerId]
    );
    const offerCurrency = (offerRow.rows[0]?.currency || "usd").toLowerCase();
    const couponCurrency = (row.currency || "usd").toLowerCase();
    if (couponCurrency !== offerCurrency) {
      console.error(
        `[coupons] ${row.code} discounts ${couponCurrency.toUpperCase()} and offer ${offerId} is ` +
          `priced in ${offerCurrency.toUpperCase()}; the code was refused.`
      );
      return { ok: false, reason: COUPON_ERROR.currency };
    }
  }

  if (row.max_per_contact !== null && email) {
    // Also the ledger rather than paid orders. An order sits `pending` for the
    // seconds between the charge and Stripe's webhook, so counting settled
    // orders let two checkouts opened together both see zero uses and both go
    // through. A redemption row exists before the customer reaches Stripe.
    const used = await db.query<{ used: number }>(
      `SELECT count(*)::int AS used
         FROM coupon_redemptions
        WHERE coupon_id = $1 AND email = $2 AND released_at IS NULL`,
      [row.id, email]
    );
    if ((used.rows[0]?.used ?? 0) >= row.max_per_contact) {
      return { ok: false, reason: "You've already used that code." };
    }
  }

  return {
    ok: true,
    coupon: {
      id: row.id,
      code: row.code,
      percentOff,
      amountOffCents,
      duration: row.duration === "forever" ? "forever" : "first",
      currency: row.currency || "usd",
      scope: row.scope === "offers" ? "offers" : "global",
      stripeCouponId: row.stripe_coupon_id,
    },
  };
}

/**
 * Claims one redemption of a coupon for an order.
 *
 * MUST be called inside the same transaction that creates the order, while the
 * coupon row is held under `FOR UPDATE` — that lock plus this insert is what
 * makes the cap real. Validation alone cannot enforce it: two checkouts reading
 * the count a millisecond apart both pass, and only a row written before either
 * reaches Stripe serialises them.
 */
export async function claimRedemption(
  client: Queryable,
  input: {
    couponId: number;
    orderId: number;
    memberId?: number | null;
    email: string;
    amountCents: number;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO coupon_redemptions (coupon_id, order_id, member_id, email, amount_cents)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING`,
    [input.couponId, input.orderId, input.memberId ?? null, input.email, input.amountCents]
  );

  await client.query(
    `UPDATE coupons SET redeemed = (
       SELECT count(*) FROM coupon_redemptions
        WHERE coupon_id = $1 AND released_at IS NULL
     ) WHERE id = $1`,
    [input.couponId]
  );
}

/**
 * Gives a redemption back when the order it belonged to never completed.
 *
 * Without this, an abandoned checkout permanently consumes one of fifty launch
 * codes — the customer who closed the tab has quietly taken a seat from someone
 * who would have paid.
 */
export async function releaseRedemption(
  client: Queryable,
  orderId: number
): Promise<void> {
  const released = await client.query<{ coupon_id: number }>(
    `UPDATE coupon_redemptions
        SET released_at = now()
      WHERE order_id = $1 AND released_at IS NULL
      RETURNING coupon_id`,
    [orderId]
  );

  const couponId = released.rows[0]?.coupon_id;
  if (!couponId) return;

  await client.query(
    `UPDATE coupons SET redeemed = (
       SELECT count(*) FROM coupon_redemptions
        WHERE coupon_id = $1 AND released_at IS NULL
     ) WHERE id = $1`,
    [couponId]
  );
}
