-- Sheet row 242 follow-up (21-Nov-2026): Kajabi buyers of "Do's and Don'ts of Documentation" (CE offer 106 /
-- Edu offer 105) were imported as purchases but never received an access grant to the on-demand replay
-- (product 72, course 63), so they could not open it or earn its certificate. Grant the same access a new
-- buyer gets. Idempotent; skips anyone who already has a grant for product 72 or whose purchase was revoked.
INSERT INTO access_grants (member_id, product_id, offer_id, source, status, granted_at)
SELECT DISTINCT ON (p.member_id) p.member_id, 72, p.offer_id, 'import', 'active', now()
  FROM purchases p
 WHERE p.offer_id IN (105, 106)
   AND p.member_id IS NOT NULL
   AND p.source = 'kajabi'
   AND p.status IN ('complete', 'completed', 'granted', 'active')
   AND COALESCE(p.access_revoked, false) = false
   AND EXISTS (SELECT 1 FROM products pr WHERE pr.id = 72 AND pr.course_id = 63)
   AND NOT EXISTS (SELECT 1 FROM access_grants g WHERE g.member_id = p.member_id AND g.product_id = 72)
 ORDER BY p.member_id, p.purchased_at;
