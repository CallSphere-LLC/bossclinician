-- Prices supplied by the owner on 2026-09-19. These replace unverified prices;
-- checkout still requires real deliverable materials.
WITH approved(slug,cents,price_text,headline,offer_status) AS (VALUES
 ('directory-makeover-audit',6700,'1 profile: $67 · 2 profiles: $97 · 3 profiles: $147','One profile','draft'),
 ('credential-with-confidence',4700,'$47','One-time payment','published'),
 ('marketing-mastery-for-therapists',6700,'$67 (regular price $147)','Regular price $147. Pay $67.','published'),
 ('therapist-niche-clarity-accelerator',4700,'$47','One-time payment','published'),
 ('rate-negotiation-letter-template',700,'$7','One-time payment','published'),
 ('prepare-to-profit-journal',1700,'$17','One-time payment','published'),
 ('client-consultation-call-script',3700,'$37','Pay in full','published')
), updated_courses AS (
 UPDATE courses c SET price_text=a.price_text,updated_at=now()
 FROM approved a WHERE c.slug=a.slug RETURNING c.*
)
INSERT INTO offers (slug,title,description,thumbnail_url,status,pricing_type,amount_cents,currency,require_terms,terms_url,checkout_headline)
SELECT c.slug,c.title,c.description,c.image,a.offer_status,'one_time',a.cents,'usd',true,'/terms',a.headline
FROM approved a JOIN updated_courses c ON c.slug=a.slug
ON CONFLICT(slug) DO UPDATE SET amount_cents=EXCLUDED.amount_cents,currency='usd',
 checkout_headline=EXCLUDED.checkout_headline,updated_at=now();

INSERT INTO offer_products (offer_id,product_id)
SELECT o.id,p.id FROM offers o JOIN courses c ON c.slug=o.slug
JOIN products p ON COALESCE(p.course_id,p.legacy_course_id)=c.id
WHERE o.slug IN ('directory-makeover-audit','credential-with-confidence','marketing-mastery-for-therapists',
 'therapist-niche-clarity-accelerator','rate-negotiation-letter-template','prepare-to-profit-journal','client-consultation-call-script')
ON CONFLICT DO NOTHING;

-- The audit currently has only a pre-existing test lesson, not its fulfillment
-- workflow. Keep its offer draft while displaying the approved public prices.
INSERT INTO offer_pricing_options (offer_id,label,pricing_type,amount_cents,currency,sort)
SELECT o.id,v.label,'one_time',v.cents,'usd',v.sort
FROM offers o CROSS JOIN (VALUES ('Two profiles',9700,1),('Three profiles',14700,2)) v(label,cents,sort)
WHERE o.slug='directory-makeover-audit'
 AND NOT EXISTS(SELECT 1 FROM offer_pricing_options p WHERE p.offer_id=o.id AND p.label=v.label);
