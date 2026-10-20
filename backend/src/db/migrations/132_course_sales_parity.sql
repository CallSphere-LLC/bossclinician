-- QA row 127: restore verified public Kajabi sales-page content for the
-- available courses in the first catalogue group. Source pages (read-only):
-- bossclinician.com/the-directory-makeover-audit
-- bossclinician.com/csfgrouppractices
-- bossclinician.com/cwcsolopractice
-- bossclinician.com/startersuitecourse
-- bossclinician.com/rampedrevenue
-- No offer prices or payment terms are stored here: buy buttons come from the
-- published offers. The unavailable rate-negotiation-letter-template course is
-- deliberately untouched until its purchased files can be recovered.

UPDATE courses SET sales_page = $sales${
  "version": 1,
  "hero": {
    "title": "The Directory Makeover Audit™",
    "subtitle": "For therapists who are tired of being invisible on the platforms where clients are already looking for them.",
    "paragraphs": ["A personalized review of your therapist directory profile, with specific feedback you can use to improve how it connects with prospective clients."],
    "highlights": ["Personalized profile review", "Psychology Today and other directories", "Choose one, two, or three profiles"],
    "image": {"src": "/images/87e2e475b3ec.webp", "alt": "Directory Makeover Audit"}
  },
  "sections": [
    {"id": "directories", "title": "Which Directories Can Be Reviewed?", "intro": "The audit can cover profiles on:", "list": ["Psychology Today", "TherapyDen", "Therapy for Black Girls", "Zencare", "Mental Health Match", "Inclusive Therapists", "Other directories where you are listed"]},
    {"id": "review", "title": "What Your Audit Covers", "list": ["How your profile communicates with your ideal client", "Your photo, headline, and first impression", "Your specialties and issues list", "Specific changes that can improve clarity, warmth, and readability", "A personalized video review with actionable feedback"]},
    {"id": "process", "title": "How It Works", "list": ["Choose your audit level for one, two, or three profiles.", "Complete a short intake form with your profile links and goals.", "Receive a personalized video audit with direct feedback.", "Use the recommendations to update your profile."]}
  ]
}$sales$::jsonb, updated_at = now()
WHERE id = 1 AND sales_page IS NULL;

UPDATE courses SET sales_page = $sales${
  "version": 1,
  "hero": {
    "title": "Credentialing Success Formula",
    "subtitle": "Streamline Your Group Practice's Credentialing Process",
    "paragraphs": ["A practical training for group practice owners credentialing new clinicians and tracking approvals. The course includes video lessons and downloadable materials for organizing the work."],
    "highlights": ["Group practice credentialing", "Video lessons", "Downloadable guides and checklists"],
    "image": {"src": "/images/5a8b78757b65.webp", "alt": "Credentialing Success Formula training"}
  },
  "sections": [
    {"id": "challenges", "title": "Bring Order to Credentialing", "list": ["Understand the credentialing process for new hires.", "Organize the documents needed for applications.", "Track credentials for current staff.", "Review supervisory billing and group credentialing guidance."]},
    {"id": "included", "title": "Inside the Training", "list": ["Step-by-step video lessons on credentialing and ongoing compliance.", "Credentialing Documents PDF and onboarding email templates.", "New-hire and current-staff credentialing checklist spreadsheet.", "Supervisory and group credentialing billing guidelines PDF."]},
    {"id": "who", "title": "Who It's For", "paragraphs": ["Group practice owners who are adding clinicians and need a repeatable way to manage applications, records, and renewals."]}
  ]
}$sales$::jsonb, updated_at = now()
WHERE id = 3 AND sales_page IS NULL;

