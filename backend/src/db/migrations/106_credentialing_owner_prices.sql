-- 106: the two credentialing courses go back to the owner's prices.
--
-- Owner's request, re-sent 2026-10-01 after 103 had run: Credential with
-- Confidence is $127 and the Credentialing Success Formula is $247, on the
-- course page and the sales page. 073 had set exactly these on 2026-09-20; 103
-- then applied its general rule ("the price is what Kajabi's live checkout
-- charges") and took them back to $27 and $17.
--
-- This request names the two products and their figures, so it supersedes 103
-- for these two slugs. They are a deliberate exception to the Kajabi-checkout
-- rule: Kajabi still charges $27 (uGqHXnvS) and $17 (bhkvLZTX), and a later
-- price sync must not "correct" these rows back to that.
--
-- offers.amount_cents is what checkout charges and what both sales pages quote;
-- courses.price_text is the catalogue label. They move together (see 072).
-- Stripe price ids are cleared so checkout mints fresh ones, as 103 does.
-- Idempotent: every statement is guarded on the value it replaces.
UPDATE offers SET amount_cents = 12700, stripe_price_id = NULL, updated_at = now()
 WHERE slug = 'credential-with-confidence' AND pricing_type = 'one_time' AND amount_cents = 2700;
UPDATE offers SET amount_cents = 24700, stripe_price_id = NULL, updated_at = now()
 WHERE slug = 'credentialing-success-formula' AND pricing_type = 'one_time' AND amount_cents = 1700;

UPDATE courses SET price_text = '$127', updated_at = now()
 WHERE slug = 'credential-with-confidence' AND price_text = '$27';
UPDATE courses SET price_text = '$247', updated_at = now()
 WHERE slug = 'credentialing-success-formula' AND price_text = '$17';
