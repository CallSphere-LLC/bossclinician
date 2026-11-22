import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { conflict } from "../utils/httpError";

/**
 * Lounge founding pricing by paid enrolment count (Yvette, 22 Nov 2026, item 1).
 *
 * The rule, exactly as implemented:
 *
 *  - Lounge Member ("General"): the first 20 distinct paid members are founding
 *    members ($197/month or $1,997/year). From the 21st, new members pay the
 *    standard rate ($247/month or $2,497/year). No cap on members.
 *  - Lounge VIP: the first 6 distinct paid VIP members are founding members
 *    ($347/month or $3,497/year). VIP has 6 seats. Once 6 have ever paid, a new
 *    VIP member can join only while fewer than 6 paid VIP members currently have
 *    active VIP access; the price is then the standard $447/month or
 *    $4,497/year. With all 6 seats active, VIP shows a waitlist and the checkout
 *    refuses the sale on the server.
 *  - Each paid member counts once per tier (one `claimed` row per tier + email),
 *    on their first successful paid order. Renewals and later payments add
 *    nothing. A claim is never removed: a cancellation, an ended annual term or
 *    a refund does not give a founding place back. (An admin can set a row's
 *    status to 'void' if the owner decides otherwise.)
 *  - Founding members keep their rate while continuously enrolled on the same
 *    plan: monthly members by keeping their Stripe price; a signed-in founding
 *    member who still has active access is also offered the founding prices at
 *    checkout (an annual renewal before the term ends).
 *  - Paid means an order with a total above zero for a contact that is not
 *    internal. A 100%-off coupon, a manual grant or a comp claims nothing.
 *  - Migration 222 (her round-2 answers, item 3): an order that used the
 *    LOUNGE26 test code never claims; "same plan" is enforced (a founding
 *    monthly member buying annual, or the reverse, pays the current price);
 *    Emails 11-12 carry her General / VIP blocks (LOUNGE_BLOCKS), chosen per
 *    tier at send time; the VIP waitlist notice is services/loungeWaitlist.ts.
 *
 * Overselling: the price is fixed when the order is created, so the checkout
 * reserves the place (a 30-minute `held` row) under a per-tier advisory lock,
 * counting claimed rows plus live holds. The payment then turns the hold into
 * the permanent `claimed` row inside `fulfillPayment`, under the same lock and a
 * unique index. A payment that lands after its hold lapsed is still honoured
 * at the price paid and flagged `over_limit` for the owner.
 */

export type SeatTier = "general" | "vip";
export type PricePhase = "founding" | "standard";

type Queryable = Pick<PoolClient, "query">;

export interface TierRule {
  foundingLimit: number;
  /** Most members who may hold the tier at once; null for no cap. */
  capacity: number | null;
  offerSlugs: readonly string[];
}

export const TIER_RULES: Record<SeatTier, TierRule> = {
  general: { foundingLimit: 20, capacity: null, offerSlugs: ["the-lounge", "lounge-billing-preview"] },
  vip: { foundingLimit: 6, capacity: 6, offerSlugs: ["the-lounge-vip"] },
};

export const HOLD_MINUTES = 30;

export function tierForSlug(slug: string | null | undefined): SeatTier | null {
  if (!slug) return null;
  for (const tier of Object.keys(TIER_RULES) as SeatTier[]) {
    if (TIER_RULES[tier].offerSlugs.includes(slug)) return tier;
  }
  return null;
}

/* ── The decision, pure ───────────────────────────────────────────────── */

export interface SeatCounts {
  /** Founding claims ever made (never decreases). */
  foundingClaimed: number;
  /** Live holds that would take a founding place, other buyers only. */
  foundingHeld: number;
  /** Claimed members who have active access to the tier right now. */
  activeSeats: number;
  /** Live holds that would take a capacity seat, other buyers only. */
  capacityHeld: number;
}

export interface TierStatus {
  tier: SeatTier;
  phase: PricePhase;
  foundingLimit: number;
  foundingRemaining: number;
  capacity: number | null;
  /** Null when the tier has no cap. */
  seatsAvailable: number | null;
  waitlist: boolean;
  purchasable: boolean;
}

