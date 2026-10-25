-- Boss Clinician QA Bugs 177-180 (source read 2026-10-25).
-- Native check-ins and CE exam/evaluation are keyed by course/lesson slug and
-- the original Google Form IDs. No attempt, progress, grant, or certificate is written.
-- Sources:
-- https://docs.google.com/document/d/1AgqPHYy-l2zbwy5h_XCk8oKPN0Be1Xkibq-cLj3CjGk
-- https://drive.google.com/file/d/1SbwFGiKSVfqIvbuLHTYcqZBXTcHgy4i6/view
-- PDF says "75% (18 correct)" although 18/25 = 72%; 75% needs 19/25.
-- Existing Boss Move exam deliberately retains its owner-approved, disputed
-- telehealth key (migration 131); this migration does not rewrite it.

DO $do$
DECLARE
  specs jsonb := $checkins$[
  {
    "prompt": "First and last name",
    "kind": "text",
    "required": true,
    "options": []
  },
  {
    "prompt": "Email",
    "kind": "text",
    "required": true,
    "options": []
  },
  {
    "prompt": "The actions you've taken in the last few week(s) that you're feeling really proud of",
    "kind": "text",
    "required": false,
    "options": []
  },
  {
    "prompt": "On a scale of 1–5 (5 being fully satisfied), please rate the effectiveness of this journey so far.",
    "kind": "scale",
    "required": true,
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "I'm always looking to improve and tailor this program to best support you and other therapists. How have you found this process so far? Is there anything you would want to adjust or focus on more?",
    "kind": "text",
    "required": false,
    "options": []
  },
  {
    "prompt": "Would you recommend this program to a friend/colleague?",
    "kind": "single",
    "required": true,
    "options": [
      "Absolutely, I've learned so much",
      "I may tell them",
      "Not at this time"
    ]
  },
  {
    "prompt": "What do you plan to do for self care this week or month?",
    "kind": "multiple",
    "required": false,
    "options": [
      "Read non fiction books",
      "Go to the gym",
      "Journal for 5 minutes",
      "Meditate for 5–10 minutes a day",
      "Other"
    ]
  },
  {
    "prompt": "Other self-care plan (if selected)",
    "kind": "text",
    "required": false,
    "options": []
  }
]$checkins$::jsonb;
  target record;
  q jsonb;
  o jsonb;
  qi bigint;
  oi bigint;
  assessment_id integer;
  question_id integer;
