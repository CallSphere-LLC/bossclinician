-- Boss Move: use the owner-supplied CE certificate and require an actual,
-- member-linked course evaluation before issuing it. Source slide:
-- https://docs.google.com/presentation/d/1GSth7EsrBDISmCr0OKVTU9pR3-AWUc8nl4Yhr3y1b2s/edit
-- The source evaluation is the public Google Form previously embedded in lesson
-- 304. Its submission cannot be attributed to a member by this application.
-- These questions reproduce that form, including repeated rating items.

DO $do$
DECLARE
  v_lesson integer;
  v_assessment integer;
  v_question integer;
  v_spec jsonb;
  v_answer jsonb;
  v_position bigint;
  v_answer_position bigint;
  v_specs jsonb := $questions$[
    {"prompt":"Email","kind":"text","options":[]},
    {"prompt":"Participant Name and Credentials (example: Jane Smith, LCSW)","kind":"text","options":[]},
    {"prompt":"License Number","kind":"text","options":[]},
    {"prompt":"How many years of experience do you have in your profession?","kind":"single","options":["0–1","1–2","2–4","4+"]},
    {"prompt":"The learning objectives were fully addressed.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The program content was current.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The program content enhanced my multicultural awareness and ability to work with diverse populations.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The program content was appropriate to my education and experience.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The program content was relevant to my profession.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The program materials enhanced my learning experience.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The program materials were professional in appearance.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The presenter/author was knowledgeable about the content.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The presenter/author effectively delivered the subject matter.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The program advertisement was accurate.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The instructions for accessing the program were clear.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The instructions for navigating through the program were clear.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The instructions for requesting accommodations for a disability were clear.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The instructions for obtaining my certificate of completion for CE credit were clear.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"My questions or concerns were addressed effectively and in a timely manner.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The online technology/platform was appropriate for this event.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The continuing education provider utilized the technology effectively.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"My request for accommodations was satisfactorily met.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The program materials enhanced my learning experience","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The program materials were professional in appearance.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The instructions for accessing the program were clear.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The instructions for navigating through the program were clear.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The instructions for obtaining my certificate of completion for CE were clear.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The online technology/platform was appropriate for this event.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"The continuing education provider utilized the technology effectively.","kind":"scale","options":["1","2","3","4","5"]},
    {"prompt":"How could we improve this program?","kind":"text","options":[]},
    {"prompt":"Any additional comments, suggestions, or takeaways?","kind":"text","options":[]}
  ]$questions$::jsonb;
BEGIN
  SELECT l.id INTO v_lesson
    FROM course_lessons l
    JOIN course_modules m ON m.id = l.module_id
   WHERE m.course_id = 52 AND l.id = 304;
  IF v_lesson IS NULL THEN RETURN; END IF;

  SELECT id INTO v_assessment FROM assessments
   WHERE lesson_id = v_lesson AND kind = 'survey' ORDER BY id LIMIT 1;
  IF v_assessment IS NULL THEN
    INSERT INTO assessments
      (slug, title, intro_md, kind, lesson_id, pass_mark, show_feedback,
       require_email, published, require_pass)
    VALUES
      ('boss-move-program-evaluation',
       'The Boss Move: Program Evaluation',
       'Please complete this evaluation after passing the post exam. Ratings use 1 = Disagree, 2 = Somewhat Disagree, 3 = Neutral, 4 = Somewhat Agree, and 5 = Agree. Your certificate becomes available after all course and CE requirements are met.',
       'survey', v_lesson, NULL, false, false, true, false)
    RETURNING id INTO v_assessment;

    FOR v_spec, v_position IN
      SELECT value, ordinality FROM jsonb_array_elements(v_specs) WITH ORDINALITY
    LOOP
      INSERT INTO assessment_questions
        (assessment_id, position, prompt, help_text, kind, required)
      VALUES
        (v_assessment, v_position - 1, v_spec->>'prompt',
         CASE WHEN v_spec->>'kind' = 'scale'
              THEN '1 = Disagree · 2 = Somewhat Disagree · 3 = Neutral · 4 = Somewhat Agree · 5 = Agree'
              WHEN v_position = 2 THEN 'The certificate uses the full name on your Boss Clinician member profile. Update your profile if it differs.'
              ELSE '' END,
         v_spec->>'kind', true)
      RETURNING id INTO v_question;

      FOR v_answer, v_answer_position IN
        SELECT value, ordinality FROM jsonb_array_elements(v_spec->'options') WITH ORDINALITY
      LOOP
        INSERT INTO assessment_answers (question_id, position, label)
        VALUES (v_question, v_answer_position - 1, v_answer #>> '{}');
      END LOOP;
    END LOOP;
  END IF;

  -- Old embed completion ticks remain for learning progress, but a certificate
  -- requires a submitted attempt on the published native survey above.
  UPDATE course_lessons
     SET title = 'Program Evaluation Form',
         content_type = 'assessment',
         embed_html = '',
         body_md = 'Submit the evaluation below after passing the post exam. Your answers are saved to your Boss Clinician account so your certificate can be issued after all requirements are met.',
         requires_previous_lesson = true,
         updated_at = now()
   WHERE id = v_lesson
     AND content_type = 'embed'
     AND embed_html LIKE '%1FAIpQLScIMMCzdKVlxe8Jrkn9KQ-eKIiMTyHGS_C_O890EWpHus1JZQ%';
END
$do$;

-- Owner-supplied Slide states 4 NBCC Core Hours and ACEP No. 7998. Setting
-- metadata as well as artwork keeps the ordinary fallback renderer truthful.
UPDATE certificate_templates
   SET ceu_credit_quarter_hours = CASE WHEN ceu_credit_quarter_hours = 0 THEN 16 ELSE ceu_credit_quarter_hours END,
       ceu_provider_name = CASE WHEN ceu_provider_name = '' THEN 'Boss Clinician, LLC' ELSE ceu_provider_name END,
       ceu_provider_number = CASE WHEN ceu_provider_number = '' THEN '7998' ELSE ceu_provider_number END,
       signature_name = CASE WHEN signature_name = '' THEN 'Yvette Howard, LCSW' ELSE signature_name END,
       signature_title = CASE WHEN signature_title = '' THEN 'Founder, Boss Clinician, LLC' ELSE signature_title END,
       background_image = CASE WHEN background_image = '' THEN 'boss-move.png' ELSE background_image END,
       background_layout = CASE WHEN background_layout = '{}'::jsonb THEN
         '{"page":{"width":792,"height":612},"recipient":{"erase":[318,243,156,32],"draw":[220,242,352,34],"font":"Times-BoldItalic","size":26,"color":"#5B4091","align":"center"},"date":{"erase":[567,424,61,19],"draw":[500,422,190,24],"font":"Times-BoldItalic","size":13,"color":"#5B4091","align":"center"},"verification":{"draw":[235,552,322,24],"size":7,"color":"#5B4091","align":"center"},"creditQuarterHours":16,"providerNumber":"7998"}'::jsonb
         ELSE background_layout END,
       updated_at = now()
 WHERE course_id = 52 AND id = 5;
