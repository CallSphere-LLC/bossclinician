-- =============================================================================
-- The Freedom Masterclass gets its own sign-up page on this site:
-- /freedom-masterclass (frontend/src/pages/FreedomMasterclass.tsx), which sends
-- people on to /watch-now (frontend/src/pages/WatchNow.tsx) once they register.
--
-- Yvette's words: "The masterclass buttons on the homepage is linked to the
-- wrong page … after they enter their information it takes it to this page then
-- I'll upload the video on there." Every masterclass link on the site went to
-- the generic /resources hub, because 061 pointed /freedom-masterclass there
-- while no page existed.
--
-- Three things change in the data for it.
--
-- 1. A tag, "Freedom Masterclass", so she can see and segment everyone who
--    registered (Contacts → filter by tag).
--
-- 2. The sign-up is a real form. The page posts first name and email to the
--    form below (POST /api/forms/freedom-masterclass/submit, the same path the
--    Boardroom application uses — routes/public/growthPublic.ts), so each
--    registration is a reply in Forms, a contact, an activity on that contact's
--    timeline and the tag above. It is NOT a lead (`create_lead false`): a
--    lead also emails the owner, and a free opt-in is not an enquiry she has to
--    answer. No email goes to the registrant from this path either — the page
--    itself is the delivery. A sequence can be attached from the Forms screen
--    whenever she wants one.
--
-- 3. The redirects stop sending people away from it. 061's
--    /freedom-masterclass -> /resources row would 301 every visitor away from
--    the page that now exists, and the other old masterclass addresses now
--    reach the sign-up instead of the hub.
--
-- The video on /watch-now is not in this file: it is a setting
-- (services/settings.ts, key `masterclass`), and a settings row that does not
-- exist yet reads as its defaults, so nothing needs seeding for it.
--
-- Conventions are 004/019/061/064/074's: from_path lowercase with a leading
-- slash and no trailing slash, and ON CONFLICT DO NOTHING throughout, so
-- anything edited by hand in the admin since is left exactly as it was —
-- including the form, whose labels and messages are hers to change from the
-- Forms screen.
--
-- nginx serves these redirects from nginx/redirects.map, which is baked into
-- the gateway image at build time and is NOT regenerated from this table by
-- the K3s deploy. The checked-in map is edited in the same change to match what
-- this file leaves in the table; the two must ship together.
-- =============================================================================

-- --- 1. The tag ---------------------------------------------------------------
INSERT INTO tags (name, slug, description) VALUES (
  'Freedom Masterclass',
  'freedom-masterclass',
  'Registered for the free Freedom Masterclass at /freedom-masterclass.'
)
ON CONFLICT (slug) DO NOTHING;

-- --- 2. The sign-up form -------------------------------------------------------
-- The page draws its own two boxes and sends exactly these keys. `name` holds
-- the first name — the only name the page asks for, as her Kajabi form did —
-- and is mapped to the contact's first-name column, so it fills that column on
-- the contact without shortening a full name somebody already has on file.
-- `email` is mapped to the address column, as 074's is.
--
-- The tag is looked up by slug rather than written as an id, because ids differ
-- between this database and any other the migration runs against.
INSERT INTO forms (
  slug, name, description, fields, submit_label, success_message,
  create_lead, published, post_action, spam_protection, apply_tag_ids
) VALUES (
  'freedom-masterclass',
  'Freedom Masterclass',
  $desc$The sign-up on the /freedom-masterclass page. The page draws its own first-name and email boxes and then takes people to /watch-now, where the video is; change the video in Settings → Your website → Free masterclass.$desc$,
  $fields$[
    {"key": "name", "label": "First name", "type": "text", "required": true, "contactField": "firstName"},
    {"key": "email", "label": "Email", "type": "email", "required": true, "contactField": "email"}
  ]$fields$::jsonb,
  'Get free access',
  $msg$You're in. Taking you to the masterclass now.$msg$,
  false,
  true,
  'message',
  'honeypot',
  COALESCE((SELECT ARRAY[id] FROM tags WHERE slug = 'freedom-masterclass'), '{}')
)
ON CONFLICT (slug) DO NOTHING;

-- --- 3. Nothing may shadow the new pages ---------------------------------------
-- Any row for either address, not only the one 061 wrote: nginx answers from
-- the redirect map before any location block, so a hand-made row would 301 the
-- visitor away from a page that now exists — 074's reasoning for /boardroom. A
-- self-row (from = to) is inert in both readers and is left alone.
DELETE FROM redirects
 WHERE from_path IN ('/freedom-masterclass', '/watch-now')
   AND to_path <> from_path;

-- --- 4. Old masterclass addresses reach the sign-up ----------------------------
-- The three 004/061 sent to /resources as the nearest page. Scoped to that
-- value, so a row retargeted by hand is kept.
UPDATE redirects
   SET to_path = '/freedom-masterclass', target_exists = true, updated_at = now(),
       note = 'Freedom Masterclass sign-up page'
 WHERE from_path IN ('/masterclass', '/evergreen-masterclass-register', '/masterclass-review-sheet')
   AND to_path = '/resources';

-- And written outright for any of them that is missing on this database.
INSERT INTO redirects (from_path, to_path, status_code, target_exists, note) VALUES
  ('/masterclass',                    '/freedom-masterclass', 301, true, 'Freedom Masterclass sign-up page'),
  ('/evergreen-masterclass-register', '/freedom-masterclass', 301, true, 'Freedom Masterclass sign-up page'),
  ('/masterclass-review-sheet',       '/freedom-masterclass', 301, true, 'Freedom Masterclass sign-up page')
ON CONFLICT (from_path) DO NOTHING;

-- --- 5. The Resources card points at the page -----------------------------------
-- The masterclass card on /resources is a CMS row whose button went off-site to
-- the Kajabi page (or nowhere: the seed wrote '#'). Only those placeholder
-- values are replaced; a link she set herself is kept.
UPDATE resources
   SET cta_url = '/freedom-masterclass', updated_at = now()
 WHERE kind = 'masterclass'
   AND cta_url IN (
     '#',
     '/resources',
     'https://www.bossclinician.com/freedom-masterclass',
     'https://bossclinician.com/freedom-masterclass'
   );
