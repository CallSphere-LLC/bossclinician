-- QA rows 132-134: versioned artwork from the owner-linked Google Slides.
-- The issued row snapshots artwork so a later template edit cannot rewrite a
-- certificate's design when its protected PDF needs to be regenerated.
ALTER TABLE certificate_templates
  ADD COLUMN IF NOT EXISTS background_image TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS background_layout JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS background_image TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS background_layout JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Audit Proof: the source design awards 1.5 Ethics CEUs, NBCC ACEP 7998.
-- Educational Access buyers remain excluded by certificateAccessAllowed.
UPDATE certificate_templates
   SET title = 'Certificate of Completion',
       body = 'Audit Proof Your Practice: What Every Therapist Needs to Know',
       signature_name = 'Yvette Howard, LCSW',
       signature_title = 'Founder, Boss Clinician, LLC',
       ceu_credit_quarter_hours = 6,
       ceu_provider_number = '7998',
       ceu_provider_name = 'Boss Clinician, LLC',
       background_image = 'audit-proof-v1.png',
       background_layout = $layout$ {
         "page":{"width":960,"height":540},
         "recipient":{"erase":[407,198,147,27],"draw":[275,198,410,27],"font":"Times-Bold","size":20,"color":"#1D2F56"},
         "date":{"erase":[264,392,58,18],"draw":[170,390,245,23],"font":"Times-Bold","size":15,"color":"#1D2F56"},
         "verification":{"draw":[605,439,270,26],"size":7,"color":"#1D2F56","align":"center"},
         "creditQuarterHours":6,"providerNumber":"7998"
       } $layout$::jsonb,
       updated_at = now()
 WHERE course_id = 62 AND issue_on = 'completion'
   AND ceu_credit_quarter_hours IN (0,6)
   AND ceu_provider_number IN ('','7998');

-- Do's & Don'ts: the source design names Nevada approval 2026-18.
UPDATE certificate_templates
   SET title = 'Certificate of Completion',
       body = 'The Do''s & Don''ts of Clinical Documentation: Ethical, Legal, and Audit-Ready Records',
       signature_name = 'Yvette Howard, LCSW',
       signature_title = 'Instructor',
       ceu_credit_quarter_hours = 14,
       ceu_provider_number = '2026-18',
       ceu_provider_name = 'Nevada Board of Examiners for MFT & CPC',
       background_image = 'dos-donts-ondemand-v1.png',
       background_layout = $layout$ {
         "page":{"width":960,"height":540},
         "recipient":{"erase":[443,218,72,19],"draw":[310,211,340,23],"font":"Times-Bold","size":17,"color":"#243C69"},
         "date":{"erase":[459,383,42,18],"draw":[385,382,190,21],"font":"Helvetica-Bold","size":12,"color":"#333333"},
         "verification":{"draw":[42,475,255,24],"size":7,"color":"#243C69","align":"left"},
         "creditQuarterHours":14,"providerNumber":"2026-18"
       } $layout$::jsonb,
       updated_at = now()
 WHERE course_id = 63 AND issue_on = 'completion'
   AND ceu_credit_quarter_hours IN (0,14)
   AND ceu_provider_number IN ('','2026-18');

-- Credentialing with Confidence still linked to an external Google Form.
-- Its embed tick cannot prove a member submitted the evaluation. Mirror the
-- source's required questions as a native, member-linked survey first.
DO $do$
DECLARE
  v_lesson int;
  v_survey int;
  v_question int;
  v_spec jsonb;
  v_option text;
  v_position int;
  v_option_position int;
  v_specs jsonb := $questions$ [
    {"prompt":"Participant Name","kind":"text","help":"Use the name you want on your certificate. Your account profile name is printed on the certificate.","options":[]},
    {"prompt":"Date Completed","kind":"text","help":"For example: 10/20/2026","options":[]},
    {"prompt":"The content of the program was clear, accurate, and well organized.","kind":"scale","options":["1 = Strongly Disagree","2","3","4","5 = Strongly Agree"]},
    {"prompt":"The presenter demonstrated strong knowledge of the subject matter and presented it effectively.","kind":"scale","options":["1 = Strongly Disagree","2","3","4","5 = Strongly Agree"]},
    {"prompt":"The program materials (video trainings and supplemental resources) were of high quality and useful.","kind":"scale","options":["1 = Strongly Disagree","2","3","4","5 = Strongly Agree"]},
    {"prompt":"This program is relevant to my work as a mental health professional.","kind":"scale","options":["1 = Strongly Disagree","2","3","4","5 = Strongly Agree"]},
    {"prompt":"This program met my expectations overall.","kind":"scale","options":["1 = Strongly Disagree","2","3","4","5 = Strongly Agree"]},
    {"prompt":"Please share any comments about the content, presentation, or materials.","kind":"text","options":[]},
    {"prompt":"What, if anything, would you suggest to improve this program?","kind":"text","options":[]},
    {"prompt":"Any additional comments, suggestions, or takeaways?","kind":"text","options":[]}
  ] $questions$::jsonb;
