-- The community live room: an always-open video room, per 2.6 of the 4 Sep brief.
--
-- Signalling state (who is in the room right now) is deliberately NOT here — it
-- lives in the process, derived from live SSE connections, because a roster
-- persisted to a table outlives the connection it describes and strands ghosts
-- in the grid after a browser is killed. What is persisted is the room's
-- configuration and a participation history the admin can read afterwards,
-- which is the same split the telehealth implementation next door uses.

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS live_room_enabled boolean NOT NULL DEFAULT false,
  -- 'always' is Kajabi's "Live Room access: Always open". 'hosted' keeps the
  -- room shut until someone with a host role is inside, which is how office
  -- hours actually runs: members cannot sit in an empty room all week.
  ADD COLUMN IF NOT EXISTS live_room_access text NOT NULL DEFAULT 'always',
  -- Kajabi's "feature alias": Yvette calls this Office Hours, not Live Room.
  ADD COLUMN IF NOT EXISTS live_room_alias text NOT NULL DEFAULT '',
  -- A mesh is O(n²): at eight participants each browser holds seven uplinks.
  -- The ceiling is enforced server-side on join, not suggested in the UI.
  ADD COLUMN IF NOT EXISTS live_room_capacity integer NOT NULL DEFAULT 8;

ALTER TABLE communities
  ADD CONSTRAINT communities_live_room_access_check
  CHECK (live_room_access IN ('always', 'hosted'));

ALTER TABLE communities
  ADD CONSTRAINT communities_live_room_capacity_check
  CHECK (live_room_capacity BETWEEN 2 AND 16);

-- One row per visit, closed on leave. Kept because "who came to office hours"
-- is a question Yvette asks and the in-process roster cannot answer once the
-- room empties.
CREATE TABLE IF NOT EXISTS community_live_visits (
  id            bigserial PRIMARY KEY,
  community_id  integer NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  member_id     integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- The signalling connection this visit belongs to, so overlapping
  -- reconnects close the right row rather than the newest one.
  peer_id       text NOT NULL,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz,
  CONSTRAINT community_live_visits_span_check CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE INDEX IF NOT EXISTS idx_live_visits_community
  ON community_live_visits (community_id, joined_at DESC);

-- Finds the open visit to close when a connection drops. Partial, because only
-- open visits are ever looked up this way and there is one per live connection.
CREATE INDEX IF NOT EXISTS idx_live_visits_open
  ON community_live_visits (community_id, peer_id)
  WHERE left_at IS NULL;
