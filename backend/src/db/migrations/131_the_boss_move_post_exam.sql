-- QA Bugs row 128: import the linked Profitable Private Practice post-exam
-- into The Boss Move course's existing Post Exam lesson.
-- Source: https://docs.google.com/forms/d/e/1FAIpQLSeWH_-NAtqEOVOSFMVYX788CiQIQfPtj3urQP5I8wmdyQ8c3w/viewform?usp=header
-- The public form exposes 25 multiple-choice questions and three identity
-- fields. It does NOT expose a verified answer key. All is_correct values
-- remain false and the assessment stays unpublished, so no learner can earn
-- credit from an unverified key. The form also says "75% (18/25)"; 18/25 is
-- 72%, while 75% requires 19/25. The owner must settle the pass standard.
-- Once the key and standard are confirmed, publish the assessment and switch
-- lesson content_type from text to assessment in Admin.
DO $do$
DECLARE
  specs jsonb := $spec$[
  {
    "prompt": "Full Name",
    "kind": "text",
    "required": true,
    "options": []
  },
  {
    "prompt": "Email Address",
    "kind": "text",
    "required": true,
    "options": []
  },
  {
    "prompt": "Professional License (e.g., LCSW, LMFT, LPC, Psychologist, etc.)",
    "kind": "text",
    "required": true,
    "options": []
  },
  {
    "prompt": "Why is it important for mental health professionals to separate personal and business bank accounts?",
    "kind": "single",
    "required": true,
    "options": [
      "A. It makes tax filing easier and protects personal assets",
      "B. It increases marketing reach",
      "C. It limits client refunds",
      "D. It is only required for corporations"
    ]
  },
  {
    "prompt": "An essential legal step when opening a private practice includes:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Creating a social media page",
      "B. Registering your business entity and obtaining an EIN",
      "C. Designing your logo",
      "D. Hiring an assistant"
    ]
  },
  {
    "prompt": "What ethical principle is most related to maintaining secure client records?",
    "kind": "single",
    "required": true,
    "options": [
      "A. Fidelity",
      "B. Autonomy",
      "C. Confidentiality",
      "D. Beneficence"
    ]
  },
  {
    "prompt": "Why is it important to obtain an NPI (National Provider Identifier)?",
    "kind": "single",
    "required": true,
    "options": [
      "A. It serves as your unique identifier for billing and insurance purposes",
      "B. It verifies your clinical license",
      "C. It increases search engine visibility",
      "D. It is optional for private pay therapists"
    ]
  },
  {
    "prompt": "When deciding on a business structure, the main consideration is:",
    "kind": "single",
    "required": true,
    "options": [
      "A. The potential for tax benefits and liability protection",
      "B. The popularity of the business name",
      "C. The number of clients you expect",
      "D. Whether your friends recommend it"
    ]
  },
  {
    "prompt": "A fair and ethical fee structure should be based on:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Competitor rates only",
      "B. The counselor’s credentials, expenses, and client access needs",
      "C. Personal preference",
      "D. Insurance reimbursement rates only"
    ]
  },
  {
    "prompt": "What is a major benefit of setting consistent financial policies?",
    "kind": "single",
    "required": true,
    "options": [
      "A. It reduces client cancellations and builds trust",
      "B. It guarantees more referrals",
      "C. It prevents clients from requesting receipts",
      "D. It eliminates intake paperwork"
    ]
  },
  {
    "prompt": "Which of the following is most important to discuss during informed consent?",
    "kind": "single",
    "required": true,
    "options": [
      "A. Your social media guidelines",
      "B. Fees, billing, and cancellation policies",
      "C. Your personal life story",
      "D. Your marketing goals"
    ]
  },
  {
    "prompt": "The best practice when setting session rates is to:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Determine them based on your financial goals and ethical guidelines",
      "B. Charge the lowest amount possible to attract more clients",
      "C. Base them on your colleagues’ rates only",
      "D. Avoid adjusting rates over time"
    ]
  },
  {
    "prompt": "Why should therapists conduct regular financial reviews of their practice?",
    "kind": "single",
    "required": true,
    "options": [
      "A. To identify trends, improve budgeting, and maintain sustainability",
      "B. To compare salaries with peers",
      "C. To update social media content",
      "D. To track clinical outcomes"
    ]
  },
  {
    "prompt": "When describing services on your website, you should:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Use clear, client-friendly language that avoids clinical jargon",
      "B. Focus only on your credentials",
      "C. Include every therapeutic approach you’ve ever studied",
      "D. List your fees without context"
    ]
  },
  {
    "prompt": "What is the primary purpose of marketing for therapists?",
    "kind": "single",
    "required": true,
    "options": [
      "A. To communicate value and reach the clients you can help most",
      "B. To outperform competitors",
      "C. To collect data for future sales",
      "D. To promote unrelated services"
    ]
  },
  {
    "prompt": "What makes a good professional referral partnership?",
    "kind": "single",
    "required": true,
    "options": [
      "A. Shared client population and ethical collaboration",
      "B. Frequent promotional exchanges",
      "C. Referral payments to other providers",
      "D. Avoiding any discussion of clinical coordination"
    ]
  },
  {
    "prompt": "A lead magnet is most effective when it:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Provides real value that builds trust and encourages next steps",
      "B. Is heavily sales-focused",
      "C. Requires paid access",
      "D. Only lists your services"
    ]
  },
  {
    "prompt": "Ethically, when marketing your practice, you should:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Guarantee specific treatment outcomes",
      "B. Avoid making false or misleading claims",
      "C. Use client testimonials freely without consent",
      "D. Exaggerate success stories"
    ]
  },
  {
    "prompt": "Which system feature is most critical for an Electronic Health Record (EHR)?",
    "kind": "single",
    "required": true,
    "options": [
      "A. HIPAA-compliance and data encryption",
      "B. Ability to post to social media",
      "C. Automatic price discounts",
      "D. Integration with your playlist"
    ]
  },
  {
    "prompt": "Using automation for intake and scheduling can improve:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Client experience and administrative efficiency",
      "B. Clinical accuracy",
      "C. Marketing visibility",
      "D. Tax deductions"
    ]
  },
  {
    "prompt": "To ensure HIPAA compliance in telehealth, a therapist should:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Use video platforms that provide a Business Associate Agreement (BAA)",
      "B. Use FaceTime for convenience",
      "C. Disable encryption for faster calls",
      "D. Share passwords with clients"
    ]
  },
  {
    "prompt": "What is the ethical concern when using email communication with clients?",
    "kind": "single",
    "required": true,
    "options": [
      "A. Grammar errors",
      "B. Protecting confidentiality and using secure platforms",
      "C. Delayed responses",
      "D. Writing too formally"
    ]
  },
  {
    "prompt": "Automating payment systems supports which ethical value?",
    "kind": "single",
    "required": true,
    "options": [
      "A. Integrity and professional responsibility",
      "B. Client autonomy",
      "C. Cultural competence",
      "D. Beneficence"
    ]
  },
  {
    "prompt": "What’s the biggest benefit of tracking key business metrics?",
    "kind": "single",
    "required": true,
    "options": [
      "A. It helps identify areas of growth and improve decision-making",
      "B. It replaces supervision",
      "C. It increases your social media followers",
      "D. It allows skipping documentation"
    ]
  },
  {
    "prompt": "A sustainable practice model prioritizes:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Profit over quality care",
      "B. Balanced workload, ethical care, and long-term client relationships",
      "C. Maximizing session volume",
      "D. Working without break"
    ]
  },
  {
    "prompt": "Burnout prevention for therapists includes:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Maintaining clear boundaries and regular self-care practices",
      "B. Avoiding time off to stay productive",
      "C. Taking on extra clients for income",
      "D. Focusing only on client outcomes"
    ]
  },
  {
    "prompt": "Expanding into group practice should only occur when:",
    "kind": "single",
    "required": true,
    "options": [
      "A. You’ve established clear systems, policies, and supervision structures",
      "B. You’ve hired friends",
      "C. You have excess office space",
      "D. You want to work fewer hours immediately"
    ]
  },
  {
    "prompt": "What is the most important long-term benefit of thinking like a CEO as a therapist?",
    "kind": "single",
    "required": true,
    "options": [
      "A. Gaining control, stability, and alignment between your business and clinical values",
      "B. Eliminating client contact",
      "C. Prioritizing profit above all",
      "D. Reducing paperwork alone"
    ]
  }
]$spec$;
  v_lesson int;
  v_assessment int;
  q jsonb;
  qi bigint;
  o jsonb;
  oi bigint;
  v_question int;