BEGIN
  FOR target IN
    SELECT c.slug AS course_slug, l.id AS lesson_id, l.slug AS lesson_slug,
           l.title AS lesson_title
      FROM courses c
      JOIN course_modules m ON m.course_id = c.id
      JOIN course_lessons l ON l.module_id = m.id
     WHERE ((c.slug = 'the-boss-move'
             AND l.slug IN ('time-to-check-in-phase-1','time-to-check-in-phase-2',
                            'time-to-check-in-phase-3','time-to-check-in-phase-4',
                            'time-to-check-in-phase-5'))
         OR (c.slug = 'profitable-private-practices-training'
             AND l.slug = 'time-to-check-in-phase-2'))
       AND l.content_type = 'embed'
       AND l.embed_html LIKE '%1FAIpQLScHE2Ssfg4Rp5DCet31f9N27rgO20OAprJIB0Ou1Yii4wA4ew%'
       AND NOT EXISTS (SELECT 1 FROM assessments a WHERE a.lesson_id = l.id)
  LOOP
    IF EXISTS (SELECT 1 FROM assessments a
               WHERE a.slug = target.course_slug || '-' || target.lesson_slug || '-check-in')
    THEN CONTINUE; END IF;

    INSERT INTO assessments
      (slug,title,intro_md,kind,lesson_id,pass_mark,show_feedback,
       require_email,published,require_pass,pass_message)
    VALUES
      (target.course_slug || '-' || target.lesson_slug || '-check-in',
       target.lesson_title,
       'Share a short check-in on your progress. This is a survey with no score or pass mark.',
       'survey',target.lesson_id,NULL,false,false,true,false,
       'Your check-in has been saved. Continue to the next lesson.')
    RETURNING id INTO assessment_id;

    FOR q, qi IN SELECT value, ordinality FROM jsonb_array_elements(specs) WITH ORDINALITY LOOP
      INSERT INTO assessment_questions
        (assessment_id,position,prompt,help_text,kind,required)
      VALUES
        (assessment_id,qi - 1,q->>'prompt',
         CASE WHEN qi = 1 THEN 'Your certificate uses the name on your Boss Clinician account profile.'
              WHEN qi = 2 THEN 'Use the email associated with your Boss Clinician account.'
              WHEN qi = 4 THEN '1 = least satisfied; 5 = fully satisfied.'
              ELSE '' END,
         q->>'kind',(q->>'required')::boolean)
      RETURNING id INTO question_id;
      FOR o, oi IN SELECT value, ordinality FROM jsonb_array_elements(q->'options') WITH ORDINALITY LOOP
        INSERT INTO assessment_answers (question_id,position,label,is_correct)
        VALUES (question_id,oi - 1,o #>> '{}',false);
      END LOOP;
    END LOOP;

    UPDATE course_lessons
       SET content_type = 'assessment',
           embed_html = '',
           body_md = 'Complete the check-in survey below. Your answers are saved to your Boss Clinician account.',
           updated_at = now()
     WHERE id = target.lesson_id;
  END LOOP;
END
$do$;

-- Post Exam in the separate Profitable Private Practices training course.
DO $do$
DECLARE
  specs jsonb := $exam$[
  {
    "prompt": "Why is it important for mental health professionals to separate personal and business bank accounts?",
    "kind": "single",
    "required": true,
    "options": [
      "A. It makes tax filing easier and protects personal assets",
      "B. It increases marketing reach",
      "C. It limits client refunds",
      "D. It is only required for corporations"
    ],
    "correct": 0,
    "feedback": "Maintaining separate accounts supports financial integrity, simplifies taxes, and protects your personal assets under an LLC or corporation."
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
    ],
    "correct": 1,
    "feedback": "Registering your business legally and obtaining an EIN ensures compliance with federal and state regulations."
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
    ],
    "correct": 2,
    "feedback": "Confidentiality ensures the privacy and security of client information, as required by HIPAA and ethics codes."
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
    ],
    "correct": 0,
    "feedback": "The NPI identifies health professionals for insurance billing and credentialing across all payer systems."
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
    ],
    "correct": 0,
    "feedback": "Choosing the right entity structure affects taxes, liability, and business security."
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
    ],
    "correct": 1,
    "feedback": "Ethical pricing considers the therapist’s value, expenses, and client accessibility."
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
    ],
    "correct": 0,
    "feedback": "Consistency in financial boundaries fosters professionalism and reliability."
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
    ],
    "correct": 1,
    "feedback": "Clients must understand payment terms, confidentiality, and policies before therapy begins."
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
    ],
    "correct": 0,
    "feedback": "Rates should reflect your clinical expertise, sustainability, and ethical fairness."
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
    ],
    "correct": 0,
    "feedback": "Financial reviews ensure long-term viability and ethical stewardship of your practice."
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
    ],
    "correct": 0,
    "feedback": "Simple, compassionate language improves client understanding and accessibility."
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
    ],
    "correct": 0,
    "feedback": "Ethical marketing educates the public and connects therapists to ideal clients."
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
    ],
    "correct": 0,
    "feedback": "Mutual respect and shared client goals make referrals professional and effective."
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
    ],
    "correct": 0,
    "feedback": "Value-based content builds credibility and nurtures long-term client relationships."
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
    ],
    "correct": 1,
    "feedback": "Truthful, accurate communication maintains professional integrity and public trust."
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
    ],
    "correct": 0,
    "feedback": "HIPAA compliance ensures secure management of client health information."
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
    ],
    "correct": 0,
    "feedback": "Automation reduces errors and enhances consistency in client care systems."
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
    ],
    "correct": 0,
    "feedback": "A BAA confirms a platform meets HIPAA security requirements."
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
    ],
    "correct": 1,
    "feedback": "Secure email protects client privacy and complies with HIPAA rules."
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
    ],
    "correct": 0,
    "feedback": "Transparent billing promotes ethical and professional accountability."
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
    ],
    "correct": 0,
    "feedback": "Tracking metrics supports evidence-based business and clinical planning."
  },
  {
    "prompt": "A sustainable practice model prioritizes:",
    "kind": "single",
    "required": true,
    "options": [
      "A. Profit over quality care",
      "B. Balanced workload, ethical care, and long-term client relationships",
      "C. Maximizing session volume",
      "D. Working without breaks"
    ],
    "correct": 1,
    "feedback": "Sustainability integrates client care with therapist well-being."
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
    ],
    "correct": 0,
    "feedback": "Healthy boundaries prevent compassion fatigue and sustain professional effectiveness."
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
    ],
    "correct": 0,
    "feedback": "Proper systems and ethical oversight are required before hiring other clinicians."
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
    ],
    "correct": 0,
    "feedback": "A CEO mindset helps align business strategy with clinical ethics and purpose."
  }
]$exam$::jsonb;
  v_lesson_id integer;
  assessment_id integer;
  question_id integer;
  q jsonb;
  o jsonb;
  qi bigint;
  oi bigint;
