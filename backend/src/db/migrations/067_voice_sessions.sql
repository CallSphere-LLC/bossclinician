-- =============================================================================
-- The voice concierge's memory
--
-- Four tables, because four different questions get asked of them.
--
--  * `voice_sessions`  — one conversation, however it was held. Voice and the
--    typed chat widget are the same machine over two transports, so they are
--    one table with a `mode`, not two tables that drift apart.
--  * `voice_transcript_lines` — what was actually said, in order.
--  * `voice_approvals` — the audit trail for anything the agent did inside the
--    admin: what it proposed, how the owner answered, and whether it ran. This
--    is the record that answers "did I agree to that?", so it is written even
--    when the answer was no.
--  * `voice_tour_progress` — where the first-run walkthrough got to, kept
--    server-side so it follows a person to another device.
--
-- A session belongs to exactly one of three kinds of caller: a signed-in
-- member, an administrator, or an anonymous visitor identified by a first-party
-- cookie. All three columns are nullable and at most one is set; ownership is
-- what stops a session id from being a key to somebody else's transcript, so
-- every route that names a session re-checks it against the caller.
--
-- The id is TEXT rather than UUID: nothing else in this schema uses the uuid
-- type or pgcrypto, and the value is minted by the API with crypto.randomUUID()
-- before the row exists — the browser has to be told its session id in the same
-- response that opens it.
--
-- Same conventions as the rest of this directory: IF NOT EXISTS throughout, so
-- running it twice is a no-op.
-- =============================================================================

