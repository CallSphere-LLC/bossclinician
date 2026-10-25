-- QA row 182: the VIP Practice Health Check, directly after the welcome lesson.
-- The linked ZIP is a local-only prototype. The native tool stores one private
-- document per authenticated member in member_tool_state (migration 119).
-- Historical form replies have no proven member owner, so they remain visible
-- to admins but are not attributed to a member by guessing from email/contact.

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_submissions_member_form
  ON form_submissions (member_id, form_id, created_at DESC)
  WHERE member_id IS NOT NULL;

-- Shift subsequent lessons only while the new lesson is absent. Match the
-- exact VIP course and welcome lesson; do not change any other Lounge course.
UPDATE course_lessons l
   SET sort = l.sort + 1, updated_at = now()
  FROM course_lessons welcome
  JOIN course_modules m ON m.id = welcome.module_id
  JOIN courses c ON c.id = m.course_id
 WHERE c.slug = 'the-lounge-vip'
   AND welcome.slug = 'welcome-vip-boss-clinician'
   AND l.module_id = m.id
   AND l.sort > welcome.sort
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons existing
      WHERE existing.module_id = m.id
        AND existing.slug = 'vip-practice-health-check'
   );

INSERT INTO course_lessons
  (module_id, title, slug, body_md, content_type, published, sort, tool_key)
SELECT m.id,
       'Your 2-Minute Practice Health Check',
       'vip-practice-health-check',
       'Complete these eight quick questions before your first VIP strategy session. Your answers and results save privately to your account. Do not enter client-identifying health information.',
       'text', true, welcome.sort + 1, 'vip-practice-health'
  FROM course_lessons welcome
  JOIN course_modules m ON m.id = welcome.module_id
  JOIN courses c ON c.id = m.course_id
 WHERE c.slug = 'the-lounge-vip'
   AND welcome.slug = 'welcome-vip-boss-clinician'
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons existing
      WHERE existing.module_id = m.id
        AND existing.slug = 'vip-practice-health-check'
   );
