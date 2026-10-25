-- QA Bugs rows 173 and 181. Boardroom reuses the per-member living plan and
-- contains copies of only Practice Elevation's four core module groups.
-- The source has a published orientation and an unpublished challenge outside
-- those groups. Do not grant the entire source product to Boardroom members.
--
-- The target course and dashboard module were set up by migration 147; the
-- source living-plan lesson by migration 152. Source lookups are by slug and
-- Kajabi module id. Copies have prefixed module ids and no Kajabi lesson id,
-- so a later source import cannot overwrite them. This is a one-time copy;
-- later source edits need a deliberate Boardroom update. The migration is
-- idempotent.

-- Row 173: the tool state is keyed by (member, tool_key), so the same member
-- sees their own plan from either course; no other member's plan is shared.
INSERT INTO course_lessons
  (module_id, title, slug, body_md, content_type, published, sort,
   tool_key, tool_config)
SELECT tm.id, sl.title, 'meet-your-business-live-plan',
       COALESCE(NULLIF(sl.body_md, ''),
         'Build and update your private living business plan below. Your entries save to your own account and follow you across devices.'),
       sl.content_type, true,
       (SELECT COALESCE(MAX(existing.sort), 0) + 1
          FROM course_lessons existing WHERE existing.module_id = tm.id),
       sl.tool_key, sl.tool_config
  FROM courses tc
  JOIN course_modules tm ON tm.course_id = tc.id
  JOIN course_lessons dashboard ON dashboard.module_id = tm.id
    AND dashboard.tool_key = 'boardroom-ceo-dashboard'
  JOIN courses sc ON sc.slug = 'the-practice-elevation'
  JOIN course_modules sm ON sm.course_id = sc.id
  JOIN course_lessons sl ON sl.module_id = sm.id
    AND sl.slug = 'meet-your-business-live-plan'
    AND sl.tool_key = 'living-business-plan' AND sl.published
 WHERE tc.slug = 'the-board-room'
   AND tm.title = 'Boardroom CEO Dashboard'
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons l WHERE l.module_id = tm.id
       AND (l.slug = 'meet-your-business-live-plan'
            OR l.tool_key = 'living-business-plan')
   );

-- The four root Kajabi modules and their direct submodules. This excludes
-- orientation (sort 0) and the unrelated caseload challenge (sort 31).
INSERT INTO course_modules
  (course_id, title, summary, sort, drip_days, drip_date,
   kajabi_id, kajabi_parent_id, image_url)
SELECT tc.id, sm.title, sm.summary, 100 + sm.sort, sm.drip_days,
       sm.drip_date, 'boardroom-exec:' || sm.kajabi_id,
       CASE WHEN sm.kajabi_parent_id IS NULL THEN NULL
            ELSE 'boardroom-exec:' || sm.kajabi_parent_id END,
       sm.image_url
  FROM courses sc
  JOIN course_modules sm ON sm.course_id = sc.id
  JOIN courses tc ON tc.slug = 'the-board-room'
 WHERE sc.slug = 'the-practice-elevation'
   AND sm.kajabi_id IS NOT NULL
   AND (
     sm.kajabi_id IN ('2157478356', '2157478357', '2157478358', '2157526875')
     OR sm.kajabi_parent_id IN
       ('2157478356', '2157478357', '2157478358', '2157526875')
   )
   AND NOT EXISTS (
     SELECT 1 FROM course_modules tm
      WHERE tm.course_id = tc.id
        AND tm.kajabi_id = 'boardroom-exec:' || sm.kajabi_id
   );

-- Copy lesson content and media references, but not progress, comments,
-- personal notes, or the globally unique Kajabi lesson id.
INSERT INTO course_lessons
  (module_id, title, slug, body_md, video_url, attachment_url,
   duration_minutes, preview, published, sort, content_type,
   audio_url, embed_html, transcript, captions_url, video_duration_seconds,
   comments_enabled, notes_enabled, drip_days, drip_date, thumbnail_url,
   requires_previous_lesson, tool_key, publish_at, tool_config)
