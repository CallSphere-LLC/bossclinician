-- Download delivery remains attached to the original product ID. These fields
-- add buyer instructions and retain legacy public course sales-page references.
ALTER TABLE products ADD COLUMN IF NOT EXISTS instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS legacy_course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS product_type_migration_audit (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  before_kind TEXT NOT NULL,
  after_kind TEXT NOT NULL,
  evidence TEXT NOT NULL,
  offer_ids JSONB NOT NULL,
  grant_ids JSONB NOT NULL,
  converted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exact titles explicitly identified as Downloads in the account owner's
-- read-only Kajabi audit. Do not infer types from price, title keywords, or
-- empty lesson counts. "Prepare to Profit Journal" needs a confirmed match.
INSERT INTO product_type_migration_audit (product_id, course_id, title, before_kind, after_kind, evidence, offer_ids, grant_ids)
SELECT p.id, p.course_id, p.title, p.kind, 'download',
       'Account owner supplied Kajabi site 2148299891 Products list, 2026-09-12',
       COALESCE((SELECT jsonb_agg(op.offer_id ORDER BY op.offer_id) FROM offer_products op WHERE op.product_id=p.id), '[]'::jsonb),
       COALESCE((SELECT jsonb_agg(g.id ORDER BY g.id) FROM access_grants g WHERE g.product_id=p.id), '[]'::jsonb)
FROM products p
WHERE p.kind='course' AND p.course_id IS NOT NULL
  AND lower(trim(p.title)) IN (
    'fully booked toolkit', 'provider partnership guide',
    'marketing mastery for therapists', 'therapist niche clarity accelerator',
    'client consultation call script', 'from profile to profit')
  AND NOT EXISTS (SELECT 1 FROM course_modules m JOIN course_lessons l ON l.module_id=m.id WHERE m.course_id=p.course_id)
ON CONFLICT (product_id) DO NOTHING;

UPDATE products p SET kind='download', legacy_course_id=p.course_id,
       course_id=NULL, updated_at=now()
FROM product_type_migration_audit a
WHERE a.product_id=p.id AND p.kind='course' AND p.course_id=a.course_id;
