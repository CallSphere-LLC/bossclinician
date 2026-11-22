-- =============================================================================
-- 224 — Retreat dashboard round 2 (Yvette's answers of 22 Nov 2026, item 7):
-- reusable, owner-editable questionnaires; per-guest dashboard access records;
-- the room type a guest booked (for "shared-room guests only" questions).
--
-- Ships with NOTHING switched on for anybody:
--   * No access_grants row is created. No member is created. No email is sent.
--   * The Bali retreat stays unpublished (retreats.published is not touched).
--   * The three Bali questionnaires are seeded as version 1. Nobody has answered
--     anything yet (retreat_form_responses / retreat_guest_tasks are empty on
--     the live database), so no existing answer is rewritten.
--
-- Versioning rule (services/retreatQuestionnaires.ts): a question definition is
-- never edited in place. Saving a changed questionnaire inserts a NEW row in
-- retreat_questionnaire_versions; old versions are never updated or deleted.
-- Every response and every submission stores the version it was saved against
-- AND a snapshot of each answered question's wording, so later edits can never
-- change what a guest answered or what she was asked.
--
-- Responses use ON DELETE RESTRICT: a questionnaire somebody has answered
-- cannot be deleted (the admin can only archive it).
--
-- Idempotent: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, and every
-- seed row is inserted only when absent. Lookups are by slug, never serial id.
-- =============================================================================

-- 1. Which room an offer sells (a paid order on it tells us a guest's room) ----
ALTER TABLE retreat_offers
  ADD COLUMN IF NOT EXISTS room_type TEXT CHECK (room_type IS NULL OR room_type IN ('private', 'shared'));

UPDATE retreat_offers ro SET room_type = 'shared'
  FROM offers o
 WHERE o.id = ro.offer_id AND o.slug = 'bali-shared-room' AND ro.room_type IS NULL;
UPDATE retreat_offers ro SET room_type = 'private'
  FROM offers o
 WHERE o.id = ro.offer_id AND o.slug = 'bali-private-room' AND ro.room_type IS NULL;

-- 2. Per-guest access record kept by the organizer ---------------------------
-- The ACCESS itself is still only the access_grants row on the retreat's
-- dashboard product (source 'manual'); this table records who granted or
-- removed it, the booking email it was matched from, the room type (for
-- imported/Kajabi bookings that have no order here) and the access email.
-- Nothing here touches orders, payment plans or balances.
CREATE TABLE IF NOT EXISTS retreat_guests (
  retreat_id         INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  member_id          INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  room_type          TEXT CHECK (room_type IS NULL OR room_type IN ('private', 'shared')),
  booking_email      TEXT NOT NULL DEFAULT '',
  email_mismatch_accepted BOOLEAN NOT NULL DEFAULT false,
  access_granted_at  TIMESTAMPTZ,
  access_granted_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  access_removed_at  TIMESTAMPTZ,
  access_removed_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  welcome_sent_at    TIMESTAMPTZ,
  welcome_sent_by    INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  welcome_send_count INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (retreat_id, member_id)
);

-- 3. Questionnaires ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS retreat_questionnaires (
  id              SERIAL PRIMARY KEY,
  retreat_id      INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  key             TEXT NOT NULL CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(key) <= 60),
  title           TEXT NOT NULL,
  -- Shown on the guest's preparation checklist when true.
  in_checklist    BOOLEAN NOT NULL DEFAULT true,
  -- Optional "please complete by" date (shown in Important dates).
  due_date        DATE,
  sort            INTEGER NOT NULL DEFAULT 0,
  archived        BOOLEAN NOT NULL DEFAULT false,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (retreat_id, key)
);

-- Immutable: one row per saved version, never updated.
CREATE TABLE IF NOT EXISTS retreat_questionnaire_versions (
  id               SERIAL PRIMARY KEY,
  questionnaire_id INTEGER NOT NULL REFERENCES retreat_questionnaires(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL CHECK (version >= 1),
  definition       JSONB NOT NULL,
  created_by       INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (questionnaire_id, version)
);

-- One current response per guest per questionnaire (Save progress / submit).
CREATE TABLE IF NOT EXISTS retreat_questionnaire_responses (
  id               SERIAL PRIMARY KEY,
  questionnaire_id INTEGER NOT NULL REFERENCES retreat_questionnaires(id) ON DELETE RESTRICT,
  member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  answers          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- question id -> {label, type, section, options, version}: what she was asked.
  question_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  state            TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted')),
  revision         INTEGER NOT NULL DEFAULT 1,
  review_status    TEXT CHECK (review_status IN ('verified', 'needs_attention')),
  review_note      TEXT NOT NULL DEFAULT '',
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at     TIMESTAMPTZ,
  UNIQUE (questionnaire_id, member_id)
);

-- Every submission, kept forever (never updated): the answers, the version and
-- the question wording exactly as submitted.
CREATE TABLE IF NOT EXISTS retreat_questionnaire_submissions (
  id                SERIAL PRIMARY KEY,
  response_id       INTEGER NOT NULL REFERENCES retreat_questionnaire_responses(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL,
  answers           JSONB NOT NULL,
  question_snapshot JSONB NOT NULL,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retreat_questionnaire_submissions_response_idx
  ON retreat_questionnaire_submissions (response_id, submitted_at DESC);

-- Files a guest attached to a "file / photo" question. Protected storage only
-- (never the public /uploads mount); served to the owner guest or an organizer.
CREATE TABLE IF NOT EXISTS retreat_questionnaire_files (
  id               SERIAL PRIMARY KEY,
  questionnaire_id INTEGER NOT NULL REFERENCES retreat_questionnaires(id) ON DELETE RESTRICT,
  member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  question_id      TEXT NOT NULL,
  storage_ref      TEXT NOT NULL,
  mime             TEXT NOT NULL,
  size_bytes       BIGINT NOT NULL DEFAULT 0,
  original_name    TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retreat_questionnaire_files_owner_idx
  ON retreat_questionnaire_files (questionnaire_id, member_id);

-- 4. Seed the Bali questionnaires (version 1) ---------------------------------
-- Wording is Yvette's Jotform "Release. Restore. Reconnect. — Retreat Profile"
-- (form 262158194471057) and "— Flight Tracker" (262157915507057), with the
-- changes she asked for on 22 Nov: roommate question replaced (shared-room
-- guests only), activity-skip question added, massage "I prefer not to receive
-- a massage." added and the unconfirmed "alternative treatment" option removed,
-- her accessibility question, the "completely confidential with Yvette" promise
-- replaced by who can see the answers, diet = select all + allergies separate,
-- Instagram and photo optional with a separate sharing permission, flight
-- details in their own form so the profile can be finished before booking.
-- {{destination}} and {{dates}} are filled in from the retreat when shown.

INSERT INTO retreat_questionnaires (retreat_id, key, title, in_checklist, sort, current_version)
SELECT r.id, q.key, q.title, true, q.sort, 1
  FROM retreats r
  CROSS JOIN (VALUES ('retreat-profile', 'Retreat Profile', 10),
                     ('flight-preferences', 'Flight Preferences', 20),
                     ('flight-details', 'Flight Details', 30)) AS q(key, title, sort)
 WHERE r.slug = 'bali-2027'
ON CONFLICT (retreat_id, key) DO NOTHING;

INSERT INTO retreat_questionnaire_versions (questionnaire_id, version, definition)
SELECT q.id, 1, $def$
{
  "intro": "We are so excited to have you join us in {{destination}}, {{dates}}! Please complete this profile below so I can help curate your experience!\n\nYou can save your progress and come back to update your answers at any time. Your flight details have their own form, so you can complete this profile before you book your flights.",
  "sections": [
    {
      "id": "basics",
      "title": "THE BASICS",
      "description": "",
      "questions": [
        {"id": "full_legal_name", "type": "short_text", "label": "Full Legal Name (as it appears on your passport)", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "preferred_name", "type": "short_text", "label": "Preferred Name (Nickname)", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "mailing_address", "type": "long_text", "label": "Mailing Address", "help": "Street Address, Street Address Line 2, City, State / Province, Postal / Zip Code, Country", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "phone", "type": "short_text", "label": "Phone Number", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "email", "type": "short_text", "label": "Email", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "instagram", "type": "short_text", "label": "Instagram Handle", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "photo", "type": "file", "label": "A Photo of You", "help": "A clear photo of your beautiful face. This helps me and your retreat sisters get to know you before we land.", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "photo_share_permission", "type": "checkbox", "label": "I give permission for my photo to be shared with the other attendees of this retreat.", "help": "Your photo is shared with other attendees only if you tick this box. You can change this later.", "required": false, "options": [], "showTo": "all", "showIf": {"questionId": "photo", "anyOf": []}, "sensitive": false},
        {"id": "departure_city", "type": "short_text", "label": "Departure City, State, and Preferred Airport", "help": "Format: Las Vegas, NV — LAS Airport", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false}
      ]
    },
    {
      "id": "emergency_health",
      "title": "EMERGENCY AND HEALTH",
      "description": "Who can see your answers: Yvette and the retreat team who coordinate the support you request. If a request needs the villa or another provider (for example, the massage therapist), we share only the details they need to arrange it. Your health answers are never shown to other guests.",
      "questions": [
        {"id": "emergency_contact", "type": "short_text", "label": "Emergency Contact Name and Relationship", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "emergency_phone", "type": "short_text", "label": "Emergency Contact Phone Number", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "health_conditions", "type": "long_text", "label": "Do you have any physical limitations or health conditions?", "help": "Our week includes breathwork, sound bath, massage, a flower bath, a temple tour with walking, and a beach day. Please share anything I should know so every experience is safe and comfortable for you.", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": true},
        {"id": "accessibility_needs", "type": "long_text", "label": "Are there any mobility, accessibility, or participation needs you would like us to consider? Please share only information relevant to arranging your retreat experience.", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": true},
        {"id": "activities_to_skip", "type": "long_text", "label": "Are there any planned activities you would prefer to skip or discuss with us beforehand?", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": true},
        {"id": "massage_comfort", "type": "single_choice", "label": "Are you comfortable receiving massage?", "help": "", "required": true, "options": ["Yes, absolutely", "Yes, with some areas avoided (please note below)", "I prefer not to receive a massage."], "showTo": "all", "showIf": null, "sensitive": true},
        {"id": "massage_areas", "type": "long_text", "label": "Which areas should be avoided?", "help": "", "required": false, "options": [], "showTo": "all", "showIf": {"questionId": "massage_comfort", "anyOf": ["Yes, with some areas avoided (please note below)"]}, "sensitive": true},
        {"id": "medications", "type": "long_text", "label": "Any medications or medical needs we should be aware of?", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": true}
      ]
    },
    {
      "id": "food_drink",
      "title": "FOOD AND DRINK",
      "description": "",
      "questions": [
        {"id": "diet", "type": "multiple_choice", "label": "How would you identify your current diet?", "help": "This guides our chef's meal planning. If your diet changes often, choose how you prefer to eat while on the trip. Select all that apply.", "required": true, "options": ["I eat everything", "Pescatarian", "Vegetarian", "Vegan", "Gluten free", "Other (please explain below)"], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "diet_other", "type": "long_text", "label": "Please explain your other food preferences.", "help": "", "required": false, "options": [], "showTo": "all", "showIf": {"questionId": "diet", "anyOf": ["Other (please explain below)"]}, "sensitive": false},
        {"id": "allergies", "type": "long_text", "label": "Please list any food allergies or restrictions", "help": "Include things like no nuts, no dairy, no pork, no shellfish, etc. Write None if none.", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": true},
        {"id": "drinks", "type": "multiple_choice", "label": "Spirit and Drink Preferences", "help": "Select all that apply", "required": true, "options": ["Vodka", "Tequila", "Rum", "Whiskey", "Gin", "Red Wine (Dry)", "White Wine (Dry)", "Red Wine (Sweet)", "White Wine (Sweet)", "Champagne", "Mocktails and non-alcoholic options", "I do not / will not be drinking"], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "drink_favorite", "type": "long_text", "label": "Of everything above, what do you prefer most?", "help": "Feel free to note preferred brands. This serves as a guide but is not guaranteed.", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "snacks", "type": "long_text", "label": "What are your favorite snacks?", "help": "Sweet, salty, specific brands — tell me everything", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "coffee_tea", "type": "short_text", "label": "Coffee or tea? How do you take it?", "help": "Your retreat mornings deserve to start exactly right", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false}
      ]
    },
    {
      "id": "just_for_you",
      "title": "JUST FOR YOU",
      "description": "",
      "questions": [
        {"id": "size", "type": "dropdown", "label": "Preferred Size", "help": "We love adding a gift you can wear to your welcome bag. What size suits you best?", "required": true, "options": ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "Other"], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "shared_room_friend", "type": "short_text", "label": "If you arranged a shared room with a friend, please enter her full name.", "help": "", "required": false, "options": [], "showTo": "shared_room", "showIf": null, "sensitive": false},
        {"id": "hopes", "type": "long_text", "label": "What do you hope to get from this retreat?", "help": "Rest? Sisterhood? A reset? Tell me in your own words.", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "additional_notes", "type": "long_text", "label": "Additional Notes", "help": "Anything we missed? Preferences, celebrations happening during our trip, or anything you want me to know. This serves as a guide and no item is guaranteed.", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false}
      ]
    }
  ]
}
$def$::jsonb
  FROM retreat_questionnaires q JOIN retreats r ON r.id = q.retreat_id
 WHERE r.slug = 'bali-2027' AND q.key = 'retreat-profile'
ON CONFLICT (questionnaire_id, version) DO NOTHING;

-- The Flight Preferences questions are the ones already on the dashboard's
-- native form (built 22 Nov, item 11), now editable like any questionnaire.
INSERT INTO retreat_questionnaire_versions (questionnaire_id, version, definition)
SELECT q.id, 1, $def$
{
  "intro": "Before you buy a flight, share your preferences so we can research options together. You choose and book your own airfare.",
  "sections": [
    {
      "id": "preferences",
      "title": "Flight Preferences",
      "description": "",
      "questions": [
        {"id": "departure_airport", "type": "short_text", "label": "Home/departure city or airport", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "outbound_date", "type": "date", "label": "Earliest outbound travel date", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "return_date", "type": "date", "label": "Preferred return date", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "budget_range", "type": "short_text", "label": "Budget range for airfare", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "connections", "type": "single_choice", "label": "Connections", "help": "", "required": true, "options": ["Nonstop preferred", "One stop is fine", "Multiple connections are fine", "No preference"], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "layover_comfort", "type": "short_text", "label": "Layover comfort", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "group_travel", "type": "single_choice", "label": "Open to travelling with other guests?", "help": "", "required": true, "options": ["Yes", "Maybe", "No"], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "points_miles", "type": "short_text", "label": "Points or miles you may use", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "extension", "type": "single_choice", "label": "Trip extension", "help": "", "required": false, "options": ["No extension", "Before the retreat", "After the retreat", "Both", "Not sure yet"], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "considerations", "type": "long_text", "label": "Travel considerations you'd like us to know", "help": "Please don't include passport numbers or medical details.", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "questions", "type": "long_text", "label": "Questions for us", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false}
      ]
    }
  ]
}
$def$::jsonb
  FROM retreat_questionnaires q JOIN retreats r ON r.id = q.retreat_id
 WHERE r.slug = 'bali-2027' AND q.key = 'flight-preferences'
ON CONFLICT (questionnaire_id, version) DO NOTHING;

INSERT INTO retreat_questionnaire_versions (questionnaire_id, version, definition)
SELECT q.id, 1, $def$
{
  "intro": "Pack your bagssss! Once you've purchased your flight use this form to share the details! This will help us with tracking your flight and coordinating groups.\n\nYou can save your progress and update these details at any time. Enter each date and time as the local time at that airport.",
  "sections": [
    {
      "id": "arrival",
      "title": "Arrival",
      "description": "",
      "questions": [
        {"id": "traveling_from", "type": "short_text", "label": "Where are you traveling from?", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "arrival_airline", "type": "short_text", "label": "Arrival Airline", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "arrival_flight_number", "type": "short_text", "label": "Arrival Flight Number", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "arrival_date", "type": "date", "label": "Arrival Date", "help": "Local date at your arrival airport", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "arrival_time", "type": "time", "label": "Arrival Time", "help": "Local time at your arrival airport", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false}
      ]
    },
    {
      "id": "departure",
      "title": "Departure",
      "description": "",
      "questions": [
        {"id": "departure_airline", "type": "short_text", "label": "Departure Airline", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "departure_flight_number", "type": "short_text", "label": "Departure Flight Number", "help": "", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "departure_date", "type": "date", "label": "Departure Date", "help": "Local date at your departure airport", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "departure_time", "type": "time", "label": "Departure Time", "help": "Local time at your departure airport", "required": true, "options": [], "showTo": "all", "showIf": null, "sensitive": false}
      ]
    },
    {
      "id": "transfers",
      "title": "Airport transfers and notes",
      "description": "",
      "questions": [
        {"id": "transfer_requests", "type": "long_text", "label": "Airport transfer requests", "help": "Final shuttle windows will be coordinated with guests and shared before travel.", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "flight_confirmation", "type": "file", "label": "Flight Confirmation Upload", "help": "", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false},
        {"id": "travel_notes", "type": "long_text", "label": "Notes", "help": "Anything else about your travel I should know? Traveling with another attendee, mobility needs at the airport, arriving a day early, etc.", "required": false, "options": [], "showTo": "all", "showIf": null, "sensitive": false}
      ]
    }
  ]
}
$def$::jsonb
  FROM retreat_questionnaires q JOIN retreats r ON r.id = q.retreat_id
 WHERE r.slug = 'bali-2027' AND q.key = 'flight-details'
ON CONFLICT (questionnaire_id, version) DO NOTHING;

-- 5. Bali settings: the welcome message opens with her own Jotform greeting,
--    now filled in from the retreat's destination and dates. Only rewritten
--    while it is still exactly the text migration 218 seeded.
UPDATE retreats
   SET settings = jsonb_set(settings, '{welcomeMessage}', to_jsonb(
         $w$We are so excited to have you join us in {{destination}}, {{dates}}!

Your time to be poured into starts now. You’ve spent so much time showing up for everyone else. Now you’ve made space for yourself, and we’re here to help you prepare for the experience.$w$::text)),
       updated_at = now()
 WHERE slug = 'bali-2027'
   AND settings->>'welcomeMessage' = $w$Your time to be poured into starts now. You’ve spent so much time showing up for everyone else. Now you’ve made space for yourself, and we’re here to help you prepare for the experience.$w$;

-- Yvette's FAQ transportation sentence (item 4) instead of the earlier wording.
UPDATE retreats
   SET settings = jsonb_set(settings, '{transportNote}', to_jsonb(
         $t$Airport transportation is provided through designated group transfers during these dates. Final shuttle windows will be coordinated with guests and shared before travel.$t$::text)),
       updated_at = now()
 WHERE slug = 'bali-2027'
   AND settings->>'transportNote' = $t$Airport transportation is provided during June 15–20 through designated group transfers. Exact pickup windows will be coordinated with guests.$t$;
