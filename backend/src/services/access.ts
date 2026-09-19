import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { accessExpiresAt } from "./pricing";
import { dispatchEvent } from "./webhooksOut";

/**
 * Access grants — the only answer to "may this member open this product".
 *
 * Every delivery route in Phase 3 consults this module and nothing else. It
 * deliberately does NOT look at orders or subscriptions: entitlement has too
 * many sources (a purchase, a bundle, an automation, a manual grant from the
 * admin, a refund clawback) for each reader to re-derive it correctly. One
 * table, one writer, one reader.
 */

export type GrantSource = "purchase" | "plan" | "manual" | "automation" | "bundle" | "affiliate" | "import";

type Queryable = Pick<PoolClient, "query"> | typeof pool;

export interface GrantAccessInput {
  memberId: number;
  productId: number;
  offerId?: number | null;
  orderId?: number | null;
  subscriptionId?: number | null;
  source?: GrantSource;
  /** Days from now until access lapses. null/undefined = never. */
  expiresAfterDays?: number | null;
  /** Defaults to now. Passed explicitly when backfilling so drip dates line up. */
  grantedAt?: Date;
  /** Runs inside a caller's transaction when given — webhooks need this. */
  client?: Queryable;
}

export interface AccessGrant {
  id: number;
  memberId: number;
  productId: number;
  status: "active" | "revoked" | "expired";
  grantedAt: string;
  expiresAt: string | null;
  updatedAt: string;
  /** True only when this call created access or reactivated a revoked/expired grant. */
  transitionedToActive: boolean;
}

/**
 * Grants access, or refreshes an existing grant.
 *
 * Re-granting is the interesting case, and it is common: a customer whose
 * subscription lapsed and who buys again, or who owns a product directly and
 * then buys a bundle containing it. The UNIQUE (member_id, product_id)
 * constraint plus this upsert means they end up with one live grant rather than
 * two, so "products owned" never double-counts.
 *
 * The expiry rule on conflict is the subtle part: a re-grant must never SHORTEN
 * existing access. Someone with lifetime access who is later given a 30-day
 * grant keeps lifetime. Hence NULL wins, and otherwise the later date wins.
 */
export async function grantAccess(input: GrantAccessInput): Promise<AccessGrant> {
  const ownedClient = input.client ? null : await pool.connect();
  const db = input.client ?? ownedClient!;
  const grantedAt = input.grantedAt ?? new Date();
  const expiresAt = accessExpiresAt(grantedAt, input.expiresAfterDays ?? null);
  try {
    if (ownedClient) await ownedClient.query("BEGIN");
    // Row locks cannot lock a row that does not exist. This transaction-scoped
    // pair lock serializes both the first insert and later reactivation for one
    // member/product without blocking unrelated grants.
    await db.query(`SELECT pg_advisory_xact_lock($1, $2)`, [input.memberId, input.productId]);
    const before = await db.query<{ status: string }>(
      `SELECT status FROM access_grants WHERE member_id = $1 AND product_id = $2 FOR UPDATE`,
      [input.memberId, input.productId],
    );
    const transitionedToActive = before.rows[0]?.status !== "active";

    const res = await db.query(
      `INSERT INTO access_grants
       (member_id, product_id, offer_id, order_id, subscription_id, source,
        status, granted_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
     ON CONFLICT (member_id, product_id) DO UPDATE SET
       status          = 'active',
       revoked_at      = NULL,
       revoke_reason   = '',
       offer_id        = COALESCE(EXCLUDED.offer_id, access_grants.offer_id),
       order_id        = COALESCE(EXCLUDED.order_id, access_grants.order_id),
       subscription_id = COALESCE(EXCLUDED.subscription_id, access_grants.subscription_id),
       granted_at      = LEAST(access_grants.granted_at, EXCLUDED.granted_at),
       expires_at      = CASE
                           WHEN access_grants.expires_at IS NULL THEN NULL
                           WHEN EXCLUDED.expires_at IS NULL THEN NULL
                           ELSE GREATEST(access_grants.expires_at, EXCLUDED.expires_at)
                         END,
       updated_at      = now()
     RETURNING id, member_id, product_id, status, granted_at, expires_at, updated_at`,
      [
        input.memberId,
        input.productId,
        input.offerId ?? null,
        input.orderId ?? null,
        input.subscriptionId ?? null,
        input.source ?? "purchase",
        grantedAt,
        expiresAt,
      ]
    );

    const row = res.rows[0];
    if (ownedClient) await ownedClient.query("COMMIT");
    return {
      id: row.id,
      memberId: row.member_id,
      productId: row.product_id,
      status: row.status,
      grantedAt: row.granted_at,
      expiresAt: row.expires_at,
      updatedAt: row.updated_at,
      transitionedToActive,
    };
  } catch (err) {
    if (ownedClient) await ownedClient.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    ownedClient?.release();
  }
}

