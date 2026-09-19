-- Pricing belongs to access groups. Existing groups/grants remain unchanged.
ALTER TABLE community_access_groups
  ADD COLUMN IF NOT EXISTS checkout_offer_id integer REFERENCES offers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_group_checkout_offer_unique
  ON community_access_groups(checkout_offer_id) WHERE checkout_offer_id IS NOT NULL;
