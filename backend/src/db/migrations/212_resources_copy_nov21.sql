-- Sheet row 245 (21-Nov website copy): /resources card titles (typo "you starter on") and plain guide names.
UPDATE resources SET title='Private Practice Kickstart Guide', description='Just starting your practice or want to make sure you start on the right path?', updated_at=now()
 WHERE slug='free-starter-guide' AND (title ILIKE '%you starter on%' OR description ILIKE '%you starter on%');
UPDATE resources SET title='Insurance or Superbills? Free Guide', updated_at=now()
 WHERE slug='free-guide-insurance-vs-superbills' AND title LIKE 'Free Guide: Want to know%';
UPDATE resources SET title='Profitable Practice Planner Checklist', description='Grab the must-have profitable practice planner now.', updated_at=now()
 WHERE slug='free-practice-planner-checklist' AND title LIKE 'Free Checklist: Grab my%';
