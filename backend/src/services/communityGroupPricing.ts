import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { badRequest, notFound } from "../utils/httpError";

export interface AccessGroupInput {
  name?: string;
  description?: string;
  sort?: number;
  pricingType?: "free" | "one_time" | "subscription";
  amountCents?: number;
  currency?: string;
  interval?: "month" | "year" | null;
}

export const GROUP_PRICE_COLUMNS = `o.slug AS checkout_slug, o.pricing_type,
  o.amount_cents, o.currency, o.interval`;

export async function readAccessGroup(client: Pick<PoolClient, "query">, groupId: number) {
  const row = await client.query(
    `SELECT g.*, ${GROUP_PRICE_COLUMNS} FROM community_access_groups g
       LEFT JOIN offers o ON o.id = g.checkout_offer_id WHERE g.id = $1`, [groupId],
  );
  return row.rows[0];
}

/** One transaction creates the tier, its product and an actual checkout offer.
 * Stripe fulfillment remains the only purchase-grant writer. Repricing clears
 * the cached Stripe Price for new purchases; existing subscriptions keep theirs.
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
      const pricingType = input.pricingType;
      const amount = pricingType === "free" ? 0 : input.amountCents;
      if (pricingType !== "free" && (amount === undefined || amount < 50)) {
        throw badRequest("Set a price of at least 0.50 for a paid access group.");
      }
      const interval = pricingType === "subscription" ? input.interval ?? "month" : null;
      const currency = input.currency ?? "usd";
      const title = `${community.rows[0].name} — ${group.name}`;
      const slug = `community-${communityId}-group-${group.id}`;
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
             access_group_id,redirect_url,send_welcome_email)
           VALUES($1,$2,'published',$3,$4,$5,$6,$7,$8,$9,false) RETURNING id`,
          [title,slug,group.description,pricingType,amount,currency,interval,group.id,`/community/${community.rows[0].slug}`],
        );
        offerId = offer.rows[0].id;
        await client.query(`INSERT INTO offer_products(offer_id,product_id) VALUES($1,$2)`,[offerId,product.rows[0].id]);
        await client.query(`UPDATE community_access_groups SET checkout_offer_id=$2 WHERE id=$1`,[group.id,offerId]);
      } else {
        await client.query(
          `UPDATE offers SET title=$2,description=$3,pricing_type=$4,amount_cents=$5,currency=$6,interval=$7,
             stripe_price_id=CASE WHEN pricing_type IS DISTINCT FROM $4 OR amount_cents IS DISTINCT FROM $5
               OR currency IS DISTINCT FROM $6 OR interval IS DISTINCT FROM $7 THEN NULL ELSE stripe_price_id END,
             updated_at=now() WHERE id=$1`,
          [offerId,title,group.description,pricingType,amount,currency,interval],
        );
        await client.query(`UPDATE products SET title=$2,description=$3,updated_at=now() WHERE slug=$1 AND kind='access_group'`,[slug,title,group.description]);
      }
    } else if (input.amountCents !== undefined || input.currency !== undefined || input.interval !== undefined) {
      throw badRequest("Choose free, one-time payment, or subscription when setting a group's price.");
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
 * cannot keep collecting payment for a tier that no longer exists. */
export async function deleteAccessGroup(communityId: number, groupId: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = await client.query(`SELECT checkout_offer_id FROM community_access_groups WHERE id=$1 AND community_id=$2 FOR UPDATE`,[groupId,communityId]);
    if (!group.rows[0]) throw notFound("Access group not found");
    if (group.rows[0].checkout_offer_id !== null) {
      await client.query(`UPDATE offers SET status='archived',updated_at=now() WHERE id=$1`,[group.rows[0].checkout_offer_id]);
      await client.query(`UPDATE products SET status='archived',updated_at=now() WHERE slug=$1 AND kind='access_group'`,[`community-${communityId}-group-${groupId}`]);
    }
    await client.query(`DELETE FROM community_access_groups WHERE id=$1 AND community_id=$2`,[groupId,communityId]);
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { client.release(); }
}
