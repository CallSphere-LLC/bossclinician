-- Yvette's decisions of 30 Oct 2026 (Q2, Q16, Q18, Q19). Every statement is
-- idempotent and sends nothing: no email, no enrolment, no change to who has what.

-- Q2: a Lounge or VIP purchase paid in full lasts 12 months. That is the offer's
-- own price; the monthly way to pay is an offer_pricing_options row, and
-- grantOfferAccess leaves a recurring option out of this setting (services/access.ts).
-- Applies from the next purchase: access_grants is not touched here, and a
-- re-grant never shortens a grant that has no end date.
UPDATE offers
   SET access_expires_after_days = 365,
       updated_at = now()
 WHERE slug IN ('the-lounge', 'the-lounge-vip')
   AND pricing_type = 'one_time'
   AND access_expires_after_days IS NULL;

-- Q16: the Boss Move welcome videos do not count toward CE. Video lessons in that
-- module only: its reading, its planner and every other module keep counting.
-- 'inherit' only, so a later choice by the owner is never overwritten. The intake
-- form on the first of these stays on that lesson, unchanged (migration 169).
UPDATE course_lessons l
   SET watch_rule = 'skippable',
       updated_at = now()
  FROM course_modules m
 WHERE m.id = l.module_id
   AND m.id = 86
   AND m.course_id = 52
   AND m.title LIKE '%Welcome: Start Here'
   AND l.content_type = 'video'
   AND COALESCE(l.video_url, '') <> ''
   AND l.watch_rule = 'inherit';

-- Q18: the Business Plan Guide is off the site. Unpublished, not deleted: the
-- public form route only loads published forms, and stored submissions stay.
UPDATE forms
   SET published = false,
       updated_at = now()
 WHERE slug = 'business-plan-guide'
   AND published;

-- Q19: new members see the Terms at checkout. An offer that already names its own
-- terms keeps them (the CE offer's /ceu-terms-boss-clinician). Free offers are left
-- out; none is published today.
UPDATE offers
   SET require_terms = true,
       terms_url = CASE WHEN terms_url = '' THEN '/terms' ELSE terms_url END,
       updated_at = now()
 WHERE status = 'published'
   AND pricing_type <> 'free'
   AND (NOT require_terms OR terms_url = '');