BEGIN
  SELECT l.id INTO v_lesson_id
    FROM courses c
    JOIN course_modules m ON m.course_id = c.id
    JOIN course_lessons l ON l.module_id = m.id
   WHERE c.slug = 'profitable-private-practices-training'
     AND m.title = 'Post Exam'
     AND l.slug = 'post-exam'
     AND l.content_type = 'embed'
     AND l.embed_html LIKE '%1FAIpQLSeWH_-NAtqEOVOSFMVYX788CiQIQfPtj3urQP5I8wmdyQ8c3w%';
  IF v_lesson_id IS NULL OR EXISTS (SELECT 1 FROM assessments a WHERE a.lesson_id = v_lesson_id)
     OR EXISTS (SELECT 1 FROM assessments WHERE slug = 'profitable-private-practices-training-post-exam')
  THEN RETURN; END IF;

  INSERT INTO assessments
    (slug,title,intro_md,kind,lesson_id,pass_mark,max_attempts,show_feedback,
     require_email,published,require_pass,pass_message,fail_message)
  VALUES
    ('profitable-private-practices-training-post-exam',
     'Profitable Private Practices: Final CEU Exam',
     'Answer all 25 questions. The passing score is 75% (at least 19 correct answers).',
     'graded',v_lesson_id,75,NULL,false,false,true,true,
     'You passed the final exam. Complete the program evaluation to receive your certificate.',
     'You need at least 19 of 25 correct answers (75%) to pass. Review the training and try again.')
  RETURNING id INTO assessment_id;

  FOR q, qi IN SELECT value, ordinality FROM jsonb_array_elements(specs) WITH ORDINALITY LOOP
    INSERT INTO assessment_questions (assessment_id,position,prompt,kind,required)
    VALUES (assessment_id,qi - 1,q->>'prompt','single',true)
    RETURNING id INTO question_id;
    FOR o, oi IN SELECT value, ordinality FROM jsonb_array_elements(q->'options') WITH ORDINALITY LOOP
      INSERT INTO assessment_answers (question_id,position,label,is_correct,feedback)
      VALUES (question_id,oi - 1,o #>> '{}',(q->>'correct')::integer = oi - 1,
              CASE WHEN (q->>'correct')::integer = oi - 1 THEN q->>'feedback' ELSE '' END);
    END LOOP;
  END LOOP;

  UPDATE course_lessons
     SET content_type = 'assessment', embed_html = '',
         body_md = 'Take the final exam below. Passing requires at least 19 correct answers out of 25.',
         updated_at = now()
   WHERE id = v_lesson_id;
