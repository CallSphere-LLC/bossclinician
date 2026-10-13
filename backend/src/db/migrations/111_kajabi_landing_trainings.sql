-- 111 — Two Kajabi landing-page trainings become courses.
--
-- Owner (13 Oct): "I have a few of my trainings on landing pages, maybe I
-- should add them into the course section?"
--
--   /on-demand-audit-your-private-practice  -> "Audit Proof Your Practice (On-Demand Training)"
--     Wistia 6hcqynp7xd, 1080p, 1 h 15 min. Her page: step 1 note template,
--     step 2 the video, step 3 "TAKE POST EXAM HERE" (Kajabi assessment
--     2148618320, "Post-Test: Audit Proof Your Practice").
--   /replay-documentation                   -> "The Do's & Don'ts of Clinical Documentation (On-Demand Replay)"
--     Wistia k6qwlw67nj, 720p (Wistia's best for it), 3 h 39 min: the 25 Sep
--     2026 workshop, plus the two practice worksheets it used live.
--
-- Media. Wistia dies with the Kajabi account, so the files were copied once by
-- backend/scripts/kajabi-import/place-landing-trainings.sh into the media
-- bucket (create-only, new "landing-" keys) and the host upload volumes. The
-- videos are /uploads/ (public) refs, not protected: — the landing pages
-- play the very same files to anyone with the link, so a members-only copy
-- would protect nothing; the course and the page share one file. Downloads
-- are protected: refs, served through the entitled download route.
--
-- Defaults (owner can change all of these in admin):
--   * courses published (catalogue card + sales page, which says "Enrollment
--     will open..." until an offer is live); products published, so anyone
--     holding a grant sees the course in their library. No grants are written.
--   * one FREE offer per course, in DRAFT: Kajabi is still the live store.
--   * the course products are also attached to the draft paid offers Kajabi
--     sold for exactly these trainings (088): audit-proof-on-demand (+
--     -educational) and dos-and-donts-of-documentation-ce (/ -edu). Those
--     offers had no product, so a buyer would have received nothing.
--   * post-test rebuilt (15 questions verbatim, 75% pass, a pass required to
--     complete the lesson, score only — Kajabi hid the answers). ANSWER KEY:
--     Kajabi's public page does not include it; the key below is the
--     unambiguous best answer to each question and MUST be checked by the
--     owner against Kajabi (Admin -> Assessments -> Post-Test: Audit Proof
--     Your Practice). Q2's fourth option "New Choice" was a Kajabi editor
--     placeholder and is left out.
--   * a certificate template for the audit course, DISABLED: CE hours and the
--     provider number are not known here, and CEU and Educational-only buyers
--     get the same course. Course Builder -> Certificate switches it on.
--
-- Keys: courses/products/offers by slug, modules/lessons/files by kajabi_id
-- 'landing:<page>:<part>', media by url, the quiz by slug. Only ever inserts
-- what is missing, so the owner's later edits survive a re-run. No emails,
-- no Stripe, no jobs.

-- ── 1. Media library rows ───────────────────────────────────────────────────
INSERT INTO media_assets (filename, original_name, url, mime, kind, size_bytes, title, folder, tags)
SELECT v.filename, v.original_name, v.url, v.mime, v.kind, v.size_bytes, v.title, 'Kajabi import', ARRAY['kajabi', 'landing-training']
  FROM (VALUES
    ('landing-audit-proof-on-demand-1080p.mp4', 'Audit_Proof_Replay.mp4',
     '/uploads/landing-audit-proof-on-demand-1080p.mp4', 'video/mp4', 'video', 385961019::bigint,
     $t$Audit Proof Your Practice — on-demand training (1080p)$t$),
    ('landing-dos-and-donts-documentation-replay-720p.mp4', 'Do_s_and_Don_ts_of_Documentation.mp4',
     '/uploads/landing-dos-and-donts-documentation-replay-720p.mp4', 'video/mp4', 'video', 585170471::bigint,
     $t$The Do's & Don'ts of Clinical Documentation — replay (720p)$t$),
    ('landing-audit-proof-on-demand-poster.png', 'Facebook_Banner_from_Karen_39_.png',
     '/uploads/landing-audit-proof-on-demand-poster.png', 'image/png', 'image', 1124215::bigint,
     $t$Audit Proof Your Practice — poster$t$),
    ('landing-dos-and-donts-documentation-replay-poster.jpg', 'DosDonts_Documentation.jpg',
     '/uploads/landing-dos-and-donts-documentation-replay-poster.jpg', 'image/jpeg', 'image', 32834::bigint,
     $t$The Do's & Don'ts of Clinical Documentation — poster$t$),
    ('landing-audit-proof-note-template.pdf', 'audit-proof-note-template.pdf',
     'protected:landing-audit-proof-note-template.pdf', 'application/pdf', 'document', 270969::bigint,
     $t$Audit Proof Your Practice — note template$t$),
    ('landing-practice-progress-note-template.docx', 'practice-progress-note-template.docx',
     'protected:landing-practice-progress-note-template.docx',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', 10165::bigint,
     $t$Practice Progress Note Template$t$),
    ('landing-practice-treatment-plan-template.docx', 'practice-treatment-plan-template.docx',
     'protected:landing-practice-treatment-plan-template.docx',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', 9615::bigint,
     $t$Practice Treatment Plan Template$t$)
  ) AS v(filename, original_name, url, mime, kind, size_bytes, title)
 WHERE NOT EXISTS (SELECT 1 FROM media_assets m WHERE m.url = v.url);

-- ── 2. Courses and their products ───────────────────────────────────────────
INSERT INTO courses (slug, title, subtitle, description, price_text, image, url, features, sort, published)
SELECT v.slug, v.title, v.subtitle, v.description, '', v.image, '/courses/' || v.slug, '[]'::jsonb,
       (SELECT COALESCE(MAX(sort), 0) FROM courses) + v.n, true
  FROM (VALUES
    (1, 'audit-proof-your-practice-on-demand',
     $t$Audit Proof Your Practice (On-Demand Training)$t$,
     $t$On-demand training with Yvette Howard, LCSW$t$,
     $t$Protect Your Practice. Protect Your Peace.

Join Yvette Howard, LCSW, Clinical Director and Founder of Boss Clinician, for a 90-minute CEU workshop that breaks down how to protect your practice from audits, billing errors, and compliance pitfalls — without getting overwhelmed.

You'll learn how to:
- Identify the most common audit triggers therapists face
- Write documentation that demonstrates medical necessity
- Apply ethical billing practices to protect your license
- Prepare for Medicaid, Medicare, and UHC audits with confidence
- Create internal systems that make your practice audit-proof$t$,
     '/uploads/landing-audit-proof-on-demand-poster.png'),
    (2, 'dos-and-donts-of-clinical-documentation-replay',
     $t$The Do's & Don'ts of Clinical Documentation (On-Demand Replay)$t$,
     $t$Workshop replay with Yvette Howard, LCSW$t$,
     $t$Every note tells a story. Make sure it's one you can defend.

The full replay of Yvette Howard's 3.5 hour Ethics workshop on everyday, high risk, legal, telehealth, and AI assisted documentation, so you can write notes that show your clinical judgment without over documenting.

You'll learn how to:
- Identify the documentation habits that quietly increase audit and liability risk.
- Know what belongs in the note, what doesn't, and how to document clinical judgment without over-documenting.
- Write high risk documentation, including suicidality, mandated reporting, substance use, and crisis sessions, with clarity and sound clinical reasoning.
- Connect progress notes to treatment goals and medical necessity more clearly.
- Apply HIPAA-conscious retention, destruction, records request, telehealth, and subpoena practices.
- Evaluate AI assisted documentation more critically, including HIPAA considerations, client consent, review, and clinician responsibility.
- Build a monthly self-audit habit that protects your practice long after the training ends.$t$,
     '/uploads/landing-dos-and-donts-documentation-replay-poster.jpg')
  ) AS v(n, slug, title, subtitle, description, image)
 WHERE NOT EXISTS (SELECT 1 FROM courses c WHERE c.slug = v.slug);

-- products.kajabi_id stays NULL: import.mjs matches Kajabi products on it.
INSERT INTO products (slug, title, subtitle, description, thumbnail_url, kind, course_id, status, sort)
SELECT c.slug, c.title, c.subtitle, c.description, COALESCE(c.image, ''), 'course', c.id, 'published',
       (SELECT COALESCE(MAX(sort), 0) FROM products) + row_number() OVER (ORDER BY c.id)
  FROM courses c
 WHERE c.slug IN ('audit-proof-your-practice-on-demand', 'dos-and-donts-of-clinical-documentation-replay')
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = c.slug);

-- ── 3. Modules ──────────────────────────────────────────────────────────────
INSERT INTO course_modules (course_id, title, summary, sort, kajabi_id, image_url)
SELECT c.id, v.title, v.summary, 0, v.kajabi_id, c.image
  FROM (VALUES
    ('audit-proof-your-practice-on-demand', 'landing:on-demand-audit-your-private-practice:module',
     $t$Audit Proof Your Practice$t$,
     $t$Take notes, watch the training, then take the post-test.$t$),
    ('dos-and-donts-of-clinical-documentation-replay', 'landing:replay-documentation:module',
     $t$The Do's & Don'ts of Clinical Documentation$t$,
     $t$Grab the practice worksheets, then watch the replay.$t$)
  ) AS v(course_slug, kajabi_id, title, summary)
  JOIN courses c ON c.slug = v.course_slug
 WHERE NOT EXISTS (SELECT 1 FROM course_modules m WHERE m.course_id = c.id AND m.kajabi_id = v.kajabi_id);

-- ── 4. Lessons ──────────────────────────────────────────────────────────────
INSERT INTO course_lessons (module_id, title, slug, body_md, video_url, content_type, thumbnail_url,
                            published, sort, comments_enabled, video_duration_seconds, duration_minutes,
                            kajabi_id, preview)
SELECT m.id, v.title, v.slug, v.body_md, v.video_url, v.content_type, v.thumbnail_url,
       true, v.sort, true, v.seconds, CEIL(v.seconds / 60.0)::int, v.kajabi_id, false
  FROM (VALUES
    ('landing:on-demand-audit-your-private-practice:module', 'landing:on-demand-audit-your-private-practice:notes', 0,
     $t$Start here: your note template$t$, 'start-here-your-note-template', 'text', '', 0,
     '/uploads/landing-audit-proof-on-demand-poster.png',
     $t$Welcome to **Audit Proof Your Practice**.

**Step 1:** Grab your note template to take notes on what you're learning. It's attached to this lesson: download it below.

**Step 2:** Watch the on-demand training in the next lesson.

**Step 3:** Take the post-test. Passing score: 75% or higher.$t$),
    ('landing:on-demand-audit-your-private-practice:module', 'landing:on-demand-audit-your-private-practice:video', 1,
     $t$Watch the training$t$, 'watch-the-training', 'video', '/uploads/landing-audit-proof-on-demand-1080p.mp4', 4492,
     '/uploads/landing-audit-proof-on-demand-poster.png',
     $t$Click play to watch the on-demand training. Keep your note template open as you go, then take the post-test in the next lesson.$t$),
    ('landing:on-demand-audit-your-private-practice:module', 'landing:on-demand-audit-your-private-practice:post-test', 2,
     $t$Post-Test: Audit Proof Your Practice$t$, 'post-test-audit-proof-your-practice', 'assessment', '', 0,
     '/uploads/landing-audit-proof-on-demand-poster.png',
     $t$15 questions. Passing score: 75% or higher.$t$),
    ('landing:replay-documentation:module', 'landing:replay-documentation:worksheets', 0,
     $t$Start here: your practice worksheets$t$, 'start-here-your-practice-worksheets', 'text', '', 0,
     '/uploads/landing-dos-and-donts-documentation-replay-poster.jpg',
     $t$The training uses these two worksheets. Download your own copy below so you're ready to write along, not just watch:

- Practice Progress Note Template
- Practice Treatment Plan Template$t$),
    ('landing:replay-documentation:module', 'landing:replay-documentation:video', 1,
     $t$Watch the replay$t$, 'watch-the-replay', 'video', '/uploads/landing-dos-and-donts-documentation-replay-720p.mp4', 13116,
     '/uploads/landing-dos-and-donts-documentation-replay-poster.jpg',
     $t$The full replay of The Do's & Don'ts of Clinical Documentation with Yvette Howard, LCSW.$t$)
  ) AS v(module_key, kajabi_id, sort, title, slug, content_type, video_url, seconds, thumbnail_url, body_md)
  JOIN course_modules m ON m.kajabi_id = v.module_key
 WHERE NOT EXISTS (SELECT 1 FROM course_lessons l WHERE l.kajabi_id = v.kajabi_id);

-- ── 5. Lesson downloads ─────────────────────────────────────────────────────
INSERT INTO lesson_files (lesson_id, media_id, title, storage_path, filename, mime, size_bytes, sort, kajabi_id)
SELECT l.id, ma.id, v.title, v.storage_path, v.filename, ma.mime, ma.size_bytes, v.sort, v.kajabi_id
  FROM (VALUES
    ('landing:on-demand-audit-your-private-practice:notes', 'landing:on-demand-audit-your-private-practice:note-template', 0,
     $t$Audit Proof Your Practice — note template$t$, 'protected:landing-audit-proof-note-template.pdf', 'audit-proof-note-template.pdf'),
    ('landing:replay-documentation:worksheets', 'landing:replay-documentation:progress-note-template', 0,
     $t$Practice Progress Note Template$t$, 'protected:landing-practice-progress-note-template.docx', 'practice-progress-note-template.docx'),
    ('landing:replay-documentation:worksheets', 'landing:replay-documentation:treatment-plan-template', 1,
     $t$Practice Treatment Plan Template$t$, 'protected:landing-practice-treatment-plan-template.docx', 'practice-treatment-plan-template.docx')
  ) AS v(lesson_key, kajabi_id, sort, title, storage_path, filename)
  JOIN course_lessons l ON l.kajabi_id = v.lesson_key
  JOIN LATERAL (SELECT id, mime, size_bytes FROM media_assets WHERE url = v.storage_path ORDER BY id LIMIT 1) ma ON true
 WHERE NOT EXISTS (SELECT 1 FROM lesson_files f WHERE f.lesson_id = l.id AND f.kajabi_id = v.kajabi_id);

-- ── 6. Post-test (Kajabi assessment 2148618320) ─────────────────────────────
-- Slug fixed by frontend/src/content/leadMagnetsDocumentation.ts. Attached to
-- the lesson, so taking it needs a signed-in member with access (104's model).
-- correctIndex = the owner-unverified key described at the top of this file.
DO $do$
DECLARE
  specs jsonb := $kj$[
   {"prompt": "Which of the following is the primary purpose of a payer audit?",
    "options": ["To penalize providers for billing errors", "To ensure documentation meets payer and clinical standards", "To verify client satisfaction", "To review clinical effectiveness only"], "correctIndex": 1},
   {"prompt": "Which documentation element best demonstrates medical necessity?",
    "options": ["Listing every coping skill discussed", "Describing symptoms, treatment goals, and client progress", "Repeating the same note for each session"], "correctIndex": 1},
   {"prompt": "Medicaid and Medicare auditors primarily review records for:",
    "options": ["Missed appointments", "Evidence of informed consent", "Proof of medical necessity and accurate CPT coding", "Therapist education level"], "correctIndex": 2},
   {"prompt": "Which CPT code represents a 53+ minute psychotherapy session?",
    "options": ["90832", "90834", "90837", "90846"], "correctIndex": 2},
   {"prompt": "Progress notes should typically be completed within how many hours of the session?",
    "options": ["72–96 hours", "24–48 hours", "One week", "Immediately after billing submission"], "correctIndex": 1},
   {"prompt": "True or False: Using identical (cloned) progress notes for multiple clients is considered compliant if the services provided were similar",
    "options": ["True", "False"], "correctIndex": 1},
   {"prompt": "Which of the following would likely trigger an audit?",
    "options": ["Consistent CPT coding and documentation", "Signed and dated treatment plans", "Frequent billing of the same code without time documentation", "Timely completion of progress notes"], "correctIndex": 2},
   {"prompt": "In a United Healthcare or Commercial Risk Adjustment Audit, what do payers primarily evaluate?",
    "options": ["Diagnosis coding accuracy (HCC) and documentation alignment", "Client attendance rates", "Therapy effectiveness surveys", "Clinician marketing materials"], "correctIndex": 0},
   {"prompt": "Which statement about audit preparedness is true?",
    "options": ["It begins only after receiving an audit notice.", "It requires consistent internal reviews and staff training.", "It’s only relevant for Medicaid providers.", "It focuses solely on billing."], "correctIndex": 1},
   {"prompt": "Which ethical principle applies when correcting a documentation error?",
    "options": ["Delete the original note and rewrite it.", "Ignore the error if the client improved.", "Use an addendum explaining the correction with date and initials.", "Backdate the note to avoid detection."], "correctIndex": 2},
   {"prompt": "What is the best first step when receiving an audit letter?",
    "options": ["Contact the payer to argue the review", "Panic and delete outdated notes", "Review your internal audit checklist and gather requested documentation", "Ignore the letter until the deadline approaches"], "correctIndex": 2},
   {"prompt": "Which of the following is NOT part of an internal compliance system?",
    "options": ["Monthly or quarterly chart reviews", "Annual staff training on documentation", "Random file audits", "Allowing clinicians to choose their own documentation rules"], "correctIndex": 3},
   {"prompt": "True or False: Progress notes must reflect both the intervention provided and the client’s response to the intervention.",
    "options": ["True", "False"], "correctIndex": 0},
   {"prompt": "In ethical billing, clinicians should:",
    "options": ["Bill for missed appointments to recover lost income", "Bill only for services provided and documented", "Increase session lengths for higher reimbursement", "Bill under a supervisor’s license without disclosure"], "correctIndex": 1},
   {"prompt": "Which of the following best describes the goal of this training?",
    "options": ["To teach advanced therapy techniques", "To help clinicians identify and correct compliance gaps to prevent audits", "To train therapists on marketing their practices", "To prepare therapists for licensure renewal exams"], "correctIndex": 1}
  ]$kj$;
  v_lesson int;
  v_assessment int;
  v_question int;
  q jsonb;
  qi bigint;
  o jsonb;
  oi bigint;
BEGIN
  SELECT id INTO v_lesson FROM course_lessons WHERE kajabi_id = 'landing:on-demand-audit-your-private-practice:post-test';
  IF v_lesson IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM assessments WHERE lesson_id = v_lesson OR slug = 'audit-proof-post-test') THEN RETURN; END IF;

  INSERT INTO assessments
    (slug, title, intro_md, kind, lesson_id, pass_mark, show_feedback,
     require_email, published, require_pass, pass_message, fail_message)
  VALUES
    ('audit-proof-post-test', $t$Post-Test: Audit Proof Your Practice$t$,
     $t$Passing score: 75% or higher. Answer all 15 questions, then submit to see your score.$t$,
     'graded', v_lesson, 75, false, false, true, true,
     $t$You passed the Audit Proof Your Practice post-test.$t$,
     $t$This attempt did not reach the 75% passing score. Review the training and try again.$t$)
  RETURNING id INTO v_assessment;

  FOR q, qi IN SELECT value, ordinality FROM jsonb_array_elements(specs) WITH ORDINALITY LOOP
    INSERT INTO assessment_questions (assessment_id, position, prompt, kind, required)
    VALUES (v_assessment, qi - 1, q->>'prompt', 'single', true)
    RETURNING id INTO v_question;

    FOR o, oi IN SELECT value, ordinality FROM jsonb_array_elements(q->'options') WITH ORDINALITY LOOP
      INSERT INTO assessment_answers (question_id, position, label, is_correct)
      VALUES (v_question, oi - 1, o #>> '{}', (q->>'correctIndex')::int = oi - 1);
    END LOOP;
  END LOOP;
END
$do$;

-- ── 7. Certificate (disabled until the owner switches it on) ────────────────
INSERT INTO certificate_templates (course_id, title, issue_on, enabled)
SELECT c.id, 'Certificate of Completion', 'completion', false
  FROM courses c
 WHERE c.slug = 'audit-proof-your-practice-on-demand'
   AND NOT EXISTS (SELECT 1 FROM certificate_templates t WHERE t.course_id = c.id);

-- ── 8. Offers ───────────────────────────────────────────────────────────────
-- Free draft offers, one per course.
INSERT INTO offers (title, internal_title, slug, status, description, pricing_type, amount_cents, currency, send_welcome_email)
SELECT c.title, v.internal_title, v.slug, 'draft', c.description, 'free', 0, 'usd', true
  FROM (VALUES
    ('audit-proof-your-practice-on-demand', 'audit-proof-your-practice-on-demand-free',
     $t$Audit Proof On-Demand — free course access$t$),
    ('dos-and-donts-of-clinical-documentation-replay', 'dos-and-donts-of-clinical-documentation-replay-free',
     $t$Do's & Don'ts Documentation Replay — free course access$t$)
  ) AS v(course_slug, slug, internal_title)
  JOIN courses c ON c.slug = v.course_slug
 WHERE NOT EXISTS (SELECT 1 FROM offers o WHERE o.slug = v.slug);

-- Offer -> product: the free offers, and the draft paid offers Kajabi sold
-- these trainings through (no products until now).
INSERT INTO offer_products (offer_id, product_id, sort)
SELECT o.id, p.id, 0
  FROM (VALUES
    ('audit-proof-your-practice-on-demand-free', 'audit-proof-your-practice-on-demand'),
    ('audit-proof-on-demand', 'audit-proof-your-practice-on-demand'),
    ('audit-proof-on-demand-educational', 'audit-proof-your-practice-on-demand'),
    ('dos-and-donts-of-clinical-documentation-replay-free', 'dos-and-donts-of-clinical-documentation-replay'),
    ('dos-and-donts-of-documentation-ce', 'dos-and-donts-of-clinical-documentation-replay'),
    ('dos-and-donts-of-documentation-edu', 'dos-and-donts-of-clinical-documentation-replay')
  ) AS v(offer_slug, product_slug)
  JOIN offers o ON o.slug = v.offer_slug
  JOIN products p ON p.slug = v.product_slug
 WHERE NOT EXISTS (SELECT 1 FROM offer_products x WHERE x.offer_id = o.id AND x.product_id = p.id);