SELECT tm.id, sl.title, sl.slug, sl.body_md, sl.video_url,
       sl.attachment_url, sl.duration_minutes, false, sl.published,
       sl.sort, sl.content_type, sl.audio_url, sl.embed_html, sl.transcript,
       sl.captions_url, sl.video_duration_seconds, sl.comments_enabled,
       sl.notes_enabled, sl.drip_days, sl.drip_date, sl.thumbnail_url,
       sl.requires_previous_lesson, sl.tool_key, sl.publish_at,
       sl.tool_config
  FROM courses sc
  JOIN course_modules sm ON sm.course_id = sc.id
  JOIN course_lessons sl ON sl.module_id = sm.id
  JOIN courses tc ON tc.slug = 'the-board-room'
  JOIN course_modules tm ON tm.course_id = tc.id
    AND tm.kajabi_id = 'boardroom-exec:' || sm.kajabi_id
 WHERE sc.slug = 'the-practice-elevation'
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons tl
      WHERE tl.module_id = tm.id AND tl.slug = sl.slug
   );

-- Protected attachments remain behind the copied Boardroom lesson's normal
-- signed-file permission check; the storage object is reused.
INSERT INTO lesson_files
  (lesson_id, media_id, title, storage_path, filename, mime,
   size_bytes, sort)
SELECT tl.id, sf.media_id, sf.title, sf.storage_path, sf.filename,
       sf.mime, sf.size_bytes, sf.sort
  FROM courses sc
  JOIN course_modules sm ON sm.course_id = sc.id
  JOIN course_lessons sl ON sl.module_id = sm.id
  JOIN lesson_files sf ON sf.lesson_id = sl.id
  JOIN courses tc ON tc.slug = 'the-board-room'
  JOIN course_modules tm ON tm.course_id = tc.id
    AND tm.kajabi_id = 'boardroom-exec:' || sm.kajabi_id
  JOIN course_lessons tl ON tl.module_id = tm.id AND tl.slug = sl.slug
 WHERE sc.slug = 'the-practice-elevation'
   AND NOT EXISTS (
     SELECT 1 FROM lesson_files tf
      WHERE tf.lesson_id = tl.id AND tf.storage_path = sf.storage_path
        AND tf.sort = sf.sort
   );

-- The one source survey in modules 1-4 gets its own assessment id. Responses
-- therefore remain private to the member and course where they were submitted.
INSERT INTO assessments
  (slug, title, intro_md, kind, lesson_id, pass_mark, max_attempts,
   show_feedback, require_email, published, require_pass,
   pass_message, fail_message)
SELECT 'boardroom-exec-' || a.slug, a.title, a.intro_md, a.kind,
       tl.id, a.pass_mark, a.max_attempts, a.show_feedback,
       a.require_email, a.published, a.require_pass, a.pass_message,
       a.fail_message
  FROM courses sc
  JOIN course_modules sm ON sm.course_id = sc.id
  JOIN course_lessons sl ON sl.module_id = sm.id
  JOIN assessments a ON a.lesson_id = sl.id
  JOIN courses tc ON tc.slug = 'the-board-room'
  JOIN course_modules tm ON tm.course_id = tc.id
    AND tm.kajabi_id = 'boardroom-exec:' || sm.kajabi_id
  JOIN course_lessons tl ON tl.module_id = tm.id AND tl.slug = sl.slug
 WHERE sc.slug = 'the-practice-elevation'
   AND NOT EXISTS (
     SELECT 1 FROM assessments ta WHERE ta.lesson_id = tl.id
   );

INSERT INTO assessment_questions
  (assessment_id, position, prompt, help_text, kind, required)
