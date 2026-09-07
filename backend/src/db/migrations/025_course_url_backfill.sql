-- =============================================================================
-- Course URL backfill — retire the '#' placeholder
--
-- `courses.url` is what a card in the training library links to. The seeder
-- never had a real value to put there: the scraped pages it builds rows from
-- carry Kajabi `/resource_redirect/...` links that are meaningless once the
-- domain points here, so `extractCoursesFromAllCourses` and
-- `extractCoursesFromStore` both wrote the literal '#', and the column default
-- in schema.sql said '#' too, so anything created in the admin without a URL
-- picked it up as well.
--
-- The result was a catalogue that looked broken. `<Link to="#">` resolves
-- against the current location, so every "GET FULLY BOOKED HERE" button on
-- /courses navigated from /courses to /courses — the click registered and
-- nothing opened.
--
-- The right destination was already sitting there: /courses/<slug> is a real
-- route (frontend/src/App.tsx) served by a real endpoint
-- (GET /api/courses/:slug), and migration 019 already points all fourteen
-- legacy `/resource_redirect/...` addresses at exactly those paths. This
-- file just makes the rows agree with the redirects that were written for
-- them.
--
-- Only placeholder rows are touched. A URL somebody set by hand — an external
-- link to a Kajabi offer that is still live, or a path pointing somewhere
-- other than the course's own page — is left exactly as it was, which is the
-- same posture 019 takes with its ON CONFLICT DO NOTHING.
-- =============================================================================

UPDATE courses
   SET url        = '/courses/' || slug,
       updated_at = now()
 WHERE btrim(COALESCE(url, '')) IN ('', '#');

-- The default is what put '#' into rows the admin creates without a URL. An
-- empty string is the honest value for "not set": the catalogue falls back to
-- the course's own sales page when it finds one, whereas '#' actively looked
-- like a link and behaved like a dead one.
ALTER TABLE courses ALTER COLUMN url SET DEFAULT '';
