-- Community channel settings (lane C-admin).
--
-- The view a channel opens in, as a single column the member side renders from
-- and the admin channel settings screen writes to. Values: 'feed' | 'forum' |
-- 'gallery', default 'feed'.
--
-- Migration 044 (lane C-member) owns this column and adds it too. Both use
-- ADD COLUMN IF NOT EXISTS, so whichever runs first creates it and the other is
-- a no-op; it is repeated here only so the admin update endpoint has a column to
-- write to however the two land.
ALTER TABLE community_channels
  ADD COLUMN IF NOT EXISTS view_mode text NOT NULL DEFAULT 'feed';

-- Carry across the layout each channel was already set to open in (033's
-- `default_view_mode`), so adding the column does not flip a gallery channel
-- back to a feed. Only rows still at the column default are touched, which
-- makes this safe to run after 044 has written real values.
UPDATE community_channels
   SET view_mode = default_view_mode
 WHERE view_mode = 'feed'
   AND default_view_mode IN ('forum', 'gallery');
