-- Kajabi lesson gaps: in-lesson quizzes and calculators.
--
-- The Kajabi import (094 + backend/scripts/kajabi-import/import.mjs) brought
-- every lesson across as text, but two kinds of Kajabi content are not in a
-- post's body and arrived empty or as residue:
--
--   1. Kajabi "assessments" (in-lesson quizzes). Kajabi stores them apart from
--      the post. They are recreated here on the existing graded-assessment
--      machinery (014 + 054: assessments / assessment_questions /
--      assessment_answers / assessment_attempts), attached by lesson_id, and
--      the lesson's content_type is switched to 'assessment' so the player
--      renders the test and gates completion on it.
--
--   2. Two Ramp-Up calculators that were hand-written HTML + script widgets in
--      the post body. Kajabi's export kept the inputs and dropped the script,
--      so the lessons showed field labels and "0 USD". They are rebuilt as
--      native React tools (frontend/src/components/lesson-tools) and attached
--      with the new course_lessons.tool_key column.
--
-- Everything is keyed by course_lessons.kajabi_id, never a numeric id, and a
-- lesson that does not exist (fresh/test database) is simply skipped.
-- Idempotent: safe to apply by hand with psql before a deploy records it.

-- --- interactive lesson tools ---------------------------------------------

ALTER TABLE course_lessons ADD COLUMN IF NOT EXISTS tool_key TEXT;
ALTER TABLE course_lessons DROP CONSTRAINT IF EXISTS course_lessons_tool_key_check;
ALTER TABLE course_lessons ADD CONSTRAINT course_lessons_tool_key_check
  CHECK (tool_key IS NULL OR tool_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Calculator: Ramp-Up Rate Calculator. Body keeps the intro; the stripped
-- widget residue ("Desired Annual Salary Sessions Per Week …", "0 USD") goes.
UPDATE course_lessons
   SET tool_key = 'ramp-up-rate-calculator',
       body_md = $md$#### Use the Ramp-Up Rate Formula Calculator to determine a session rate based on:

- Your Financial Goals
- How Many Sessions Per Week
- Number of Weeks Worked in a Year
- Approximate Expenses$md$,
       updated_at = now()
 WHERE kajabi_id = '2186600443';

-- Calculator: Ramp-Up Rate Comparison.
UPDATE course_lessons
   SET tool_key = 'ramp-up-rate-comparison',
       body_md = $md$**Rate Comparison Calculator:** Easily compare different rates to see how adjusting your session rate impacts your overall earnings, helps you make informed decisions about your rate(s) will help you meet your income goals.$md$,
       updated_at = now()
 WHERE kajabi_id = '2186600444';

-- Practice Elevation: PTO Planning Tool + Income Set-Aside Calculator. The
-- worksheet stays a linked Google Doc (calendar + client emails); section 2,
-- the set-aside arithmetic, is added as a live calculator under the lesson.
UPDATE course_lessons
   SET tool_key = 'pto-set-aside-calculator', updated_at = now()
 WHERE kajabi_id = '2199631527';

-- --- Kajabi in-lesson quizzes ----------------------------------------------
--
-- Source: /var/tmp/kajabi-export/assessments.json, read from Kajabi's quiz
-- editor on 2026-10-01 (questions and options verbatim). 14 quizzes:
--   * 13 readiness checks (The Boss Move phases 1-5, PPP Training phases 1-5,
--     Private Practice Starter Suite lessons 1-3). Not graded in Kajabi, so
--     kind 'survey': submitting saves the answers and completes the lesson.
--   * Credential with Confidence Quiz: graded, 15 questions, pass mark 80%,
--     a pass is required to complete the lesson, and Kajabi hid the correct
--     answers, so show_feedback = false (score and pass/fail only).
-- The answer key (is_correct) never leaves the server: see
-- loadPublicAssessment in services/assessments.ts.
--
-- Slug = <course slug>-<lesson slug> ("Phase 1 Readiness Quiz" exists in two
-- courses). A lesson that already has an assessment is left alone, so the
-- owner's edits in Admin -> Assessments survive a re-run.

DO $do$
DECLARE
  specs jsonb := $kj$[
 {
  "kajabiId": "2186555829",
  "title": "Phase 1 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you chosen and registered your business entity (LLC, Sole Proprietor, etc.)?",
    "options": [
     "A) Yes",
     "B) No, but I’m in the process",
     "C) No, I still need to decide"
    ]
   },
   {
    "prompt": "Do you have a clear exit timeline with financial goals in place?",
    "options": [
     "A) Yes, I have a specific exit date",
     "B) Somewhat, but I need to refine my financial goals",
     "C) No, I haven’t set a timeline yet"
    ]
   },
   {
    "prompt": "How confident are you in your CEO mindset shift and transitioning from employee to business owner?",
    "options": [
     "A) Very confident—I’m ready to take charge",
     "B) Somewhat confident—I still have doubts",
     "C) Not confident—I feel stuck in employee mode"
    ]
   },
   {
    "prompt": "Have you clearly defined your niche and ideal client?",
    "options": [
     "A) Yes, I know exactly who I want to serve",
     "B) Somewhat, but I need to narrow it down",
     "C) No, I’m still unsure about my niche"
    ]
   },
   {
    "prompt": "Have you determined your pricing structure and feel confident in your rates?",
    "options": [
     "A) Yes, I’ve set my fees based on my expertise and expenses",
     "B) I have an idea, but I’m still refining it",
     "C) No, I’m unsure how to price my services"
    ]
   }
  ]
 },
 {
  "kajabiId": "2191373459",
  "title": "Phase 1 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you chosen and registered your business entity (LLC, Sole Proprietor, etc.)?",
    "options": [
     "A) Yes",
     "B) No, but I’m in the process",
     "C) No, I still need to decide"
    ]
   },
   {
    "prompt": "Do you have a clear exit timeline with financial goals in place?",
    "options": [
     "A) Yes, I have a specific exit date",
     "B) Somewhat, but I need to refine my financial goals",
     "C) No, I haven’t set a timeline yet"
    ]
   },
   {
    "prompt": "How confident are you in your CEO mindset shift and transitioning from employee to business owner?",
    "options": [
     "A) Very confident—I’m ready to take charge",
     "B) Somewhat confident—I still have doubts",
     "C) Not confident—I feel stuck in employee mode"
    ]
   },
   {
    "prompt": "Have you clearly defined your niche and ideal client?",
    "options": [
     "A) Yes, I know exactly who I want to serve",
     "B) Somewhat, but I need to narrow it down",
     "C) No, I’m still unsure about my niche"
    ]
   },
   {
    "prompt": "Have you determined your pricing structure and feel confident in your rates?",
    "options": [
     "A) Yes, I’ve set my fees based on my expertise and expenses",
     "B) I have an idea, but I’m still refining it",
     "C) No, I’m unsure how to price my services"
    ]
   }
  ]
 },
 {
  "kajabiId": "2186555837",
  "title": "Phase 2 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you created and optimized your online presence (website, directory profiles, etc.)?",
    "options": [
     "A) Yes, I have a strong, optimized profile",
     "B) Somewhat, but I need to fine-tune it",
     "C) No, I haven’t set it up yet"
    ]
   },
   {
    "prompt": "How confident are you in your ability to generate referrals from professional networks?",
    "options": [
     "A) Very confident—I have a referral network in place",
     "B) Somewhat confident—I’ve reached out but need more connections",
     "C) Not confident—I don’t know where to start"
    ]
   },
   {
    "prompt": "Have you identified at least 3 referral partners (e.g., doctors, attorneys, community leaders) and reached out to them?",
    "options": [
     "A) Yes, I’ve started networking and building relationships",
     "B) Somewhat—I have a list but haven’t taken action yet",
     "C) No, I haven’t thought about referrals yet"
    ]
   },
   {
    "prompt": "Have you created a lead magnet to attract potential clients?",
    "options": [
     "A) Yes, and I’m actively using it to build an email list",
     "B) I have an idea, but I haven’t launched it yet",
     "C) No, I don’t have a lead magnet"
    ]
   },
   {
    "prompt": "Are you consistently engaging with your audience through content (blogs, email, networking, or other marketing efforts)?",
    "options": [
     "A) Yes, I have a plan and I’m executing it",
     "B) Somewhat, but I struggle with consistency",
     "C) No, I haven’t started marketing yet"
    ]
   }
  ]
 },
 {
  "kajabiId": "2191373466",
  "title": "Phase 2 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you created and optimized your online presence (website, directory profiles, etc.)?",
    "options": [
     "A) Yes, I have a strong, optimized profile",
     "B) Somewhat, but I need to fine-tune it",
     "C) No, I haven’t set it up yet"
    ]
   },
   {
    "prompt": "How confident are you in your ability to generate referrals from professional networks?",
    "options": [
     "A) Very confident—I have a referral network in place",
     "B) Somewhat confident—I’ve reached out but need more connections",
     "C) Not confident—I don’t know where to start"
    ]
   },
   {
    "prompt": "Have you identified at least 3 referral partners (e.g., doctors, attorneys, community leaders) and reached out to them?",
    "options": [
     "A) Yes, I’ve started networking and building relationships",
     "B) Somewhat—I have a list but haven’t taken action yet",
     "C) No, I haven’t thought about referrals yet"
    ]
   },
   {
    "prompt": "Have you created a lead magnet to attract potential clients?",
    "options": [
     "A) Yes, and I’m actively using it to build an email list",
     "B) I have an idea, but I haven’t launched it yet",
     "C) No, I don’t have a lead magnet"
    ]
   },
   {
    "prompt": "Are you consistently engaging with your audience through content (blogs, email, networking, or other marketing efforts)?",
    "options": [
     "A) Yes, I have a plan and I’m executing it",
     "B) Somewhat, but I struggle with consistency",
     "C) No, I haven’t started marketing yet"
    ]
   }
  ]
 },
 {
  "kajabiId": "2186555845",
  "title": "Phase 3 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you automated key administrative tasks like scheduling, billing, and client documentation?",
    "options": [
     "A) Yes, I have automated systems in place",
     "B) Somewhat—I have some systems but need to refine them",
     "C) No, I’m still doing everything manually"
    ]
   },
   {
    "prompt": "Have you chosen the right technology and EHR system for managing your practice?",
    "options": [
     "A) Yes, I’ve set up my EHR and other tools",
     "B) Somewhat, but I need to finalize my choices",
     "C) No, I haven’t chosen my systems yet"
    ]
   },
   {
    "prompt": "Do you have a structured onboarding process for new clients?",
    "options": [
     "A) Yes, my intake and onboarding are seamless",
     "B) Somewhat, but I need to refine my process",
     "C) No, I don’t have a clear system in place"
    ]
   },
   {
    "prompt": "Have you reassessed your exit timeline and committed to a transition date?",
    "options": [
     "A) Yes, I have a set date and I’m on track",
     "B) Somewhat, but I need to confirm my timeline",
     "C) No, I haven’t set a final exit date"
    ]
   },
   {
    "prompt": "Are you confident in announcing and launching your private practice?",
    "options": [
     "A) Yes, I have a plan and I’m excited to announce!",
     "B) Somewhat, but I feel nervous about the next steps",
     "C) No, I don’t feel ready to announce my practice yet"
    ]
   }
  ]
 },
 {
  "kajabiId": "2191373474",
  "title": "Phase 3 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you automated key administrative tasks like scheduling, billing, and client documentation?",
    "options": [
     "A) Yes, I have automated systems in place",
     "B) Somewhat—I have some systems but need to refine them",
     "C) No, I’m still doing everything manually"
    ]
   },
   {
    "prompt": "Have you chosen the right technology and EHR system for managing your practice?",
    "options": [
     "A) Yes, I’ve set up my EHR and other tools",
     "B) Somewhat, but I need to finalize my choices",
     "C) No, I haven’t chosen my systems yet"
    ]
   },
   {
    "prompt": "Do you have a structured onboarding process for new clients?",
    "options": [
     "A) Yes, my intake and onboarding are seamless",
     "B) Somewhat, but I need to refine my process",
     "C) No, I don’t have a clear system in place"
    ]
   },
   {
    "prompt": "Have you reassessed your exit timeline and committed to a transition date?",
    "options": [
     "A) Yes, I have a set date and I’m on track",
     "B) Somewhat, but I need to confirm my timeline",
     "C) No, I haven’t set a final exit date"
    ]
   },
   {
    "prompt": "Are you confident in announcing and launching your private practice?",
    "options": [
     "A) Yes, I have a plan and I’m excited to announce!",
     "B) Somewhat, but I feel nervous about the next steps",
     "C) No, I don’t feel ready to announce my practice yet"
    ]
   }
  ]
 },
 {
  "kajabiId": "2187158712",
  "title": "Phase 4 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you defined your core content pillars and created messaging that aligns with your ideal client's pain points?",
    "options": [
     "Yes",
     "Somewhat",
     "No"
    ]
   },
   {
    "prompt": "Are you consistently creating content (social posts, blogs, emails) that speaks directly to your ideal client’s struggles?",
    "options": [
     "Yes, consistently",
     "Occasionally",
     "Not yet"
    ]
   },
   {
    "prompt": "Have you launched (or planned) a visibility strategy through SEO or a simple ad campaign?",
    "options": [
     "Yes",
     "Planning",
     "Not started"
    ]
   },
   {
    "prompt": "Do you have at least 3 active referral relationships or outreach efforts in motion?",
    "options": [
     "Yes",
     "Working on it",
     "No"
    ]
   },
   {
    "prompt": "Have you designed or delivered a workshop that positions you as an expert in your niche?",
    "options": [
     "Yes",
     "Scheduled",
     "Not yet"
    ]
   }
  ]
 },
 {
  "kajabiId": "2191373484",
  "title": "Phase 4 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you defined your core content pillars and created messaging that aligns with your ideal client's pain points?",
    "options": [
     "Yes",
     "Somewhat",
     "No"
    ]
   },
   {
    "prompt": "Are you consistently creating content (social posts, blogs, emails) that speaks directly to your ideal client’s struggles?",
    "options": [
     "Yes, consistently",
     "Occasionally",
     "Not yet"
    ]
   },
   {
    "prompt": "Have you launched (or planned) a visibility strategy through SEO or a simple ad campaign?",
    "options": [
     "Yes",
     "Planning",
     "Not started"
    ]
   },
   {
    "prompt": "Do you have at least 3 active referral relationships or outreach efforts in motion?",
    "options": [
     "Yes",
     "Working on it",
     "No"
    ]
   },
   {
    "prompt": "Have you designed or delivered a workshop that positions you as an expert in your niche?",
    "options": [
     "Yes",
     "Scheduled",
     "Not yet"
    ]
   }
  ]
 },
 {
  "kajabiId": "2187158716",
  "title": "Phase 5 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you implemented a client attraction strategy that consistently brings in referrals or inquiries?",
    "options": [
     "Yes",
     "Somewhat",
     "No"
    ]
   },
   {
    "prompt": "Are your core business systems (onboarding, billing, email follow-up) running smoothly with minimal manual effort?",
    "options": [
     "Yes",
     "Getting There",
     "No"
    ]
   },
   {
    "prompt": "Do you feel confident in tracking your key metrics (consultations, conversions, revenue) and using them to make informed business decisions?",
    "options": [
     "Yes",
     "Somewhat",
     "No"
    ]
   },
   {
    "prompt": "Have you launched or committed to a visibility strategy (workshops, referral partnerships, content or SEO)?",
    "options": [
     "Yes",
     "In progress",
     "Not started"
    ]
   },
   {
    "prompt": "Are you confident in maintaining momentum and continuing to attract ideal clients consistently over time?",
    "options": [
     "Yes",
     "Getting There",
     "Not Quite"
    ]
   }
  ]
 },
 {
  "kajabiId": "2191373492",
  "title": "Phase 5 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you implemented a client attraction strategy that consistently brings in referrals or inquiries?",
    "options": [
     "Yes",
     "Somewhat",
     "No"
    ]
   },
   {
    "prompt": "Are your core business systems (onboarding, billing, email follow-up) running smoothly with minimal manual effort?",
    "options": [
     "Yes",
     "Getting There",
     "No"
    ]
   },
   {
    "prompt": "Do you feel confident in tracking your key metrics (consultations, conversions, revenue) and using them to make informed business decisions?",
    "options": [
     "Yes",
     "Somewhat",
     "No"
    ]
   },
   {
    "prompt": "Have you launched or committed to a visibility strategy (workshops, referral partnerships, content or SEO)?",
    "options": [
     "Yes",
     "In progress",
     "Not started"
    ]
   },
   {
    "prompt": "Are you confident in maintaining momentum and continuing to attract ideal clients consistently over time?",
    "options": [
     "Yes",
     "Getting There",
     "Not Quite"
    ]
   }
  ]
 },
 {
  "kajabiId": "2187370557",
  "title": "Lesson 1 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Which best describes your current mindset?",
    "options": [
     "I see myself as a business owner and make decisions strategically.",
     "I still feel like an employee.",
     "I’m somewhere in between."
    ]
   },
   {
    "prompt": "Do you have at least 3 clear goals for your private practice over the next year?",
    "options": [
     "Yes, they’re written down.",
     "I have some ideas but they’re not clear.",
     "No, not yet."
    ]
   },
   {
    "prompt": "Have you identified and addressed any mindset blocks around money or pricing?",
    "options": [
     "Yes, I feel confident about pricing my services.",
     "Somewhat—I still feel uncertain at times.",
     "No, I haven’t worked on this yet."
    ]
   },
   {
    "prompt": "Which of these best describes your confidence in leading your practice?",
    "options": [
     "I’m ready to step fully into the CEO role.",
     "I’m getting there, but still feel hesitant.",
     "I don’t feel confident in this role yet."
    ]
   }
  ]
 },
 {
  "kajabiId": "2187370670",
  "title": "Lesson 2 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you defined a profitable niche for your private practice?",
    "options": [
     "Yes, it’s clear and specific.",
     "Sort of—I have a general idea.",
     "No, not yet."
    ]
   },
   {
    "prompt": "Which best describes your business model?",
    "options": [
     "I’ve chosen a clear model (private pay, insurance-based, hybrid).",
     "I’m still deciding between options.",
     "I haven’t thought about it yet."
    ]
   },
   {
    "prompt": "Do you know who your ideal client is (age, needs, problems)?",
    "options": [
     "Yes, I have a detailed profile.",
     "Somewhat—I have a rough idea.",
     "No, I haven’t defined this yet."
    ]
   },
   {
    "prompt": "How confident are you in marketing your niche to potential clients?",
    "options": [
     "Very confident—I know exactly what to say.",
     "Somewhat confident—I need a bit more clarity.",
     "Not confident—I feel stuck here."
    ]
   },
   {
    "prompt": "Do you have a clear elevator pitch for your private practice?",
    "options": [
     "Yes, and I can deliver it confidently.",
     "I have a draft but need to refine it.",
     "No, I don’t have one yet."
    ]
   }
  ]
 },
 {
  "kajabiId": "2187370683",
  "title": "Lesson 3 Readiness Quiz",
  "kind": "survey",
  "passMark": null,
  "requirePass": false,
  "showFeedback": false,
  "introMd": "A quick readiness check. There are no right or wrong answers: your answers are saved as a snapshot of where you are right now, and you can retake it any time.",
  "passMessage": "",
  "failMessage": "",
  "questions": [
   {
    "prompt": "Have you booked your first 3 clients without relying on social media?",
    "options": [
     "Yes, through referrals and other methods.",
     "Not yet, but I’m working on it.",
     "No, I haven’t started."
    ]
   },
   {
    "prompt": "Do you have a referral system set up to attract clients consistently?",
    "options": [
     "Yes, it’s bringing in clients regularly.",
     "I have a few referral sources but no system.",
     "No, not yet."
    ]
   },
   {
    "prompt": "Have you optimized a directory profile (e.g., Psychology Today)?",
    "options": [
     "Yes, and it’s getting traffic.",
     "I set it up but haven’t optimized it.",
     "No, not yet."
    ]
   },
   {
    "prompt": "Do you have a lead magnet or free resource to attract potential clients?",
    "options": [
     "Yes, it’s live and collecting leads.",
     "I have an idea but haven’t created it.",
     "No, not yet."
    ]
   },
   {
    "prompt": "How confident are you in attracting clients without using social media?",
    "options": [
     "Very confident—I have a plan.",
     "Somewhat confident—I need more strategies.",
     "Not confident—I feel stuck."
    ]
   }
  ]
 },
 {
  "kajabiId": "2200026927",
  "title": "Credential with Confidence Quiz",
  "kind": "graded",
  "passMark": 80,
  "requirePass": true,
  "showFeedback": false,
  "introMd": "",
  "passMessage": "You passed the Credential with Confidence Quiz. You can continue to the next lesson.",
  "failMessage": "You need 80% to pass. Review the lessons and retake the quiz when you are ready.",
  "questions": [
   {
    "prompt": "What is the primary purpose of the National Provider Identifier (NPI)?",
    "options": [
     "A. To verify a therapist's malpractice insurance",
     "B. A unique 10-digit identification number issued by CMS to identify healthcare providers",
     "C. To replace the need for state licensure",
     "D. A billing code used only for Medicaid claims"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "Which of the following best describes the CAQH application?",
    "options": [
     "A. A state-specific licensing exam",
     "B. A central hub that streamlines credentialing information across multiple insurance payers",
     "C. A malpractice insurance provider",
     "D. A billing software required by all payers"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "True or False: Being credentialed with a group practice automatically credentials a therapist as an individual provider with every payer.",
    "options": [
     "A. True",
     "B. False"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "Which of the following is NOT typically part of the essential credentialing document set?",
    "options": [
     "A. State-issued license",
     "B. Proof of malpractice insurance",
     "C. Personal bank statements",
     "D. Curriculum vitae"
    ],
    "correctIndex": 2
   },
   {
    "prompt": "What is the key difference between credentialing and provider enrollment?",
    "options": [
     "A. They are the same process under different names",
     "B. Credentialing verifies qualifications, while enrollment establishes the contractual billing relationship with a payer",
     "C. Enrollment only applies to Medicare",
     "D. Credentialing is only required for group practices"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "Approximately how long does commercial insurer credentialing typically take?",
    "options": [
     "A. 1 to 7 days",
     "B. 30 to 90 days",
     "C. 6 months to 1 year",
     "D. There is no typical timeframe"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "Which of the following is considered an ethical requirement when billing for services?",
    "options": [
     "A. Using CPT codes that reflect a more complex service than what was performed, to increase reimbursement",
     "B. Billing only for the actual time spent with the client during the session",
     "C. Rounding session length up whenever possible",
     "D. Charging different rates for the same service based on a client's insurance plan"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "What is the primary risk of upcoding in clinical documentation and billing?",
    "options": [
     "A. It has no meaningful risk if the client agrees",
     "B. It misrepresents services rendered and can trigger audit findings, clawbacks, or fraud allegations",
     "C. It only affects the therapist's tax filings",
     "D. It is standard practice recommended by most payers"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "Which of the following is an appropriate approach to missed appointment and late cancellation policies?",
    "options": [
     "A. Charging the full session fee regardless of the circumstances",
     "B. Establishing a clear, written policy communicated at intake, with reasonable notice periods",
     "C. Waiving all missed appointment fees to avoid conflict",
     "D. Billing the client's insurance for a missed session"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "When a claim is denied, what is the appropriate first step?",
    "options": [
     "A. Resubmit the exact same claim immediately",
     "B. Analyze the reason for the denial before determining next steps, such as an appeal",
     "C. Write off the balance without review",
     "D. Contact the client to request direct payment"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "Which of the following is a HIPAA-related consideration specific to telehealth billing?",
    "options": [
     "A. Telehealth sessions are exempt from HIPAA requirements",
     "B. Ensuring telehealth platforms and communication methods meet HIPAA privacy and security standards",
     "C. HIPAA only applies to in-person sessions",
     "D. Telehealth billing does not require client consent"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "What is an example of a conflict of interest in billing that therapists should avoid?",
    "options": [
     "A. Disclosing fee arrangements to clients in writing",
     "B. Offering a discount or preferential treatment to a friend or family member client",
     "C. Using a secure, encrypted billing platform",
     "D. Providing an itemized statement to a client"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "Which of the following best reflects an ethical approach to a client experiencing financial hardship?",
    "options": [
     "A. Immediately terminating services",
     "B. Discussing the situation openly and considering options such as a sliding scale fee or payment plan",
     "C. Referring the client to collections without discussion",
     "D. Ignoring the issue and continuing to bill as usual"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "What must a therapist do before providing services, according to informed consent requirements?",
    "options": [
     "A. Nothing, as long as the client eventually receives a bill",
     "B. Ensure the client understands the nature of services, fees, confidentiality limits, and provide a written consent document",
     "C. Wait until after the first session to discuss fees",
     "D. Only provide verbal explanation of fees"
    ],
    "correctIndex": 1
   },
   {
    "prompt": "Which of the following is required to maintain active credentialed status with a payer over time?",
    "options": [
     "A. No further action is needed once initial approval is granted",
     "B. Undergoing periodic reviews and promptly notifying payers of changes to practice information or credentials",
     "C. Re-submitting the NPI application every year",
     "D. Credentialing never needs to be renewed"
    ],
    "correctIndex": 1
   }
  ]
 }
]$kj$::jsonb;
  spec jsonb;
  q jsonb;
  qi bigint;
  o jsonb;
  oi bigint;
  v_lesson int;
  v_slug text;
  v_assessment int;
  v_question int;
BEGIN
  FOR spec IN SELECT value FROM jsonb_array_elements(specs) LOOP
    SELECT l.id, c.slug::text || '-' || l.slug
      INTO v_lesson, v_slug
      FROM course_lessons l
      JOIN course_modules m ON m.id = l.module_id
      JOIN courses c ON c.id = m.course_id
     WHERE l.kajabi_id = spec->>'kajabiId';
    CONTINUE WHEN v_lesson IS NULL;

    IF NOT EXISTS (SELECT 1 FROM assessments WHERE lesson_id = v_lesson OR slug = v_slug) THEN
      INSERT INTO assessments
        (slug, title, intro_md, kind, lesson_id, pass_mark, show_feedback,
         require_email, published, require_pass, pass_message, fail_message)
      VALUES
        (v_slug, spec->>'title', spec->>'introMd', spec->>'kind', v_lesson,
         (spec->>'passMark')::int, (spec->>'showFeedback')::boolean,
         false, true, (spec->>'requirePass')::boolean,
         COALESCE(NULLIF(spec->>'passMessage', ''), 'You passed. Continue to the next lesson.'),
         COALESCE(NULLIF(spec->>'failMessage', ''), 'Review the lesson and try again.'))
      RETURNING id INTO v_assessment;

      FOR q, qi IN SELECT value, ordinality FROM jsonb_array_elements(spec->'questions') WITH ORDINALITY LOOP
        INSERT INTO assessment_questions (assessment_id, position, prompt, kind, required)
        VALUES (v_assessment, qi - 1, q->>'prompt', 'single', true)
        RETURNING id INTO v_question;

        FOR o, oi IN SELECT value, ordinality FROM jsonb_array_elements(q->'options') WITH ORDINALITY LOOP
          INSERT INTO assessment_answers (question_id, position, label, is_correct)
          VALUES (v_question, oi - 1, o #>> '{}',
                  q ? 'correctIndex' AND (q->>'correctIndex')::int = oi - 1);
        END LOOP;
      END LOOP;
    END IF;

    UPDATE course_lessons
       SET content_type = 'assessment', updated_at = now()
     WHERE id = v_lesson AND content_type <> 'assessment';
  END LOOP;
END
$do$;

-- --- Credential with Confidence: results email + team notification ---------
--
-- Kajabi emailed the member their result and notified the team. Mirrored with
-- two ordinary automations on the assessment triggers (editable in Admin ->
-- Automations): one on a pass, one on a completed attempt that did not pass.
-- Each emails the member and adds a follow-up note, which lands on the
-- contact's timeline and in the owner's alert inbox. The automation email can
-- only merge name/email, not the score; the score is on the lesson page.

WITH quiz AS (
  SELECT a.id FROM assessments a JOIN course_lessons l ON l.id = a.lesson_id
   WHERE l.kajabi_id = '2200026927' AND a.kind = 'graded'
   ORDER BY a.id LIMIT 1
),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, conditions, status)
  SELECT $au$Credential with Confidence Quiz — passed$au$,
         $au$Emails the member that they passed the Credential with Confidence Quiz and notifies the team (Kajabi "email results" + "notify team").$au$,
         'assessment_passed', jsonb_build_object('assessmentId', quiz.id), '{}'::jsonb, 'active'
    FROM quiz
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $au$Credential with Confidence Quiz — passed$au$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $au${"subject":"You passed the Credential with Confidence Quiz","bodyMd":"Hi {{firstName}},\n\nCongratulations: you passed the **Credential with Confidence Quiz**.\n\nYour score and your answers are saved in the course. [Open Credential with Confidence](https://bossclinician.callsphere.site/library/credential-with-confidence/lessons/credential-with-confidence-quiz)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"product"}$au$::jsonb, 0 FROM new_automation
UNION ALL
SELECT id, 'create_task', $au${"title":"Credential with Confidence Quiz passed","note":"A member passed the Credential with Confidence Quiz. Their score and answers are in Admin -> Assessments -> Credential with Confidence Quiz -> Attempts."}$au$::jsonb, 1 FROM new_automation;

WITH quiz AS (
  SELECT a.id FROM assessments a JOIN course_lessons l ON l.id = a.lesson_id
   WHERE l.kajabi_id = '2200026927' AND a.kind = 'graded'
   ORDER BY a.id LIMIT 1
),
new_automation AS (
  INSERT INTO automations (name, description, trigger_type, trigger_config, conditions, status)
  SELECT $au$Credential with Confidence Quiz — not passed$au$,
         $au$Emails the member that their Credential with Confidence Quiz attempt did not reach the 80% pass mark and notifies the team (Kajabi "email results" + "notify team").$au$,
         'assessment_completed', jsonb_build_object('assessmentId', quiz.id),
         '{"match":"all","rules":[{"field":"passed","op":"is","value":"false"}]}'::jsonb, 'active'
    FROM quiz
   WHERE NOT EXISTS (SELECT 1 FROM automations WHERE name = $au$Credential with Confidence Quiz — not passed$au$)
  RETURNING id
)
INSERT INTO automation_actions (automation_id, action_type, config, sort)
SELECT id, 'send_email', $au${"subject":"Your Credential with Confidence Quiz result","bodyMd":"Hi {{firstName}},\n\nThank you for taking the **Credential with Confidence Quiz**. This attempt did not reach the 80% pass mark yet.\n\nReview the lessons and retake the quiz whenever you are ready; your score is saved in the course. [Open Credential with Confidence](https://bossclinician.callsphere.site/library/credential-with-confidence/lessons/credential-with-confidence-quiz)\n\nTo your success,\nYvette","fromName":"","fromEmail":"","topic":"product"}$au$::jsonb, 0 FROM new_automation
UNION ALL
SELECT id, 'create_task', $au${"title":"Credential with Confidence Quiz not passed","note":"A member completed the Credential with Confidence Quiz below the 80% pass mark. Their score and answers are in Admin -> Assessments -> Credential with Confidence Quiz -> Attempts."}$au$::jsonb, 1 FROM new_automation;
