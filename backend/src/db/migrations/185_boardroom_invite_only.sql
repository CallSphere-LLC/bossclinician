-- The Boardroom is invite-only (owner, 30 Oct): applicants get a link once she has
-- reviewed them. The agreement step follows separately, when the signing copy is
-- final, so nothing here requires a signature. Reminders are off because a reminder
-- link carries no invitation and would land on the notice.
INSERT INTO offer_checkout_requirements (offer_id, invitation_required)
SELECT o.id, true FROM offers o WHERE o.slug = 'the-boss-boardroom'
ON CONFLICT (offer_id) DO UPDATE SET invitation_required = true;

UPDATE offers
   SET allow_gifting = false, recovery_enabled = false, updated_at = now()
 WHERE slug = 'the-boss-boardroom';