SELECT ta.id, sq.position, sq.prompt, sq.help_text, sq.kind, sq.required
  FROM assessments sa
  JOIN assessment_questions sq ON sq.assessment_id = sa.id
  JOIN course_lessons sl ON sl.id = sa.lesson_id
  JOIN course_modules sm ON sm.id = sl.module_id
  JOIN courses sc ON sc.id = sm.course_id
  JOIN courses tc ON tc.slug = 'the-board-room'
  JOIN course_modules tm ON tm.course_id = tc.id
    AND tm.kajabi_id = 'boardroom-exec:' || sm.kajabi_id
  JOIN course_lessons tl ON tl.module_id = tm.id AND tl.slug = sl.slug
  JOIN assessments ta ON ta.lesson_id = tl.id
    AND ta.slug = 'boardroom-exec-' || sa.slug
 WHERE sc.slug = 'the-practice-elevation'
   AND NOT EXISTS (
     SELECT 1 FROM assessment_questions tq
      WHERE tq.assessment_id = ta.id AND tq.position = sq.position
   );

INSERT INTO assessment_answers
  (question_id, position, label, weight, is_correct, feedback)
SELECT tq.id, ans.position, ans.label, ans.weight, ans.is_correct,
       ans.feedback
  FROM assessments sa
  JOIN assessment_questions sq ON sq.assessment_id = sa.id
  JOIN assessment_answers ans ON ans.question_id = sq.id
  JOIN course_lessons sl ON sl.id = sa.lesson_id
  JOIN course_modules sm ON sm.id = sl.module_id
  JOIN courses sc ON sc.id = sm.course_id
  JOIN courses tc ON tc.slug = 'the-board-room'
  JOIN course_modules tm ON tm.course_id = tc.id
    AND tm.kajabi_id = 'boardroom-exec:' || sm.kajabi_id
  JOIN course_lessons tl ON tl.module_id = tm.id AND tl.slug = sl.slug
  JOIN assessments ta ON ta.lesson_id = tl.id
    AND ta.slug = 'boardroom-exec-' || sa.slug
  JOIN assessment_questions tq ON tq.assessment_id = ta.id
    AND tq.position = sq.position
 WHERE sc.slug = 'the-practice-elevation'
   AND NOT EXISTS (
     SELECT 1 FROM assessment_answers existing
      WHERE existing.question_id = tq.id
        AND existing.position = ans.position
   );

-- Row 181: the index stays inside Boardroom. Its links point to Boardroom's
-- own copies; a manual Boardroom course grant works with no companion grant.
INSERT INTO course_lessons
  (module_id, title, slug, body_md, content_type, published, sort)
SELECT m.id, 'Executive Resources', 'executive-resources',
$body$Your Boardroom course includes the four core Practice Elevation modules. Open a module below, then use the course outline to continue through its lessons, worksheets and resources.

1. [Module 1: Audit what is broken and find your starting point](/library/the-board-room/lessons/welcome-to-module-1)
2. [Module 2: Restructure your rates and income sources](/library/the-board-room/lessons/welcome-to-module-2)
3. [Module 3: Build systems and get out of your own way](/library/the-board-room/lessons/welcome-to-lesson-3)
4. [Module 4: Pay yourself and protect what you built](/library/the-board-room/lessons/welcome-to-module-4)

Your work in the interactive tools and assessments is saved to your own account.$body$,
       'text', true,
       (SELECT COALESCE(MAX(existing.sort), 0) + 1
          FROM course_lessons existing WHERE existing.module_id = m.id)
  FROM courses c
  JOIN course_modules m ON m.course_id = c.id
  JOIN course_lessons dashboard ON dashboard.module_id = m.id
    AND dashboard.tool_key = 'boardroom-ceo-dashboard'
 WHERE c.slug = 'the-board-room'
   AND m.title = 'Boardroom CEO Dashboard'
   AND (SELECT COUNT(DISTINCT tm.kajabi_id)
          FROM course_modules tm
          JOIN course_lessons tl ON tl.module_id = tm.id
         WHERE tm.course_id = c.id
           AND (tm.kajabi_id, tl.slug) IN (
             ('boardroom-exec:2157478356', 'welcome-to-module-1'),
             ('boardroom-exec:2157478357', 'welcome-to-module-2'),
             ('boardroom-exec:2157478358', 'welcome-to-lesson-3'),
             ('boardroom-exec:2157526875', 'welcome-to-module-4')
           )) = 4
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons l
      WHERE l.module_id = m.id AND l.slug = 'executive-resources'
   );
