-- Native forms inside lessons, and a per-form "email me when someone sends it".
--
-- 1. The Lounge VIP course (courses.id 60) had three lessons that were Jotform
--    iframes — Monthly Voice Note question, Monthly Materials Review
--    submission, Priority Hot Seat request. The site's frame policy does not
--    allow form.jotform.com, so members saw an empty box, and even when it
--    loaded the replies went to Jotform with nothing tying them to a student.
--    They are rebuilt here as forms of our own (questions copied from the live
--    Jotforms on 2026-10-13) and rendered inside the lesson for the signed-in
--    member: their name and email are taken from the account, every reply is
--    filed against their contact, and the owner reads them in Forms.
--
--    How a lesson carries a form: `course_lessons.tool_key = 'form-<form slug>'`.
--    tool_key (migration 104) is already "an interactive thing rendered under
--    the lesson's text", is already served by the member and preview lesson
--    endpoints, and is never touched by the course editor — so the owner can
--    keep editing the lesson's words without detaching the form. A form's slug
--    cannot be changed in the builder, so the link is stable.
--
--    The lessons move from 'embed' to 'text' so the dead iframe stops
--    rendering. `embed_html` is left exactly as it was (unused for a text
--    lesson), so switching a lesson back to Embed in the editor restores the
--    Jotform with nothing lost.
--
--    The forms are created unpublished: unpublished means "not at /f/<slug>",
--    so nobody outside the course can send one. Inside the lesson they work
--    regardless — the member route checks course access instead.
--
-- 2. forms.notify_on_submit / notify_emails. The owner email used to go out for
--    a reply only when the form also made an enquiry (create_lead). It is now
--    its own switch per form, with an optional list of addresses; blank uses
--    the notification address in Settings. Back-filled from create_lead, so
--    every form that emailed before still does and nothing new starts to.
--
-- Idempotent: safe to run by hand before a deploy records it.

-- --- per-form notification --------------------------------------------------

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'forms' AND column_name = 'notify_on_submit'
  ) THEN
    ALTER TABLE forms ADD COLUMN notify_on_submit BOOLEAN;
    UPDATE forms SET notify_on_submit = create_lead WHERE notify_on_submit IS NULL;
    ALTER TABLE forms ALTER COLUMN notify_on_submit SET DEFAULT true;
    ALTER TABLE forms ALTER COLUMN notify_on_submit SET NOT NULL;
  END IF;
END
$do$;

-- Comma-separated addresses. Blank = the notification address in Settings.
ALTER TABLE forms ADD COLUMN IF NOT EXISTS notify_emails TEXT NOT NULL DEFAULT '';

-- --- the three Lounge VIP forms ------------------------------------------------

INSERT INTO forms (slug, name, description_md, fields, submit_label, success_message,
                   create_lead, published, notify_on_submit)
