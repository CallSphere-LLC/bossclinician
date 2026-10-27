-- Row 191: a pass confirmation is separate from full-course/certificate eligibility.
-- Do not activate the paused, unresolved imported marketing sequence or backfill.
DO $migration$
DECLARE
  assessment_id integer;
  minimum_attempt bigint;
  automation_id integer;
BEGIN
  SELECT a.id INTO assessment_id
  FROM assessments a
  JOIN course_lessons l ON l.id = a.lesson_id
  JOIN course_modules m ON m.id = l.module_id
  JOIN courses c ON c.id = m.course_id
  WHERE c.slug = 'the-boss-move' AND a.slug = 'the-boss-move-post-exam'
    AND a.kind = 'graded' AND a.published AND l.slug = 'post-exam';
  IF assessment_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM automations WHERE name = 'Boss Move Post Exam - pass confirmation (BC191)') THEN RETURN; END IF;

  -- Wait for in-flight attempts, then freeze the rollout boundary for replays.
  -- This lock lasts only for the migration transaction; no learner data is edited.
  LOCK TABLE assessment_attempts IN SHARE MODE;
  SELECT COALESCE(MAX(id), 0) + 1 INTO minimum_attempt FROM assessment_attempts;
  INSERT INTO automations(name,description,trigger_type,trigger_config,conditions,status)
  VALUES ('Boss Move Post Exam - pass confirmation (BC191)',
    'Confirms future Boss Move exam passes. Certificate eligibility is separate. Existing attempts and imported sequences are not replayed.',
    'assessment_passed',jsonb_build_object('assessmentId',assessment_id,'minimumAttemptId',minimum_attempt),
    '{"match":"all","rules":[{"field":"passed","op":"is","value":"true"}]}'::jsonb,'active')
  RETURNING id INTO automation_id;
  INSERT INTO automation_actions(automation_id,action_type,config,sort)
  VALUES (automation_id,'send_email',jsonb_build_object(
    'subject','You passed The Boss Move Post Exam',
    'bodyMd',E'Hi {{firstName}},\n\nCongratulations: you passed **The Boss Move Post Exam**. Your result has been saved.\n\n[View your saved exam result](https://www.bossclinician.com/library/the-boss-move/lessons/post-exam)\n\nThis confirms your exam result. Your course certificate is issued separately once all required lessons, applicable video requirements, the post-exam and the program evaluation are complete.\n\n[Review your course progress](https://www.bossclinician.com/library/the-boss-move) or [check your certificates](https://www.bossclinician.com/account/certificates).\n\nThe Boss Clinician Team',
    'fromName','','fromEmail','','topic','product'),0);
END;
$migration$;
