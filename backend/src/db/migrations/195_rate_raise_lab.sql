-- Attach to the existing guide only; preserve original content and all access grants.
UPDATE course_lessons l SET tool_key='rate-raise-lab'
FROM course_modules m
WHERE l.module_id=m.id AND m.course_id=61 AND l.id=163
 AND l.slug='raise-your-rate-guide' AND l.published
 AND (l.tool_key IS NULL OR l.tool_key='rate-raise-lab');
