-- Sheet row 217: every lesson in Boss Move's "Welcome: Start Here" can be skipped,
-- not only its three videos. They count toward nothing the CE certificate attests.
UPDATE course_lessons l
   SET watch_rule = 'skippable'
  FROM course_modules m
 WHERE m.id = l.module_id
   AND m.course_id = 52
   AND m.id = (SELECT module_id FROM course_lessons WHERE id = 249)
   AND l.content_type <> 'assessment'
   AND l.watch_rule <> 'skippable';
