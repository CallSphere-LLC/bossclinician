ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_kind_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_kind_check CHECK (kind IN ('quiz','graded','survey'));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS require_pass boolean NOT NULL DEFAULT true;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS pass_message text NOT NULL DEFAULT 'You passed. Continue to the next lesson.';
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS fail_message text NOT NULL DEFAULT 'Review the lesson and try again.';
