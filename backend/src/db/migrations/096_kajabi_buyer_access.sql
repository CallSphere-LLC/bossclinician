-- 096: give Kajabi buyers access to what they bought.
--
-- The Kajabi import (075/076/085/088) brought over contacts, member accounts
-- (161, password-less, members.contact_id linked) and one `purchases` row per
-- Kajabi purchase card, linked to our offers by Kajabi's internal title. It
-- never wrote `access_grants`, and access_grants is the only thing the library,
-- course player, downloads, coaching and community doors read
-- (services/access.ts). So almost nobody who bought in Kajabi could open what
-- they bought here, and the 2026-10-01 course import (094) made that matter.
--
-- What counts as "still has it in Kajabi" (purchases columns from 076):
--   * status complete (one-time / free / order), granted (admin grant),
--     active or past_due (payment plan in good standing or being dunned, the
--     same reading services/access.ts gives a past_due subscription), or
--     completed (plan paid off);
--   * NOT paused, canceled or refunded;
--   * NOT access_revoked (Kajabi's "Access revoked by ..." / "at the end of the
--     offer's access period"), and access_ends_on not in the past;
--   * not one of Kajabi's own "TEST ..." purchases.
--
-- What it grants: exactly what grantOfferAccess would hand out for the linked
-- offer - every offer_products product, plus one level of bundle items, with
-- no filter on product status (an archived product simply stays out of the
-- library grid, as it does for a native buyer). Community tiers need nothing
-- extra: access groups are derived from live grants through
-- offers.access_group_id / products.access_group_id, so a Lounge buyer gets
-- the room and the tier from the grant itself.
--
-- One Kajabi offer has no offer here but a known target: "Boss Clinician
-- Elite - zap" (a Zapier-granted offer) is the Practice Reset Intensive, as
-- 078 maps its holders and as their Kajabi "Bought: Practice Reset Intensive"
-- tags confirm. Those grants carry no offer_id.
--
-- Columns follow grantAccess(): source 'import' (the Kajabi-import source the
-- CHECK allows, as 088 used), offer_id from the purchase (so refunds/plan
-- defaults that revoke by offer, and offer-level access groups, work as for a
-- native buyer), order_id = the purchase's first Kajabi payment if any,
-- granted_at = Kajabi purchase date (drip schedules line up), expires_at from
-- the offer's access_expires_after_days, else the purchase's access_ends_on,
-- else never.
--
-- Idempotent and additive only: a member/product pair that already has a
-- grant in ANY status is left alone, so this never shortens, revokes or
-- reactivates anything (a grant the admin revoked here stays revoked). No
-- emails, no webhooks, no jobs: grantAccess's member.granted_access event is
-- deliberately not fired for a backfill.

WITH eligible AS (
  SELECT pu.id, pu.member_id, pu.offer_id, pu.offer_title, pu.purchased_at,
         pu.access_ends_on
    FROM purchases pu
    JOIN members m ON m.id = pu.member_id
   WHERE pu.source = 'kajabi'
     AND pu.status IN ('complete', 'granted', 'active', 'past_due', 'completed')
     AND NOT pu.access_revoked
     AND (pu.access_ends_on IS NULL OR pu.access_ends_on >= current_date)
     AND pu.offer_title NOT ILIKE 'TEST %'
),
-- Kajabi offers with no offer row here, mapped straight to the product.
title_products (offer_title, product_slug) AS (
  VALUES ('Boss Clinician Elite - zap', 'practice-reset-intensive')
),
targets AS (
  SELECT e.id AS purchase_id, op.product_id
    FROM eligible e
    JOIN offer_products op ON op.offer_id = e.offer_id
  UNION
  SELECT e.id, bi.product_id
    FROM eligible e
    JOIN offer_products op       ON op.offer_id = e.offer_id
    JOIN product_bundle_items bi ON bi.bundle_product_id = op.product_id
  UNION
  SELECT e.id, p.id
    FROM eligible e
    JOIN title_products tp ON tp.offer_title = e.offer_title
    JOIN products p        ON p.slug = tp.product_slug
   WHERE e.offer_id IS NULL
),
-- One grant per member/product: the earliest purchase wins, as
-- grantAccess keeps LEAST(granted_at) when a product is bought twice.
picked AS (
  SELECT DISTINCT ON (e.member_id, t.product_id)
         e.member_id, t.product_id, e.offer_id, e.id AS purchase_id,
         e.purchased_at, e.access_ends_on
    FROM targets t
    JOIN eligible e ON e.id = t.purchase_id
   ORDER BY e.member_id, t.product_id, e.purchased_at, e.id
)
INSERT INTO access_grants
  (member_id, product_id, offer_id, order_id, source, status, granted_at, expires_at)
SELECT pk.member_id, pk.product_id, pk.offer_id,
       (SELECT min(o.id) FROM orders o WHERE o.purchase_id = pk.purchase_id),
       'import', 'active', pk.purchased_at,
       CASE
         WHEN ofr.access_expires_after_days IS NOT NULL
           THEN pk.purchased_at + make_interval(days => ofr.access_expires_after_days)
         WHEN pk.access_ends_on IS NOT NULL
           THEN (pk.access_ends_on + 1)::timestamptz
         ELSE NULL
       END
  FROM picked pk
  LEFT JOIN offers ofr ON ofr.id = pk.offer_id
 WHERE NOT EXISTS (
         SELECT 1 FROM access_grants g
          WHERE g.member_id = pk.member_id AND g.product_id = pk.product_id
       )
ON CONFLICT (member_id, product_id) DO NOTHING;
