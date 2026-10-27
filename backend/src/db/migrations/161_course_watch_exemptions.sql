-- An explicit, audited recognition of prior Kajabi viewing, scoped to one
-- member/course. No progress, grant, certificate or email is created here.
CREATE TABLE IF NOT EXISTS course_watch_exemptions (
  member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  course_id integer NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 2000),
  admin_user_id integer NOT NULL REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (member_id, course_id)
);
