import { pool } from "../db/pool";
import { countSegment } from "../services/segments";
import { registerHandler } from "./worker";

/**
 * The contact rollup.
 *
 * `contacts.lifetime_value_cents`, `order_count` and `last_activity_at`, plus
 * the counts on tags and segments, are denormalised because every list in the
 * console sorts and filters on them. Recomputing a lifetime total across orders
 * per row makes the contact list unusable at a few thousand contacts, and a
 * segment count evaluated on every page view of the segment list is a table
 * scan per row.
 *
 * The price of that is this job. Everything below is a full recompute rather
 * than an increment: an increment is only correct if it runs exactly once for
 * every event, and a refund arriving through a webhook that was retried is
 * precisely the case where it will not. Recomputing is idempotent, cheap enough
 * at this size, and self-healing — the numbers converge on the truth however
 * badly the last run went.
 */

/**
 * Attaches orders to contacts by address.
 *
 * `services/fulfillment.ts` sets `contact_id` when a payment settles, so this
 * closes two gaps rather than doing the normal work: an order placed before
 * Phase 4 shipped, and one whose contact was created after the order row. Only
 * ever fills a blank, so an order already attributed to somebody stays there.
 */
async function linkOrphanedOrders(): Promise<number> {
  const result = await pool.query(
    `UPDATE orders o
        SET contact_id = c.id
       FROM contacts c
      WHERE o.contact_id IS NULL
        AND o.email <> ''
        -- Compared as citext rather than as lower(text). The orders table holds
        -- the address exactly as the customer typed it in a plain TEXT column,
        -- so a case-sensitive join loses every order placed as "Y@x.com".
        AND o.email::citext = c.email`
  );
  return result.rowCount ?? 0;
}

/**
 * Recomputes what each contact has spent and when they last did anything.
 *
 * Two quirks are load-bearing:
 *
 *  - The amount is `GREATEST(total_cents, amount_cents)`. The legacy
 *    /checkout/session path writes `amount_cents` and leaves `total_cents` at
 *    zero, while the offer checkout writes both; taking either one alone
 *    silently values half the order history at nothing.
 *  - Refunds come off the total but not off the count. Somebody who bought and
 *    was refunded is still a customer who bought, and reporting them as having
 *    made zero purchases loses the fact that a refund happened at all.
 */
async function rollUpContacts(): Promise<number> {
  const result = await pool.query(
    `UPDATE contacts c
        SET lifetime_value_cents = totals.value_cents,
            order_count          = totals.order_count,
            last_ordered_at      = totals.last_ordered_at,
            last_activity_at     = GREATEST(
                                     totals.last_ordered_at,
                                     (SELECT max(a.occurred_at) FROM contact_activity a
                                       WHERE a.contact_id = c.id),
                                     c.created_at
                                   ),
            updated_at = now()
       FROM (
         SELECT c2.id,
                COALESCE(SUM(GREATEST(o.total_cents, o.amount_cents) - o.refunded_cents)
                           FILTER (WHERE o.status IN ('paid', 'refunded')), 0)::int AS value_cents,
                COUNT(o.id) FILTER (WHERE o.status IN ('paid', 'refunded'))::int    AS order_count,
                MAX(o.created_at) FILTER (WHERE o.status IN ('paid', 'refunded'))   AS last_ordered_at
           FROM contacts c2
           LEFT JOIN orders o ON o.contact_id = c2.id
          GROUP BY c2.id
       ) totals
      WHERE c.id = totals.id
        -- Only write the rows that actually move. Touching every contact on
        -- every run rewrites the whole table hourly for no change.
        AND (c.lifetime_value_cents IS DISTINCT FROM totals.value_cents
          OR c.order_count          IS DISTINCT FROM totals.order_count
          OR c.last_ordered_at      IS DISTINCT FROM totals.last_ordered_at)`
  );
  return result.rowCount ?? 0;
}

async function rollUpTags(): Promise<number> {
  const result = await pool.query(
    `UPDATE tags t
        SET contact_count = counts.total, updated_at = now()
       FROM (
         SELECT t2.id, (SELECT COUNT(*)::int FROM contact_tags ct WHERE ct.tag_id = t2.id) AS total
           FROM tags t2
       ) counts
      WHERE t.id = counts.id AND t.contact_count IS DISTINCT FROM counts.total`
  );
  return result.rowCount ?? 0;
}

/**
 * Recounts every segment, one at a time.
 *
 * Deliberately not one statement: each definition compiles to a different query,
 * and a single broken segment must not stop the other thirty being counted. A
 * definition that no longer compiles — a field that was removed, a value that
 * was hand-edited — leaves its stale count alone and says so in the log rather
 * than failing the job and taking the tag and contact rollups with it.
 */
async function rollUpSegments(): Promise<{ counted: number; failed: number }> {
  const segments = await pool.query<{ id: number; name: string; definition: unknown }>(
    `SELECT id, name, definition FROM segments`
  );

  let counted = 0;
  let failed = 0;

  for (const segment of segments.rows) {
    try {
      const count = await countSegment(segment.definition);
      await pool.query(
        `UPDATE segments SET contact_count = $2, counted_at = now(), updated_at = now()
          WHERE id = $1`,
        [segment.id, count]
      );
      counted += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[contacts.rollup] segment "${segment.name}" (#${segment.id}) could not be counted:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { counted, failed };
}

export interface ContactRollupResult {
  ordersLinked: number;
  contactsUpdated: number;
  tagsUpdated: number;
  segmentsCounted: number;
  segmentsFailed: number;
}

export async function runContactRollup(): Promise<ContactRollupResult> {
  const ordersLinked = await linkOrphanedOrders();
  const contactsUpdated = await rollUpContacts();
  const tagsUpdated = await rollUpTags();
  const segments = await rollUpSegments();

  return {
    ordersLinked,
    contactsUpdated,
    tagsUpdated,
    segmentsCounted: segments.counted,
    segmentsFailed: segments.failed,
  };
}

/** Wires the rollup into the queue. Called once at boot, like every other handler. */
export function registerContactJobs(): void {
  registerHandler("contacts.rollup", () => runContactRollup());
}