/**
 * Grants every product attached to an offer, expanding any bundles one level.
 *
 * One level, not recursively: a bundle of bundles is a configuration mistake
 * rather than a feature, and the migration's `bundle_not_self` check only stops
 * the trivial cycle. Expanding once keeps this terminating no matter how the
 * data is shaped.
 */
export async function grantOfferAccess(input: {
  memberId: number;
  offerId: number;
  orderId?: number | null;
  subscriptionId?: number | null;
  source?: GrantSource;
  grantedAt?: Date;
  client?: Queryable;
  /** Optional caller-owned collector for events that must wait until commit. */
  activatedProductIds?: number[];
}): Promise<number[]> {
  const db = input.client ?? pool;

  const res = await db.query<{ product_id: number; access_expires_after_days: number | null }>(
    `SELECT DISTINCT p.id AS product_id, o.access_expires_after_days
       FROM offers o
       JOIN offer_products op ON op.offer_id = o.id
       JOIN products p        ON p.id = op.product_id
      WHERE o.id = $1
      UNION
     SELECT DISTINCT bi.product_id, o.access_expires_after_days
       FROM offers o
       JOIN offer_products op       ON op.offer_id = o.id
      JOIN product_bundle_items bi ON bi.bundle_product_id = op.product_id
      WHERE o.id = $1`,
    [input.offerId]
  );

  // grantAccess takes one advisory lock per product. A stable order prevents
  // two overlapping bundles from acquiring those locks in opposite order.
  res.rows.sort((a, b) => a.product_id - b.product_id);

  const granted: number[] = [];
  const activated = input.activatedProductIds ?? [];
  const activatedOccurrences: AccessGrant[] = [];
  for (const row of res.rows) {
    const grant = await grantAccess({
      memberId: input.memberId,
      productId: row.product_id,
      offerId: input.offerId,
      orderId: input.orderId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      source: input.source ?? "purchase",
      expiresAfterDays: row.access_expires_after_days,
      grantedAt: input.grantedAt,
      client: input.client,
    });
    granted.push(row.product_id);
    if (grant.transitionedToActive) {
      activated.push(row.product_id);
      activatedOccurrences.push(grant);
    }
  }
  if (input.client === undefined) {
    for (const grant of activatedOccurrences) {
      await dispatchEvent("member.granted_access", {
        id: `grant:${grant.id}:activated:${new Date(grant.updatedAt).toISOString()}`,
        memberId: input.memberId,
        productId: grant.productId,
        offerId: input.offerId,
        source: input.source ?? "purchase",
      });
    }
  }
  return granted;
}

/** Revokes one grant. Keeps the row so the history of what was owned survives. */
export async function revokeAccess(input: {
  memberId: number;
  productId: number;
  reason?: string;
  client?: Queryable;
}): Promise<boolean> {
  const db = input.client ?? pool;
  const res = await db.query(
    `UPDATE access_grants
        SET status = 'revoked', revoked_at = now(), revoke_reason = $3, updated_at = now()
      WHERE member_id = $1 AND product_id = $2 AND status = 'active'`,
    [input.memberId, input.productId, (input.reason ?? "").slice(0, 500)]
  );
  return (res.rowCount ?? 0) > 0;
}

