-- =============================================================================
-- 127 — QA sheet rows 237, 245, 249 (20 Oct): the two on-demand CE courses get
-- their full post-test + evaluation flow, and the Audit Proof checkout goes live
-- with both price tiers.
--
-- Row 245  Course 62 "Audit Proof Your Practice (On-Demand Training)".
--          Survey `audit-proof-your-practice-what-every-therapist-needs-to-know-2`
--          (Yvette made it on lesson 318 as the evaluation, empty and
--          unpublished) is filled with every item of the Google Form "Audit
--          Proof Your Practice: On-Demand Evaluation Form", in form order. Each
--          grid row becomes its own 1-5 scale question (grid heading in the
--          help text); the date item is a text answer (there is no date
--          question type); checkboxes are `multiple`, multiple choice is
--          `single`. Survey + lesson are published; the lesson is retitled
--          "Course Evaluation", sits right after the post-test and needs it
--          finished first.
--
-- Row 249  Course 63 "The Do's & Don'ts of Clinical Documentation".
--          Graded quiz `the-do-s-don-ts-of-clinical-documentation-post-test`
--          (lesson 319, empty) gets the form's 25 post-test questions. Pass
--          mark 80 (form: at least 20 of 25). ANSWER KEY: the Google Form does
--          not expose one; `correct` below is the unambiguous best answer to
--          each question and MUST be checked by the owner (Admin -> Assessments).
--          The learner identity items (certificate name, licence number, type,
--          state) and the form's "Required Course Evaluation" + "Completion
--          Acknowledgment" sections become a NEW survey on a NEW lesson
--          "Course Evaluation" after the post-test. No members table column
--          holds a licence, and the certificate prints the member's profile
--          name, so the survey is the only place these answers can live; the
--          name question says so in its help text.
--
-- Row 237  Offer `audit-proof-your-practice-on-demand-free` (draft, $77, sells
--          the course-62 product). Two pricing options: "Training + CE Credit
--          — $77" (recommended) and "Educational Access — $57 | No CE Credit".
--          The offer is published with the "Audit Proof Check out" doc's copy
--          (markdown), CE program policies as its terms link, and the terms
--          box required (the doc's purchase acknowledgment). Slug unchanged.
--
-- Idempotent and owner-safe: each block looks its rows up by slug and only
-- fires while the row is still in the state this file expects (empty
-- assessment, draft offer with the Kajabi copy, no matching option), so a
-- re-run or a fresh CI database is a no-op and later Admin edits are kept.
-- migrate.ts wraps the file in one transaction.
-- =============================================================================

-- One question-writer for all three assessments. pg_temp: gone with the session.
CREATE FUNCTION pg_temp.bc127_fill(p_assessment int, p_specs jsonb) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  q jsonb;
  qi bigint;
  o jsonb;
  oi bigint;
  v_question int;
BEGIN
  FOR q, qi IN SELECT value, ordinality FROM jsonb_array_elements(p_specs) WITH ORDINALITY LOOP
    INSERT INTO assessment_questions (assessment_id, position, prompt, help_text, kind, required)
    VALUES (p_assessment, qi - 1, q->>'prompt', COALESCE(q->>'help', ''), q->>'kind', (q->>'required')::boolean)
    RETURNING id INTO v_question;

    FOR o, oi IN SELECT value, ordinality FROM jsonb_array_elements(q->'options') WITH ORDINALITY LOOP
      INSERT INTO assessment_answers (question_id, position, label, is_correct)
      VALUES (v_question, oi - 1, o #>> '{}', COALESCE((q->>'correct')::int = oi - 1, false));
    END LOOP;
  END LOOP;
END
$fn$;

-- ── Row 245: Audit Proof evaluation ─────────────────────────────────────────
DO $do$
DECLARE
  specs jsonb := $spec$[
  {"prompt": "Full Name", "kind": "text", "required": true, "help": "Your certificate prints the first and last name on your account profile. If they differ, update your profile before you finish the course.", "options": []},
  {"prompt": "License Type & Number", "kind": "text", "required": true, "help": "", "options": []},
  {"prompt": "Date you took the training", "kind": "text", "required": true, "help": "For example: 10/19/2026", "options": []},
  {"prompt": "Delivery Format", "kind": "single", "required": true, "help": "", "options": ["In-Person", "Virtual", "Asynchronous/ On-Demand"]},
  {"prompt": "The course objectives were clearly stated and achieved.", "kind": "scale", "required": true, "help": "Course Content & Objectives · 1 = Strongly Disagree, 5 = Strongly Agree", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "The content was relevant to my clinical or professional practice.", "kind": "scale", "required": true, "help": "Course Content & Objectives · 1 = Strongly Disagree, 5 = Strongly Agree", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "The course provided practical information I can apply in my work.", "kind": "scale", "required": true, "help": "Course Content & Objectives · 1 = Strongly Disagree, 5 = Strongly Agree", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "The level of difficulty was appropriate for my professional experience.", "kind": "scale", "required": true, "help": "Course Content & Objectives · 1 = Strongly Disagree, 5 = Strongly Agree", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "The instructor demonstrated expertise in audits, documentation, and compliance.", "kind": "scale", "required": true, "help": "Instructor & Presentation · 1 = Strongly Disagree, 5 = Strongly Agree", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "The material was presented clearly and effectively.", "kind": "scale", "required": true, "help": "Instructor & Presentation · 1 = Strongly Disagree, 5 = Strongly Agree", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "The instructor engaged participants and supported learning.", "kind": "scale", "required": true, "help": "Instructor & Presentation · 1 = Strongly Disagree, 5 = Strongly Agree", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "This training increased my understanding of payer audits and documentation ethics.", "kind": "scale", "required": true, "help": "Learning Experience · 1 = Strongly Disagree, 5 = Strongly Agree", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "The case studies and examples enhanced my learning experience.", "kind": "scale", "required": true, "help": "Learning Experience · 1 = Strongly Disagree, 5 = Strongly Agree", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "Overall Satisfaction with this CEU Training:", "kind": "scale", "required": true, "help": "", "options": ["1 = Strongly Disagree", "2", "3", "4", "5 = Strongly Agree"]},
  {"prompt": "What did you find most valuable about this course?", "kind": "text", "required": true, "help": "", "options": []},
  {"prompt": "What additional topics or areas would you like future trainings to cover?", "kind": "text", "required": false, "help": "", "options": []},
  {"prompt": "Where are you in your practice right now?", "kind": "single", "required": true, "help": "", "options": ["I’m starting my private practice", "I have a solo practice and want more stability", "I have a solo practice and want to grow", "I’m expanding into a group practice", "I already have a group practice and want stronger systems", "I’m rebranding or restructuring my practice", "I’m not sure where I am yet and need clarity"]},
  {"prompt": "How would you describe your current caseload flow?", "kind": "single", "required": true, "help": "", "options": ["I’m building my caseload", "My caseload is inconsistent", "My caseload is stable but my systems need work", "My caseload is full and I’m preparing for growth or leadership"]},
  {"prompt": "Which areas feel most challenging right now?", "kind": "multiple", "required": true, "help": "", "options": ["Documentation or staying compliant", "Insurance billing, credentialing, or payer requirements", "Getting consistent clients", "Clarifying my niche or ideal client", "Pricing, finances, or revenue structure", "Systems and operations (onboarding, workflows, documentation, scheduling)", "Balancing clinical work with administrative tasks", "Leadership, hiring, or delegation", "I’m not sure where to start but I need structure"]},
  {"prompt": "What would meaningful progress in your practice look like over the next three to six months?", "kind": "text", "required": true, "help": "", "options": []},
  {"prompt": "Would you like more information about trainings or support in the areas you selected above?", "kind": "single", "required": true, "help": "", "options": ["Yes", "Possibly", "Not at this time"]},
  {"prompt": "CEU Confirmation", "kind": "multiple", "required": true, "help": "", "options": ["I confirm attendance and completion of the full 90-minute CEU session."]}
  ]$spec$;
  v_assessment int;
  v_lesson int;
  v_post_sort int;
BEGIN
  SELECT id, lesson_id INTO v_assessment, v_lesson
    FROM assessments
   WHERE slug = 'audit-proof-your-practice-what-every-therapist-needs-to-know-2' AND kind = 'survey';
  IF v_assessment IS NULL OR v_lesson IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM assessment_questions WHERE assessment_id = v_assessment) THEN RETURN; END IF;

  PERFORM pg_temp.bc127_fill(v_assessment, specs);

  UPDATE assessments
     SET title = CASE WHEN title = 'Audit Proof Your Practice: What Every Therapist Needs to Know'
                      THEN 'Audit Proof Your Practice: Course Evaluation' ELSE title END,
         intro_md = CASE WHEN intro_md = '' THEN $t$Thank you for joining Audit Proof Your Practice: What Every Therapist Needs to Know with Yvette Howard, LCSW.
This training was created to give you clarity, confidence, and practical structure to protect your practice. Your feedback shapes future CE experiences and helps us understand the needs of our clinician community.
Your responses are confidential.
Your CE certificate is issued after you pass the post-test and submit this evaluation.$t$ ELSE intro_md END,
         published = true,
         updated_at = now()
   WHERE id = v_assessment;

  -- The post-test lesson in the same module; the evaluation goes right after it.
  SELECT l.sort INTO v_post_sort
    FROM assessments p
    JOIN course_lessons l ON l.id = p.lesson_id
   WHERE p.slug = 'audit-proof-post-test'
     AND l.module_id = (SELECT module_id FROM course_lessons WHERE id = v_lesson);

  UPDATE course_lessons
     SET title = 'Course Evaluation',
         body_md = CASE WHEN body_md = '' THEN $t$Required for your CE certificate. Complete the evaluation after you pass the post-test; submitting it completes the course.$t$ ELSE body_md END,
         published = true,
         requires_previous_lesson = true,
         sort = CASE WHEN v_post_sort IS NOT NULL AND sort <= v_post_sort THEN v_post_sort + 1 ELSE sort END,
         updated_at = now()
   WHERE id = v_lesson;
END
$do$;

-- ── Row 249: Do's & Don'ts post-test ────────────────────────────────────────
DO $do$
DECLARE
  specs jsonb := $spec$[
  {"prompt": "Ethical documentation is best defined as:", "kind": "single", "required": true, "help": "Module 1 — Orientation & Ethics Framing", "options": ["Clarity and intent that reflect clinical reasoning", "The longest possible note", "Avoiding any mention of client risk", "Copying the previous session's note"], "correct": 0},
  {"prompt": "True or False: Ethical documentation and lengthy documentation are the same thing.", "kind": "single", "required": true, "help": "", "options": ["True", "False"], "correct": 1},
  {"prompt": "Which of the following is a common documentation pitfall that increases audit risk?", "kind": "single", "required": true, "help": "Module 2 — Everyday Documentation Do's & Don'ts", "options": ["Diagnosis-aligned symptoms", "Cloned notes", "Documented client response", "Treatment plan goal referenced"], "correct": 1},
  {"prompt": "A defensible progress note should include all of the following EXCEPT:", "kind": "single", "required": true, "help": "", "options": ["Specific interventions used", "Client's response to intervention", "Vague general statements about the session", "A reference to the treatment plan goal"], "correct": 2},
  {"prompt": "True or False: Under-documentation carries no audit or compliance risk as long as the clinician remembers the session details.", "kind": "single", "required": true, "help": "", "options": ["True", "False"], "correct": 1},
  {"prompt": "When documenting suicidality or self-harm risk, clinicians should:", "kind": "single", "required": true, "help": "Module 3 — High-Risk Documentation", "options": ["Reassure the client without completing a formal risk assessment", "Use vague language to avoid liability", "Document protective factors and rationale for the level of care selected", "Omit next steps to save time"], "correct": 2},
  {"prompt": "Mandated reporting documentation should include:", "kind": "single", "required": true, "help": "", "options": ["Speculate intent", "Emotional language describing the clinician's reaction", "Legal conclusions about guilt or innocence", "Objective, factual language and documentation of consultation"], "correct": 3},
  {"prompt": "When documenting substance use or boundary concerns, clinicians should avoid:", "kind": "single", "required": true, "help": "", "options": ["Moralizing or judgmental language", "Noting clinically relevant patterns", "Naming interventions used", "Documenting impact on functioning"], "correct": 0},
  {"prompt": "Which CPT codes are used to bill psychotherapy for crisis?", "kind": "single", "required": true, "help": "", "options": ["90832 / 90834", "90839 / 90840", "90846 / 90847", "90837 / 90838"], "correct": 1},
  {"prompt": "True or False: Billing a routine, non-urgent session using a crisis CPT code without matching documentation is a common audit trigger.", "kind": "single", "required": true, "help": "", "options": ["True", "False"], "correct": 0},
  {"prompt": "True or False: High-risk documentation should reflect clinical judgment rather than fear-based or defensive writing.", "kind": "single", "required": true, "help": "", "options": ["True", "False"], "correct": 0},
  {"prompt": "Which statement about HIPAA record retention is accurate?", "kind": "single", "required": true, "help": "Module 4 — Legal & Regulatory Do's & Don'ts", "options": ["Deleting notes immediately after a session protects the clinician", "There are no requirements for how records are destroyed", "Retention timelines and secure destruction practices should be followed and documented", "Retention only applies to physical paper records"], "correct": 2},
  {"prompt": "When a subpoena or audit request is received, the clinician's first step should be to:", "kind": "single", "required": true, "help": "", "options": ["Immediately send all requested records", "Destroy any records that could be misinterpreted", "Respond emotionally to protect the client relationship", "Slow down, review the request, and follow practice policy"], "correct": 3},
  {"prompt": "In telehealth sessions, which factor determines which state's licensure laws apply?", "kind": "single", "required": true, "help": "", "options": ["The client's physical location at the time of the session", "The clinician's physical location", "Where the practice is legally registered", "The video platform's headquarters"], "correct": 0},
  {"prompt": "True or False: A single telehealth consent form obtained at intake is sufficient to cover all future sessions indefinitely, with no need for periodic review.", "kind": "single", "required": true, "help": "", "options": ["True", "False"], "correct": 1},
  {"prompt": "True or False: More detailed documentation is always safer during an audit or legal review.", "kind": "single", "required": true, "help": "", "options": ["True", "False"], "correct": 1},
  {"prompt": "Which of the following is required before entering client PHI into an AI documentation tool?", "kind": "single", "required": true, "help": "Module 5 — AI-Assisted Documentation in Practice", "options": ["A strong password", "A signed Business Associate Agreement (BAA)", "Written approval from the state licensing board", "A general HIPAA training certificate"], "correct": 1},
  {"prompt": "According to this training, who remains the author and legal owner of a clinical note, even when AI assists in drafting it?", "kind": "single", "required": true, "help": "", "options": ["The AI vendor", "The practice's IT administrator", "The clinician", "Authorship is shared equally with the tool"], "correct": 2},
  {"prompt": "Which of the following is NOT one of the criteria for a HIPAA-compliant AI documentation tool discussed in this training?", "kind": "single", "required": true, "help": "", "options": ["A signed BAA is in place", "The vendor states client data isn't used to train its models", "The tool offers a free trial period", "Documented data retention and deletion policies"], "correct": 2},
  {"prompt": "What is the recommended safeguard against over-reliance on AI for documentation?", "kind": "single", "required": true, "help": "", "options": ["Using AI exclusively for every note", "Avoiding AI tools altogether", "Relying on the tool's built-in spell-check only", "Periodically practicing writing complete notes without AI assistance"], "correct": 3},
  {"prompt": "True or False: Client consent for AI-assisted documentation should be obtained before the tool is used, not disclosed after the fact.", "kind": "single", "required": true, "help": "", "options": ["True", "False"], "correct": 0},
  {"prompt": "Which of the following is a common audit trigger across most payer types?", "kind": "single", "required": true, "help": "Module 6 — Audit Proof Your Practice", "options": ["Copy-paste or cloned notes", "Signed treatment plans", "Documented client response", "CPT code alignment with session content"], "correct": 0},
  {"prompt": "If a clinician discovers a billing error that led to an overpayment, what is the ethical duty?", "kind": "single", "required": true, "help": "", "options": ["Ignore it", "Wait to see if the payer notices", "Refund only if the client asks", "Report and correct it"], "correct": 3},
  {"prompt": "At minimum, how often should a quarterly self-audit review a random sample of charts?", "kind": "single", "required": true, "help": "", "options": ["Every 90 days", "Every 30 days", "Once a year", "Only after a complaint is filed"], "correct": 0},
  {"prompt": "True or False: Being paneled through a platform like Alma or Headway removes a clinician's individual documentation responsibility.", "kind": "single", "required": true, "help": "", "options": ["True", "False"], "correct": 1}
  ]$spec$;
  v_assessment int;
  v_lesson int;
BEGIN
  SELECT id, lesson_id INTO v_assessment, v_lesson
    FROM assessments
   WHERE slug = 'the-do-s-don-ts-of-clinical-documentation-post-test' AND kind = 'graded';
  IF v_assessment IS NULL OR v_lesson IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM assessment_questions WHERE assessment_id = v_assessment) THEN RETURN; END IF;

  PERFORM pg_temp.bc127_fill(v_assessment, specs);

  UPDATE assessments
     SET pass_mark = 80,
         intro_md = CASE WHEN intro_md = '' THEN $t$Instructor: Yvette Howard, LCSW | 210 minutes | 3.5 CE Contact Hours (Ethics)
