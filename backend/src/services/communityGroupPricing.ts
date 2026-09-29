import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { badRequest, notFound } from "../utils/httpError";
import { offerPricingIssue } from "../validation/commerceSchemas";

/**
 * Kajabi's access-group pricing: Free, or Paid as a One-time payment, a
 * Subscription (with an optional free trial) or Multiple payments (a payment
 * plan: N payments of $X, one every interval). Each maps onto the offer
 * pricing types the checkout already charges.
 */
export type GroupPricingType = "free" | "one_time" | "subscription" | "payment_plan";
export type GroupInterval = "week" | "month" | "year";

export interface AccessGroupInput {
  name?: string;
  description?: string;
  sort?: number;
  pricingType?: GroupPricingType;
  /** For multiple payments, the amount of ONE payment, not the total. */
  amountCents?: number;
  currency?: string;
  interval?: GroupInterval | null;
  /** Multiple payments only: how many payments in total (2–60). */
  installmentCount?: number | null;
  /** Subscription only: days before the first charge; 0 for none. */
  trialDays?: number;
}

export const GROUP_PRICE_COLUMNS = `o.slug AS checkout_slug, o.pricing_type,
  o.amount_cents, o.currency, o.interval, o.installment_count, o.trial_days,
  o.status AS checkout_status, o.title AS checkout_title,
  (SELECT COALESCE(json_agg(po.label ORDER BY po.sort, po.id), '[]'::json)
     FROM offer_pricing_options po
    WHERE po.offer_id = o.id AND po.active) AS checkout_option_labels`;

/** The generated checkout's slug. An offer with any other slug was linked to
 * the group (e.g. a Kajabi offer), and keeps its own title and copy. */
export function generatedGroupOfferSlug(communityId: number, groupId: number): string {
  return `community-${communityId}-group-${groupId}`;
}

interface GroupPrice {
  pricingType: GroupPricingType;
  amountCents: number;
  currency: string;
  interval: GroupInterval | null;
  installmentCount: number | null;
  trialDays: number;
}

/** Normalise and check a group's price the way the offer editor does, so a
 * group cannot save a price the checkout would refuse or mis-charge. */
export function resolveGroupPrice(input: AccessGroupInput): GroupPrice {
  const pricingType = input.pricingType as GroupPricingType;
  const currency = input.currency ?? "usd";
  if (pricingType === "free") {
    return { pricingType, amountCents: 0, currency, interval: null, installmentCount: null, trialDays: 0 };
  }
  const amountCents = input.amountCents;
  if (amountCents === undefined || amountCents < 50) {
    throw badRequest(
      pricingType === "payment_plan"
        ? "Set an amount of at least 0.50 for each payment."
        : "Set a price of at least 0.50 for a paid access group.",
    );
  }
  const recurring = pricingType === "subscription" || pricingType === "payment_plan";
  const price: GroupPrice = {
    pricingType,
    amountCents,
    currency,
    interval: recurring ? input.interval ?? "month" : null,
    installmentCount: pricingType === "payment_plan" ? input.installmentCount ?? null : null,
    // A trial sent with a payment plan is refused below rather than dropped.
    trialDays: pricingType === "one_time" ? 0 : input.trialDays ?? 0,
  };
  const issue = offerPricingIssue({ ...price, minAmountCents: 0 });
  if (issue) throw badRequest(issue.message, { field: issue.field });
  return price;
}

export async function readAccessGroup(client: Pick<PoolClient, "query">, groupId: number) {
  const row = await client.query(
    `SELECT g.*, ${GROUP_PRICE_COLUMNS} FROM community_access_groups g
       LEFT JOIN offers o ON o.id = g.checkout_offer_id WHERE g.id = $1`, [groupId],
  );
  return row.rows[0];
}

/** One transaction creates the tier, its product and an actual checkout offer.
 * Stripe fulfillment remains the only purchase-grant writer.
 */