/** Revokes everything an offer granted — used on refund and subscription end. */
export async function revokeOfferAccess(input: {
  memberId: number;
  offerId: number;
  reason?: string;
  client?: Queryable;
}): Promise<number> {
  const db = input.client ?? pool;
  const res = await db.query(
    `UPDATE access_grants
        SET status = 'revoked', revoked_at = now(), revoke_reason = $3, updated_at = now()
      WHERE member_id = $1 AND offer_id = $2 AND status = 'active'`,
    [input.memberId, input.offerId, (input.reason ?? "").slice(0, 500)]
  );
  return res.rowCount ?? 0;
}

/**
 * Whether a member may open a product right now.
 *
 * Expiry is evaluated in the query rather than by a sweeper job, so access
 * lapses at the instant it should even if no background task has run. A
 * separate job flips `status` to 'expired' for reporting; correctness does not
 * depend on it having run.
 */
export async function hasProductAccess(memberId: number, productId: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM access_grants
      WHERE member_id = $1 AND product_id = $2 AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [memberId, productId]
  );
  return res.rows.length > 0;
}

/** The same question asked about a course, which is what the player needs. */
export async function hasCourseAccess(memberId: number, courseId: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1
       FROM access_grants g
       JOIN products p ON p.id = g.product_id
      WHERE g.member_id = $1 AND p.course_id = $2 AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
      LIMIT 1`,
    [memberId, courseId]
  );
  return res.rows.length > 0;
}

/**
 * Whether a community is something somebody sells.
 *
 * Three separate facts each say so on their own — a product of kind 'community'
 * pointing at the room, a plan that unlocks it, or the admin's own 'paid' flag —
 * and any one of them means the room has a door. A community none of them names
 * is open: there is nothing to buy, so entitlement is not a question that applies
 * to it, and that is exactly what a free community is.
 *
 * This is the only thing in this module that reads a table other than
 * `access_grants`, and it reads the catalogue to answer "is there a door", never
 * "may this person walk through it". The second question has one answer, below.
 *
 * Deliberately blind to `products.status`: a product withdrawn from the shop
 * still sold the room to everybody holding it, and reading an archived product
 * as "nobody sells this" would swing the door open the moment the admin tidies
 * up the catalogue.
 */
const COMMUNITY_IS_SOLD = `(
       c.access = 'paid'
    OR EXISTS (SELECT 1 FROM products sp
                WHERE sp.community_id = c.id AND sp.kind = 'community')
    OR EXISTS (SELECT 1 FROM plans pl WHERE pl.community_id = c.id)
  )`;

/**
 * A live grant for a product that sells this room; `$1` is the member.
 *
 * Product status is left out here for the mirror-image reason: archiving a
 * product takes it out of the library grid, and must never take a paying member
 * out of the room they are standing in.
 */
const COMMUNITY_IS_GRANTED = `(EXISTS (
    SELECT 1 FROM access_grants g
      JOIN products gp ON gp.id = g.product_id
     WHERE g.member_id = $1 AND gp.kind IN ('community', 'access_group') AND gp.community_id = c.id
       AND g.status = 'active' AND (g.expires_at IS NULL OR g.expires_at > now())
  ) OR EXISTS (
    -- Entitlements that never take the shape of a grant. A membership created
    -- by an admin, by an automation, or by a plan subscription has no product
    -- behind it — plans unlock a community directly — so judging those by
    -- grants alone would shut out the people who actually paid.
    --
    -- 'purchase' is deliberately absent: that source DOES have a grant, and
    -- reading the membership instead would restore the original bug, where a
    -- refunded member kept the room because the row recording their standing
    -- was still there.
    SELECT 1 FROM community_memberships lm
     WHERE lm.member_id = $1 AND lm.community_id = c.id
       AND lm.banned_at IS NULL
       AND lm.source IN ('manual', 'automation', 'plan')
       AND (
         lm.source <> 'plan'
         -- A plan-sourced membership lasts exactly as long as the subscription
         -- paying for it. Without this, cancelling still left the room open.
         OR lm.subscription_id IS NULL
         OR EXISTS (
           SELECT 1 FROM subscriptions sub
            WHERE sub.id = lm.subscription_id
              AND sub.status IN ('active', 'trialing', 'past_due')
         )
       )
  ))`;

/**
 * Whether a member may be inside a community right now.
 *
 * Asked on every entry rather than once at the door. A `community_memberships`
 * row is a record of standing — points, badges, role, history — and is kept on
 * purpose when a refund revokes the grant behind it, so it can never be the
 * thing that answers this question: a door made of a row nobody deletes is a
 * door that never closes.
 */
export async function mayEnterCommunity(memberId: number, communityId: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM communities c
      WHERE c.id = $2 AND (NOT ${COMMUNITY_IS_SOLD} OR ${COMMUNITY_IS_GRANTED})
      LIMIT 1`,
    [memberId, communityId]
  );
  return res.rows.length > 0;
}