CREATE TABLE IF NOT EXISTS voice_sessions (
  id                     TEXT PRIMARY KEY,
  -- The surface the SERVER decided on, never the one the browser asked for.
  surface                TEXT NOT NULL,
  mode                   TEXT NOT NULL DEFAULT 'voice',
  -- Exactly one of these three is set. See the note above.
  member_id              INT REFERENCES members(id) ON DELETE SET NULL,
  admin_user_id          INT REFERENCES admin_users(id) ON DELETE SET NULL,
  visitor_id             TEXT,
  -- Where the person was standing when they pressed the button.
  path                   TEXT NOT NULL DEFAULT '',
  ip                     TEXT NOT NULL DEFAULT '',
  user_agent             TEXT NOT NULL DEFAULT '',
  started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at               TIMESTAMPTZ,
  -- The last time anything arrived for this conversation — a line of
  -- transcript, a few seconds of audio. A browser tab closed mid-sentence
  -- never sends a goodbye, so without this a call that plainly happened would
  -- show no length at all on the owner's page. With it, the length of an
  -- unfinished conversation is "up to the last thing we heard", which is both
  -- true and useful.
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Measured from the two timestamps when the call ends, stored because the
  -- admin list sorts and sums on it and a difference of timestamps cannot be
  -- indexed usefully.
  seconds                INT,
  -- Deliberately unconstrained text: the vocabulary of endings belongs to the
  -- broker that detects them ('hung up', 'time limit', 'lost connection'), and
  -- a CHECK here would mean a new reason could not be recorded until this
  -- file's successor shipped.
  end_reason             TEXT NOT NULL DEFAULT '',
  -- What the RecordingStore handed back. `recording_key` is opaque and says
  -- which store holds it: a `protected:` prefix is the local protected upload
  -- directory (services/signedUrls.ts uses the same convention), anything else
  -- is an object key in the bucket.
  recording_key          TEXT,
  recording_bytes        BIGINT,
  recording_content_type TEXT,
  -- Audio arrives every few seconds while the call runs, not in one upload at
  -- the end: a browser tab closed mid-sentence is exactly how a recording
  -- feature ends up holding nothing. So a recording exists as numbered parts
  -- from the first few seconds onwards, and these two columns are how the
  -- owner's page tells "still arriving" from "closed and whole": the count of
  -- parts accepted, and the moment they were joined into one object.
  recording_chunks       INT NOT NULL DEFAULT 0,
  recording_finalized_at TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE voice_sessions DROP CONSTRAINT IF EXISTS voice_sessions_surface_check;
ALTER TABLE voice_sessions ADD CONSTRAINT voice_sessions_surface_check
  CHECK (surface IN ('public', 'member', 'admin'));

ALTER TABLE voice_sessions DROP CONSTRAINT IF EXISTS voice_sessions_mode_check;
ALTER TABLE voice_sessions ADD CONSTRAINT voice_sessions_mode_check
  CHECK (mode IN ('voice', 'text'));

-- The admin list is "newest first", optionally narrowed to one surface or one
-- transport. Both indexes lead with what is filtered and end with the sort, so
-- neither query has to sort a result set it has already found.
CREATE INDEX IF NOT EXISTS idx_voice_sessions_started ON voice_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_surface_started
  ON voice_sessions (surface, started_at DESC);
-- "Show me this member's conversations" from a contact record, and the
-- ownership check every /api/voice route makes for an anonymous visitor.
CREATE INDEX IF NOT EXISTS idx_voice_sessions_member
  ON voice_sessions (member_id, started_at DESC) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voice_sessions_visitor
  ON voice_sessions (visitor_id, started_at DESC) WHERE visitor_id IS NOT NULL;

COMMENT ON COLUMN voice_sessions.visitor_id IS
  'First-party cookie value for an anonymous visitor. The only thing that makes a signed-out session ownable.';

-- -----------------------------------------------------------------------------
-- What was said.
--
-- Lines arrive in batches as they finalise, and a flush that times out is
-- retried with the same batch — so the same line would land twice and the owner
-- would read a stutter that never happened. `line_key` is a digest of the line
-- the API computes (role, offset and text together); the unique index turns a
-- retry into a no-op rather than a duplicate, which is cheaper and more honest
-- than trying to spot near-duplicates when reading.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_transcript_lines (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  text        TEXT NOT NULL,
  -- Milliseconds from the start of the call, so the transcript can be read
  -- alongside the recording.
  at_ms       INT NOT NULL DEFAULT 0,
  line_key    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE voice_transcript_lines DROP CONSTRAINT IF EXISTS voice_transcript_lines_role_check;
ALTER TABLE voice_transcript_lines ADD CONSTRAINT voice_transcript_lines_role_check
  CHECK (role IN ('user', 'agent'));

CREATE UNIQUE INDEX IF NOT EXISTS voice_transcript_lines_key
  ON voice_transcript_lines (session_id, line_key);
-- The detail view reads one conversation end to end, in the order it happened.
CREATE INDEX IF NOT EXISTS idx_voice_transcript_session
  ON voice_transcript_lines (session_id, at_ms, id);

-- -----------------------------------------------------------------------------
-- What the agent was allowed to do.
--
-- Only the admin surface can propose an action, and it may never run one the
-- owner did not answer. Both halves are here: the proposal as she was shown it,
-- and the answer with the way she gave it — out loud, typed, a click, or the
-- silence that timed out. `executed` closes the loop, so "she said yes and it
-- failed" is distinguishable from "it ran".
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_approvals (
  id           BIGSERIAL PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  action_id    TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  summary      TEXT NOT NULL DEFAULT '',
  -- The field-by-field preview exactly as the approval card rendered it.
  details      JSONB,
  risk         TEXT NOT NULL DEFAULT 'normal',
  approved     BOOLEAN NOT NULL DEFAULT false,
  answered_via TEXT NOT NULL DEFAULT 'timeout',
  note         TEXT NOT NULL DEFAULT '',
  executed     BOOLEAN NOT NULL DEFAULT false,
  executed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE voice_approvals DROP CONSTRAINT IF EXISTS voice_approvals_risk_check;
ALTER TABLE voice_approvals ADD CONSTRAINT voice_approvals_risk_check
  CHECK (risk IN ('normal', 'destructive'));

ALTER TABLE voice_approvals DROP CONSTRAINT IF EXISTS voice_approvals_answered_via_check;
ALTER TABLE voice_approvals ADD CONSTRAINT voice_approvals_answered_via_check
  CHECK (answered_via IN ('voice', 'chat', 'click', 'timeout', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_voice_approvals_session
  ON voice_approvals (session_id, created_at);

-- -----------------------------------------------------------------------------
-- Where the walkthrough got to.
--
-- One row per person per surface, and "person" is again one of three kinds. The
-- three partial unique indexes are what make the upsert possible without a
-- composite key full of NULLs — in Postgres NULL is not equal to NULL, so a
-- plain UNIQUE across all four columns would let the same visitor accumulate a
-- new row on every reconnect.
--
-- `stop_index` rather than `index`: the latter is a reserved word in enough
-- places (and reads as an instruction in every query that uses it) to be worth
-- avoiding.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_tour_progress (
  id            BIGSERIAL PRIMARY KEY,
  surface       TEXT NOT NULL,
  member_id     INT REFERENCES members(id) ON DELETE CASCADE,
  admin_user_id INT REFERENCES admin_users(id) ON DELETE CASCADE,
  visitor_id    TEXT,
  stop_index    INT NOT NULL DEFAULT 0,
  -- Set when the walkthrough is finished OR declined: both mean "never offer
  -- this again", and an offer that keeps coming back is the thing addendum 1
  -- exists to prevent.
  completed     BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE voice_tour_progress DROP CONSTRAINT IF EXISTS voice_tour_progress_surface_check;
ALTER TABLE voice_tour_progress ADD CONSTRAINT voice_tour_progress_surface_check
  CHECK (surface IN ('public', 'member', 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS voice_tour_progress_member_key
  ON voice_tour_progress (surface, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS voice_tour_progress_admin_key
  ON voice_tour_progress (surface, admin_user_id) WHERE admin_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS voice_tour_progress_visitor_key
  ON voice_tour_progress (surface, visitor_id) WHERE visitor_id IS NOT NULL;
