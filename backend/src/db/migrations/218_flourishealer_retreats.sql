-- =============================================================================
-- 218 — FlourisHealer Retreat Dashboard, Phase 1 (sheet row 248, Yvette's item 11,
-- 22 Nov 2026: "create the private retreat dashboard as a course within the
-- existing Boss Clinician portal").
--
-- Ships UNPUBLISHED. Nothing here grants access to anybody, sends any email, or
-- copies any guest's data:
--   * retreats.published = false — every guest endpoint answers 404 until the
--     owner publishes it under Admin › Products › Retreats.
--   * The dashboard is its OWN product ('flourishealer-retreats-bali-2027', status
--     draft) wrapping its own course (published = false). No access_grants row
--     is created. The existing booking product 70 ('bali-retreat-2027', 4 import
--     grants) is only REFERENCED (booking_product_id) so the admin can see who
--     holds a booking but has not been given the dashboard yet; it is not linked
--     to the new course in any way.
--   * Agreement status is READ from participant_contract_assignments (the real
--     signing records); this migration links the two existing Bali agreement
--     documents to the retreat and creates no assignment.
--
-- Columns other work depends on (agent F, alumni email sequence):
--   retreats(id, slug, title, location, start_date, end_date, timezone,
--            product_id, course_id, published, created_at)
--   product_id         = the DASHBOARD product (grant it to give a guest the dashboard)
--   booking_product_id = the product the room offers sell (Bali: product 70)
--
-- Idempotent: CREATE ... IF NOT EXISTS, and every seed row is inserted only
-- when its slug is absent. Lookups are by slug/title, never serial id, so the
-- file also applies cleanly to an empty test database where product 70, the
-- room offers and the agreement documents do not exist.
-- =============================================================================

CREATE TABLE IF NOT EXISTS retreats (
  id                 SERIAL PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title              TEXT NOT NULL,
  location           TEXT NOT NULL DEFAULT '',
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  timezone           TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  product_id         INTEGER REFERENCES products(id) ON DELETE SET NULL,
  booking_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  course_id          INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  published          BOOLEAN NOT NULL DEFAULT false,
  -- Owner-editable dashboard content and switches (services/retreats.ts
  -- normaliseSettings fills anything missing with the safe default).
  settings           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT retreats_dates_ordered CHECK (end_date >= start_date)
);

-- The offers that sell a place on this retreat (payments panel reads their orders).
CREATE TABLE IF NOT EXISTS retreat_offers (
  retreat_id INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  offer_id   INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  PRIMARY KEY (retreat_id, offer_id)
);

-- The agreement documents whose signed assignments count as "My Agreement".
-- Explicit, because one Bali agreement document is not linked to any offer.
CREATE TABLE IF NOT EXISTS retreat_contracts (
  retreat_id  INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  contract_id BIGINT  NOT NULL REFERENCES participant_contracts(id) ON DELETE CASCADE,
  PRIMARY KEY (retreat_id, contract_id)
);

-- Per guest, per checklist task: what the guest reported, and the organizer's review.
-- A guest can only ever write guest_status='submitted'/'none'; Verified and
-- Needs attention exist only as an admin review (review_status).
CREATE TABLE IF NOT EXISTS retreat_guest_tasks (
  retreat_id       INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  task_key         TEXT NOT NULL CHECK (task_key IN (
                     'agreement','guest_profile','flight_preferences','travel_insurance',
                     'flight_details','passport','payments','group_call')),
  guest_status     TEXT NOT NULL DEFAULT 'none' CHECK (guest_status IN ('none','submitted')),
  guest_data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  guest_updated_at TIMESTAMPTZ,
  review_status    TEXT CHECK (review_status IN ('verified','needs_attention')),
  review_note      TEXT NOT NULL DEFAULT '',
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  PRIMARY KEY (retreat_id, member_id, task_key)
);

-- Native retreat forms (Flight Preferences, Travel Insurance): Save & Finish
-- Later drafts and validated submissions, one current row per guest per form.
CREATE TABLE IF NOT EXISTS retreat_form_responses (
  id           SERIAL PRIMARY KEY,
  retreat_id   INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  form_key     TEXT NOT NULL CHECK (form_key IN ('flight_preferences','travel_insurance')),
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  state        TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','submitted')),
  revision     INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  UNIQUE (retreat_id, member_id, form_key)
);

-- Every validated submission, kept so a corrected itinerary keeps its history.
CREATE TABLE IF NOT EXISTS retreat_form_submissions (
  id           SERIAL PRIMARY KEY,
  response_id  INTEGER NOT NULL REFERENCES retreat_form_responses(id) ON DELETE CASCADE,
  data         JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retreat_form_submissions_response_idx ON retreat_form_submissions (response_id, submitted_at DESC);

-- Messages & Announcements. Posting one never sends email.
CREATE TABLE IF NOT EXISTS retreat_announcements (
  id           SERIAL PRIMARY KEY,
  retreat_id   INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body_md      TEXT NOT NULL DEFAULT '',
  published    BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_by   INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Private Retreat Memories gallery. Files are stored as protected: references
-- (never under the public /uploads mount) and leave only through short-lived
-- signed links re-checked against retreat membership on every request.
CREATE TABLE IF NOT EXISTS retreat_media (
  id              SERIAL PRIMARY KEY,
  retreat_id      INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
  admin_user_id   INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  storage_ref     TEXT NOT NULL,
  mime            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('photo','video')),
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  original_name   TEXT NOT NULL DEFAULT '',
  caption         TEXT NOT NULL DEFAULT '',
  -- The uploader's own "I have permission to share these" acknowledgement.
  -- It is NOT marketing consent and nothing reads it as such.
  sharing_consent BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden','removed')),
  reviewed_by     INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  removed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retreat_media_retreat_idx ON retreat_media (retreat_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS retreat_media_reports (
  id          SERIAL PRIMARY KEY,
  media_id    INTEGER NOT NULL REFERENCES retreat_media(id) ON DELETE CASCADE,
  member_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  UNIQUE (media_id, member_id)
);

-- ── Seed: the Bali 2027 dashboard course, its own draft product, the retreat ──

-- 1. The course (unpublished: never in the public catalogue).
INSERT INTO courses (slug, title, subtitle, description, price_text, image, url, features, sort, published)
SELECT 'flourishealer-retreats-bali-2027',
       'FlourisHealer Retreats — Bali 2027',
       'Your private retreat dashboard',
       'Your private FlourisHealer retreat dashboard: your agreement, guest profile, travel and flights, travel insurance, preparation, itinerary, payments and messages in one place.',
       '', NULL, '', '[]'::jsonb,
       (SELECT COALESCE(MAX(sort), 0) + 1 FROM courses),
       false
 WHERE NOT EXISTS (SELECT 1 FROM courses WHERE slug = 'flourishealer-retreats-bali-2027');

-- 2. One module, one lesson carrying the dashboard tool (no video, quiz or
--    certificate: the lesson body is empty, so the player shows only the tool).
INSERT INTO course_modules (course_id, title, sort)
SELECT c.id, 'Your Retreat Dashboard', 0
  FROM courses c
 WHERE c.slug = 'flourishealer-retreats-bali-2027'
   AND NOT EXISTS (SELECT 1 FROM course_modules m WHERE m.course_id = c.id);

INSERT INTO course_lessons
  (module_id, title, slug, body_md, content_type, published, sort, tool_key, tool_config,
   requires_previous_lesson, watch_rule, comments_enabled, notes_enabled)
SELECT m.id, 'YOUR RETREAT DASHBOARD', 'your-retreat-dashboard', '', 'text', true, 0,
       'flourishealer-retreat-dashboard', '{"retreat": "bali-2027"}'::jsonb,
       false, 'skippable', false, false
  FROM course_modules m
  JOIN courses c ON c.id = m.course_id
 WHERE c.slug = 'flourishealer-retreats-bali-2027'
   AND NOT EXISTS (
     SELECT 1 FROM course_lessons l WHERE l.module_id = m.id AND l.slug = 'your-retreat-dashboard'
   );

-- 3. The dashboard's own product, draft, granted to nobody.
INSERT INTO products (slug, title, subtitle, description, kind, course_id, status, sort)
SELECT 'flourishealer-retreats-bali-2027',
       'FlourisHealer Retreats — Bali 2027',
       'Private retreat dashboard',
       'Private guest dashboard for the FlourisHealer Bali retreat, June 15–20, 2027. Give this product to a confirmed guest to open her dashboard.',
       'course', c.id, 'draft',
       (SELECT COALESCE(MAX(sort), 0) + 1 FROM products)
  FROM courses c
 WHERE c.slug = 'flourishealer-retreats-bali-2027'
   AND NOT EXISTS (SELECT 1 FROM products WHERE slug = 'flourishealer-retreats-bali-2027');

-- 4. The retreat instance. Facts from Yvette's 22 Nov answers (item 4) and the
--    developer brief; every unconfirmed operational detail starts unconfirmed.
INSERT INTO retreats (slug, title, location, start_date, end_date, timezone,
                      product_id, booking_product_id, course_id, published, settings)
SELECT 'bali-2027',
       'FlourisHealer Bali 2027',
       'Ubud, Bali',
       DATE '2027-06-15',
       DATE '2027-06-20',
       'America/Los_Angeles',
       (SELECT id FROM products WHERE slug = 'flourishealer-retreats-bali-2027'),
       (SELECT id FROM products WHERE slug = 'bali-retreat-2027'),
       (SELECT id FROM courses  WHERE slug = 'flourishealer-retreats-bali-2027'),
       false,
       jsonb_build_object(
         'dashboardTitle', 'YOUR RETREAT DASHBOARD',
         'welcomeMessage', $w$Your time to be poured into starts now. You’ve spent so much time showing up for everyone else. Now you’ve made space for yourself, and we’re here to help you prepare for the experience.$w$,
         'supportEmail', 'retreats@bossclinician.com',
         'airport', 'Ngurah Rai International Airport, Denpasar (DPS)',
         'guestProfileUrl', 'https://form.jotform.com/262158194471057',
         'flightTrackerUrl', 'https://form.jotform.com/262157915507057',
         'transportNote', $t$Airport transportation is provided during June 15–20 through designated group transfers. Exact pickup windows will be coordinated with guests.$t$,
         'shuttle', jsonb_build_object('confirmed', false, 'details', ''),
         'groupCall', jsonb_build_object('confirmed', false, 'startsAt', NULL, 'timezone', 'America/Los_Angeles', 'joinUrl', '', 'notes', ''),
         'flightGuidance', jsonb_build_object('status', 'researching', 'note', ''),
         'inclusions', jsonb_build_array(
           'Five nights at a private villa in Ubud',
           'Designated group airport transfers',
           'Villa chef meals and scheduled outside meals',
           'Wellness experiences: sound bath, breathwork, Balinese massage and flower bath',
           'Group activities: temple tour, fire show, beach and photo day, shared storytelling and dancing',
           'Pre-trip group call',
           'Welcome items'
         ),
         'itineraryMd', '',
         'preparationMd', $p$### Passport
Check your passport's expiration date now. We recommend your passport be valid through at least **December 20, 2027**.

### Entry and visa requirements
Official entry and visa guidance for Indonesia will be posted here with the date it was verified. Until then, please check the current requirements with official government sources before you travel.

### Arrival and time zones
You'll arrive at Ngurah Rai International Airport, Denpasar (DPS) on June 15, 2027, and depart on June 20, 2027. Because of time zones and connections, many guests travelling from the U.S. may need to leave home on June 13 or 14.

### Suggested packing list
These are suggestions, not requirements:

- Light, breathable outfits
- A bright outfit for our photo dinner
- Swimwear
- Walking shoes and sandals
- A light wrap
- Modest clothing for temple visits
- Sunscreen and insect repellent
- Your medications
- A travel adapter
- Your passport
- Space in your luggage for your welcome bag$p$,
         'passportValidThrough', '2027-12-20',
         'gallery', jsonb_build_object('mode', 'auto', 'uploadsMode', 'auto', 'requireReview', true, 'maxPhotoMb', 20, 'maxVideoMb', 200),
         'feedback', jsonb_build_object('mode', 'auto'),
         'interest', jsonb_build_object('mode', 'auto'),
         'joinUsAgain', jsonb_build_object('mode', 'closed',
           'intro', $j$Loved having you with us. Ready for your next FlourisHealer experience? Explore what’s coming next—or join the first-access list.$j$)
       )
 WHERE NOT EXISTS (SELECT 1 FROM retreats WHERE slug = 'bali-2027');

-- 5. The room offers (payments panel). The archived QA offer is deliberately excluded.
INSERT INTO retreat_offers (retreat_id, offer_id)
SELECT r.id, o.id
  FROM retreats r
  JOIN offers o ON o.slug IN ('bali-private-room', 'bali-shared-room')
 WHERE r.slug = 'bali-2027'
ON CONFLICT DO NOTHING;

-- 6. The two existing Bali agreement documents. Their stored titles carry month
--    labels; services/retreats.ts never shows a contract title to a guest.
INSERT INTO retreat_contracts (retreat_id, contract_id)
SELECT r.id, c.id
  FROM retreats r
  JOIN participant_contracts c ON c.title ILIKE 'Bali Retreat Agreement%'
 WHERE r.slug = 'bali-2027'
ON CONFLICT DO NOTHING;