/** The same question asked of every room at once — the query behind the listing. */
export async function listEnterableCommunityIds(memberId: number): Promise<number[]> {
  const res = await pool.query<{ id: number }>(
    `SELECT c.id FROM communities c
      WHERE NOT ${COMMUNITY_IS_SOLD} OR ${COMMUNITY_IS_GRANTED}
      ORDER BY c.id`,
    [memberId]
  );
  return res.rows.map((row) => row.id);
}

export interface OwnedProduct {
  grantId: number;
  productId: number;
  slug: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  kind: string;
  courseId: number | null;
  communityId: number | null;
  podcastId: number | null;
  newsletterId: number | null;
  coachingOfferId: number | null;
  grantedAt: string;
  expiresAt: string | null;
}

/** Everything a member currently owns — the query behind /library. */
export async function listMemberProducts(memberId: number): Promise<OwnedProduct[]> {
  const res = await pool.query(
    `SELECT g.id AS grant_id, p.id AS product_id, p.slug, p.title, p.subtitle,
            p.thumbnail_url, p.kind, p.course_id, p.community_id, p.podcast_id,
            p.newsletter_id, p.coaching_offer_id, g.granted_at, g.expires_at
       FROM access_grants g
       JOIN products p ON p.id = g.product_id
      WHERE g.member_id = $1 AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND p.status <> 'archived'
      ORDER BY g.granted_at DESC`,
    [memberId]
  );

  return res.rows.map((r) => ({
    grantId: r.grant_id,
    productId: r.product_id,
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle,
    thumbnailUrl: r.thumbnail_url,
    kind: r.kind,
    courseId: r.course_id,
    communityId: r.community_id,
    podcastId: r.podcast_id,
    newsletterId: r.newsletter_id,
    coachingOfferId: r.coaching_offer_id,
    grantedAt: r.granted_at,
    expiresAt: r.expires_at,
  }));
}

/**
 * Marks lapsed grants as expired.
 *
 * Cosmetic and for reporting only — `hasProductAccess` already refuses an
 * expired grant regardless of whether this has run. Called by the Phase 10 job
 * runner; safe to call at any frequency.
 */
export async function sweepExpiredGrants(): Promise<number> {
  const res = await pool.query(
    `UPDATE access_grants
        SET status = 'expired', updated_at = now()
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()`
  );
  return res.rowCount ?? 0;
}

/**
 * The community access groups a member is effectively in.
 *
 * Two sources, unioned, and the split is the same one the rest of this module
 * makes. A group Yvette added somebody to by hand is a row in
 * `community_access_group_members`. A group an offer sells is NOT: it is
 * derived from a live grant, so a refund takes the tier away with the room
 * rather than leaving a row behind that nobody remembers to delete.
 *
 * Plans are read directly for the same reason plans unlock a community
 * directly — a subscription has no product grant behind it.
 */