For on-demand/replay participants only. Complete the full recording before beginning. Answer all 25 post-test questions, then complete the required course evaluation in the next lesson. Passing standard: at least 20 correct (80% or higher). CE certificates are issued only when all applicable course and CE requirements are met.$t$ ELSE intro_md END,
         pass_message = CASE WHEN pass_message = 'You passed. Continue to the next lesson.'
                             THEN $t$You passed the Do's & Don'ts of Clinical Documentation post-test. Complete the course evaluation in the next lesson.$t$ ELSE pass_message END,
         fail_message = CASE WHEN fail_message = 'Review the lesson and try again.'
                             THEN $t$This attempt did not reach the passing standard of 20 correct (80%). Review the training and try again.$t$ ELSE fail_message END,
         published = true,
         updated_at = now()
   WHERE id = v_assessment;

  UPDATE course_lessons
     SET body_md = CASE WHEN body_md = '' THEN $t$25 questions. Passing score: 80% or higher (at least 20 correct).$t$ ELSE body_md END,
         published = true,
         requires_previous_lesson = true,
         updated_at = now()
   WHERE id = v_lesson;
END
$do$;

-- ── Row 249: Do's & Don'ts evaluation (new survey + lesson) ─────────────────
DO $do$
DECLARE
  specs jsonb := $spec$[
  {"prompt": "Full Name (as it should appear on your certificate)", "kind": "text", "required": true, "help": "Your certificate prints the first and last name on your account profile. If they differ, update your profile before you finish the course.", "options": []},
  {"prompt": "Professional License Number", "kind": "text", "required": true, "help": "", "options": []},
  {"prompt": "Professional License Type", "kind": "single", "required": true, "help": "", "options": ["LCSW / Social Worker", "LPC / CPC / Professional Counselor", "LMFT / Marriage & Family Therapist", "Psychologist", "Other licensed professional", "Not currently licensed"]},
  {"prompt": "Licensing State", "kind": "text", "required": true, "help": "", "options": []},
  {"prompt": "The learning objectives were clearly explained.", "kind": "scale", "required": true, "help": "Required Course Evaluation · 1 = Strongly disagree, 5 = Strongly agree", "options": ["1 = Strongly disagree", "2", "3", "4", "5 = Strongly agree"]},
  {"prompt": "The course content was relevant to my professional practice.", "kind": "scale", "required": true, "help": "", "options": ["1 = Strongly disagree", "2", "3", "4", "5 = Strongly agree"]},
  {"prompt": "The instructor demonstrated knowledge of the subject matter.", "kind": "scale", "required": true, "help": "", "options": ["1 = Strongly disagree", "2", "3", "4", "5 = Strongly agree"]},
  {"prompt": "The presentation was organized and easy to follow.", "kind": "scale", "required": true, "help": "", "options": ["1 = Strongly disagree", "2", "3", "4", "5 = Strongly agree"]},
  {"prompt": "I can identify common clinical documentation errors and risks.", "kind": "scale", "required": true, "help": "", "options": ["1 = Strongly disagree", "2", "3", "4", "5 = Strongly agree"]},
  {"prompt": "I better understand how documentation supports medical necessity and clinical decision-making.", "kind": "scale", "required": true, "help": "", "options": ["1 = Strongly disagree", "2", "3", "4", "5 = Strongly agree"]},
  {"prompt": "I can identify appropriate documentation practices for high-risk or legally sensitive situations.", "kind": "scale", "required": true, "help": "", "options": ["1 = Strongly disagree", "2", "3", "4", "5 = Strongly agree"]},
  {"prompt": "I better understand responsible use of AI-assisted clinical documentation.", "kind": "scale", "required": true, "help": "", "options": ["1 = Strongly disagree", "2", "3", "4", "5 = Strongly agree"]},
  {"prompt": "I plan to apply what I learned to my documentation practices.", "kind": "scale", "required": true, "help": "", "options": ["1 = Strongly disagree", "2", "3", "4", "5 = Strongly agree"]},
  {"prompt": "How would you rate the overall quality of this training?", "kind": "single", "required": true, "help": "", "options": ["Excellent", "Good", "Fair", "Poor"]},
  {"prompt": "What was the most valuable information you learned?", "kind": "text", "required": true, "help": "", "options": []},
  {"prompt": "What is one change you plan to make in your clinical documentation?", "kind": "text", "required": true, "help": "", "options": []},
  {"prompt": "What could be improved about this training?", "kind": "text", "required": false, "help": "", "options": []},
  {"prompt": "Training completion confirmation", "kind": "multiple", "required": true, "help": "Completion Acknowledgment", "options": ["I confirm that I personally completed the full 210-minute on-demand training before submitting this assessment."]},
  {"prompt": "Assessment attestation", "kind": "multiple", "required": true, "help": "", "options": ["I confirm that I completed this assessment myself and that the information I provided is accurate."]}
  ]$spec$;
  v_post_lesson int;
  v_module int;
  v_post_sort int;
  v_lesson int;
  v_assessment int;
