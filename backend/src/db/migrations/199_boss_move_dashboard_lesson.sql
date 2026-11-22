-- =============================================================================
-- 199 — The Boss Move Dashboard gets its own lesson (QA sheet row 238, 21 Nov 2026)
--
-- Yvette's doc "Developer Update: Income Planning & Cash Reserve Improvements",
-- additional requirement: "move the existing Boss Move Exit Dashboard out of
-- Lesson 0 and place it in a new, separate lesson immediately after Lesson 0.
-- New lesson number: 0.1. Exact lesson title: The Boss Move Dashboard."
-- Released live straight away (Sagar, 21 Nov).
--
-- Course 'The Boss Move' → MOD 01 (Kajabi module 2160590410):
--   sort 2  🗓️ Lesson 0: Planning Your Exit Timeline      (kajabi 2186555818) — keeps its title, video and text, loses the embedded dashboard
--   sort 3  🗓️ Lesson 0.1: The Boss Move Dashboard        (NEW, published, tool_key boss-move-exit-planner)
--   sort 4+ every later lesson, shifted down by one
--
-- Title: the doc's exact words, prefixed the way every lesson in this course is
-- numbered ("🗓️ Lesson 0: …", "💰 Lesson 3.1: Pricing Strategy").
--
-- Saved member data: member_tool_state is keyed by (member_id, tool_key), not by
-- lesson, so moving tool_key 'boss-move-exit-planner' from lesson 0 to the new
-- lesson leaves every member's saved planner where it is and the dashboard loads
-- it unchanged. Access (services/toolState.ts mayUseTool) follows the published
-- lesson that now carries the key: same course, same grants.
--
-- watch_rule 'skippable': lesson "✨ Know Yourself Before You Boss Up" (the next
-- lesson) is "locked in order". Without this, members who already finished
-- Lesson 0 and moved on would find that lesson locked until they ticked the new
-- one, and their course percentage would drop. A skippable lesson holds nothing
-- up and only counts once completed (services/curriculum.ts).
--
-- Idempotent: the shift and the insert run together only while the new lesson
-- does not exist; the Lesson 0 update only fires while it still carries the key
-- and the new lesson is in place. Keyed on Kajabi ids and slugs, never serial ids.
-- =============================================================================

-- 1. Insert the new lesson straight after Lesson 0, making room below it.
WITH anchor AS (
  SELECT l.module_id, l.sort
    FROM course_lessons l
    JOIN course_modules m ON m.id = l.module_id
   WHERE l.kajabi_id = '2186555818'
     AND m.kajabi_id = '2160590410'
     AND NOT EXISTS (
       SELECT 1 FROM course_lessons n
        WHERE n.module_id = l.module_id AND n.slug = 'the-boss-move-dashboard'
     )
), shifted AS (
  UPDATE course_lessons c
     SET sort = c.sort + 1, updated_at = now()
    FROM anchor
   WHERE c.module_id = anchor.module_id
     AND c.sort > anchor.sort
  RETURNING c.id
)
INSERT INTO course_lessons
  (module_id, title, slug, body_md, content_type, published, sort, tool_key,
   requires_previous_lesson, watch_rule, comments_enabled, notes_enabled)
SELECT anchor.module_id,
       '🗓️ Lesson 0.1: The Boss Move Dashboard',
       'the-boss-move-dashboard',
       $md$Plan your transition with your Boss Move Dashboard. Work through **My Freedom Number**, **My Ideal Work Schedule**, **My Revenue Roadmap**, **My Cash Reserve Plan** and **My Exit Readiness Snapshot**, then print or download your personal summary.

Everything you enter saves to your account automatically, and you can come back and update it any time. All figures are pretax planning estimates: they are not take-home pay, a guarantee of income, or a recommendation to resign.$md$,
       'text',
       true,
       anchor.sort + 1,
       'boss-move-exit-planner',
       false,
       'skippable',
       true,
       true
  FROM anchor;
-- (A data-modifying CTE always runs, so shifted runs exactly when anchor has a row.)

-- 2. Lesson 0 keeps its title, video and intro, without the embedded dashboard,
--    and its task now points to the new lesson instead of "below".
UPDATE course_lessons l
   SET tool_key = NULL,
       body_md = replace(
         l.body_md,
         'Use the **“Exit Timeline Workbook below”** to set',
         'Use **The Boss Move Dashboard** in the next lesson (Lesson 0.1) to set'
       ),
       updated_at = now()
 WHERE l.kajabi_id = '2186555818'
   AND l.tool_key = 'boss-move-exit-planner'
   AND EXISTS (
     SELECT 1 FROM course_lessons n
      WHERE n.module_id = l.module_id
        AND n.slug = 'the-boss-move-dashboard'
        AND n.published
        AND n.tool_key = 'boss-move-exit-planner'
   );