export function decideTierStatus(tier: SeatTier, counts: SeatCounts): TierStatus {
  const rule = TIER_RULES[tier];
  const foundingTaken = counts.foundingClaimed + counts.foundingHeld;
  const foundingRemaining = Math.max(0, rule.foundingLimit - foundingTaken);
  const seatsAvailable = rule.capacity === null
    ? null
    : Math.max(0, rule.capacity - counts.activeSeats - counts.capacityHeld);
  const phase: PricePhase = foundingRemaining > 0 ? "founding" : "standard";
  const full = seatsAvailable !== null && seatsAvailable === 0;
  return {
    tier,
    phase,
    foundingLimit: rule.foundingLimit,
    foundingRemaining,
    capacity: rule.capacity,
    seatsAvailable,
    waitlist: phase === "standard" && full,
    purchasable: !full,
  };
}

export interface BuyerStanding {
  /** A claimed row exists for this tier and email. */
  claimPhase: PricePhase | null;
  /** The buyer has active access to the tier right now. */
  active: boolean;
  /**
   * Migration 222: the plan of the order that claimed the place
   * ('subscription' monthly or 'one_time' annual). Null when unknown (a
   * backfilled or Kajabi claim), which is treated as any plan.
   */
  claimPlan?: string | null;
}

/** Her rule: the founding rate is kept "while continuously enrolled on the same plan". */
export function samePlan(claimPlan: string | null | undefined, planType: string | null | undefined): boolean {
  return !claimPlan || !planType || claimPlan === planType;
}

export interface BuyerDecision {
  phase: PricePhase;
  purchasable: boolean;
  waitlist: boolean;
  /** A founding member renewing or re-buying while still enrolled. */
  continuation: boolean;
  /** This purchase would take a founding place (so it needs a founding hold). */
  takesFoundingPlace: boolean;
  /** This purchase would take a capacity seat (so it needs a capacity hold). */
  takesCapacitySeat: boolean;
}

/**
 * What one buyer may buy, given the tier's status and their own record.
 * `allowContinuation` is false for a guest checkout: an active member is still
 * never waitlisted or counted twice, but only a signed-in member is shown, and
 * so charged, their founding price after founding closes.
 */
export function decideForBuyer(
  status: TierStatus,
  buyer: BuyerStanding,
  allowContinuation = true,
  /** The plan being bought; a founding member switching plan pays the current price. */
  planType: string | null = null
): BuyerDecision {
  // Already a member holding a seat: never waitlisted, never counted again.
  if (buyer.active && buyer.claimPhase !== null) {
    const continuation = allowContinuation && buyer.claimPhase === "founding" && samePlan(buyer.claimPlan, planType);
    return {
      phase: continuation ? "founding" : status.phase,
      purchasable: true,
      waitlist: false,
      continuation,
      takesFoundingPlace: false,
      takesCapacitySeat: false,
    };
  }
  const takesCapacitySeat = status.capacity !== null;
  if (!status.purchasable) {
    return { phase: status.phase, purchasable: false, waitlist: status.waitlist, continuation: false, takesFoundingPlace: false, takesCapacitySeat };
  }
  return {
    phase: status.phase,
    purchasable: true,
    waitlist: false,
    continuation: false,
    // Counted once: someone who already claimed (and later left) never takes a second place.
    takesFoundingPlace: status.phase === "founding" && buyer.claimPhase === null,
    takesCapacitySeat,
  };
}

/* ── Reading the counts ───────────────────────────────────────────────── */

const ACTIVE_ACCESS = `EXISTS (
  SELECT 1 FROM access_grants g
    JOIN members m ON m.id = g.member_id
    JOIN offers ao ON ao.id = g.offer_id
   WHERE ao.slug = ANY($2::text[])
     AND lower(m.email::text) = s.email
     AND g.status = 'active' AND g.revoked_at IS NULL
     AND (g.expires_at IS NULL OR g.expires_at > now()))`;

