-- =============================================================================
-- Redirect backfill — the CTAs Appendix B did not cover
--
-- Appendix B (migration 004) was built from the list of *indexed* URLs. It
-- therefore misses every address that only ever appears as a button on a page:
-- a Kajabi offer link behind a "RESERVE NOW", the `/resource_redirect/...`
-- fallback each course card points at, a quiz link in the resource hub. Those
-- are not crawled, so they were not on the list — and they are the ones with
-- money attached, because they are what a visitor clicks to buy.
--
-- Left as they are, the day bossclinician.com points at this app is the day the
-- $3,500, $6,500 and $12,000 service buttons and both retreat deposit buttons
-- start answering 404.
--
-- Conventions are 004's, and they matter:
--   * from_path is stored lowercase, leading slash, no trailing slash, no query
--     string. Both readers depend on it — services/redirects.ts lowercases the
--     incoming path before its equality lookup, and nginx's `map` lowercases a
--     string key too. Kajabi's offer tokens are mixed case (`/offers/EGheHSbL`),
--     so a row written as typed would simply never match.
--   * target_exists = false marks a destination that is the closest live
--     section rather than the page that was actually being linked to. It is
--     what fills the "needs a page" worklist on the redirects screen; nothing
--     here is a 404, but the false rows are the ones still owed a page.
--
-- Every target below was checked against the route table in
-- frontend/src/App.tsx. Idempotent and safe to re-run: ON CONFLICT DO NOTHING
-- also means a row Yvette has since edited by hand is left exactly as she left
-- it.
-- =============================================================================

