-- Sheet row 240: attach the stateless Income Stream Decision Assessment
-- (frontend lesson tool 'income-stream-assessment') to the existing
-- "Do You Actually Need This?" lesson in The Practice Elevation (lesson 182,
-- module 68) and its Board Room copy (lesson 367, module 117).
-- Only tool_key changes: title, body, video, sort, publish state, access and
-- tool_config are left as they are. The tool stores nothing, so there is no
-- member data or table involved. Idempotent; a lesson that already carries a
-- different tool is left alone.
UPDATE course_lessons l
   SET tool_key = 'income-stream-assessment', updated_at = now()
  FROM course_modules m
 WHERE l.module_id = m.id
   AND ((l.id = 182 AND m.id = 68 AND m.course_id = 61)
     OR (l.id = 367 AND m.id = 117 AND m.course_id = 65))
   AND l.slug = 'do-you-actually-need-this-income-stream-decision-assessment'
   AND l.title LIKE 'Do You Actually Need This?%Income Stream Decision Assessment'
   AND l.tool_key IS NULL;
