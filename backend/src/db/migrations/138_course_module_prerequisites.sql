-- Completion gates for whole phases; lesson ordering within a phase is unchanged.
CREATE TABLE IF NOT EXISTS course_module_prerequisites (
  module_id INTEGER NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  prerequisite_module_id INTEGER NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  PRIMARY KEY (module_id, prerequisite_module_id),
  CHECK (module_id <> prerequisite_module_id)
);

-- Owner policy, 21 October 2026:
-- Phases 1 -> 2 -> 3 -> 4 -> 5; Tier 2 introduction after phases 4 and 5;
-- every training module before the post exam; post exam before CE evaluation.
-- Tier 2 precedes phase 4 visually, so it is deliberately not a phase-4 prerequisite.
DO $$
DECLARE
  course INTEGER;
  phases INTEGER[];
  tier INTEGER;
  exam INTEGER;
  evaluation INTEGER;
  n INTEGER;
  phase_id INTEGER;
BEGIN
  SELECT id INTO course FROM courses WHERE slug = 'profitable-private-practices-training';
  IF course IS NULL THEN RETURN; END IF;
  -- Fresh installations have the catalogue seed but no imported curriculum yet.
  IF NOT EXISTS (SELECT 1 FROM course_modules WHERE course_id=course AND title LIKE 'Phase %') THEN RETURN; END IF;
  FOR n IN 1..5 LOOP
    SELECT id INTO phase_id FROM course_modules
      WHERE course_id = course AND title LIKE 'Phase ' || n || ':%';
    phases[n] := phase_id;
    IF phases[n] IS NULL THEN RAISE EXCEPTION 'PPP phase % is missing', n; END IF;
  END LOOP;
  SELECT id INTO tier FROM course_modules WHERE course_id=course AND title LIKE '%Tier 2:%';
  SELECT id INTO exam FROM course_modules WHERE course_id=course AND title='Post Exam';
  SELECT id INTO evaluation FROM course_modules WHERE course_id=course AND title='CE Certification and Evaluation';
  IF tier IS NULL OR exam IS NULL OR evaluation IS NULL THEN
    RAISE EXCEPTION 'PPP tier, exam or evaluation module is missing';
  END IF;
  FOR n IN 2..5 LOOP
    INSERT INTO course_module_prerequisites VALUES (phases[n], phases[n-1]) ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO course_module_prerequisites VALUES (tier, phases[4]), (tier, phases[5]), (evaluation, exam)
    ON CONFLICT DO NOTHING;
  INSERT INTO course_module_prerequisites (module_id, prerequisite_module_id)
    SELECT exam, id FROM course_modules
    WHERE course_id=course AND id NOT IN (exam, evaluation)
    ON CONFLICT DO NOTHING;
END $$;
