-- =============================================================================
-- The Boardroom gets a page of its own: /boardroom (frontend/src/pages/Boardroom.tsx)
--
-- Two things change in the data for it.
--
-- 1. The application on that page is a real form. Yvette designed the page with
--    a six-step application that ended "This form is a preview. Your answers
--    are not sent or saved." On this site it posts to the form created below,
--    so every application is filed in Forms, becomes a contact and a lead, and
--    is emailed to the owner (routes/public/growthPublic.ts).
--
-- 2. The redirects stop sending people away from it. 061 pointed /boardroom at
--    /work-with-me because the page did not exist; left in place, that row
--    would 301 every visitor away from the page that now does.
--
-- Conventions are 004/019/061/064's: from_path lowercase with a leading slash
-- and no trailing slash, and ON CONFLICT DO NOTHING throughout, so anything
-- edited by hand in the admin since is left exactly as it was — including the
-- form, whose questions and messages are hers to change from the Forms screen.
--
-- nginx serves these redirects from nginx/redirects.map, which is baked into
-- the gateway image at build time and is NOT regenerated from this table by
-- the K3s deploy. The checked-in map is edited in the same change to match what
-- this file leaves in the table; the two must ship together.
-- =============================================================================

-- --- 1. The application form -------------------------------------------------
-- The keys, types, choices and required flags are the page's own
-- (frontend/src/content/boardroom.ts, `application.steps`), in its order, and
-- the labels are Yvette's wording. The server checks every reply against this
-- row, so a question added or made required here without the page following
-- is a reply the page cannot send; the page shows the server's reason when
-- that happens rather than a generic failure.
--
-- `name` and `email` come first, as the builder's starter fields do
-- (routes/admin/formsV2.ts STARTER_FIELDS), with the address mapped to the
-- contact's email column so the reply lands on the right person.
--
-- `social_profile` is optional here even though the page requires it when the
-- follow-up answer is "Instagram/Facebook": a stored rule can hide a question,
-- but not make a visible one conditionally required, so that one check lives
-- on the page, where her own page kept it.
--
-- Dollar-quoted because her copy is full of apostrophes.
INSERT INTO forms (
  slug, name, description, fields, submit_label, success_message,
  create_lead, published, post_action, spam_protection
) VALUES (
  'boardroom-application',
  'Boardroom Application',
  $desc$The application on the /boardroom page. The page draws its own six-step version of these questions; change a question here and change it in frontend/src/content/boardroom.ts too.$desc$,
  $fields$[
    {"key": "name", "label": "Full name", "type": "text", "required": true},
    {"key": "email", "label": "Email address", "type": "email", "required": true, "contactField": "email"},
    {"key": "practice", "label": "Practice name", "type": "text", "required": true},
    {"key": "social_profile", "label": "Instagram handle or Facebook profile link", "type": "text", "required": false,
     "placeholder": "@yourhandle or https://facebook.com/yourprofile"},

    {"key": "stage", "label": "Which best describes your current stage?", "type": "select", "required": true,
     "options": ["Established solo practice preparing to hire within 3–6 months", "Recently made my first hire",
                 "2–4 team members", "5–9 team members", "10+ team members"]},
    {"key": "experience", "label": "How long have you been in private practice, and how long has it been your primary income?",
     "type": "textarea", "required": true},
    {"key": "revenue", "label": "Approximate annual practice revenue", "type": "select", "required": true,
     "options": ["Under $150K", "$150K–$249K", "$250K–$499K", "$500K–$749K", "$750K–$999K", "$1M+",
                 "Prefer to discuss privately"]},

    {"key": "driver", "label": "What is driving your desire to grow beyond your current structure right now?",
     "type": "textarea", "required": true},
    {"key": "decision", "label": "What is the biggest decision you are currently trying to make?",
     "type": "textarea", "required": true},
    {"key": "challenge", "label": "What is the biggest challenge in your practice right now?", "type": "checkboxes",
     "required": true, "helpText": "Select all that apply.",
     "options": ["Profitability", "Hiring", "Team performance", "Leadership", "Delegation", "Systems or SOPs",
                 "Owner pay", "Provider utilization", "Compensation or benefits", "Reducing my own caseload",
                 "Payer mix or insurance", "Other"]},
    {"key": "sessions", "label": "How many client or patient appointments do you personally provide in an average week?",
     "type": "number", "required": true},

    {"key": "confidence", "label": "How confident are you that you understand your revenue, expenses, profit, payroll, and owner compensation?",
     "type": "select", "required": true,
     "options": ["Very confident", "Mostly confident", "Somewhat confident", "Not very confident",
                 "I mostly rely on my bookkeeper or accountant"]},
    {"key": "absence", "label": "If you stepped away for two weeks, what would stop, slow down, or still require you?",
     "type": "textarea", "required": true},
    {"key": "leadership", "label": "What is your biggest leadership or team challenge—or your biggest concern about becoming an employer?",
     "type": "textarea", "required": true},

    {"key": "future_role", "label": "What do you want your role in the practice to look like 12 months from now?",
     "type": "textarea", "required": true},
    {"key": "outcome", "label": "If The Boardroom worked exactly as you hoped, what would be different a year from now?",
     "type": "textarea", "required": true},
    {"key": "tried", "label": "What have you already tried, and what still feels unresolved?",
     "type": "textarea", "required": true},
    {"key": "why", "label": "Why is The Boardroom the right room for you right now?",
     "type": "textarea", "required": true},

    {"key": "readiness", "label": "Our Council is a small group of mental health practice owners who share real numbers, challenge one another with care, and follow through on decisions. How do you feel about participating in that kind of room?",
     "type": "select", "required": true,
     "options": ["I'm ready to participate fully.", "I'm excited and a little nervous.",
                 "I'm still deciding whether this is the right season."]},
    {"key": "follow_up", "label": "How would you prefer that I follow up with you?", "type": "select", "required": true,
     "options": ["Instagram/Facebook", "Email", "Either"]},
    {"key": "payment_preference", "label": "If invited to join, which payment options would you consider?",
     "type": "checkboxes", "required": true, "helpText": "Select all that apply.",
     "options": ["Pay in full — $18,000", "2 payments of $9,000", "6 payments of $3,000",
                 "12 monthly payments of $1,500", "I'd like to discuss the options before deciding"]},
    {"key": "hesitation", "label": "If you received an invitation today, what—if anything—would keep you from moving forward?",
     "type": "textarea", "required": true, "placeholder": "It's okay to say nothing."},
    {"key": "commitment", "label": "I understand the 12-month investment is $18,000, and I am willing to review my actual numbers, make decisions, and participate honestly in a small peer room.",
     "type": "checkbox", "required": true}
  ]$fields$::jsonb,
  'Submit application',
  -- Her voice, from her own lines on the page. No reply time: she never
  -- promised one, and this is the sentence an applicant will hold her to.
  $msg$Your application is in. I personally review each application, and I'll follow up with you the way you asked me to. You already built something worth protecting.$msg$,
  true,
  true,
  'message',
  'honeypot'
)
ON CONFLICT (slug) DO NOTHING;

