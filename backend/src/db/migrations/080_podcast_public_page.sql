-- =============================================================================
-- 080 — The Kajabi podcast has its own public page again (sheet row R39).
--
-- "Lyrical Reflections" was imported from its Kajabi RSS feed on 2026-09-29
-- (backups/sheet-parity-20260929/podcast-import-kajabi.py: the show, its nine
-- episodes, and the audio and artwork re-hosted under /uploads). The public
-- page for it, frontend pages/Podcast.tsx, answers at the same addresses the
-- show had on Kajabi:
--
--   /podcasts/lyrical-reflections
--   /podcasts/lyrical-reflections/episodes/<Kajabi episode id>
--
-- 004/061 sent those ten addresses to /blog while no page existed ("podcast
-- show page not built yet — blog index meanwhile"). nginx answers from the
-- redirect map before any location block, so those rows would now 301 every
-- visitor away from the page that exists — 074's and 077's reasoning for
-- /boardroom and /freedom-masterclass. They are removed. A row that was
-- retargeted by hand since (anything not pointing at /blog) is left alone.
--
-- nginx serves these redirects from nginx/redirects.map, which is baked into
-- the gateway image at build time and is NOT regenerated from this table by
-- the K3s deploy. The checked-in map is edited in the same change to match what
-- this file leaves in the table; the two must ship together.
-- =============================================================================

DELETE FROM redirects
 WHERE (from_path = '/podcasts/lyrical-reflections'
        OR from_path LIKE '/podcasts/lyrical-reflections/episodes/%')
   AND to_path = '/blog';