export async function readSeatCounts(db: Queryable, tier: SeatTier, excludeEmail = ""): Promise<SeatCounts> {
  const result = await db.query<{ founding_claimed: number; founding_held: number; active_seats: number; capacity_held: number }>(
    `SELECT
       (SELECT count(*)::int FROM lounge_seats s
         WHERE s.tier = $1 AND s.status = 'claimed' AND s.phase = 'founding') AS founding_claimed,
       (SELECT count(DISTINCT s.email)::int FROM lounge_seats s
         WHERE s.tier = $1 AND s.status = 'held' AND s.counts_founding AND s.hold_expires_at > now()
           AND s.email <> $3
           AND NOT EXISTS (SELECT 1 FROM lounge_seats c WHERE c.tier = s.tier AND c.email = s.email AND c.status = 'claimed')) AS founding_held,
       (SELECT count(*)::int FROM lounge_seats s
         WHERE s.tier = $1 AND s.status = 'claimed' AND ${ACTIVE_ACCESS}) AS active_seats,
       (SELECT count(DISTINCT s.email)::int FROM lounge_seats s
         WHERE s.tier = $1 AND s.status = 'held' AND s.counts_capacity AND s.hold_expires_at > now()
           AND s.email <> $3
           AND NOT EXISTS (SELECT 1 FROM lounge_seats c WHERE c.tier = s.tier AND c.email = s.email AND c.status = 'claimed'
                             AND EXISTS (SELECT 1 FROM access_grants g JOIN members m ON m.id = g.member_id JOIN offers ao ON ao.id = g.offer_id
                                          WHERE ao.slug = ANY($2::text[]) AND lower(m.email::text) = c.email
                                            AND g.status = 'active' AND g.revoked_at IS NULL
                                            AND (g.expires_at IS NULL OR g.expires_at > now())))) AS capacity_held`,
    [tier, [...TIER_RULES[tier].offerSlugs], excludeEmail.trim().toLowerCase()]
  );
  const row = result.rows[0];
  return {
    foundingClaimed: Number(row?.founding_claimed ?? 0),
    foundingHeld: Number(row?.founding_held ?? 0),
    activeSeats: Number(row?.active_seats ?? 0),
    capacityHeld: Number(row?.capacity_held ?? 0),
  };
}

export async function readBuyerStanding(db: Queryable, tier: SeatTier, email: string): Promise<BuyerStanding> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { claimPhase: null, active: false };
  const result = await db.query<{ phase: PricePhase; active: boolean; plan: string | null }>(
    `SELECT s.phase, ${ACTIVE_ACCESS} AS active,
            (SELECT po.pricing_type FROM orders co JOIN offer_pricing_options po ON po.id = co.pricing_option_id
              WHERE co.id = s.order_id) AS plan
       FROM lounge_seats s
      WHERE s.tier = $1 AND s.status = 'claimed' AND s.email = $3
      LIMIT 1`,
    [tier, [...TIER_RULES[tier].offerSlugs], normalized]
  );
  const row = result.rows[0];
  return row
    ? { claimPhase: row.phase, active: row.active === true, claimPlan: row.plan ?? null }
    : { claimPhase: null, active: false };
}

export async function tierStatus(tier: SeatTier, db: Queryable = pool, excludeEmail = ""): Promise<TierStatus> {
  return decideTierStatus(tier, await readSeatCounts(db, tier, excludeEmail));
}

/** GET /api/lounge/pricing and the /lounge server render. */
export async function loungePricingStatus(db: Queryable = pool): Promise<Record<SeatTier, TierStatus>> {
  const [general, vip] = await Promise.all([tierStatus("general", db), tierStatus("vip", db)]);
  return { general, vip };
}

export interface SeatViewer {
  memberId?: number | null;
  email?: string | null;
}

async function viewerEmail(db: Queryable, viewer: SeatViewer | undefined): Promise<string> {
  if (viewer?.email) return viewer.email.trim().toLowerCase();
  if (!viewer?.memberId) return "";
  const row = await db.query<{ email: string }>(`SELECT email::text AS email FROM members WHERE id = $1`, [viewer.memberId]);
  return (row.rows[0]?.email ?? "").trim().toLowerCase();
}

export interface SeatPricingView extends TierStatus {
  /** What this viewer is offered (founding for a continuing founding member). */
  viewerPhase: PricePhase;
  continuation: boolean;
}

/** The status the checkout page shows a given viewer. Only a signed-in member is a known viewer. */
export async function seatPricingFor(tier: SeatTier, viewer: SeatViewer | undefined, db: Queryable = pool): Promise<SeatPricingView> {
  const email = await viewerEmail(db, viewer);
  const status = await tierStatus(tier, db, email);
  const buyer = email ? await readBuyerStanding(db, tier, email) : { claimPhase: null, active: false };
  const decision = decideForBuyer(status, buyer);
  return {
    ...status,
    phase: status.phase,
    viewerPhase: decision.phase,
    continuation: decision.continuation,
    purchasable: decision.purchasable,
    waitlist: decision.waitlist,
  };
}