BEGIN
  SELECT l.id, l.module_id, l.sort INTO v_post_lesson, v_module, v_post_sort
    FROM assessments p
    JOIN course_lessons l ON l.id = p.lesson_id
   WHERE p.slug = 'the-do-s-don-ts-of-clinical-documentation-post-test';
  IF v_module IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM assessments WHERE slug = 'dos-and-donts-documentation-evaluation') THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM course_lessons WHERE module_id = v_module AND slug = 'course-evaluation') THEN RETURN; END IF;

  -- Room right after the post-test (nothing follows it today).
  UPDATE course_lessons SET sort = sort + 1, updated_at = now()
   WHERE module_id = v_module AND sort > v_post_sort;

  INSERT INTO course_lessons
    (module_id, title, slug, body_md, content_type, published, sort, requires_previous_lesson, preview)
  VALUES
    (v_module, 'Course Evaluation', 'course-evaluation',
     $t$Required for your CE certificate. Complete the evaluation after you pass the post-test; submitting it completes the course.$t$,
     'assessment', true, v_post_sort + 1, true, false)
  RETURNING id INTO v_lesson;

  INSERT INTO assessments
    (slug, title, intro_md, kind, lesson_id, pass_mark, show_feedback, require_email, published, require_pass)
  VALUES
    ('dos-and-donts-documentation-evaluation',
     $t$The Do's & Don'ts of Clinical Documentation: Course Evaluation$t$,
     $t$Your evaluation is required to qualify for certificate processing. Your responses are confidential.
Your CE certificate is issued only when all applicable course and CE requirements are met: the full recording, a passing post-test, and this evaluation.$t$,
     'survey', v_lesson, NULL, true, false, true, false)
  RETURNING id INTO v_assessment;

  PERFORM pg_temp.bc127_fill(v_assessment, specs);