export async function saveAccessGroup(communityId: number, groupId: number | null, input: AccessGroupInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const community = await client.query(`SELECT name, slug FROM communities WHERE id = $1`, [communityId]);
    if (!community.rows[0]) throw notFound("Community not found");
    let group;
    if (groupId === null) {
      const result = await client.query(
        `INSERT INTO community_access_groups(community_id,name,description,sort)
         VALUES($1,$2,$3,$4) RETURNING *`,
        [communityId, input.name, input.description ?? "", input.sort ?? 0],
      );
      group = result.rows[0];
    } else {
      const before = await client.query(`SELECT * FROM community_access_groups WHERE id=$1 AND community_id=$2 FOR UPDATE`, [groupId, communityId]);
      if (!before.rows[0]) throw notFound("Access group not found");
      const result = await client.query(
        `UPDATE community_access_groups SET name=$3,description=$4,sort=$5 WHERE id=$1 AND community_id=$2 RETURNING *`,
        [groupId, communityId, input.name ?? before.rows[0].name, input.description ?? before.rows[0].description, input.sort ?? before.rows[0].sort],
      );
      group = result.rows[0];
    }
    if (input.pricingType !== undefined) {
      const price = resolveGroupPrice(input);
      const title = `${community.rows[0].name} — ${group.name}`;
      const slug = generatedGroupOfferSlug(communityId, group.id);
      const pricingValues = [price.pricingType, price.amountCents, price.currency, price.interval,
        price.installmentCount, price.trialDays];
      let offerId = group.checkout_offer_id;
      if (offerId === null) {
        // An access_group product does not make a free parent community paid.
        const product = await client.query(
          `INSERT INTO products(slug,title,description,kind,community_id,access_group_id,status)
           VALUES($1,$2,$3,'access_group',$4,$5,'published') RETURNING id`,
          [slug,title,group.description,communityId,group.id],
        );
        const offer = await client.query(
          `INSERT INTO offers(title,slug,status,description,pricing_type,amount_cents,currency,interval,
             installment_count,trial_days,interval_count,access_group_id,redirect_url,send_welcome_email)
           VALUES($1,$2,'published',$3,$4,$5,$6,$7,$8,$9,1,$10,$11,false) RETURNING id`,
          [title,slug,group.description,...pricingValues,group.id,`/community/${community.rows[0].slug}`],
        );
        offerId = offer.rows[0].id;
        await client.query(`INSERT INTO offer_products(offer_id,product_id) VALUES($1,$2)`,[offerId,product.rows[0].id]);
        await client.query(`UPDATE community_access_groups SET checkout_offer_id=$2 WHERE id=$1`,[group.id,offerId]);
      } else {
        // Repricing clears the cached Stripe Price so the next checkout mints
        // one for the new terms; existing subscriptions keep theirs.
        await client.query(
          `UPDATE offers SET pricing_type=$2,amount_cents=$3,currency=$4,interval=$5,
             installment_count=$6,trial_days=$7,interval_count=1,
             stripe_price_id=CASE WHEN pricing_type IS DISTINCT FROM $2 OR amount_cents IS DISTINCT FROM $3
               OR currency IS DISTINCT FROM $4 OR interval IS DISTINCT FROM $5
               OR installment_count IS DISTINCT FROM $6 OR interval_count <> 1
               THEN NULL ELSE stripe_price_id END,
             updated_at=now() WHERE id=$1`,
          [offerId,...pricingValues],
        );
        // Only the checkout this screen generated takes the group's name and
        // blurb. A linked offer (e.g. Kajabi's "The Lounge | Boss Clinician")
        // keeps its own title and checkout copy.
        await client.query(
          `UPDATE offers SET title=$2,description=$3 WHERE id=$1 AND slug=$4`,
          [offerId,title,group.description,slug],
        );
        await client.query(`UPDATE products SET title=$2,description=$3,updated_at=now() WHERE slug=$1 AND kind='access_group'`,[slug,title,group.description]);
      }
    } else if (input.amountCents !== undefined || input.currency !== undefined || input.interval !== undefined
      || input.installmentCount !== undefined || input.trialDays !== undefined) {
      throw badRequest("Choose Free, One-time payment, Subscription or Multiple payments when setting a group's price.");
    }
    const saved = await readAccessGroup(client, group.id);
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as {code?: string}).code === "23505") throw badRequest("There is already a group with that name.");
    throw error;
  } finally { client.release(); }
}

/** Archive the generated checkout before deleting the tier, so an old link
 * cannot keep collecting payment for a tier that no longer exists. An offer
 * that was linked to the group rather than generated for it (e.g. Kajabi's
 * "The Lounge | Boss Clinician") is its own catalog item and is left as it is. */
export async function deleteAccessGroup(communityId: number, groupId: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = await client.query(`SELECT checkout_offer_id FROM community_access_groups WHERE id=$1 AND community_id=$2 FOR UPDATE`,[groupId,communityId]);
    if (!group.rows[0]) throw notFound("Access group not found");
    if (group.rows[0].checkout_offer_id !== null) {
      await client.query(`UPDATE offers SET status='archived',updated_at=now() WHERE id=$1 AND slug=$2`,
        [group.rows[0].checkout_offer_id, generatedGroupOfferSlug(communityId, groupId)]);
      await client.query(`UPDATE products SET status='archived',updated_at=now() WHERE slug=$1 AND kind='access_group'`,[generatedGroupOfferSlug(communityId, groupId)]);
    }
    await client.query(`DELETE FROM community_access_groups WHERE id=$1 AND community_id=$2`,[groupId,communityId]);
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { client.release(); }
}
