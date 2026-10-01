-- Localize every Kajabi link left in DB content, 2026-10-01.
--
-- Owner's rule: nothing on this site links or redirects to bossclinician.com
-- (the Kajabi site) or depends on a Kajabi-hosted asset. A read-only scan of
-- every text/varchar/json/jsonb column in `public` for bossclinician.com,
-- mykajabi.com, kajabi-cdn.com, kajabi-storefronts and app.kajabi.com found
-- links in three places only (everything else was an email address such as
-- support@bossclinician.com, which stays):
--
--   courses.url        12 rows  www.bossclinician.com/resource_redirect/...
--   course_lessons     8 lessons, 10 distinct link targets
--   blog_posts         2 posts, the visible text of the Protect-Your-Practice
--                      link (093 already made its target site-relative)
--
-- No column holds a Kajabi-hosted file: the lesson images the course import
-- found were already copied into the uploads volume (/uploads/kajabi-*.png).
-- Offers, forms, email templates/sequences/broadcasts, automations, settings,
-- community, coaching, podcasts, pages, funnels and redirects.to_path are clean.
--
-- Old path -> new path comes from the `redirects` table where it has a row;
-- the rest are mapped by hand (see each block). Web content uses site-relative
-- links. No email body carried a Kajabi link, so nothing here needs the
-- absolute https://bossclinician.callsphere.site form.
--
-- Idempotent: every statement is a replace() of an exact old URL, guarded on
-- the old URL still being present, so a second run changes nothing.

-- ── courses.url ─────────────────────────────────────────────────────────────
-- Each Kajabi resource_redirect resolves (redirects table) to the course's own
-- page on this site.
UPDATE courses SET url = v.to_path, updated_at = now()
  FROM (VALUES
    ('https://www.bossclinician.com/resource_redirect/landing_pages/2150414734', '/courses/fully-booked-toolkit'),
    ('https://www.bossclinician.com/resource_redirect/landing_pages/2151054099', '/courses/private-practice-starter-suite'),
    ('https://www.bossclinician.com/resource_redirect/landing_pages/2150427089', '/courses/from-profile-to-profit'),
    ('https://www.bossclinician.com/resource_redirect/offers/Jgx2ULVA',         '/courses/marketing-mastery-for-therapists'),
    ('https://www.bossclinician.com/resource_redirect/landing_pages/2151104751', '/courses/ramp-up-rate-formula'),
    ('https://www.bossclinician.com/resource_redirect/landing_pages/2151230875', '/courses/provider-partnership-guide'),
    ('https://www.bossclinician.com/resource_redirect/landing_pages/2151750533', '/courses/directory-makeover-audit'),
    ('https://www.bossclinician.com/resource_redirect/offers/wMz5RNgn',         '/courses/therapist-niche-clarity-accelerator'),
    ('https://www.bossclinician.com/resource_redirect/offers/7n6FFEe2',         '/courses/rate-negotiation-letter-template'),
    ('https://www.bossclinician.com/resource_redirect/offers/JfvDGdjF',         '/courses/prepare-to-profit-journal'),
    ('https://www.bossclinician.com/resource_redirect/offers/Yhc3aisz',         '/courses/client-consultation-call-script'),
    ('https://www.bossclinician.com/resource_redirect/landing_pages/2151230877', '/courses/private-practice-protection-pack')
  ) AS v(from_url, to_path)
 WHERE courses.url = v.from_url;

-- ── course_lessons.body_md ──────────────────────────────────────────────────
--   /boss-clinician-club      -> /club   (Kajabi's old Club sales page; no
--                                         redirects row, /club is the page)
--   /fullybooked              -> /courses/fully-booked-toolkit   (redirects)
--   /practice-reset-snapshot  -> /practice-reset-snapshot (built on this site)
--   /products/profitable-private-practice-program/categories/2156724841
--        "Click here to use the Ramp-Up rate calculator" -> the calculator
--        lesson of the same course here (ramp-up-rate-formula, lesson
--        calculator-ramp-up-rate-calculator)
--   /products/communities/{bosscliniciancommunity, v2/starterleapcommunity,
--        v2/leapcommunity}/home -> /community, the member's communities on
--        this site (Kajabi's three communities do not map one-to-one onto the
--        communities here, and /community lists the ones the member can open)
-- An UPDATE ... FROM applies at most one VALUES row per target row, and four
-- lessons (47, 133, 134, 252) hold two different old URLs, so this repeats
-- until no lesson body holds any of them. Bounded: each pass removes at least
-- one URL from every row it touches.
DO $$
DECLARE n integer;
BEGIN
  FOR i IN 1..10 LOOP
    UPDATE course_lessons SET body_md = replace(body_md, v.from_url, v.to_path), updated_at = now()
      FROM (VALUES
        ('https://www.bossclinician.com/boss-clinician-club',                                    '/club'),
        ('https://www.bossclinician.com/fullybooked',                                            '/courses/fully-booked-toolkit'),
        ('https://www.bossclinician.com/practice-reset-snapshot',                                '/practice-reset-snapshot'),
        ('https://www.bossclinician.com/products/profitable-private-practice-program/categories/2156724841',
                                                                                                 '/library/ramp-up-rate-formula/lessons/calculator-ramp-up-rate-calculator'),
        ('https://www.bossclinician.com/products/communities/bosscliniciancommunity/home',       '/community'),
        ('https://www.bossclinician.com/products/communities/v2/starterleapcommunity/home',      '/community'),
        ('https://www.bossclinician.com/products/communities/v2/leapcommunity/home?sidebar=true', '/community')
      ) AS v(from_url, to_path)
     WHERE position(v.from_url IN course_lessons.body_md) > 0;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
  END LOOP;
END $$;

-- ── blog_posts.body_md ──────────────────────────────────────────────────────
-- 093 already pointed these at /Protect-Your-Practice but kept the Kajabi URL
-- as the visible link text. The redirects table sends /protect-your-practice
-- to /courses/private-practice-protection-pack, so link there directly and
-- give the link a readable label.
UPDATE blog_posts
   SET body_md = replace(body_md,
         '[https://www.bossclinician.com/Protect-Your-Practice](/Protect-Your-Practice)',
         '[Protect Your Practice](/courses/private-practice-protection-pack)'),
       updated_at = now()
 WHERE position('[https://www.bossclinician.com/Protect-Your-Practice](/Protect-Your-Practice)' IN body_md) > 0;