END
$do$;

-- ── Row 237: Audit Proof checkout, both tiers ───────────────────────────────
-- Only on the offer as it stands in production: the $77 one-time draft.
INSERT INTO offer_pricing_options
  (offer_id, label, pricing_type, amount_cents, currency, recommended, active, sort)
SELECT o.id, v.label, 'one_time', v.amount_cents, 'usd',
       v.recommended AND NOT EXISTS (
         SELECT 1 FROM offer_pricing_options r WHERE r.offer_id = o.id AND r.recommended AND r.active),
       true, v.sort
  FROM offers o
 CROSS JOIN (VALUES
   ($t$Training + CE Credit — $77$t$, 7700, true, 0),
   ($t$Educational Access — $57 | No CE Credit$t$, 5700, false, 1)
 ) AS v(label, amount_cents, recommended, sort)
 WHERE o.slug = 'audit-proof-your-practice-on-demand-free'
   AND o.pricing_type = 'one_time' AND o.amount_cents = 7700
   AND NOT EXISTS (
     SELECT 1 FROM offer_pricing_options x
      WHERE x.offer_id = o.id AND x.pricing_type = 'one_time' AND x.amount_cents = v.amount_cents)
 ORDER BY v.sort;

UPDATE offers
   SET status = 'published',
       internal_title = CASE WHEN internal_title = 'Audit Proof On-Demand — free course access'
                             THEN 'Audit Proof On-Demand — CE $77 / Educational $57' ELSE internal_title END,
       checkout_headline = 'Protect Your Practice. Protect Your Peace.',
       terms_url = '/ceu-terms-boss-clinician',
       require_terms = true,
       description = $md$Strengthen your documentation, understand medical necessity, and improve your practice's audit readiness.

