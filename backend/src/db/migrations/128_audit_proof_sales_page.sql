-- =============================================================================
-- Sheet row 235 (Yvette, 19 Oct): the old Kajabi page
-- bossclinician.com/protect-your-practice-recorded becomes the content of
-- /courses/audit-proof-your-practice-on-demand, worded exactly as her Google Doc
-- "Audit Proof Sales Page", with the photos from the old page.
--
-- 1. `courses.sales_page` (JSONB, nullable): a long-form sales page for any
--    course. When it is set, CourseDetail renders CourseSalesPage — hero,
--    titled sections, a closing band and a footer line — instead of the
--    catalogue layout. It is deliberately not in coursesRepo's writable column
--    list, so an admin course save cannot clobber it.
--
--    Inline markup inside its strings: **bold**, [label](/path) links, and
--    bare email addresses (rendered as mailto links). Nothing else is parsed.
--
--    The buy buttons are NOT stored here. They come from the course's
--    published offers and each offer's active pricing options (migration 127
--    gives offer 121 "Training + CE Credit — $77" and "Educational Access —
--    $57 | No CE Credit"), so the price on a button is always the price the
--    checkout charges.
--
-- 2. Course 62's card copy: the /courses catalogue prints the full
--    description, so it is cut to two sentences; price_text reads "From $57".
--    Each statement only fires while the field still holds its old value, so
--    an edit made in the admin since is left alone. Keyed by slug: a fresh CI
--    database has no such course and every UPDATE is a no-op.
-- =============================================================================

ALTER TABLE courses ADD COLUMN IF NOT EXISTS sales_page JSONB;

