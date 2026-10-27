-- Row 200: the owner's PDF intake survey in the existing Boss Move welcome tab.
-- No new lesson, assessment, progress requirement, grants, replies or email.
-- Source: Drive 1Yv-f6PliOYyPBdqc0RSiGSBY8LNCKoY7 (two pages).
DO $migration$
DECLARE
  target_id integer;
  target_tool text;
  target_count integer;
BEGIN
  SELECT count(*), min(l.id) INTO target_count, target_id
    FROM course_lessons l
    JOIN course_modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
   WHERE c.slug = 'the-boss-move'
     AND l.slug = 'start-here-welcome-to-the-boss-clinician-club-program';
  IF target_count = 0 THEN RETURN; END IF;
  IF target_count <> 1 THEN
    RAISE EXCEPTION 'Row 200: ambiguous Boss Move welcome lesson; review before attaching intake survey';
  END IF;
  SELECT tool_key INTO target_tool FROM course_lessons WHERE id = target_id FOR UPDATE;
  IF COALESCE(target_tool, '') NOT IN ('', 'form-boss-move-intake-survey') THEN
    RAISE EXCEPTION 'Row 200: welcome lesson already has another tool; preserve it and review placement';
  END IF;

  IF COALESCE(target_tool, '') <> 'form-boss-move-intake-survey'
     AND EXISTS (SELECT 1 FROM forms WHERE slug = 'boss-move-intake-survey') THEN
    RAISE EXCEPTION 'Row 200: survey slug already belongs to an unattached form; review before attaching';
  END IF;

  INSERT INTO forms (slug, name, description_md, fields, submit_label, success_message,
                     create_lead, published, notify_on_submit)
  VALUES (
    'boss-move-intake-survey',
    'Boss Clinician Intake Survey',
    'Intake Survey Questions for the Boss Clinician Club',
    $fields$[
  {
    "key": "email",
    "label": "Email",
    "type": "email",
    "required": true
  },
  {
    "key": "name",
    "label": "First and Last Name",
    "type": "text",
    "required": true
  },
  {
    "key": "practice_stage",
    "label": "What stage are you currently at in the process of starting your private practice?\nChoose as many as you like",
    "type": "checkboxes",
    "required": true,
    "options": [
      "I am brand new and have not seen any private pay clients yet",
      "I have a few clients but nothing consistent yet",
      "I am currently on a platform (Grow, Rula, Talkspace) and want to build independently",
      "I am rebuilding after leaving agency or W2 clinical work",
      "I have a practice but it is not where I want it to be yet"
    ]
  },
  {
    "key": "support",
    "label": "Which area do you feel you need the most support with?Choose as many as you like",
    "type": "checkboxes",
    "required": true,
    "options": [
      "Building a solid business foundation from the start",
      "Getting consistent clients without depending on platforms",
      "Pricing my services so I actually make real money",
      "Developing my marketing and visibility strategy",
      "Building the CEO mindset to run this like a business",
      "Creating systems so I am not doing everything manually"
    ]
  },
  {
    "key": "confidence",
    "label": "How do you currently rate your confidence in managing the business aspects of your practice?",
    "type": "radio",
    "required": true,
    "options": [
      "Very Confident",
      "Somewhat Confident",
      "Neutral",
      "Somewhat unconfident",
      "Very unconfident"
    ]
  },
  {
    "key": "enrollment_reason",
    "label": "What is your primary reason for enrolling in the Boss Clinician Club?",
    "type": "textarea",
    "required": true
  },
  {
    "key": "success_six_months",
    "label": "What does success look like for you 6 months from now?",
    "type": "textarea",
    "required": true
  }
]$fields$::jsonb,
    'Submit', 'Thank you. Your intake survey has been received.',
    false, false, false
  )
  ON CONFLICT (slug) DO NOTHING;

  -- Preserve owner edits and earlier replies, including on a rerun. Only the
  -- exact former survey link is changed; community/help links remain intact.
  UPDATE course_lessons
     SET tool_key = 'form-boss-move-intake-survey',
         body_md = regexp_replace(
           replace(body_md, '](https://forms.gle/BvNoceZw3Bn66ufRA)',
                   '](#lesson-form-boss-move-intake-survey)'),
           E'(^|\\n)https://forms\\.gle/BvNoceZw3Bn66ufRA[ \\t]*(\\r?\\n|$)',
           E'\\1', 'g')
   WHERE id = target_id;
END
$migration$;
