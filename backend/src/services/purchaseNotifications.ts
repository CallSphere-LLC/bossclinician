import type { PoolClient } from "pg";
import { pool } from "../db/pool";

/**
 * "You now have access to …" — the in-app notice a member gets when something
 * they bought (or were given) becomes theirs.
 *
 * Written into `member_notifications`, the same table the community bell reads,
 * so there is one inbox rather than two. Never emailed: purchase delivery mail
 * is sent by fulfillment on its own terms, and nothing reads `emailed_at`.
 *
 * The link is the whole point. A customer who has just paid should not have to
 * work out which tab of which page the thing landed on, so every kind of product
 * gets the address of the exact place it lives.
 */

type Queryable = Pick<PoolClient, "query"> | typeof pool;

export const PURCHASE_ACCESS_KIND = "purchase_access";

export interface PurchaseLinkInput {
  kind: string;
  slug: string;
  /** The community this product opens, directly or through its access group. */
  communitySlug: string | null;
}

/**
 * Where a product lives in the member area. Mirrored in SQL by migration 130's
 * backfill; purchaseNotifications.integration.test.ts keeps the two agreeing.
 */
export function purchaseLink(product: PurchaseLinkInput): string {
  const slug = encodeURIComponent(product.slug);
  switch (product.kind) {
    case "course":
      return `/library/${slug}`;
    case "download":
      return `/library?tab=documents&product=${slug}`;
    case "community":
      return product.communitySlug
        ? `/community/${encodeURIComponent(product.communitySlug)}`
        : "/community";
    case "access_group":
      return product.communitySlug
        ? `/community/${encodeURIComponent(product.communitySlug)}`
        : `/library?product=${slug}`;
    case "coaching":
      return "/coaching";
    case "podcast":
      return "/podcasts";
    case "newsletter":
      return "/newsletters";
    default:
      return `/library?product=${slug}`;
  }
}

/** One line under the title, by kind: what "open it" will actually show them. */
export function purchaseBody(kind: string): string {
  switch (kind) {
    case "course":
      return "Your course is ready. Start the first lesson whenever you like.";
    case "download":
      return "Your files are ready to download.";
    case "community":
    case "access_group":
      return "You're in. Open it to see what's waiting for you.";
    case "coaching":
      return "Your coaching is set up. Open it to book and prepare.";
    default:
      return "It's in your library now.";
  }
}

interface ProductForNotice {
  kind: string;
  slug: string;
  title: string;
  community_slug: string | null;
}

/**
 * Writes the notice for one grant. Called by `grantAccess` inside its own
 * transaction, only when the grant has just become active.
 *
 * The offer's name is used when the offer sells exactly this product: it is
 * what the customer saw at checkout ("The Fully Booked Therapist Toolkit")
 * where the product's own title is often an imported shorthand. A bundle's
 * contents keep their own names.
 */
export async function notifyPurchaseAccess(input: {
  memberId: number;
  productId: number;
  grantId: number;
  offerId: number | null;
  client?: Queryable;
}): Promise<number | null> {
  const db = input.client ?? pool;
  const found = await db.query<ProductForNotice>(
    `SELECT p.kind, p.slug,
            COALESCE(
              (SELECT NULLIF(TRIM(o.title), '') FROM offers o
                WHERE o.id = $2
                  AND (SELECT COUNT(*) FROM offer_products op WHERE op.offer_id = o.id) = 1
                  AND EXISTS (SELECT 1 FROM offer_products op
                               WHERE op.offer_id = o.id AND op.product_id = p.id)),
              NULLIF(TRIM(p.title), ''),
              p.slug
            ) AS title,
            COALESCE(c.slug, ac.slug) AS community_slug
       FROM products p
       LEFT JOIN communities c ON c.id = p.community_id
       LEFT JOIN community_access_groups ag ON ag.id = p.access_group_id
       LEFT JOIN communities ac ON ac.id = ag.community_id
      WHERE p.id = $1`,
    [input.productId, input.offerId]
  );
  const product = found.rows[0];
  if (!product) return null;

  const res = await db.query<{ id: number }>(
    `INSERT INTO member_notifications (member_id, kind, title, body, link, access_grant_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.memberId,
      PURCHASE_ACCESS_KIND,
      `You now have access to ${product.title}`.slice(0, 200),
      purchaseBody(product.kind),
      purchaseLink({
        kind: product.kind,
        slug: product.slug,
        communitySlug: product.community_slug,
      }).slice(0, 500),
      input.grantId,
    ]
  );
  return res.rows[0]?.id ?? null;
}

/**
 * The notice must never cost the customer their access. Inside a transaction a
 * failed statement poisons everything after it, so the insert runs under a
 * savepoint and a failure is rolled back to it and logged; the grant commits.
 * Outside a transaction (a bare pool) SAVEPOINT itself errors harmlessly and the
 * insert simply runs on its own.
 */
export async function notifyPurchaseAccessSafely(
  input: Parameters<typeof notifyPurchaseAccess>[0]
): Promise<void> {
  const db = input.client ?? pool;
  let savepoint = false;
  if (input.client) {
    try {
      await db.query("SAVEPOINT purchase_notice");
      savepoint = true;
    } catch {
      savepoint = false;
    }
  }
  try {
    await notifyPurchaseAccess(input);
    if (savepoint) await db.query("RELEASE SAVEPOINT purchase_notice");
  } catch (err) {
    if (savepoint) {
      await db.query("ROLLBACK TO SAVEPOINT purchase_notice").catch(() => undefined);
    }
    console.error("[purchase-notice] could not record notification", {
      memberId: input.memberId,
      productId: input.productId,
      grantId: input.grantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