VALUES
(
  'lounge-vip-voice-note-question',
  'Lounge VIP: Monthly Voice Note question',
  '',
  $json$[
    {"key": "question", "label": "What is your one question this month?", "type": "textarea", "required": true,
     "helpText": "Be specific. One clear question gets a clearer answer than three stacked ones."},
    {"key": "context", "label": "Give me the context behind the question.", "type": "textarea", "required": true,
     "helpText": "Your numbers, your situation, what you've already tried, and what's at stake. Example: \"BCBS pays me $87 per session, they're 40 percent of my caseload, and I'm afraid of the income gap if I exit.\""},
    {"key": "phase", "label": "Which phase of The Practice Elevation are you currently working through?", "type": "select", "required": true,
     "options": ["Start Here", "Build", "Optimize", "Systematize", "Sustain", "I have completed all four phases"]},
    {"key": "anything_else", "label": "Anything else I should know before I answer?", "type": "textarea", "required": false}
  ]$json$::jsonb,
  'Send my question',
  'Got it. Your question is in, and your voice note answer will come to the email on your account.',
  false, false, true
),
(
  'lounge-vip-materials-review',
  'Lounge VIP: Monthly Materials Review',
  '',
  $json$[
    {"key": "submission_type", "label": "What are you submitting this month?", "type": "select", "required": false,
     "options": ["Niche statement", "Psychology Today or directory profile", "Website copy", "Pricing", "Marketing material", "Other"]},
    {"key": "material", "label": "Paste your material here, or link to it.", "type": "textarea", "required": true,
     "helpText": "For websites and profiles, paste the URL. For statements and pricing, paste the text directly."},
    {"key": "material_file", "label": "Upload a file instead (optional)", "type": "file", "required": false,
     "helpText": "PDF, Word doc, or image. Use this if your material lives in a document.",
     "fileTypes": ["pdf", "word", "image", "spreadsheet"], "maxSizeMb": 10},
    {"key": "goal", "label": "What do you want this material to do?", "type": "textarea", "required": true,
     "helpText": "One or two sentences. Example: \"I want my profile to attract more cash pay clients\" or \"I want my pricing page to stop scaring people off before a consult.\""},
    {"key": "phase", "label": "Which phase of The Practice Elevation are you currently working through?", "type": "select", "required": true,
     "options": ["Start Here", "Build", "Optimize", "Systematize", "Sustain", "I have completed all four phases"]}
  ]$json$::jsonb,
  'Submit for review',
  'Received. Your material is in my review queue, and your recorded review will come to the email on your account.',
  false, false, true
),
(
  'lounge-vip-hot-seat-request',
  'Lounge VIP: Priority Hot Seat request',
  '',
  -- The Jotform also carried "What are you submitting this month?" (a copy of
  -- the Materials Review question with the same choices); it has nothing to do
  -- with a hot seat and is left off. Add it back in Forms if it was meant.
  $json$[
    {"key": "topic", "label": "What do you want to work through on your hot seat?", "type": "textarea", "required": true,
     "helpText": "The situation, the decision, or the stuck place. The more real, the better the coaching."},
    {"key": "already_tried", "label": "What have you already tried or considered?", "type": "textarea", "required": false,
     "helpText": "This lets us skip past what you've ruled out and go straight to new ground."},
    {"key": "win", "label": "What would make this hot seat a win for you?", "type": "text", "required": false,
     "helpText": "Example: \"I leave with a decision on my BCBS panel\" or \"I leave with my new rate and the date I'm announcing it.\""},
    {"key": "session_choice", "label": "Which upcoming Strategy Session works best for you?", "type": "select", "required": true,
     "helpText": "I'll confirm your scheduled call by email.",
     "options": ["The next monthly call", "The following month", "Either works for me"]},
    {"key": "phase", "label": "Which phase of The Practice Elevation are you currently working through?", "type": "select", "required": false,
     "options": ["Start Here", "Build", "Optimize", "Systematize", "Sustain", "I have completed all four phases"]}
  ]$json$::jsonb,
  'Request my hot seat',
  'Your hot seat request is in. I''ll confirm your scheduled call by email.',
  false, false, true
)
ON CONFLICT (slug) DO NOTHING;

-- --- point the lessons at them ------------------------------------------------
-- Keyed by Kajabi id (104's convention). Only a lesson that is still the
-- Jotform embed and carries no tool yet is changed, so a re-run — or a lesson
-- the owner has since reworked — is left alone.

UPDATE course_lessons l
   SET tool_key = 'form-' || v.form_slug, content_type = 'text', updated_at = now()
  FROM (VALUES
          ('2199801069', 'lounge-vip-voice-note-question'),
          ('2199801070', 'lounge-vip-materials-review'),
          ('2199801068', 'lounge-vip-hot-seat-request')
       ) AS v(kajabi_id, form_slug)
 WHERE l.kajabi_id = v.kajabi_id
   AND l.content_type = 'embed'
   AND l.embed_html LIKE '%form.jotform.com%'
   AND l.tool_key IS NULL
   AND EXISTS (SELECT 1 FROM forms f WHERE f.slug = v.form_slug);