END
$do$;

-- Same source evaluation form as the existing Boss Move survey in migration 136.
-- A native submission links the evaluation to the member for certificate gating.
DO $do$
DECLARE
  specs jsonb := $evaluation$[
  {
    "prompt": "Email",
    "kind": "text",
    "options": []
  },
  {
    "prompt": "Participant Name and Credentials (example: Jane Smith, LCSW)",
    "kind": "text",
    "options": []
  },
  {
    "prompt": "License Number",
    "kind": "text",
    "options": []
  },
  {
    "prompt": "How many years of experience do you have in your profession?",
    "kind": "single",
    "options": [
      "0–1",
      "1–2",
      "2–4",
      "4+"
    ]
  },
  {
    "prompt": "The learning objectives were fully addressed.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The program content was current.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The program content enhanced my multicultural awareness and ability to work with diverse populations.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The program content was appropriate to my education and experience.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The program content was relevant to my profession.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The program materials enhanced my learning experience.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The program materials were professional in appearance.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The presenter/author was knowledgeable about the content.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The presenter/author effectively delivered the subject matter.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The program advertisement was accurate.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The instructions for accessing the program were clear.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The instructions for navigating through the program were clear.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The instructions for requesting accommodations for a disability were clear.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The instructions for obtaining my certificate of completion for CE credit were clear.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "My questions or concerns were addressed effectively and in a timely manner.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The online technology/platform was appropriate for this event.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The continuing education provider utilized the technology effectively.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "My request for accommodations was satisfactorily met.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The program materials enhanced my learning experience",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The program materials were professional in appearance.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The instructions for accessing the program were clear.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The instructions for navigating through the program were clear.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The instructions for obtaining my certificate of completion for CE were clear.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The online technology/platform was appropriate for this event.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "The continuing education provider utilized the technology effectively.",
    "kind": "scale",
    "options": [
      "1",
      "2",
      "3",
      "4",
      "5"
    ]
  },
  {
    "prompt": "How could we improve this program?",
    "kind": "text",
    "options": []
  },
  {
    "prompt": "Any additional comments, suggestions, or takeaways?",
    "kind": "text",
    "options": []
  }
]$evaluation$::jsonb;
  v_lesson_id integer;
  v_assessment_id integer;
  v_question_id integer;
  q jsonb;
  o jsonb;
  qi bigint;
  oi bigint;