-- --- 2. Nothing may shadow the new page --------------------------------------
-- Any row for /boardroom, not only the one 061 wrote: nginx answers from the
-- redirect map before any location block, so a hand-made "/boardroom -> …" row
-- would 301 the visitor away from a page that now exists — the same reasoning
-- 061 applied to /club and /lounge. A self-row (from = to) is inert in both
-- readers and is left alone.
DELETE FROM redirects
 WHERE from_path = '/boardroom'
   AND to_path <> from_path;

-- --- 3. Addresses that meant the Boardroom now reach it ----------------------
-- /boss-clinician-boardroom is the address the old TODOs in this codebase
-- named for a dedicated Boardroom page, after the source site's
-- /boss-clinician-* page names. Anyone who was given it lands on the real one.
INSERT INTO redirects (from_path, to_path, status_code, target_exists, note) VALUES
  ('/boss-clinician-boardroom', '/boardroom', 301, true, 'Boardroom sales page')
ON CONFLICT (from_path) DO NOTHING;

-- The Kajabi offer and checkout for "The Boss Boardroom" (019). They were sent
-- to /store as the closest page while the Boardroom had none; it is by
-- application, so its own page, with the application on it, is the answer to
-- both. Scoped to the value 019 wrote, so a row retargeted by hand is kept.
UPDATE redirects
   SET to_path = '/boardroom', target_exists = true, updated_at = now(),
       note = 'The Boss Boardroom — its own page, with the application'
 WHERE from_path IN ('/offers/gswshbtx', '/offers/gswshbtx/checkout')
   AND to_path = '/store';
