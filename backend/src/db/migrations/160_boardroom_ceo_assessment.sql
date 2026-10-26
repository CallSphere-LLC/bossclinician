-- QA sheet row 186. 158 and 159 are already assigned; this migration is additive.
-- Reports are independent of dashboard, living-plan, and goal tool state.
CREATE TABLE IF NOT EXISTS member_boardroom_assessments (
  id UUID PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  assessment_version TEXT NOT NULL CHECK (assessment_version ~ '^boardroom-ceo-v[0-9]+$'),
  completed_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  quarter TEXT NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  responses SMALLINT[] NOT NULL CHECK (
    array_ndims(responses) = 1 AND array_lower(responses, 1) = 1
    AND cardinality(responses) = 12 AND array_position(responses, NULL) IS NULL
    AND responses <@ ARRAY[1,2,3,4]::smallint[]
  ),
  overall_score SMALLINT NOT NULL CHECK (overall_score BETWEEN 25 AND 100),
  domains JSONB NOT NULL CHECK (jsonb_typeof(domains) = 'array' AND jsonb_array_length(domains) = 6),
  priorities JSONB NOT NULL CHECK (jsonb_typeof(priorities) = 'array' AND jsonb_array_length(priorities) = 3),
  first_action TEXT NOT NULL,
  UNIQUE (member_id, request_id)
);
CREATE INDEX IF NOT EXISTS member_boardroom_assessments_history
  ON member_boardroom_assessments (member_id, completed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS member_boardroom_assessments_quarter_baselines
  ON member_boardroom_assessments (member_id, quarter, assessment_version, completed_at DESC, id DESC);

-- No edit endpoint; protect stored snapshots from accidental SQL updates too.
-- Deletion remains possible through member erasure (ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION reject_boardroom_assessment_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Completed CEO assessments are immutable';
END;
$$;
DROP TRIGGER IF EXISTS boardroom_assessment_immutable ON member_boardroom_assessments;
CREATE TRIGGER boardroom_assessment_immutable BEFORE UPDATE ON member_boardroom_assessments
FOR EACH ROW EXECUTE FUNCTION reject_boardroom_assessment_update();

-- The standard dashboard is the first lesson and has no previous-lesson gate.
-- Fail closed if its prerequisite has been customized: inserting a predecessor
-- there would change progression. No course/product/grant is created here.
DO $$
DECLARE target RECORD;
BEGIN
  FOR target IN
    SELECT DISTINCT ON (l.module_id) l.id, l.module_id, l.sort, l.requires_previous_lesson, m.course_id, m.sort AS module_sort, c.require_full_video
      FROM course_lessons l
      JOIN course_modules m ON m.id = l.module_id
      JOIN courses c ON c.id = m.course_id
     WHERE c.slug = 'the-board-room' AND l.tool_key = 'boardroom-ceo-dashboard'
       AND NOT EXISTS (
         SELECT 1 FROM course_lessons existing WHERE existing.module_id = l.module_id
           AND (existing.tool_key = 'boardroom-ceo-assessment' OR existing.slug = 'boardroom-ceo-assessment')
       )
     ORDER BY l.module_id, l.sort, l.id
  LOOP
    IF target.requires_previous_lesson THEN
      RAISE EXCEPTION 'CEO dashboard has a custom previous-lesson prerequisite; review placement before adding assessment';
    END IF;
    -- A preceding required-pass quiz or full-watch video also gates the
    -- dashboard even when requires_previous_lesson is false. Preserve that
    -- owner customization by refusing placement rather than bypassing it.
    IF EXISTS (
      SELECT 1 FROM (
        SELECT prev.id, prev.content_type, prev.video_url, prev.audio_url
          FROM course_lessons prev
          JOIN course_modules pm ON pm.id = prev.module_id
         WHERE pm.course_id = target.course_id AND prev.published
           AND (pm.sort, pm.id, prev.sort, prev.id) <
               (target.module_sort, target.module_id, target.sort, target.id)
         ORDER BY pm.sort DESC, pm.id DESC, prev.sort DESC, prev.id DESC LIMIT 1
      ) predecessor
      WHERE EXISTS (SELECT 1 FROM assessments a WHERE a.lesson_id = predecessor.id
                     AND a.kind = 'graded' AND a.published AND a.require_pass)
         OR (target.require_full_video AND (
              (predecessor.content_type = 'video' AND COALESCE(predecessor.video_url, '') <> '')
              OR (predecessor.content_type = 'audio' AND COALESCE(predecessor.audio_url, '') <> '')))
    ) THEN
      RAISE EXCEPTION 'CEO dashboard has a custom quiz or media prerequisite; review placement before adding assessment';
    END IF;
    -- Make room without reordering any existing lesson or changing its content.
    UPDATE course_lessons SET sort = sort + 1
      WHERE module_id = target.module_id
        AND (sort > target.sort OR (sort = target.sort AND id >= target.id));
    INSERT INTO course_lessons
      (module_id, title, slug, body_md, content_type, published, sort, tool_key, requires_previous_lesson)
    VALUES
      (target.module_id, 'Your CEO Assessment', 'boardroom-ceo-assessment',
       'Complete twelve questions to establish your personal CEO strategic baseline. Your self-reported results and history are private to your account. Review your priorities with your advisor before deciding on goals. Completing an assessment does not change your dashboard, goals, or living business plan.',
       'text', true, target.sort, 'boardroom-ceo-assessment', false);
  END LOOP;
END;
$$;