### Recorded Training + 1.5 CE Hours — $77 · Educational Access — $57

**Presenter:** Yvette Howard, LCSW · **Format:** Recorded, on-demand home study · **Length:** 90 minutes · **Access:** Lifetime access · **Prerequisites:** None

## Choose Your Option

- **Training + CE Credit — $77:** the full training, the checklist, the post-test and evaluation, and a certificate documenting **1.5 CE hours** after successful completion.
- **Educational Access — $57 | No CE Credit:** the same 90-minute training and checklist for learning only. No CE credit or certificate is issued with this option.

## Your Purchase Includes

- The 90-minute recorded training.
- Downloadable Audit-Readiness Checklist.
- Online post-test and course evaluation.
- Certificate documenting **1.5 CE hours** after successful completion (Training + CE Credit option).

The checklist is a bonus resource and is not included in the calculation of CE hours.

## What You'll Learn

- Identify common documentation deficiencies that increase audit and claim-recoupment risk.
- Describe how clinical records support medical necessity and services billed.
- Apply ethical billing principles to documentation scenarios.
- Identify steps to prepare records for Medicaid, Medicare, and commercial insurance reviews.
- Develop an internal documentation review process.

## Earning Your Certificate

With the Training + CE Credit option, watch the full training, pass the post-test with **75% or higher**, and complete the evaluation. Your certificate will be made available after successful completion.

