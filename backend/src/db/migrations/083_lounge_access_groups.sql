-- 083: The Lounge's access groups, as Kajabi has them (bug sheet row 41).
--
-- Kajabi's Lounge community has two access groups, "Boss Clinician Lounge" and
-- "How to Improve Relations" (names as the QA tester read them in Kajabi admin).
-- Here The Lounge (communities.slug 'the-lounge') had none.
--
-- "Boss Clinician Lounge" takes the owner's own Lounge text (sheet tab
-- "Updates & Discussion") and is sold by the existing Kajabi offer
-- "The Lounge | Boss Clinician" (offers.slug 'the-lounge', added as a draft by
-- 081: $1,997 or 6 x $197). The link is wired the same way the admin's group
-- pricing wires a generated checkout, so buying that offer really grants the
-- room and the tier: an access_group product for The Lounge, attached to the
-- offer, plus offers.access_group_id and the group's checkout_offer_id.
-- The offer itself (status, title, copy, prices) is left exactly as 081 made it:
-- it stays a draft, so nothing is sold until the owner publishes it.
--
-- "How to Improve Relations" has no description or price in any source we hold,
-- so it is created bare and unpriced. Nobody is added to either group.
-- Idempotent: every step is keyed on names/slugs and skips what already exists.

INSERT INTO community_access_groups (community_id, name, description, sort)
SELECT c.id, 'Boss Clinician Lounge',
       'A flexible monthly membership offering ongoing business support, resources, training, and community for clinicians building and growing their practices.',
       0
  FROM communities c WHERE c.slug = 'the-lounge'
ON CONFLICT (community_id, name) DO NOTHING;

INSERT INTO community_access_groups (community_id, name, description, sort)
SELECT c.id, 'How to Improve Relations', '', 1
  FROM communities c WHERE c.slug = 'the-lounge'
ON CONFLICT (community_id, name) DO NOTHING;

DO $$
DECLARE
  v_community communities%ROWTYPE;
  v_group community_access_groups%ROWTYPE;
  v_offer_id integer;
  v_product_id integer;
  v_slug text;
BEGIN
  SELECT * INTO v_community FROM communities WHERE slug = 'the-lounge';
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_group FROM community_access_groups
   WHERE community_id = v_community.id AND name = 'Boss Clinician Lounge';
  SELECT id INTO v_offer_id FROM offers WHERE slug = 'the-lounge';
  IF v_group.id IS NULL OR v_offer_id IS NULL THEN RETURN; END IF;

  -- Never take over an offer another group already checks out through, and
  -- never replace a checkout the admin has since set on this group.
  IF v_group.checkout_offer_id IS NOT NULL AND v_group.checkout_offer_id <> v_offer_id THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM community_access_groups
              WHERE checkout_offer_id = v_offer_id AND id <> v_group.id) THEN RETURN; END IF;

  -- Same slug convention as services/communityGroupPricing.ts, so the admin's
  -- group editor finds and keeps this product in step with the group.
  v_slug := 'community-' || v_community.id || '-group-' || v_group.id;
  INSERT INTO products (slug, title, description, kind, community_id, access_group_id, status)
  VALUES (v_slug, v_community.name || ' — ' || v_group.name, v_group.description,
          'access_group', v_community.id, v_group.id, 'published')
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_product_id FROM products WHERE slug = v_slug;

  INSERT INTO offer_products (offer_id, product_id) VALUES (v_offer_id, v_product_id)
  ON CONFLICT (offer_id, product_id) DO NOTHING;

  UPDATE offers SET access_group_id = v_group.id, updated_at = now()
   WHERE id = v_offer_id AND access_group_id IS NULL;

  UPDATE community_access_groups SET checkout_offer_id = v_offer_id
   WHERE id = v_group.id AND checkout_offer_id IS NULL;
END $$;