/**
 * Keeps only the options of the phase this viewer may buy. Options with no
 * phase (every other offer) pass straight through, with no query at all.
 */
export async function filterPhasedOptions<T extends { price_phase?: PricePhase | null; pricing_type?: string | null }>(
  rows: T[],
  offerSlug: string | null | undefined,
  viewer: SeatViewer | undefined,
  db: Queryable = pool
): Promise<T[]> {
  if (!rows.some((row) => row.price_phase)) return rows;
  const tier = tierForSlug(offerSlug);
  // A phased option on an offer this module does not know: show founding only,
  // never both prices side by side.
  if (!tier) return rows.filter((row) => !row.price_phase || row.price_phase === "founding");
  const email = await viewerEmail(db, viewer);
  const status = await tierStatus(tier, db, email);
  const buyer = email ? await readBuyerStanding(db, tier, email) : { claimPhase: null, active: false };
  // Per plan (migration 222): a continuing founding member sees the founding
  // price on the plan they hold and the current price on the other one.
  return rows.filter(
    (row) => !row.price_phase || row.price_phase === decideForBuyer(status, buyer, true, row.pricing_type ?? null).phase
  );
}

/* ── Checkout: reserve the place before any charge exists ─────────────── */

const lockKey = (tier: SeatTier) => `lounge-seats:${tier}`;

export const FOUNDING_JUST_FILLED =
  "Founding pricing for this membership has just filled, so the price has changed. Refresh this page to see the current price.";
export const VIP_WAITLIST_MESSAGE =
  "All six VIP seats are filled. Please join the VIP waitlist on this page, and we will let you know when a seat becomes available.";

/**
 * Called after the pending order is written and before any Stripe or PayPal
 * object exists. Throws a 409 when the place the buyer was quoted is gone; the
 * caller marks the order failed. A no-op for every offer that is not the Lounge.
 */