BEGIN
  SELECT l.id INTO v_lesson_id
    FROM courses c
    JOIN course_modules m ON m.course_id = c.id
    JOIN course_lessons l ON l.module_id = m.id
   WHERE c.slug = 'profitable-private-practices-training'
     AND m.title = 'CE Certification and Evaluation'
     AND l.slug = 'program-evaluation-form'
     AND l.content_type = 'embed'
     AND l.embed_html LIKE '%1FAIpQLScIMMCzdKVlxe8Jrkn9KQ-eKIiMTyHGS_C_O890EWpHus1JZQ%';
  IF v_lesson_id IS NULL
     OR EXISTS (SELECT 1 FROM assessments a WHERE a.lesson_id = v_lesson_id)
     OR EXISTS (SELECT 1 FROM assessments a WHERE a.slug = 'profitable-private-practices-program-evaluation')
  THEN RETURN; END IF;

  INSERT INTO assessments
    (slug,title,intro_md,kind,lesson_id,pass_mark,show_feedback,
     require_email,published,require_pass,pass_message)
  VALUES
    ('profitable-private-practices-program-evaluation',
     'Profitable Private Practices: Program Evaluation',
     'Complete this evaluation after passing the final exam. Ratings use 1 = Disagree through 5 = Agree. Your certificate becomes available after all course requirements are met.',
     'survey',v_lesson_id,NULL,false,false,true,false,
     'Thank you. Your evaluation is saved and your certificate is available when all course requirements are complete.')
  RETURNING id INTO v_assessment_id;

  FOR q, qi IN SELECT value, ordinality FROM jsonb_array_elements(specs) WITH ORDINALITY LOOP
    INSERT INTO assessment_questions
      (assessment_id,position,prompt,help_text,kind,required)
    VALUES
      (v_assessment_id,qi - 1,q->>'prompt',
       CASE WHEN q->>'kind' = 'scale'
            THEN '1 = Disagree · 2 = Somewhat Disagree · 3 = Neutral · 4 = Somewhat Agree · 5 = Agree'
            WHEN qi = 2
            THEN 'The certificate uses the full name on your Boss Clinician member profile.'
            ELSE '' END,
       q->>'kind',true)
    RETURNING id INTO v_question_id;
    FOR o, oi IN SELECT value, ordinality FROM jsonb_array_elements(q->'options') WITH ORDINALITY LOOP
      INSERT INTO assessment_answers (question_id,position,label,is_correct)
      VALUES (v_question_id,oi - 1,o #>> '{}',false);
    END LOOP;
  END LOOP;

  UPDATE course_lessons
     SET content_type = 'assessment', embed_html = '',
         body_md = 'Submit the program evaluation below after passing the final exam. Your answers are saved to your account for certificate eligibility.',
         requires_previous_lesson = true, updated_at = now()
   WHERE id = v_lesson_id;
END
$do$;

-- The course builder reads these fields directly. Keep the 4 Core CE hours and
-- NBCC program title on the certificate, and require passing its graded exam.
-- The template was already enabled; do not issue a certificate in migration.
UPDATE courses c
   SET certificate_requires_pass = true, updated_at = now()
 WHERE c.slug = 'profitable-private-practices-training'
   AND c.certificate_requires_pass = false;

UPDATE certificate_templates ct
   SET body = CASE WHEN ct.body = '' THEN
         'Profitable Private Practices: Training for Clinically-Aligned Private Practices'
         ELSE ct.body END,
       signature_name = CASE WHEN ct.signature_name = '' THEN 'Yvette Howard, LCSW' ELSE ct.signature_name END,
       signature_title = CASE WHEN ct.signature_title = '' THEN 'Founder, Boss Clinician, LLC' ELSE ct.signature_title END,
       ceu_credit_quarter_hours = CASE WHEN ct.ceu_credit_quarter_hours = 0 THEN 16 ELSE ct.ceu_credit_quarter_hours END,
       ceu_provider_name = CASE WHEN ct.ceu_provider_name = '' THEN 'Boss Clinician, LLC' ELSE ct.ceu_provider_name END,
       ceu_provider_number = CASE WHEN ct.ceu_provider_number = '' THEN '7998' ELSE ct.ceu_provider_number END,
       updated_at = now()
  FROM courses c
 WHERE c.id = ct.course_id
   AND c.slug = 'profitable-private-practices-training'
   AND ct.issue_on = 'completion'
   AND ct.enabled
   AND (ct.body = '' OR ct.signature_name = '' OR ct.signature_title = ''
        OR ct.ceu_credit_quarter_hours = 0 OR ct.ceu_provider_name = ''
        OR ct.ceu_provider_number = '')
   AND EXISTS (
       SELECT 1 FROM assessments a JOIN course_lessons l ON l.id=a.lesson_id
       JOIN course_modules m ON m.id=l.module_id
       WHERE m.course_id=c.id AND l.slug='post-exam'
         AND a.kind='graded' AND a.published AND a.pass_mark=75
   )
   AND EXISTS (
       SELECT 1 FROM assessments a JOIN course_lessons l ON l.id=a.lesson_id
       JOIN course_modules m ON m.id=l.module_id
       WHERE m.course_id=c.id AND l.slug='program-evaluation-form'
         AND a.kind='survey' AND a.published
   );