BEGIN
  SELECT l.id INTO v_lesson
    FROM course_lessons l
    JOIN course_modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
   WHERE c.slug = 'the-boss-move'
     AND l.slug = 'post-exam'
     AND m.title = 'Post Exam';
  IF v_lesson IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM assessments WHERE lesson_id = v_lesson) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM assessments WHERE slug = 'the-boss-move-post-exam') THEN RETURN; END IF;

  INSERT INTO assessments
    (slug, title, intro_md, kind, lesson_id, pass_mark, max_attempts,
     show_feedback, require_email, published, require_pass)
  VALUES
    ('the-boss-move-post-exam', 'The Boss Move Post Exam', '', 'graded',
     v_lesson, 75, NULL, false, true, false, true)
  RETURNING id INTO v_assessment;

  FOR q, qi IN SELECT value, ordinality FROM jsonb_array_elements(specs) WITH ORDINALITY LOOP
    INSERT INTO assessment_questions
      (assessment_id, position, prompt, help_text, kind, required)
    VALUES
      (v_assessment, qi - 1, q->>'prompt',
       CASE WHEN qi <= 3 THEN 'Identity details from the source form; these are not scored.' ELSE '' END,
       q->>'kind', true)
    RETURNING id INTO v_question;

    FOR o, oi IN SELECT value, ordinality FROM jsonb_array_elements(q->'options') WITH ORDINALITY LOOP
      INSERT INTO assessment_answers (question_id, position, label, is_correct)
      VALUES (v_question, oi - 1, o #>> '{}', false);
    END LOOP;
  END LOOP;
END
$do$;
