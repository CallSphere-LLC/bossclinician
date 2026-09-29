-- =============================================================================
-- Courses: Kajabi parity, from bug sheet rows R37 and R38 (2026-09-29).
--
-- R37 "in courses, the courses are also not matching" and R38 "the content in
-- each course is also not matching". The Kajabi admin was not reachable, so
-- everything below comes from two sources only: the Kajabi contacts export
-- (its Products column names every Kajabi product a contact holds) and the
-- public bossclinician.com pages (all-courses, /club,
-- /profitable-private-practice-leap-accelerator, /startersuitecourse,
-- /credentialsolo) as fetched on 2026-09-29. Nothing is invented: products
-- whose curriculum is only visible behind the Kajabi login get a shell with
-- no modules, and lessons named on a sales page arrive unpublished and empty.
--
-- Every statement is guarded, so this file is a no-op on a fresh database and
-- on a second run, and it never overwrites something edited in the admin.
-- Backup taken before the production run:
-- backups/sheet-parity-20260929/courses-before.sql
-- =============================================================================

-- 1. Test fixtures out of the course list and the curriculum ------------------

-- Product 25 "The Profitable Private Practice Boss Builders Collective" is the
-- draft test fixture recorded in docs/verification/sheet-quinn-ford-20260928.
-- Its only access grants belong to the owner's own test accounts. Archived,
-- not deleted, so those rows and its draft offer keep pointing at something.
UPDATE products
   SET status = 'archived', updated_at = now()
 WHERE slug = 'ppp-collective' AND status = 'draft';

-- Test modules left in two real courses. "test 1" / "Clinician test" sit in
-- Directory Makeover Audit, and "test 1" holds a published lesson ("lesson 1",
-- body "test"), so it was on the public course page and in the admin
-- curriculum. "ZZ Test — Module 1" sits in Practice Reset Intensive. Their only
-- progress, note and comment rows are the owner's test account (member 40).
-- The lesson video is a media-library upload referenced by URL, so it stays in
-- the Media Library.
DELETE FROM course_modules m
 USING courses c
 WHERE c.id = m.course_id
   AND ((c.slug = 'directory-makeover-audit' AND m.title IN ('test 1', 'Clinician test'))
     OR (c.slug = 'practice-reset-intensive' AND m.title = 'ZZ Test — Module 1'));

-- 2. Curriculum named on public sales pages -----------------------------------

-- /credentialsolo names the second video training "The Boss Biller Blueprint".
UPDATE course_lessons l
   SET title = 'The Boss Biller Blueprint', updated_at = now()
  FROM course_modules m, courses c
 WHERE l.module_id = m.id AND m.course_id = c.id
   AND c.slug = 'credential-with-confidence'
   AND l.title = 'Boss Billing Blueprint';

-- /startersuitecourse lists its three video lessons by name. The videos are
-- behind the Kajabi login, so the lessons are unpublished placeholders: members
-- and the public outline see nothing until a video is attached and published.
WITH course AS (
  SELECT c.id FROM courses c
   WHERE c.slug = 'private-practice-starter-suite'
     AND NOT EXISTS (SELECT 1 FROM course_modules m WHERE m.course_id = c.id)
), module AS (
  INSERT INTO course_modules (course_id, title, summary, sort)
  SELECT id, '3 Power-Packed Video Lessons', 'Short, easily digestible, and actionable!', 0
    FROM course
  RETURNING id
)
INSERT INTO course_lessons (module_id, title, slug, content_type, published, sort)
SELECT module.id, v.title, v.slug, 'video', false, v.sort
  FROM module,
       (VALUES ('From Employee to Business Owner',     'from-employee-to-business-owner',    0),
               ('Choosing Your Niche & Business Model', 'choosing-your-niche-business-model', 1),
               ('First 3 Clients Blueprint',            'first-3-clients-blueprint',          2)
       ) AS v(title, slug, sort);

-- 3. Kajabi products with no counterpart here ----------------------------------

-- Shells only: a courses row (unpublished, so no public page or sitemap entry)
-- and its product. No modules: none of the three has a public module list.
INSERT INTO courses (slug, title, subtitle, description, price_text, url, features, sort, published)
SELECT v.slug, v.title, v.subtitle, v.description, v.price_text, '/courses/' || v.slug, v.features::jsonb, v.sort, false
  FROM (VALUES
    ('the-boss-move',
     'The Boss Move',
     '5-module private-practice business curriculum + eligible NBCC CE content',
     'A 5-module program with NBCC-approved CE content that walks you through the core business decisions behind building a strong private practice — foundation, client flow, income, and systems in an order that makes sense.',
     '',
     '["Approved by NBCC under the program title \"Profitable Private Practices: Training for Clinically-Aligned Private Practices\" for 4 clock hours. Boss Clinician, LLC, ACEP No. 7998."]',
     18),
    ('profitable-private-practices-training',
     'Profitable Private Practices: Training For Clinically-Aligned Private Practices',
     'NBCC-approved program · 4 clock hours',
     'The program title under which NBCC approved The Boss Move for 4 clock hours. Boss Clinician, LLC, ACEP No. 7998.',
     '',
     '[]',
     19),
    ('profitable-private-practice-leap-accelerator',
     'Profitable Private Practice Leap Accelerator',
     'Your Roadmap to Freedom, Flexibility, and Financial Stability',
     'The Profitable Private Practice Leap Accelerator helps mental health providers escape burnout and take control of their future—without stress or confusion. This academy provides the step-by-step roadmap to successfully transition from your 9-5 job into a thriving private practice, giving you the freedom, flexibility, and financial stability you deserve.',
     '$997 Pay in Full or 3 Monthly Payments of $357',
     '["Comprehensive Business Training – A step-by-step roadmap guiding you through business setup, pricing, and financial stability.", "Marketing & Client Attraction Strategies – Proven frameworks to bring in ideal clients consistently, without uncertainty.", "Private Community & Support – Surround yourself with a network of like-minded therapists for guidance and accountability.", "Exclusive Resources & Templates – Done-for-you scripts, checklists, and foundational tools to streamline your practice setup.", "Live Coaching & Mentorship – Direct access to expert coaching, ensuring you stay on track with your goals.", "Mindset & Confidence Shifts – Learn how to move past self-doubt and embrace the role of a confident business owner."]',
     20)
  ) AS v(slug, title, subtitle, description, price_text, features, sort)
 WHERE NOT EXISTS (SELECT 1 FROM courses c WHERE c.slug = v.slug);

-- Kajabi lists the Leap Accelerator as archived; the other two are live there
-- but have no content here yet, so they start as drafts.
INSERT INTO products (slug, title, subtitle, description, kind, course_id, status, sort)
SELECT c.slug, c.title, c.subtitle, c.description, 'course', c.id, v.status, c.sort
  FROM (VALUES ('the-boss-move', 'draft'),
               ('profitable-private-practices-training', 'draft'),
               ('profitable-private-practice-leap-accelerator', 'archived')
       ) AS v(slug, status)
  JOIN courses c ON c.slug = v.slug
 WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = v.slug);
