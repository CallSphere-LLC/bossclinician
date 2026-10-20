-- 130: in-app "you now have access" notices for purchases.
--
-- services/purchaseNotifications.ts writes one member_notifications row (kind
-- 'purchase_access') whenever a grant becomes active, linking straight to where
-- the product lives. `access_grant_id` ties the notice to the grant that caused
-- it, which is what makes the backfill below safe to re-run.
--
-- Backfill: paid purchases from the last 30 days that have no notice yet, so a
-- customer who bought before this shipped (the Fully Booked Toolkit, order 199)
-- still gets one. Nothing is emailed; nothing reads emailed_at. On an empty
-- database the INSERT selects nothing.

ALTER TABLE member_notifications
  ADD COLUMN IF NOT EXISTS access_grant_id INT REFERENCES access_grants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_member_notifications_grant
  ON member_notifications (access_grant_id) WHERE access_grant_id IS NOT NULL;

-- The title, body and link expressions mirror notifyPurchaseAccess(),
-- purchaseBody() and purchaseLink() in services/purchaseNotifications.ts;
-- purchaseNotifications.integration.test.ts checks the two agree.
INSERT INTO member_notifications (member_id, kind, title, body, link, access_grant_id, created_at)
SELECT g.member_id,
       'purchase_access',
       LEFT('You now have access to ' || COALESCE(
         (SELECT NULLIF(TRIM(o.title), '') FROM offers o
           WHERE o.id = g.offer_id
             AND (SELECT COUNT(*) FROM offer_products op WHERE op.offer_id = o.id) = 1
             AND EXISTS (SELECT 1 FROM offer_products op
                          WHERE op.offer_id = o.id AND op.product_id = p.id)),
         NULLIF(TRIM(p.title), ''),
         p.slug), 200),
       CASE p.kind
         WHEN 'course' THEN 'Your course is ready. Start the first lesson whenever you like.'
         WHEN 'download' THEN 'Your files are ready to download.'
         WHEN 'community' THEN 'You''re in. Open it to see what''s waiting for you.'
         WHEN 'access_group' THEN 'You''re in. Open it to see what''s waiting for you.'
         WHEN 'coaching' THEN 'Your coaching is set up. Open it to book and prepare.'
         ELSE 'It''s in your library now.'
       END,
       CASE p.kind
         WHEN 'course' THEN '/library/' || p.slug
         WHEN 'download' THEN '/library?tab=documents&product=' || p.slug
         WHEN 'community' THEN COALESCE('/community/' || COALESCE(c.slug, ac.slug), '/community')
         WHEN 'access_group' THEN COALESCE('/community/' || COALESCE(c.slug, ac.slug),
                                           '/library?product=' || p.slug)
         WHEN 'coaching' THEN '/coaching'
         WHEN 'podcast' THEN '/podcasts'
         WHEN 'newsletter' THEN '/newsletters'
         ELSE '/library?product=' || p.slug
       END,
       g.id,
       g.granted_at
  FROM access_grants g
  JOIN products p ON p.id = g.product_id
  JOIN orders ord ON ord.id = g.order_id AND ord.status = 'paid'
  LEFT JOIN communities c ON c.id = p.community_id
  LEFT JOIN community_access_groups ag ON ag.id = p.access_group_id
  LEFT JOIN communities ac ON ac.id = ag.community_id
 WHERE g.status = 'active'
   AND (g.expires_at IS NULL OR g.expires_at > now())
   AND g.source <> 'import'
   AND g.granted_at > now() - interval '30 days'
   AND p.status <> 'archived'
   AND NOT EXISTS (SELECT 1 FROM member_notifications n WHERE n.access_grant_id = g.id);
