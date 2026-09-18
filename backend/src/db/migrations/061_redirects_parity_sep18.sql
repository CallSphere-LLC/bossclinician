-- =============================================================================
-- Redirect parity — what the 2026-09-18 HTTP audit of bossclinician.com found
--
-- 004 was built from the indexed-URL list and 019 from the buttons on the pages
-- that existed then. Since then the source site has gained two sales pages
-- (/club, /lounge), their checkout and thank-you paths, a live workshop funnel,
-- and a handful of short links that the header, footer and FAQ copy point at.
-- On the rebuild every one of them answered HTTP 200 with an empty SPA shell.
--
-- Conventions are 004's and 019's:
--   * from_path is lowercase, leading slash, no trailing slash, no query string.
--     Kajabi's offer tokens are mixed case; both readers (services/redirects.ts
--     and nginx's `map`) lowercase the incoming path, so a row written as typed
--     never matches.
--   * target_exists = false marks "closest live page, still owed the real one".
--   * ON CONFLICT DO NOTHING — a row somebody has since edited by hand is left
--     exactly as they left it. It also makes the file safe to re-run.
--
-- Every target was checked against the route table in frontend/src/App.tsx.
-- /club and /lounge are real routes as of this release (pages/Club.tsx,
-- pages/Lounge.tsx).
-- =============================================================================

-- --- 1. Nothing may shadow the two new real pages ----------------------------
-- nginx answers from the redirect map *before* any location block, so a row
-- whose from_path is /club or /lounge would 301 the visitor away from a page
-- that now exists. Neither 004 nor 019 wrote one, but the table is editable in
-- the admin and a stop-gap row ("/club -> /work-with-me") is exactly what a
-- sensible person would have added while the page was missing. A self-row
-- (from = to) is inert in both readers and is left alone.
DELETE FROM redirects
 WHERE from_path IN ('/club', '/lounge')
   AND to_path <> from_path;

-- --- 2. Rows that pointed at a stand-in for a page that now exists -----------
-- Scoped to the exact value an earlier migration wrote, so a row that was
-- retargeted by hand since then is not touched.
UPDATE redirects
   SET to_path = '/lounge', target_exists = true, updated_at = now(),
       note = 'Lounge membership sales page'
 WHERE from_path = '/the-lounge-suite' AND to_path = '/work-with-me';

-- The podcast show page and its nine episodes. 004 pointed the show at itself
-- (inert: the generator skips from = to, and resolveRedirect refuses a
-- self-redirect) and the episodes at the show, so all ten indexed URLs ended on
-- the soft 404 this release removes. There is still no public podcast page —
-- /podcasts exists only inside the member area — so they go to the blog index,
-- the one public place Yvette's long-form content lives, and stay flagged as
-- owing a page. The episodes are retargeted too, rather than left pointing at
-- the show: a redirect that lands on another redirect is two hops for a
-- crawler.
UPDATE redirects
   SET to_path = '/blog', target_exists = false, updated_at = now(),
       note = 'podcast show page not built yet — blog index meanwhile'
 WHERE from_path = '/podcasts/lyrical-reflections'
   AND to_path = '/podcasts/lyrical-reflections';

UPDATE redirects
   SET to_path = '/blog', updated_at = now()
 WHERE from_path LIKE '/podcasts/lyrical-reflections/episodes/%'
   AND to_path = '/podcasts/lyrical-reflections';

