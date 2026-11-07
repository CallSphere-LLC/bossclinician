-- Marketing Studio: the site owner's content-planning board (Marketing →
-- Studio). The screen keeps its whole working state as one JSON document
-- ({settings, posts, savedIdeas, legacy, hookEdits, customHooks}), so the
-- server stores exactly that, in one row, rather than a schema that would have
-- to follow every change to the board's shape.
--
-- `version` is the optimistic-concurrency counter: a save names the version it
-- was based on, and a save from a stale tab is refused with the current copy
-- instead of silently overwriting newer work. `recovery` is a separate,
-- optional snapshot the screen can restore from; a save that does not mention
-- it leaves it alone.
CREATE TABLE IF NOT EXISTS marketing_studio_state (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  recovery    JSONB,
  version     INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);