INSERT INTO redirects (from_path, to_path, target_exists, note) VALUES

  -- --- Paid service CTAs on /store -----------------------------------------
  -- The three cards on the storefront still link at Kajabi offer pages. There
  -- is no route of that shape here (checkout is /checkout/:offerSlug, keyed on
  -- an offer slug this app assigns, and these three services have no offer row
  -- yet), so they land on the page that sells all three and are flagged as
  -- owing a checkout. Both URL forms are written: Kajabi serves an offer at
  -- /offers/<token> and again at /offers/<token>/checkout, and which one a
  -- visitor has bookmarked is not something we get to choose.
  ('/offers/eghehsbl',                    '/store',    false, 'Practice Reset Intensive ($3,500) — needs an offer + checkout'),
  ('/offers/eghehsbl/checkout',           '/store',    false, 'Practice Reset Intensive ($3,500) — needs an offer + checkout'),
  ('/offers/ykwzvqdz',                    '/store',    false, 'Scale and Reclaim Suite ($6,500) — needs an offer + checkout'),
  ('/offers/ykwzvqdz/checkout',           '/store',    false, 'Scale and Reclaim Suite ($6,500) — needs an offer + checkout'),
  ('/offers/gswshbtx',                    '/store',    false, 'The Boss Boardroom ($12,000) — needs an offer + checkout'),
  ('/offers/gswshbtx/checkout',           '/store',    false, 'The Boss Boardroom ($12,000) — needs an offer + checkout'),

  -- --- Retreat deposits ----------------------------------------------------
  -- Both reservation buttons on /retreats. Same story: the retreat has no offer
  -- row, so the closest live page is the retreat page itself.
  ('/offers/z9zxy5pi',                    '/retreats', false, 'Retreat — Private King Suite, pay in full ($4,500)'),
  ('/offers/z9zxy5pi/checkout',           '/retreats', false, 'Retreat — Private King Suite, pay in full ($4,500)'),
  ('/offers/boofdeo2',                    '/retreats', false, 'Retreat — Private King Suite, payment plan ($500 deposit)'),
  ('/offers/boofdeo2/checkout',           '/retreats', false, 'Retreat — Private King Suite, payment plan ($500 deposit)'),

  -- --- Course catalogue fallback links -------------------------------------
  -- Every card in the training library carries a `/resource_redirect/...` URL
  -- as its buy link. Unlike the blocks above these have an exact destination:
  -- each one names a course, matched slug by slug against
  -- frontend/src/content/courses.ts, and /courses/:slug is a real route.
  --
  -- They are still target_exists = false, and the distinction is worth being
  -- precise about: the *route* resolves, but /api/courses/:slug answers 404 for
  -- a slug with no published row, and CourseDetail renders that as a genuine
  -- 404. Whether each row is published is a question about the database, not
  -- about this file, so they stay on the redirects screen's "needs a page"
  -- list until somebody has looked. 004 flags the same slugs the same way.
  ('/resource_redirect/landing_pages/2151750533', '/courses/directory-makeover-audit',           false, 'Directory Makeover Audit'),
  ('/resource_redirect/landing_pages/2150414734', '/courses/fully-booked-toolkit',               false, 'Fully Booked Toolkit'),
  ('/resource_redirect/landing_pages/2151053560', '/courses/credentialing-success-formula',      false, 'Credentialing Success Formula'),
  ('/resource_redirect/landing_pages/2151053468', '/courses/credential-with-confidence',         false, 'Credential With Confidence'),
  ('/resource_redirect/landing_pages/2151054099', '/courses/private-practice-starter-suite',     false, 'Private Practice Starter Suite'),
  ('/resource_redirect/landing_pages/2151104751', '/courses/ramp-up-rate-formula',               false, 'Ramp-Up Rate Formula'),
  ('/resource_redirect/landing_pages/2151230875', '/courses/provider-partnership-guide',         false, 'Provider Partnership Guide'),
  ('/resource_redirect/landing_pages/2151230877', '/courses/private-practice-protection-pack',   false, 'Private Practice Protection Pack'),
  ('/resource_redirect/landing_pages/2150427089', '/courses/from-profile-to-profit',             false, 'From Profile to Profit'),
  ('/resource_redirect/offers/jgx2ulva',          '/courses/marketing-mastery-for-therapists',   false, 'Marketing Mastery for Therapists'),
  ('/resource_redirect/offers/wmz5rngn',          '/courses/therapist-niche-clarity-accelerator', false, 'Therapist Niche Clarity Accelerator'),
  ('/resource_redirect/offers/7n6ffee2',          '/courses/rate-negotiation-letter-template',   false, 'Rate Negotiation Letter Template'),
  ('/resource_redirect/offers/jfvdgdjf',          '/courses/prepare-to-profit-journal',          false, 'Prepare to Profit Journal'),
  ('/resource_redirect/offers/yhc3aisz',          '/courses/client-consultation-call-script',    false, 'Client Consultation Call Script'),

  -- --- Quiz link in the resource hub ---------------------------------------
  -- "Is Private Practice Actually Right for You Right Now?" — a six-question
  -- readiness quiz that still runs on Kajabi. /practice-quiz is where 004 sends
  -- every other quiz that has not been rebuilt here, and this one keeps that
  -- convention rather than inventing a /quiz/<slug> that nothing publishes.
  ('/ready-quiz',                         '/practice-quiz', false, 'readiness quiz — not rebuilt here yet'),

  -- --- Blog posts featured on the home page --------------------------------
  -- The three teaser cards link at .com blog slugs. One of them has an exact
  -- local equivalent under a longer slug; the other two are posts this platform
  -- does not have, so they land on the blog index rather than on nothing, and
  -- are flagged as owing a page.
  ('/blog/how-to-stop-seeing-25-clients-a-week',
     '/blog/how-to-stop-seeing-25-clients-a-week-and-still-hit-your-income-goals', true,
     'same post, longer slug here'),
  ('/blog/is-talkspace-right-for-your-practice-goals', '/blog', false, 'post not migrated yet'),
  ('/blog/alma-vs-private-pay-group-practice-numbers', '/blog', false, 'post not migrated yet')

ON CONFLICT (from_path) DO NOTHING;

-- --- Deliberately not written here -------------------------------------------
--
-- /podcasts/lyrical-reflections and its nine episode paths (added by 004) point
-- at a path with no route: /podcasts exists only inside the member area, behind
-- RequireMember, and there is no per-show or per-episode route at all. There is
-- no public page on this site that is the right destination for a podcast, so
-- rather than send ten indexed URLs somewhere arbitrary they are left as they
-- are — target_exists = false, i.e. already on the redirects screen's "needs a
-- page" list — for Yvette to decide what a listener should land on.
--
-- /practice-quiz is likewise untouched. 004 maps it to itself; that row is
-- inert by design (resolveRedirect refuses a self-redirect rather than serving
-- a loop) and the path is a real route here, so no redirect can help. What is
-- actually wrong is on the page: the CTA on /practice-quiz links out to
-- https://www.bossclinician.com/practice-quiz, which after cutover is the page
-- the visitor is already reading. That is a front-end fix, not a redirect.