This training is designed for licensed and associate-level mental health professionals. An internet connection and a device capable of playing video and completing online forms are required.

Participants are responsible for confirming acceptance with their licensing board, including whether the program meets their ethics requirements.

## About Your Presenter

Yvette Howard, LCSW, is a clinical supervisor and founder of Brighter Tomorrow Therapy and Boss Clinician, LLC, with firsthand experience in clinical documentation, insurance audits, ethical billing, and practice ownership.

## Continuing Education Information

Boss Clinician, LLC has been approved by NBCC as an Approved Continuing Education Provider, ACEP No. 7998. Programs that do not qualify for NBCC credit are clearly identified. Boss Clinician, LLC is solely responsible for all aspects of the programs. CE credit applies to the Training + CE Credit option only.

## Purchase and Program Policies

**All sales are final**, except as required by applicable law.

For technical support, accommodation requests, or grievances, email **support@bossclinician.com**.

[Continuing Education Program Policies](/ceu-terms-boss-clinician) | [Privacy Policy](/privacy-policy) | [Terms of Use](/terms)

By completing your purchase, you acknowledge the refund policy and understand that CE credit requires the Training + CE Credit option and successful completion of the training, post-test, and evaluation.

Boss Clinician, LLC, 848 N Rainbow Blvd #441, Las Vegas, Nevada 89107 · support@bossclinician.com$md$,
       updated_at = now()
 WHERE slug = 'audit-proof-your-practice-on-demand-free'
   AND status = 'draft'
   AND pricing_type = 'one_time' AND amount_cents = 7700
   AND description LIKE 'Protect Your Practice. Protect Your Peace.%Join Yvette Howard, LCSW, Clinical Director and Founder of Boss Clinician%';

DROP FUNCTION pg_temp.bc127_fill(int, jsonb);