UPDATE courses SET sales_page = $sales${
  "version": 1,
  "hero": {
    "title": "Credential With Confidence",
    "subtitle": "Streamline Your Solo Practice Credentialing Process",
    "paragraphs": ["Get organized around insurance enrollment, CAQH, panel applications, and billing with recorded training and practical reference materials."],
    "highlights": ["Recorded training", "CAQH resources", "Credentialing and billing trackers"],
    "image": {"src": "/images/bf28804cb9be.webp", "alt": "Credential With Confidence training"}
  },
  "sections": [
    {"id": "learn", "title": "What You'll Work Through", "list": ["The insurance paneling process and how to choose an address for a virtual practice.", "NPI and CAQH setup, with an example application walkthrough.", "Medical billing and a sample claim walkthrough.", "Ways to track applications, claims, and follow-up work."]},
    {"id": "resources", "title": "Included Resources", "list": ["Credentialing tracker and CAQH checklist.", "Insurance panel reference and fee guides.", "Billing code cheat sheet and billing software list.", "Claim submission tracker and denial follow-up script."]},
    {"id": "who", "title": "Who It's For", "paragraphs": ["Solo therapists who want a clearer process for credentialing with insurance panels and managing billing work."]}
  ]
}$sales$::jsonb, updated_at = now()
WHERE id = 4 AND sales_page IS NULL;

UPDATE courses SET sales_page = $sales${
  "version": 1,
  "hero": {
    "title": "Private Practice Starter Suite",
    "subtitle": "A Three-Step Mini Course for Therapists Starting a Private Practice",
    "paragraphs": ["Work through the move from employee to owner, choose a niche and business model, and plan how to find your first clients."],
    "highlights": ["Three core lessons", "Starter workbook", "Readiness quizzes and worksheets"],
    "image": {"src": "/images/b638c609d53c.webp", "alt": "Private Practice Starter Suite"}
  },
  "sections": [
    {"id": "lessons", "title": "The Three Core Lessons", "list": ["From Employee to CEO: work through the mindset shift into practice ownership.", "Choosing Your Niche and Business Model: clarify whom you serve and how to structure your practice.", "First Three Clients Blueprint: plan referral and visibility steps for your first clients."]},
    {"id": "resources", "title": "Resources to Use Along the Way", "list": ["Private Practice Starter Suite workbook.", "Lesson worksheets and readiness quizzes.", "Private practice starter checklist.", "From Employee to CEO mindset affirmations."]},
    {"id": "who", "title": "Who It's For", "paragraphs": ["Therapists preparing to launch a practice and looking for a guided starting point."]}
  ]
}$sales$::jsonb, updated_at = now()
WHERE id = 5 AND sales_page IS NULL;

UPDATE courses SET sales_page = $sales${
  "version": 1,
  "hero": {
    "title": "The Ramp-Up Rate Pricing Formula",
    "subtitle": "Set Your Private Pay Rate With Clarity",
    "paragraphs": ["A recorded training and workbook for therapists who want to calculate a session rate using their own goals, availability, and expenses."],
    "highlights": ["Pricing lessons", "Two interactive calculators", "Downloadable workbooks"],
    "image": {"src": "/images/63feb84d0c9d.webp", "alt": "Ramp-Up Rate Pricing Formula training"}
  },
  "sections": [
    {"id": "learn", "title": "What You'll Learn", "list": ["Explore your money mindset and pricing fears.", "Consider value-based pricing and local market research.", "Use the Ramp-Up Rate Formula to work out a session rate.", "Practice communicating your rate with confidence."]},
    {"id": "tools", "title": "Calculators and Workbooks", "list": ["Ramp-Up Rate Calculator using your financial goals, session volume, weeks worked, and expenses.", "Rate Comparison Calculator for comparing potential rates.", "Ramp-Up Rate Formula workbooks, lesson worksheets, and budget sheet links."]},
    {"id": "who", "title": "Who It's For", "paragraphs": ["Therapists starting out or revisiting their private pay rate who want a structured way to work through pricing decisions."]}
  ]
}$sales$::jsonb, updated_at = now()
WHERE id = 6 AND sales_page IS NULL;
