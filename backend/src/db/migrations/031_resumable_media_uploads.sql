-- Resumable media uploads.
--
-- A 400MB course video posted in one request is one network interruption away
-- from starting again from zero, and on a hotel wifi it never finishes at all:
-- nginx's client_body_timeout gives the whole body 600 seconds, which a slow
-- line cannot meet however healthy it stays. The upload is therefore cut into
-- chunks, and this table is what remembers where the last one stopped.
--
-- It has to be a table rather than in-memory state for the case that actually
-- happens: she closes the laptop, or is logged out, or the API is redeployed
-- mid-upload. The bytes are already on disk in a .part file; the row is what
-- lets a later session find them again and carry on.
CREATE TABLE media_upload_sessions (
  id              TEXT PRIMARY KEY,
  admin_user_id   INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,

  original_name   TEXT NOT NULL,
  mime            TEXT NOT NULL,
  visibility      TEXT NOT NULL CHECK (visibility IN ('public', 'protected')),
  size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
  -- The authority on where to resume from. The .part file may hold more than
  -- this after a connection died mid-chunk; those trailing bytes were never
  -- acknowledged, so the next write truncates back to this figure first.
  received_bytes  BIGINT NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),

  -- The name the finished file is stored under, decided up front so the
  -- finalise step is a rename inside one directory and never a copy.
  stored_name     TEXT NOT NULL,

  -- name + size + mtime + audience, hashed. Choosing the same file twice
  -- resumes the upload already in flight instead of starting a second one.
  fingerprint     TEXT NOT NULL,

  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'completed', 'aborted')),
  media_asset_id  INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,

  -- Held for the duration of one chunk write. Two tabs resuming the same file
  -- would otherwise interleave their writes into one file at one offset.
  writing_since   TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);

-- One open session per file per administrator: the create call is idempotent
-- and a double-click cannot fork the upload in two.
CREATE UNIQUE INDEX idx_media_upload_open_fingerprint
  ON media_upload_sessions (admin_user_id, fingerprint)
  WHERE status = 'open';

-- The "unfinished uploads" list the media library shows on load.
CREATE INDEX idx_media_upload_sessions_open
  ON media_upload_sessions (admin_user_id, updated_at DESC)
  WHERE status = 'open';

-- Abandoned uploads are bytes on a volume nobody will ever ask for again.
INSERT INTO job_schedules (name, kind, every_minutes, timezone)
VALUES ('media-upload-sweep', 'media.sweepUploads', 60, 'America/New_York')
ON CONFLICT (name) DO NOTHING;
