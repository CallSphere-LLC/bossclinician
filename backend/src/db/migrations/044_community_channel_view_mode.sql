-- Community channels: one view mode per channel (Lane C-member, item C7).
--
-- The contract between the admin channel settings screen and the member portal:
-- `community_channels.view_mode` is how the channel is laid out for members —
-- 'feed' (cards), 'forum' (a compact topic table) or 'gallery' (an image grid).
-- The admin screen writes it; the member channel page renders it.
--
-- 034 already added `view_modes text[]` + `default_view_mode`, a "which layouts
-- may a member switch between" pair that nothing on the admin side ever wrote,
-- so every channel on the live site is still {feed}/feed. Those columns stay
-- (dropping a column other code still selects would break a running API during
-- a rolling start); `view_mode` is backfilled from `default_view_mode` so no
-- channel changes layout on deploy, and the member page treats `view_mode` as
-- the authority from here on.
--
-- Idempotent: safe to run on every start.

ALTER TABLE community_channels
  ADD COLUMN IF NOT EXISTS view_mode text NOT NULL DEFAULT 'feed';

-- Backfill once, only rows still on the default, and only from a value the
-- constraint below accepts.
UPDATE community_channels
   SET view_mode = default_view_mode
 WHERE view_mode = 'feed'
   AND default_view_mode IN ('forum', 'gallery');

ALTER TABLE community_channels
  DROP CONSTRAINT IF EXISTS community_channels_view_mode_check;
ALTER TABLE community_channels
  ADD CONSTRAINT community_channels_view_mode_check
  CHECK (view_mode IN ('feed', 'forum', 'gallery'));
