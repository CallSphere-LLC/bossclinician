-- QA row 167 (2026-10-23): "participants can start a live video … please
-- remove that capability". Members join a call a host has started; they never
-- open an empty room themselves. routes/member/communityLive.ts now enforces
-- that for every room, and this brings the stored setting into line so the
-- admin's "When can they get in?" never shows a choice that no longer exists.
-- Idempotent: re-running finds nothing left to change.

UPDATE communities
   SET live_room_access = 'hosted', updated_at = now()
 WHERE live_room_access <> 'hosted';

ALTER TABLE communities
  ALTER COLUMN live_room_access SET DEFAULT 'hosted';
