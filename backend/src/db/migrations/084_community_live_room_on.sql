-- 084: the live room (web video calling) on for the two real communities.
--
-- QA row 43 (2026-09-29): "i don't see the web calling feature in community
-- page". The Boss already had it on, as "Office Hours"; The Lounge had it off,
-- so a Lounge member had no way into a call at all. Both run as always-open
-- rooms, which is how Skool/Circle-style community calls work: a member can
-- start one whenever they like, and the admin can still switch a room to
-- "only when a host is in" from Community -> Live room.
--
-- Only switches the room on. The alias ("Office Hours" on The Boss), the
-- access mode already chosen and the capacity are left as they are, and an
-- archived community is not touched. Re-running it changes nothing.
UPDATE communities
   SET live_room_enabled = true,
       updated_at = now()
 WHERE slug IN ('the-boss', 'the-lounge')
   AND archived_at IS NULL
   AND live_room_enabled = false;
