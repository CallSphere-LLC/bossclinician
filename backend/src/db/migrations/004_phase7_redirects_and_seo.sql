-- =============================================================================
-- Phase 7 (part 1) — Redirect map & 404 reporting
--
-- bossclinician.com has 125 indexed URLs and this app is going to take that
-- domain over. Every one of those paths has to answer 301 to a live equivalent
-- on the first request after cutover, or the organic traffic the business runs
-- on evaporates.
--
-- Shipped ahead of the rest of Phase 7 because the table is what the content
-- migration fills in: each landing page built from here on marks off a row.
-- =============================================================================

CREATE TABLE redirects (
  id            SERIAL PRIMARY KEY,
  -- Always stored lowercase, leading slash, no trailing slash, no query string.
  -- Normalisation happens on write so the lookup can be a single indexed
  -- equality check rather than a scan with lower() on every row.
  from_path     TEXT UNIQUE NOT NULL,
  to_path       TEXT NOT NULL,
  status_code   INT NOT NULL DEFAULT 301 CHECK (status_code IN (301, 302, 307, 308)),
  -- False while the destination is still a placeholder. The admin screen shows
  -- these as "needs a page" so the content migration has a visible worklist,
  -- and the cutover checklist can assert this is empty.
  target_exists BOOLEAN NOT NULL DEFAULT true,
  note          TEXT NOT NULL DEFAULT '',
  hit_count     INT NOT NULL DEFAULT 0,
  last_hit_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_redirects_review ON redirects (target_exists, from_path);

-- Unmatched paths, so the 404 report shows what real traffic is asking for that
-- the redirect map does not cover — which is the only reliable way to find the
-- URLs Appendix B missed.
CREATE TABLE not_found_log (
  id          SERIAL PRIMARY KEY,
  path        TEXT NOT NULL,
  referrer    TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  hit_count   INT NOT NULL DEFAULT 1,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved    BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (path)
);

CREATE INDEX idx_not_found_unresolved ON not_found_log (resolved, hit_count DESC);

-- --- Appendix B ---------------------------------------------------------------
-- Every live bossclinician.com URL. `target_exists = false` marks the rows whose
-- destination is a page the content migration still has to build; those are
-- pointed at the closest live section in the meantime so a visitor lands
-- somewhere sensible rather than on a 404 the day of the cutover.

INSERT INTO redirects (from_path, to_path, target_exists, note) VALUES
  -- Identity / about
  ('/about_yvette',                              '/about',            true,  'Kajabi about page'),
  ('/heyyvettehere',                             '/about',            true,  'link-in-bio intro page'),
  ('/boss-clinician-home',                       '/',                 true,  'duplicate home'),
  ('/link-in-bio',                               '/resource-hub',     true,  'Instagram link hub'),

  -- Catalogue
  ('/all-courses',                               '/courses',          true,  ''),
  ('/store',                                     '/store',            true,  'same path, kept for the audit trail'),
  ('/work-with-me',                              '/work-with-me',     true,  'same path, kept for the audit trail'),
  ('/resourcehub',                               '/resource-hub',     true,  'hyphenation changed'),
  ('/contact',                                   '/contact',          true,  'same path'),

  -- Products that map onto an existing course row
  ('/practice-protection-pack',                  '/courses/private-practice-protection-pack', false, 'needs a course detail page'),
  ('/protect-your-practice',                     '/courses/private-practice-protection-pack', false, 'needs a course detail page'),
  ('/fullybooked',                               '/courses/fully-booked-toolkit',             false, 'needs a course detail page'),
  ('/fullybookedtherapist',                      '/courses/fully-booked-toolkit',             false, 'needs a course detail page'),
  ('/credentialwithconfidencekit',               '/courses/credential-with-confidence',       false, 'needs a course detail page'),
  ('/credential-with-confidencekit-confirmed',   '/checkout/success',                         true,  'post-purchase confirmation'),
  ('/credentialingsuccess',                      '/courses/credentialing-success-formula',    false, 'needs a course detail page'),
  ('/cwcsolopractice',                           '/courses/credential-with-confidence',       false, 'solo-practice variant'),
  ('/csfgrouppractices',                         '/courses/credentialing-success-formula',    false, 'group-practice variant'),
  ('/profiletoprofitguide',                      '/courses/from-profile-to-profit',           false, 'needs a course detail page'),
  ('/the-directory-makeover-audit',              '/courses/directory-makeover-audit',         false, 'needs a course detail page'),
  ('/startersuitecourse',                        '/courses/private-practice-starter-suite',   false, 'needs a course detail page'),
  ('/rampedrevenue',                             '/courses/ramp-up-rate-formula',             false, 'needs a course detail page'),
  ('/practice-planner',                          '/courses/prepare-to-profit-journal',        false, 'needs a course detail page'),
  ('/the-lounge-suite',                          '/work-with-me',                             false, 'Lounge membership sales page'),
  ('/boss-builders-sales-page',                  '/work-with-me',                             false, 'Boss Builders Collective sales page'),
  ('/profitable-private-practice-leap-accelerator', '/work-with-me',                          false, 'Leap Accelerator sales page'),
  ('/private-practice-for-you',                  '/work-with-me',                             false, 'sales page'),
  ('/turn-doctor-referrals-into-ideal-client',   '/courses/provider-partnership-guide',       false, 'needs a course detail page'),

  -- Lead magnets / opt-ins
  ('/5-step-marketing',                          '/resources',        false, 'opt-in landing page'),
  ('/business-plan-guide',                       '/resources',        false, 'opt-in landing page'),
  ('/insurance-guide',                           '/resources',        true,  'maps to free-guide-insurance-vs-superbills'),
  ('/kickstartguide',                            '/resources',        true,  'maps to free-starter-guide'),
  ('/practice-reset-planner',                    '/practice-reset-planner', true, 'same path'),
  ('/reset-planner-form',                        '/practice-reset-planner', true, ''),
  ('/marketing-step-form',                       '/resources',        false, 'opt-in form page'),
  ('/masterclass-review-sheet',                  '/resources',        false, 'masterclass companion'),
  ('/next-steps-consult',                        '/apply',            true,  ''),
  ('/on-demand-audit-your-private-practice',     '/resources',        false, 'evergreen masterclass registration'),
  ('/evergreen-masterclass-register',            '/resources',        false, 'evergreen masterclass registration'),
  ('/reset-audit',                               '/resources',        false, 'audit opt-in'),
  ('/reset-audit-form',                          '/resources',        false, 'audit opt-in form'),

  -- Quizzes and their result forms
  ('/practice-quiz',                             '/practice-quiz',    true,  'same path'),
  ('/offer-quiz',                                '/practice-quiz',    false, 'offer archetype quiz'),
  ('/hiring-quiz',                               '/practice-quiz',    false, 'hiring readiness quiz'),
  ('/boss-assessment',                           '/practice-quiz',    false, 'boss assessment'),
  ('/start-your-own-private-practice-quiz',      '/practice-quiz',    false, 'start-a-practice quiz'),
  ('/practice-set-up-quiz',                      '/practice-quiz',    false, 'practice setup quiz'),
  ('/practice-set-up-quiz-ty',                   '/practice-quiz',    false, 'quiz thank-you'),
  ('/visionary-form',                            '/practice-quiz',    false, 'quiz result: Visionary Builder'),
  ('/steady-form',                               '/practice-quiz',    false, 'quiz result: Steady Grower'),
  ('/careful-form',                              '/practice-quiz',    false, 'quiz result: Careful Clinician'),
  ('/reluctant-form',                            '/practice-quiz',    false, 'quiz result: Reluctant CEO'),
  ('/hire-form',                                 '/practice-quiz',    false, 'hiring quiz result form'),

  -- Replays and webinars
  ('/audit-private-practice-replay',             '/resources',        false, 'replay page'),
  ('/replay-audit-your-ppractice-edu',           '/resources',        false, 'replay page'),
  ('/replay-audit-your-practice',                '/resources',        false, 'replay page'),
  ('/webinar-waitlist-thank-you',                '/resources',        false, 'waitlist thank-you'),

  -- Thank-you / confirmation pages
  ('/thank-you',                                 '/checkout/success', true,  ''),
  ('/thank-you-audit-proof',                     '/checkout/success', true,  ''),
  ('/thank-you-fullybooked',                     '/checkout/success', true,  ''),
  ('/thank-you-rate-renegotiate',                '/checkout/success', true,  ''),
  ('/confirmation-page-1',                       '/checkout/success', true,  ''),
  ('/confirmation-boss-clinician-lounge',        '/checkout/success', true,  ''),
  ('/starterconfirmed',                          '/checkout/success', true,  ''),
  ('/protectionpackthanks',                      '/checkout/success', true,  ''),
  ('/business-plan-ty',                          '/resources',        true,  ''),
  ('/practice-planner-thank-you',                '/resources',        true,  ''),
  ('/practice-reset-audit-ty',                   '/resources',        true,  ''),
  ('/profile-audit-ty',                          '/resources',        true,  ''),
  ('/private-practice-for-you-ty',               '/work-with-me',     true,  ''),
  ('/leap-accelerator-thank-you',                '/work-with-me',     true,  ''),
  ('/the-boss-builders-collective-thank-you-page', '/work-with-me',   true,  ''),
  ('/step-by-step-guide-thank-you-page',         '/resources',        true,  ''),
  ('/retreat-thank-you-page',                    '/retreats',         true,  ''),

  -- Legal
  ('/terms-of-use',                              '/terms',            true,  ''),
  ('/terms-of-service-boss-clinician',           '/terms',            true,  ''),
  ('/coaching-terms',                            '/terms',            false, 'coaching-specific terms need their own page'),
  ('/ceu-terms-boss-clinician',                  '/terms',            false, 'CEU terms need their own page'),
  ('/retreatagreement',                          '/terms',            false, 'retreat agreement needs its own page'),
  ('/disclaimer',                                '/disclaimer',       true,  'same path'),
  ('/financialdisclaimer',                       '/financial-disclaimer', true, 'hyphenation changed'),
  ('/privacy-policy',                            '/privacy-policy',   true,  'same path'),
  ('/privacy-policy-8b664a08-e1e5-4f19-8d9a-5cb8f33bf104', '/privacy-policy', true, 'Kajabi duplicate with a uuid suffix'),

  -- Continuing education
  ('/continuing-education-boss-clinician',       '/courses',          false, 'CEU catalogue page'),

  -- Podcast
  ('/podcasts/lyrical-reflections',              '/podcasts/lyrical-reflections', false, 'podcast show page not built yet'),
  ('/podcasts/lyrical-reflections/episodes/2148691037', '/podcasts/lyrical-reflections', false, 'episode 1'),
  ('/podcasts/lyrical-reflections/episodes/2148691038', '/podcasts/lyrical-reflections', false, 'episode 2'),
  ('/podcasts/lyrical-reflections/episodes/2148691039', '/podcasts/lyrical-reflections', false, 'episode 3'),
  ('/podcasts/lyrical-reflections/episodes/2148691040', '/podcasts/lyrical-reflections', false, 'episode 4'),
  ('/podcasts/lyrical-reflections/episodes/2148691041', '/podcasts/lyrical-reflections', false, 'episode 5'),
  ('/podcasts/lyrical-reflections/episodes/2148691042', '/podcasts/lyrical-reflections', false, 'episode 6'),
  ('/podcasts/lyrical-reflections/episodes/2148691043', '/podcasts/lyrical-reflections', false, 'episode 7'),
  ('/podcasts/lyrical-reflections/episodes/2148691044', '/podcasts/lyrical-reflections', false, 'episode 8'),
  ('/podcasts/lyrical-reflections/episodes/2148691045', '/podcasts/lyrical-reflections', false, 'episode 9')
ON CONFLICT (from_path) DO NOTHING;

-- The 8 blog posts and /blog itself keep their exact paths on the new platform,
-- verified slug by slug against the live database, so they need no rows here.
-- The 21 indexed /blog?tag=… archives likewise resolve unchanged: the query
-- string is preserved and /blog already reads `tag`.