export async function memberAccessGroupIds(memberId: number): Promise<number[]> {
  const found = await pool.query<{ group_id: number }>(
    `SELECT group_id FROM community_access_group_members WHERE member_id = $1
     UNION
     SELECT gp.access_group_id AS group_id
       FROM access_grants g
       JOIN products gp ON gp.id = g.product_id
      WHERE g.member_id = $1
        AND gp.access_group_id IS NOT NULL
        AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
     UNION
     -- The offer that produced the grant, which is where the admin actually
     -- sets the tier ("an offer can grant it"). Same live-grant reading as the
     -- product above, so a refund takes the tier with the access.
     SELECT o.access_group_id AS group_id
       FROM access_grants g
       JOIN offers o ON o.id = g.offer_id
      WHERE g.member_id = $1
        AND o.access_group_id IS NOT NULL
        AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
     UNION
     SELECT pl.access_group_id AS group_id
       FROM subscriptions s
       JOIN plans pl ON pl.id = s.plan_id
      WHERE s.member_id = $1
        AND pl.access_group_id IS NOT NULL
        AND s.status IN ('active', 'trialing', 'past_due')`,
    [memberId]
  );
  return found.rows.map((r) => r.group_id);
}

/**
 * SQL predicate: may `$1` (the member) see a channel scoped to `access_group_id`?
 *
 * Exported as a fragment rather than a function call so the channel list stays
 * one query — resolving the member's groups first and then filtering in JS
 * would make the overview two round trips for one answer.
 */
export const CHANNEL_GROUP_VISIBLE = `(
    ch.access_group_id IS NULL
    OR EXISTS (
      SELECT 1 FROM community_access_group_members agm
       WHERE agm.group_id = ch.access_group_id AND agm.member_id = $MEMBER$
    )
    OR EXISTS (
      SELECT 1 FROM access_grants g
        JOIN products gp ON gp.id = g.product_id
       WHERE g.member_id = $MEMBER$ AND gp.access_group_id = ch.access_group_id
         AND g.status = 'active' AND (g.expires_at IS NULL OR g.expires_at > now())
    )
    OR EXISTS (
      SELECT 1 FROM access_grants g
        JOIN offers o ON o.id = g.offer_id
       WHERE g.member_id = $MEMBER$ AND o.access_group_id = ch.access_group_id
         AND g.status = 'active' AND (g.expires_at IS NULL OR g.expires_at > now())
    )
    OR EXISTS (
      SELECT 1 FROM subscriptions s
        JOIN plans pl ON pl.id = s.plan_id
       WHERE s.member_id = $MEMBER$ AND pl.access_group_id = ch.access_group_id
         AND s.status IN ('active', 'trialing', 'past_due')
    )
  )`;

/**
 * SQL predicate: may `$MEMBER$` see channel `ch` at all?
 *
 * Two independent restrictions, and they are not the same thing.
 *
 * `visibility = 'private'` is the hand-picked list: a row in
 * `community_channel_members` is an invitation, and without one an invite-only
 * channel is not theirs to see. Before that table existed this arm could only
 * ever be false for a plain member, which made "Invited members only" a setting
 * that hid a channel from everybody including the people it was created for.
 *
 * `access_group_id` is the tier, derived from a live grant. A channel can be
 * both — invite-only *and* limited to a tier — and then both have to hold.
 *
 * Moderators are handled by the caller rather than here, because "show me
 * everything in the room I run" is a different question from this one.
 */
export const CHANNEL_MEMBER_VISIBLE = `(
    (
      ch.visibility <> 'private'
      OR EXISTS (
        SELECT 1 FROM community_channel_members ccm
         WHERE ccm.channel_id = ch.id AND ccm.member_id = $MEMBER$
      )
    )
    AND ${CHANNEL_GROUP_VISIBLE}
  )`;
