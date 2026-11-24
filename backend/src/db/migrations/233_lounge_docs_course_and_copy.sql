-- =============================================================================
-- 233: sheet row 253 (doc "Remaining Website Updates", 23 Nov 2026), engineer A.
--
-- Item 4. Yvette confirms The Do's & Don'ts of Clinical Documentation is NOT
-- included in The Lounge (Audit Proof Your Practice is). On the live site the
-- course page listed four Lounge membership buttons in its enrollment block
-- (/checkout/the-lounge?option=10/37/43/44). Those come from
-- services/courseOffers.ts, which lists every published offer whose
-- offer_products row grants a product of this course. No migration created that
-- link, so it was made in the admin; it also meant buying The Lounge granted
-- this course. Remove the link for the Lounge offers only. The standalone $99
-- offer (dos-and-donts-of-clinical-documentation-replay-free) is untouched.
-- Existing enrollments are NOT revoked here (owner decision).
--
-- Item 2. The Lounge checkout summary (offers.description from 081) still says
-- "fully booked"; replace those two sentences only where still present.
--
-- Idempotent: guarded deletes / replace() only where the old text remains.
-- =============================================================================

DELETE FROM offer_products op
 USING offers o, products p, courses c
 WHERE op.offer_id = o.id
   AND op.product_id = p.id
   AND c.id = COALESCE(p.course_id, p.legacy_course_id)
   AND c.slug = 'dos-and-donts-of-clinical-documentation-replay'
   AND o.slug IN ('the-lounge', 'the-lounge-vip', 'lounge-billing-preview');

UPDATE offers SET description = replace(description,
         $q$The membership where fully booked clinicians restructure the practice they built: rates, income sources, systems, and sustainability.$q$,
         $q$A structured membership for clinicians who already own a practice and want more consistent income, stronger referral systems, and a workload they can sustain. You do not need a full caseload to join.$q$),
       updated_at = now()
 WHERE slug = 'the-lounge'
   AND strpos(description, $q$The membership where fully booked clinicians restructure the practice they built: rates, income sources, systems, and sustainability.$q$) > 0;

UPDATE offers SET description = replace(description,
         $q$Your growth circle of clinicians who understand exactly what it means to be fully booked and still underpaid.$q$,
         $q$Your growth circle of practice owners working toward steadier income and a workload they can sustain.$q$),
       updated_at = now()
 WHERE slug = 'the-lounge'
   AND strpos(description, $q$Your growth circle of clinicians who understand exactly what it means to be fully booked and still underpaid.$q$) > 0;
