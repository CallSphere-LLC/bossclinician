-- A recurring plan can unlock the same catalogue products as an offer.
--
-- `plans.community_id` predates the catalogue and only lets a plan unlock one
-- community. Keeping it during the transition preserves existing subscriptions;
-- every non-null legacy community is mirrored into the join table below.
CREATE TABLE IF NOT EXISTS plan_products (
  plan_id     INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (plan_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_products_product ON plan_products (product_id);

ALTER TABLE access_grants DROP CONSTRAINT IF EXISTS access_grants_source_check;
ALTER TABLE access_grants ADD CONSTRAINT access_grants_source_check
  CHECK (source IN ('purchase','plan','manual','automation','bundle','affiliate','import'));

INSERT INTO plan_products (plan_id, product_id, sort)
SELECT pl.id, p.id, 0
  FROM plans pl
  JOIN products p ON p.kind = 'community' AND p.community_id = pl.community_id
 WHERE pl.community_id IS NOT NULL
ON CONFLICT (plan_id, product_id) DO NOTHING;
