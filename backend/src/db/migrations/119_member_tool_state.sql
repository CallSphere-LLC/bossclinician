-- Interactive lesson dashboards with per-member saving (QA sheet 2026-10-17,
-- rows 95, 101, 102, 103).
--
-- 1. member_tool_state: what a member has typed into a lesson tool — the Boss
--    Move Exit Planner, the Practice Elevation dashboard, the Boardroom CEO
--    dashboard, the Practice Reset Snapshot. The prototypes kept this in the
--    browser's localStorage; here it follows the account across devices. One
--    row per member per tool: a tool_key can sit on more than one lesson and
--    is the same planner wherever it appears. Read and written only through
--    /api/member/tool-state/:toolKey, which checks the member may open a
--    published lesson carrying that key (services/toolState.ts).
--
-- 2. The tools attached to their lessons. Matched on Kajabi ids and slugs,
--    never on serial ids, so this is the same on every database.

CREATE TABLE IF NOT EXISTS member_tool_state (
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tool_key   TEXT NOT NULL CHECK (tool_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  state      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, tool_key)
);

-- --- Row 102: The Boss Move → MOD 01 → "🗓️ Lesson 0: Planning Your Exit Timeline"
UPDATE course_lessons
   SET tool_key = 'boss-move-exit-planner', updated_at = now()
 WHERE kajabi_id = '2186555818'
   AND tool_key IS DISTINCT FROM 'boss-move-exit-planner';

-- --- Row 101: The Practice Elevation → ORIENTATION Start Here →
--     "Take the Practice Reset Snapshot | Your Starting Point".
-- The snapshot now runs inside the lesson, so the link out to the public page
-- becomes a pointer to the tool underneath.
UPDATE course_lessons
   SET tool_key = 'practice-reset-snapshot',
       body_md = replace(
         body_md,
         '**[TAKE THE PRACTICE RESET SNAPSHOT HERE](/practice-reset-snapshot)**',
         '**Take the Practice Reset Snapshot below.** Your answers save to your account, and your results set the suggested pathway in your Practice Elevation Dashboard (the next lesson).'
       ),
       updated_at = now()
 WHERE kajabi_id = '2199615930'
   AND tool_key IS DISTINCT FROM 'practice-reset-snapshot';

-- --- Row 103: The Practice Elevation → ORIENTATION Start Here → new lesson
--     "My Practice Elevation Dashboard", straight after the snapshot.
INSERT INTO course_lessons (module_id, title, slug, body_md, content_type, published, sort, tool_key)
SELECT m.id,
       'My Practice Elevation Dashboard',
       'my-practice-elevation-dashboard',
       $md$**OBJECTIVE**

*Turn your Practice Reset Snapshot into one clear priority, three outcomes and a four-week action plan, then review and elevate every 30 days.*

**HOW TO USE YOUR DASHBOARD**

- **Overview:** your current focus, progress and recommended next move.
- **Practice Reset Snapshot:** if you took it in the previous lesson, your answers are already here. Generate your personalized 30-day plan from them.
- **My 30-Day Plan:** edit your three outcomes and mark each weekly task Not started, In progress, Completed or Blocked.
- **Numbers & Goals:** your baseline and 30-day targets for collections, sessions, admin time and owner pay.
- **Monthly Review:** close the cycle and start your next 30 days. Past cycles stay in your Growth History.

Everything you enter saves to your account automatically. Do not enter client-identifying health information.$md$,
       'text',
       true,
       5,
       'practice-elevation-dashboard'
  FROM course_modules m
  JOIN courses c ON c.id = m.course_id
 WHERE c.slug = 'the-practice-elevation'
   AND m.kajabi_id = '2160597684'
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons l
      WHERE l.module_id = m.id AND l.slug = 'my-practice-elevation-dashboard'
   );

-- --- Row 95: The Boss Boardroom → new module + lesson "Boardroom CEO Dashboard".
-- The course had no modules yet. Keyed on the course slug + module title.
INSERT INTO course_modules (course_id, title, summary, sort)
SELECT c.id, 'Boardroom CEO Dashboard', 'Your CEO decision dashboard: capacity, team pay, hiring, owner pay, cash, benefits and scenarios.', 0
  FROM courses c
 WHERE c.slug = 'the-boss-boardroom'
   AND NOT EXISTS (
     SELECT 1 FROM course_modules m WHERE m.course_id = c.id AND m.title = 'Boardroom CEO Dashboard'
   );

INSERT INTO course_lessons (module_id, title, slug, body_md, content_type, published, sort, tool_key)
SELECT m.id,
       'Boardroom CEO Dashboard',
       'boardroom-ceo-dashboard',
       $md$Start with your current monthly financial picture in **CEO Snapshot**, then work through each tab. Every result shows "—" until you enter the numbers it needs, and the **CEO Report** tab gathers everything you entered into one decision-prep summary you can print or download.

Your entries save to your account automatically. Strategic planning only: results do not replace accounting, tax, payroll, HR, legal, or financial advice.$md$,
       'text',
       true,
       0,
       'boardroom-ceo-dashboard'
  FROM course_modules m
  JOIN courses c ON c.id = m.course_id
 WHERE c.slug = 'the-boss-boardroom'
   AND m.title = 'Boardroom CEO Dashboard'
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons l WHERE l.module_id = m.id AND l.slug = 'boardroom-ceo-dashboard'
   );
