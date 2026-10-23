-- QA sheet rows 158 and 159 (23 Oct), The Practice Elevation → module
-- "ORIENTATION Start Here" (kajabi_id 2160597684).
--
-- Row 158: "add this [Snapshot zip] as a lesson labeled 'the practice reset
-- snapshot' … above the practice elevation dashboard". The module already has
-- the owner's lesson "Take the Practice Reset Snapshot | Your Starting Point"
-- (slug private-practice-snapshot) directly above the dashboard, carrying her
-- written instructions for the assessment and no tool. It is reused rather than
-- duplicated: retitled, given the new tool 'practice-reset-snapshot-v2'
-- (components/lesson-tools/PracticeResetSnapshotV2.tsx), and the bare "TAKE THE
-- PRACTICE RESET SNAPSHOT HERE" line — a link on Kajabi — now points at the tool
-- under the text. Keeping the row keeps its slug, progress, notes and comments.
--
-- Row 159: "add this [Living Business Plan zip] as a lesson … labeled 'meet your
-- business live plan' below the practice elevation dashboard". A new lesson with
-- tool 'living-business-plan' (LivingBusinessPlan.tsx) directly after the
-- dashboard lesson; the lessons after it move down one place.
--
-- Both lessons are published: the tool-state endpoint only loads and saves a
-- tool that sits on a published lesson the member can open (services/toolState.ts
-- mayUseTool). Keyed on slugs, never serial ids; on a database without the
-- owner's course every statement matches nothing. Re-running changes nothing.

-- --- Row 158 ---------------------------------------------------------------
UPDATE course_lessons l
   SET title = 'The Practice Reset Snapshot',
       tool_key = 'practice-reset-snapshot-v2',
       body_md = replace(
         l.body_md,
         'TAKE THE PRACTICE RESET SNAPSHOT HERE',
         '**TAKE THE PRACTICE RESET SNAPSHOT BELOW.** Your answers save privately to your account, and your results open your recommended module and lesson.'
       ),
       published = true,
       updated_at = now()
  FROM course_modules m
  JOIN courses c ON c.id = m.course_id
 WHERE l.module_id = m.id
   AND c.slug = 'the-practice-elevation'
   AND m.kajabi_id = '2160597684'
   AND l.slug = 'private-practice-snapshot'
   AND l.tool_key IS DISTINCT FROM 'practice-reset-snapshot-v2';

-- --- Row 159 ---------------------------------------------------------------
-- 1. Make room directly under the dashboard (only while the new lesson is absent).
UPDATE course_lessons l
   SET sort = l.sort + 1, updated_at = now()
  FROM course_lessons dash
  JOIN course_modules m ON m.id = dash.module_id
  JOIN courses c ON c.id = m.course_id
 WHERE c.slug = 'the-practice-elevation'
   AND m.kajabi_id = '2160597684'
   AND dash.slug = 'my-practice-elevation-dashboard'
   AND l.module_id = m.id
   AND l.sort > dash.sort
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons x WHERE x.module_id = m.id AND x.slug = 'meet-your-business-live-plan'
   );

-- 2. The lesson itself, at the dashboard's sort + 1. No written body: the tool's
--    own Overview tab carries the owner's introduction; she can add lesson text
--    in Admin → Courses.
INSERT INTO course_lessons (module_id, title, slug, body_md, content_type, published, sort, tool_key)
SELECT m.id,
       'Meet Your Business Live Plan',
       'meet-your-business-live-plan',
       '',
       'text',
       true,
       dash.sort + 1,
       'living-business-plan'
  FROM course_lessons dash
  JOIN course_modules m ON m.id = dash.module_id
  JOIN courses c ON c.id = m.course_id
 WHERE c.slug = 'the-practice-elevation'
   AND m.kajabi_id = '2160597684'
   AND dash.slug = 'my-practice-elevation-dashboard'
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons x WHERE x.module_id = m.id AND x.slug = 'meet-your-business-live-plan'
   );