-- --- 3. New rows --------------------------------------------------------------
INSERT INTO redirects (from_path, to_path, status_code, target_exists, note) VALUES

  -- Account. Kajabi's password-reset address, linked from old emails.
  ('/password/new',                                '/forgot-password', 301, true,  'Kajabi password reset'),

  -- Short links the source header, footer and home page use. /boardroom and
  -- /aboutyvette already 404 on the source site, but its own navigation still
  -- links them, so they carry real clicks.
  ('/boardroom',                                   '/work-with-me',    301, false, 'Boardroom has no page of its own yet'),
  ('/aboutyvette',                                 '/about',           301, true,  'header link on the source site'),
  ('/masterclass',                                 '/resources',       301, false, 'footer "Free Masterclass" link; masterclass is listed on /resources'),
  ('/freedom-masterclass',                         '/resources',       301, false, 'Freedom Masterclass registration page — needs a page or an event'),
  -- Already written by 004 with this same target; restated so the list of
  -- masterclass paths is complete in one place. A no-op on conflict.
  ('/evergreen-masterclass-register',              '/resources',       301, false, 'evergreen masterclass registration'),

  -- Credential with Confidence, solo-practice sales page and its offer.
  ('/credentialsolo',                              '/courses/credential-with-confidence', 301, true, 'linked from the Club FAQ'),
  ('/resource_redirect/offers/ugqhxnvs',           '/courses/credential-with-confidence', 301, false, 'Credential with Confidence offer'),
  ('/offers/ugqhxnvs',                             '/courses/credential-with-confidence', 301, false, 'Credential with Confidence offer'),
  ('/offers/ugqhxnvs/checkout',                    '/courses/credential-with-confidence', 301, false, 'Credential with Confidence offer'),

  -- Kajabi landing-page short links, resolved by asking the source site where
  -- each one goes (2026-09-18).
  ('/resource_redirect/landing_pages/2151702199',  '/apply',           301, true,  'source: /apply'),
  ('/resource_redirect/landing_pages/2151298575',  '/club',            301, true,  'source: /club'),
  ('/resource_redirect/landing_pages/2152229660',  '/lounge',          301, true,  'source: /lounge'),
  ('/resource_redirect/landing_pages/2152186082',  '/about',           301, true,  'source: /about_yvette'),

  -- The Club's checkout. No offer row exists here yet, so the sales page —
  -- whose buttons go to the application form — is the closest live page.
  ('/offers/tzgjalku',                             '/club',            301, false, 'The Club ($397/mo x 6 or $1,997) — needs an offer + checkout'),
  ('/offers/tzgjalku/checkout',                    '/club',            301, false, 'The Club ($397/mo x 6 or $1,997) — needs an offer + checkout'),
  ('/resource_redirect/offers/tzgjalku',           '/club',            301, false, 'The Club — needs an offer + checkout'),
  ('/the-club-ty',                                 '/checkout/success', 301, true, 'Club post-purchase page (004 sends every confirmation here)'),

  -- The Lounge's two checkouts: Member and VIP.
  ('/resource_redirect/offers/5rwmdhlj',           '/lounge',          301, false, 'Lounge Member ($197/mo or $1,997/yr) — needs an offer + checkout'),
  ('/offers/5rwmdhlj',                             '/lounge',          301, false, 'Lounge Member — needs an offer + checkout'),
  ('/offers/5rwmdhlj/checkout',                    '/lounge',          301, false, 'Lounge Member — needs an offer + checkout'),
  ('/resource_redirect/offers/awvko5oi',           '/lounge',          301, false, 'Lounge VIP ($347/mo or $3,497/yr) — needs an offer + checkout'),
  ('/offers/awvko5oi',                             '/lounge',          301, false, 'Lounge VIP — needs an offer + checkout'),
  ('/offers/awvko5oi/checkout',                    '/lounge',          301, false, 'Lounge VIP — needs an offer + checkout'),
  -- A Lounge member tool ("Practice Reset Snapshot | Boss Clinician Lounge").
  ('/practice-reset-snapshot',                     '/lounge',          301, false, 'Lounge onboarding tool — needs a page'),

  -- The "Dos and Donts of Clinical Documentation" live CEU workshop
  -- (25 September). 302, not 301: this is a dated funnel that should become an
  -- /events/<slug> page the moment the event is created in the admin, and a
  -- cached permanent redirect would outlive that.
  ('/doc-registration',                            '/resources',       302, false, 'documentation CEU workshop registration — create the event, then retarget'),
  ('/offers/pq696zyw',                             '/resources',       302, false, 'documentation workshop ticket — needs an offer'),
  ('/offers/pq696zyw/checkout',                    '/resources',       302, false, 'documentation workshop ticket — needs an offer'),
  ('/offers/syqkeslz',                             '/resources',       302, false, 'documentation workshop ticket (second tier) — needs an offer'),
  ('/offers/syqkeslz/checkout',                    '/resources',       302, false, 'documentation workshop ticket (second tier) — needs an offer'),
  ('/replay-documentation',                        '/resources',       302, false, 'documentation workshop replay page'),
  ('/dos-and-donts-ty',                            '/resources',       301, true,  'workshop registration thank-you'),
  ('/dos-donts-ty',                                '/resources',       301, true,  'workshop registration thank-you'),

  -- Odds and ends.
  ('/opt-in',                                      '/resources',       301, true,  'unfilled Kajabi opt-in template'),
  ('/retreat-needed-quiz',                         '/retreats',        301, false, 'burnout self-assessment for the retreat — quiz not rebuilt here')

ON CONFLICT (from_path) DO NOTHING;

-- After this migration the edge map has to be regenerated and nginx reloaded
-- (the deploy does both):
--   docker compose exec backend node scripts/generate-nginx-redirects.js
--   docker compose exec nginx nginx -s reload