UPDATE courses
   SET sales_page = $sales${
  "version": 1,
  "hero": {
    "title": "Protect Your Practice.",
    "titleAccent": "Protect Your Peace.",
    "subtitle": "Practical guidance for stronger documentation and ethical billing.",
    "paragraphs": [
      "You became a therapist to help people. But questions about documentation, medical necessity, and insurance audits can leave you second-guessing your records.",
      "Join **Yvette Howard, LCSW**, for a recorded training that helps you identify common documentation concerns, strengthen your records, and improve your practice's audit readiness."
    ],
    "highlights": ["90-Minute On-Demand Training", "1.5 CE Hours", "Lifetime Access"],
    "image": {
      "src": "/images/audit-proof/yvette-writing.webp",
      "alt": "Yvette Howard writing in a notebook at her desk",
      "width": 1000,
      "height": 1266
    }
  },
  "proof": {
    "label": "Notes from past attendees",
    "images": [
      {
        "src": "/images/audit-proof/attendee-note-nicole.webp",
        "alt": "Nicole McDonagh: \"Thanks a million Yvette! My notes were literally looked at a few days after your course. Truly appreciate your knowledge and direction.\"",
        "width": 1400,
        "height": 445
      },
      {
        "src": "/images/audit-proof/attendee-chat.webp",
        "alt": "Attendees thanking Yvette in the training chat: \"This was great, thank you!\", \"Thanks Yvette! Awesome training\", \"This was very insightful\"",
        "width": 300,
        "height": 300
      }
    ]
  },
  "sections": [
    {
      "id": "learn",
      "title": "What You'll Learn",
      "intro": "After completing this training, you will be able to:",
      "list": [
        "Identify common documentation deficiencies that increase audit and claim-recoupment risk.",
        "Describe how clinical records support medical necessity and services billed.",
        "Apply ethical billing principles to documentation scenarios.",
        "Identify steps to prepare records for Medicaid, Medicare, and commercial insurance reviews.",
        "Develop an internal documentation review process."
      ]
    },
    {
      "id": "who",
      "title": "Who It's For",
      "paragraphs": [
        "Licensed and associate-level mental health professionals, including social workers, professional counselors, and marriage and family therapists.",
        "**No prerequisites are required.**"
      ]
    },
    {
      "id": "included",
      "title": "What's Included",
      "list": [
        "Lifetime access to the 90-minute recorded training.",
        "Downloadable Audit-Readiness Checklist.",
        "Post-test, evaluation, and certificate documenting **1.5 CE hours** with the $77 option."
      ],
      "notes": [
        "The checklist is a bonus resource and is not included in the calculation of CE hours. The $57 educational-access option does not include CE credit or a CE certificate."
      ]
    },
    {
      "id": "certificate",
      "title": "Earning Your CE Certificate",
      "paragraphs": [
        "Watch the full training, pass the post-test with **75% or higher**, and complete the evaluation. Your certificate will be made available after successful completion.",
        "This is a recorded **home study** program, not a live event. An internet connection and a device capable of playing video and completing online forms are required.",
        "Participants should confirm acceptance with their licensing board, including whether this training meets their ethics requirements."
      ]
    },
    {
      "id": "instructor",
      "title": "About Your Instructor",
      "paragraphs": [
        "**Yvette Howard, LCSW**, is a clinical supervisor and founder of Brighter Tomorrow Therapy and Boss Clinician, LLC. She brings firsthand experience in practice ownership, clinical documentation, insurance audits, and ethical billing to practical education for mental health professionals."
      ],
      "image": {
        "src": "/images/audit-proof/yvette-howard-lcsw.webp",
        "alt": "Yvette Howard, LCSW",
        "width": 855,
        "height": 1289
      }
    },
    {
      "id": "ce-information",
      "title": "Continuing Education Information",
      "paragraphs": [
        "Boss Clinician, LLC has been approved by NBCC as an Approved Continuing Education Provider, ACEP No. 7998. Programs that do not qualify for NBCC credit are clearly identified. Boss Clinician, LLC is solely responsible for all aspects of the programs."
      ],
      "badge": {
        "src": "/images/audit-proof/nbcc-acep-provider.png",
        "alt": "NBCC Approved Continuing Education Provider",
        "width": 180,
        "height": 228
      }
    },
    {
      "id": "policies",
      "title": "Questions and Program Policies",
      "paragraphs": [
        "For support, accommodation requests, or grievances, email **support@bossclinician.com**.",
        "**Refund Policy:** All sales for this recorded training are final, except as required by applicable law.",
        "[View Continuing Education Program Policies](/ceu-terms-boss-clinician), including accommodations, grievances, refunds, and cancellations."
      ],
      "notes": [
        "This training provides general education, not legal advice, and does not guarantee an audit or reimbursement outcome."
      ]
    }
  ],
  "closing": {
    "image": {
      "src": "/images/audit-proof/training-audience.webp",
      "alt": "",
      "width": 1800,
      "height": 1014
    }
  },
  "footer": "Boss Clinician, LLC · 848 N Rainbow Blvd #441 · Las Vegas, Nevada 89107 · support@bossclinician.com · www.bossclinician.com"
}$sales$::jsonb,
       updated_at = now()
 WHERE slug = 'audit-proof-your-practice-on-demand'
   AND sales_page IS NULL;

UPDATE courses
   SET description = 'Practical guidance for stronger documentation and ethical billing. A 90-minute on-demand training with Yvette Howard, LCSW: 1.5 CE hours and lifetime access.',
       updated_at = now()
 WHERE slug = 'audit-proof-your-practice-on-demand'
   AND description LIKE 'Protect Your Practice. Protect Your Peace.%audit-proof';

UPDATE courses
   SET subtitle = 'Protect Your Practice. Protect Your Peace.', updated_at = now()
 WHERE slug = 'audit-proof-your-practice-on-demand'
   AND subtitle = 'On-demand training with Yvette Howard, LCSW';

UPDATE courses
   SET features = '["Lifetime access to the 90-minute recorded training", "Downloadable Audit-Readiness Checklist", "Post-test, evaluation and certificate for 1.5 CE hours (Training + CE option)"]'::jsonb,
       updated_at = now()
 WHERE slug = 'audit-proof-your-practice-on-demand'
   AND features = '[]'::jsonb;

-- The catalogue card's price line is display text; the two published prices
-- are $77 (Training + CE Credit) and $57 (Educational Access, no CE credit).
UPDATE courses
   SET price_text = 'From $57', updated_at = now()
 WHERE slug = 'audit-proof-your-practice-on-demand'
   AND price_text = '';