export async function reserveLoungeSeat(input: {
  orderId: number;
  offerSlug: string;
  pricePhase: PricePhase | null | undefined;
  email: string;
  /** Only a signed-in member may be priced as a continuing founding member. */
  signedIn: boolean;
  /** The chosen option's pricing_type: the founding rate continues on the same plan only. */
  pricingType?: string | null;
}): Promise<void> {
  const tier = tierForSlug(input.offerSlug);
  if (!tier) return;
  const email = input.email.trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey(tier)]);
    const status = decideTierStatus(tier, await readSeatCounts(client, tier, email));
    const standing = await readBuyerStanding(client, tier, email);
    // The page priced a guest at the public phase, so a guest is charged it;
    // an active member is still never waitlisted or counted twice.
    const decision = decideForBuyer(status, standing, input.signedIn, input.pricingType ?? null);
    if (!decision.purchasable) throw conflict(VIP_WAITLIST_MESSAGE, { waitlist: true });
    if ((input.pricePhase ?? "founding") !== decision.phase) throw conflict(FOUNDING_JUST_FILLED, { phase: decision.phase });
    if (decision.takesFoundingPlace || decision.takesCapacitySeat) {
      await client.query(
        `INSERT INTO lounge_seats (tier, email, order_id, phase, status, counts_founding, counts_capacity, hold_expires_at, source)
         VALUES ($1, $2, $3, $4, 'held', $5, $6, now() + make_interval(mins => $7), 'checkout')`,
        [tier, email, input.orderId, decision.phase, decision.takesFoundingPlace, decision.takesCapacitySeat, HOLD_MINUTES]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/* ── Payment: the permanent claim, inside fulfillPayment's transaction ── */

export interface ClaimResult {
  claimed: boolean;
  overLimit: boolean;
  reason: string;
}

/**
 * Records the paid member once per tier. Runs inside the fulfilment
 * transaction under its own savepoint and never throws: a seat-count problem
 * must never roll back a customer's paid access. Idempotent (unique index).
 */
export async function claimLoungeSeatSafely(client: Queryable, orderId: number): Promise<ClaimResult> {
  const none = (reason: string): ClaimResult => ({ claimed: false, overLimit: false, reason });
  try {
    await client.query("SAVEPOINT lounge_seat_claim");
    const result = await claimLoungeSeat(client, orderId);
    await client.query("RELEASE SAVEPOINT lounge_seat_claim");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT lounge_seat_claim").catch(() => undefined);
    console.error("[lounge-seats] could not record the paid seat", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return none("error");
  }
}

/**
 * Test transactions never take a place (her rule; migration 222). Test
 * accounts are contacts marked internal (contacts.is_internal), refused before
 * this. LOUNGE26 was the owner's test code (order 201, 8 Nov 2026), switched
 * off by migration 222; an order that used it is never counted.
 */
export const TEST_COUPON_CODES: readonly string[] = ["LOUNGE26"];

export function testOrderReason(order: { couponCode?: string | null }): string {
  const code = (order.couponCode ?? "").trim().toUpperCase();
  return code && TEST_COUPON_CODES.includes(code) ? "test coupon" : "";
}

export async function claimLoungeSeat(client: Queryable, orderId: number): Promise<ClaimResult> {
  const found = await client.query<{
    slug: string; email: string; total_cents: number; contact_id: number | null; member_id: number | null;
    is_internal: boolean | null; price_phase: PricePhase | null; coupon_code?: string | null;
  }>(
    `SELECT o.slug, lower(ord.email) AS email, ord.total_cents, ord.contact_id, ord.member_id,
            c.is_internal, po.price_phase, ord.coupon_code
       FROM orders ord
       JOIN offers o ON o.id = ord.offer_id
       LEFT JOIN contacts c ON c.id = ord.contact_id
       LEFT JOIN offer_pricing_options po ON po.id = ord.pricing_option_id AND po.offer_id = o.id
      WHERE ord.id = $1`,
    [orderId]
  );
  const order = found.rows[0];
  const tier = tierForSlug(order?.slug);
  if (!order || !tier) return { claimed: false, overLimit: false, reason: "not a lounge order" };
  if (!(Number(order.total_cents) > 0)) return { claimed: false, overLimit: false, reason: "not a paid order" };
  if (order.is_internal) return { claimed: false, overLimit: false, reason: "internal contact" };
  if (!order.email) return { claimed: false, overLimit: false, reason: "no email" };
  const testReason = testOrderReason({ couponCode: order.coupon_code });
  if (testReason) return { claimed: false, overLimit: false, reason: testReason };

  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey(tier)]);
  // Legacy prices carry no phase; every price sold before 22 Nov was a founding one.
  const phase: PricePhase = order.price_phase ?? "founding";
  const claimedFounding = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM lounge_seats WHERE tier = $1 AND status = 'claimed' AND phase = 'founding'`,
    [tier]
  );
  const overLimit = phase === "founding" && Number(claimedFounding.rows[0]?.n ?? 0) >= TIER_RULES[tier].foundingLimit;
  const inserted = await client.query(
    `INSERT INTO lounge_seats (tier, email, contact_id, member_id, order_id, phase, status, over_limit, claimed_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'claimed', $7, now(), 'payment')
     ON CONFLICT (tier, email) WHERE status = 'claimed' DO NOTHING
     RETURNING id`,
    [tier, order.email, order.contact_id, order.member_id, orderId, phase, overLimit]
  );
  // The hold has done its job either way.
  await client.query(
    `UPDATE lounge_seats SET status = 'released', updated_at = now() WHERE order_id = $1 AND status = 'held'`,
    [orderId]
  );
  if (!inserted.rows[0]) return { claimed: false, overLimit: false, reason: "already counted" };
  if (overLimit) console.warn("[lounge-seats] founding price paid after the founding places filled", { orderId, tier });
  return { claimed: true, overLimit, reason: "" };
}

/* ── Email: the masterclass sequence's founding wording ───────────────── */

/** Skip-rule check: is this tier's founding pricing over? */
export async function foundingFull(db: Queryable, tier: SeatTier): Promise<boolean> {
  return (await tierStatus(tier, db)).phase === "standard";
}

/**
 * `{{lounge.memberRate}}` for masterclass email 11: the Lounge Member price
 * paragraph, true on the day it is sent.
 */
export function memberRateSentence(phase: PricePhase): string {
  return phase === "founding"
    ? "The founding Lounge Member rate is $197 per month, with a six-month minimum commitment totaling $1,182, or $1,997 for 12 months paid upfront. After the six months, monthly membership continues month-to-month unless canceled. The first 20 paid Lounge Members join at the founding rate; starting with the 21st paid member, the rate for new members increases to $247 per month or $2,497 per year."
    : "The Lounge Member rate is $247 per month, with a six-month minimum commitment totaling $1,482, or $2,497 for 12 months paid upfront. After the six months, monthly membership continues month-to-month unless canceled.";
}

/**
 * Masterclass Emails 11-12 (Yvette's revised doc, "TEAM IMPLEMENTATION NOTES",
 * 22 Nov 2026): one General block and one VIP block, each chosen on its own
 * from the live seat state at send time. Her exact texts, without the doc's
 * enclosing quotes. The same texts are the Lounge page and checkout lines
 * (frontend/src/content/loungePricing.ts); keep the two copies identical.
 */
export const LOUNGE_BLOCKS = {
  generalFounding:
    "General: The first 20 paid General members can join for $197/month or $1,997/year. The monthly option has a six-month minimum totaling $1,182, then continues month-to-month. Starting with the 21st paid General member, pricing becomes $247/month or $2,497/year.",
  generalStandard:
    "General: Join for $247/month or $2,497/year. The monthly option has a six-month minimum totaling $1,482, then continues month-to-month.",
  vipFounding:
    "VIP: The first six paid VIP members can join for $347/month or $3,497/year. The monthly option has a six-month minimum totaling $2,082, then continues month-to-month. Once all six seats are filled, a waitlist opens. Future available seats are $447/month or $4,497/year.",
  vipFull:
    "VIP is currently full. Join the VIP waitlist through The Lounge page to hear when a seat becomes available. Future seats are $447/month or $4,497/year. Seats are first come, first served; joining the waitlist does not reserve a place.",
  vipSeatAvailable:
    "A VIP seat is available at $447/month or $4,497/year. The monthly option has a six-month minimum totaling $2,682, then continues month-to-month. Available seats are first come, first served.",
} as const;

export type LoungeBlockKey = keyof typeof LOUNGE_BLOCKS;

/** General: founding while any of the 20 places is left (counting live checkout holds, as the checkout does). */
export function generalBlockKey(status: TierStatus): LoungeBlockKey {
  return status.phase === "founding" ? "generalFounding" : "generalStandard";
}

/**
 * VIP: founding while any of the six founding places is left; after that,
 * "full" while every seat is taken (a live 30-minute checkout hold counts,
 * exactly as the checkout counts it) and "seat available" otherwise.
 */
export function vipBlockKey(status: TierStatus): LoungeBlockKey {
  if (status.phase === "founding") return "vipFounding";
  return status.purchasable ? "vipSeatAvailable" : "vipFull";
}

export const LOUNGE_BLOCK_TOKENS = ["lounge_general_pricing_block", "lounge_vip_availability_block"] as const;

export function loungeBlockValues(general: TierStatus, vip: TierStatus): Record<(typeof LOUNGE_BLOCK_TOKENS)[number], string> {
  return {
    lounge_general_pricing_block: LOUNGE_BLOCKS[generalBlockKey(general)],
    lounge_vip_availability_block: LOUNGE_BLOCKS[vipBlockKey(vip)],
  };
}

/**
 * Every Lounge token, read from the live seat state. Throws if the state
 * cannot be read: the caller then has no value, and the send guard
 * (services/emailSendGuard.ts) holds the email rather than send a guessed price.
 */
export async function loungeMergeValues(db: Queryable): Promise<Record<string, string>> {
  const general = await tierStatus("general", db);
  const vip = await tierStatus("vip", db);
  return { "lounge.memberRate": memberRateSentence(general.phase), ...loungeBlockValues(general, vip) };
}

/** For the sequence send: under a savepoint, so a failed read neither sends nor aborts the run's transaction. */
export async function loungeMergeValuesSafe(client: Queryable): Promise<Record<string, string>> {
  try {
    await client.query("SAVEPOINT lounge_merge");
    const values = await loungeMergeValues(client);
    await client.query("RELEASE SAVEPOINT lounge_merge");
    return values;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT lounge_merge").catch(() => undefined);
    console.error("[lounge-seats] could not read the seat state for an email", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}
