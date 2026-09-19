-- Verified public sale prices, read from the original sales pages on 2026-09-19.
-- Missing prices remain unset. Delivery readiness is checked before checkout.
WITH verified(slug, cents) AS (VALUES
 ('fully-booked-toolkit',6700), -- /fullybooked
 ('credentialing-success-formula',1700), -- /csfgrouppractices
 ('private-practice-starter-suite',2700), -- /startersuitecourse
 ('ramp-up-rate-formula',9700), -- /rampedrevenue
 ('provider-partnership-guide',9700), -- /Turn-Doctor-Referrals-Into-Ideal-Client
 ('private-practice-protection-pack',9700), -- /Practice-Protection-Pack
 ('from-profile-to-profit',9700) -- /profiletoprofitguide (pay in full)
)
INSERT INTO offers (slug,title,description,thumbnail_url,status,pricing_type,amount_cents,currency,require_terms,terms_url)
SELECT c.slug,c.title,c.description,c.image,'published','one_time',v.cents,'usd',true,'/terms'
FROM verified v JOIN courses c ON c.slug=v.slug
ON CONFLICT(slug) DO NOTHING;

INSERT INTO offer_products (offer_id,product_id)
SELECT o.id,p.id FROM offers o JOIN courses c ON c.slug=o.slug
JOIN products p ON COALESCE(p.course_id,p.legacy_course_id)=c.id
WHERE o.slug IN ('fully-booked-toolkit','credentialing-success-formula','private-practice-starter-suite',
 'ramp-up-rate-formula','provider-partnership-guide','private-practice-protection-pack','from-profile-to-profit')
ON CONFLICT DO NOTHING;
