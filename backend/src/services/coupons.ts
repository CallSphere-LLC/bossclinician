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

/**
 * One message for "no such code", "switched off" and "misconfigured".
 *
 * Distinguishing them would turn the coupon field into an oracle that confirms
 * which codes exist, which is exactly how a private launch discount escapes.
 */
const UNKNOWN_CODE = "That code isn't valid.";

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
  if (!normalised) return { ok: false, reason: UNKNOWN_CODE };

  const db = options.client ?? pool;
  const res = await db.query<CouponRow>(
    options.lock ? SELECT_COUPON_LOCKED : SELECT_COUPON,
    [normalised]
  );

  const row = res.rows[0];
  if (!row || !row.active) return { ok: false, reason: UNKNOWN_CODE };

  const percentOff = row.percent_off !== null && row.percent_off > 0 ? row.percent_off : null;
  const amountOffCents =
    row.amount_off_cents !== null && row.amount_off_cents > 0 ? row.amount_off_cents : null;
  if (percentOff === null && amountOffCents === null) {
    return { ok: false, reason: UNKNOWN_CODE };
  }

  const now = Date.now();
  if (row.starts_at && row.starts_at.getTime() > now) {
    return { ok: false, reason: "That code isn't active yet." };
  }
  if (row.expires_at && row.expires_at.getTime() <= now) {
    return { ok: false, reason: "That code has expired." };
  }

  if (row.max_redemptions !== null && row.redeemed >= row.max_redemptions) {
    return { ok: false, reason: "That code has been fully redeemed." };
  }

  if (row.scope === "offers") {
    const scoped = await db.query(
      `SELECT 1 FROM coupon_offers WHERE coupon_id = $1 AND offer_id = $2`,
      [row.id, offerId]
    );
    if (scoped.rows.length === 0) {
      return { ok: false, reason: "That code doesn't apply to this offer." };
    }
  }

  if (row.max_per_contact !== null && email) {
    // An order carrying the code IS the redemption record: it is written in the
    // same transaction as the charge and survives a refund, so a buy-refund-buy
    // loop cannot mine a one-per-customer code.
    const used = await db.query<{ used: number }>(
      `SELECT count(*)::int AS used
         FROM orders
        WHERE coupon_id = $1
          AND lower(email) = lower($2)
          AND status IN ('paid', 'refunded')`,
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