BEGIN
  SELECT l.id INTO v_lesson
    FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
   WHERE l.id = 119 AND m.course_id = 4 AND l.content_type = 'embed';
  IF v_lesson IS NULL OR EXISTS (SELECT 1 FROM assessments WHERE lesson_id = v_lesson) THEN
    RETURN;
  END IF;

  INSERT INTO assessments
    (slug,title,intro_md,kind,lesson_id,pass_mark,show_feedback,require_email,published,require_pass,pass_message)
  VALUES
    ('credentialing-with-confidence-program-evaluation',
     'Credentialing with Confidence: Program Evaluation',
     'Please complete this evaluation to help us improve our programs for mental health professionals. Submit it after finishing the training and quiz to qualify for your certificate.',
     'survey',v_lesson,NULL,true,false,true,false,
     'Thank you for completing your evaluation. Your certificate is issued after all course requirements are met.')
  RETURNING id INTO v_survey;

  FOR v_spec, v_position IN
    SELECT value, ordinality::int - 1 FROM jsonb_array_elements(v_specs) WITH ORDINALITY
  LOOP
    INSERT INTO assessment_questions
      (assessment_id,position,prompt,help_text,kind,required)
    VALUES
      (v_survey,v_position,v_spec->>'prompt',COALESCE(v_spec->>'help',''),
       v_spec->>'kind',true)
    RETURNING id INTO v_question;
    FOR v_option, v_option_position IN
      SELECT value #>> '{}', ordinality::int - 1
        FROM jsonb_array_elements(v_spec->'options') WITH ORDINALITY
    LOOP
      INSERT INTO assessment_answers (question_id,position,label,is_correct)
      VALUES (v_question,v_option_position,v_option,false);
    END LOOP;
  END LOOP;

  UPDATE course_lessons
     SET title = 'Program Evaluation Form',
         content_type = 'assessment',
         body_md = 'Complete and submit the evaluation here after finishing the training and quiz. Your answers are linked to your account so the certificate can be issued when all requirements are met.',
         embed_html = '',
         requires_previous_lesson = true,
         updated_at = now()
   WHERE id = v_lesson;
END
$do$;

-- The native survey must exist before a CE certificate can be offered.
INSERT INTO certificate_templates
  (course_id,title,body,signature_name,signature_title,
   ceu_credit_quarter_hours,ceu_provider_number,ceu_provider_name,
   issue_on,enabled,background_image,background_layout)
SELECT
  4,'Certificate of Completion',
  'Credentialing with Confidence: Insurance Enrollment and Ethical Billing for Mental Health Therapists',
  'Yvette Howard, LCSW','Founder, Boss Clinician, LLC',
  7,'7998','Boss Clinician, LLC','completion',true,
  'credentialing-confidence-v1.png',
  $layout$ {
    "page":{"width":792,"height":612},
    "recipient":{"erase":[312,220,168,35],"draw":[198,219,395,37],"font":"Times-BoldItalic","size":25,"color":"#5B4091"},
    "date":{"erase":[574,416,65,23],"draw":[510,415,190,25],"font":"Times-BoldItalic","size":17,"color":"#5B4091"},
    "verification":{"draw":[500,478,235,28],"size":7,"color":"#5B4091","align":"center"},
    "creditQuarterHours":7,"providerNumber":"7998"
  } $layout$::jsonb
 WHERE EXISTS (
   SELECT 1 FROM assessments a
   JOIN course_lessons l ON l.id = a.lesson_id
   JOIN course_modules m ON m.id = l.module_id
   WHERE m.course_id = 4 AND l.id = 119 AND l.content_type = 'assessment'
     AND a.kind = 'survey' AND a.published
 )
   AND NOT EXISTS (SELECT 1 FROM certificate_templates WHERE course_id = 4);
