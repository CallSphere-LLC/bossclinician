-- =============================================================================
-- QA sheet rows 113-116 (19 Oct).
--
-- Row 114: Rosa M.'s home-page testimonial gets the headshot Yvette supplied
-- (frontend/public/images/about/testimonial-rosa-m.jpg).
-- Row 108 follow-up: Ashley B.'s photo was corrected in the code fallback on
-- 19 Oct, but the live testimonials row still pointed at the mislabelled
-- import (a different person), so the home page kept showing it.
-- Row 116: "Profitable Private Practices: Training For Clinically-Aligned
-- Private Practices" (course 53, the 52 imported Kajabi lessons) joins the
-- public /courses catalogue. Its stub description is replaced with the Kajabi
-- checkout copy, and its course page sells it through the already-published
-- offer `profitable-private-practices-ceu` ($149).
--
-- Idempotent and owner-safe: each statement only fires while the row still
-- holds the value being replaced, so later edits in Admin are never undone.
-- =============================================================================
UPDATE testimonials
   SET image = '/images/about/testimonial-rosa-m.jpg', updated_at = now()
 WHERE name = 'Rosa M.' AND COALESCE(image, '') = '';

UPDATE testimonials
   SET image = '/images/about/testimonial-ashley-b.jpg', updated_at = now()
 WHERE name = 'Ashley B.' AND image = '/images/e342b1098928.jpeg';

UPDATE courses
   SET subtitle = 'On-demand CE training with Yvette Howard, LCSW · 4 CE hours',
       description = $copy$Launching a private practice can be both liberating and overwhelming for mental health professionals. While graduate school prepares us to serve clients, it often leaves gaps in the business and ethical side of building a sustainable practice.

This comprehensive training bridges that gap. We'll cover the essential components of establishing a legally sound, ethically responsible, and clinically-aligned private practice. From deciding between practice models and setting session fees, to building your brand and streamlining your systems, you'll walk away with clarity and a practical roadmap.

Through a downloadable template and real-life examples, you'll learn how to build a business that supports both your clients' needs and your professional sustainability. This course is ideal for clinicians who want to start private practice the right way, without compromising care, access, or ethical integrity.

CE hours included: 4 core hours
Format: on-demand training. Watch at your own pace, and pause, rewind, and revisit the material anytime.
Instruction level: intermediate
Presented by: Yvette Howard, LCSW
For: licensed mental health professionals, including social workers, counselors, marriage & family therapists, psychologists, pre-licensed therapists, and other behavioral health providers.

Boss Clinician, LLC is an NBCC Approved Continuing Education Provider, ACEP No. 7998.$copy$,
       features = '[
         "Identify the legal, ethical, and financial components necessary to launch a private mental health practice",
         "Design a comprehensive business plan that includes niche definition, branding, pricing, and administrative systems",
         "Formulate marketing, client onboarding, and retention strategies to attract and serve your ideal clientele",
         "Explain the implications of insurance credentialing, private pay models, and documentation best practices"
       ]'::jsonb,
       sort = 31,
       published = true,
       updated_at = now()
 WHERE slug = 'profitable-private-practices-training'
   AND published = false
   AND description LIKE 'The program title under which NBCC approved%';

UPDATE products
   SET thumbnail_url = '/uploads/c3b5e6782a698bbe.jpeg', updated_at = now()
 WHERE slug = 'profitable-private-practices-training' AND thumbnail_url = '';
