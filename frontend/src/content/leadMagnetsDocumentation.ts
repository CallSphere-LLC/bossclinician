/**
 * The documentation-training pages, word for word from her Kajabi pages
 * (captured 1 Oct 2026):
 *
 *   /doc-registration                       the sales page for the live workshop
 *   /dos-and-donts-ty, /dos-donts-ty        its two thank-you pages (CE / no CE)
 *   /replay-documentation                   the workshop replay, with its countdown
 *   /on-demand-audit-your-private-practice  the Audit Proof Your Practice on-demand page
 *   /profile-audit-ty                       the Directory Makeover Audit thank-you page
 *
 * The register buttons go to this site's checkout for the two offers that
 * Kajabi sold (Pq696Zyw = CE, SYqKeSLZ = no CE); migration 097 points those
 * offers' thank-you address at the matching page below.
 */

export const DOC_TRAINING = {
  name: "The Do's & Don'ts of Clinical Documentation",
  /** 1:00 to 4:30 PM PT on 25 Sep 2026 (PDT, UTC−7). */
  startsAtUtc: "20260925T200000Z",
  endsAtUtc: "20260925T233000Z",
  ics: "/downloads/dos-and-donts-of-clinical-documentation.ics",
  checkout: {
    ce: { to: "/checkout/dos-and-donts-of-documentation-ce", label: "Register with CEU, $167" },
    edu: { to: "/checkout/dos-and-donts-of-documentation-edu", label: "Register without CEU, $127" },
  },
} as const;

/* ── /doc-registration ──────────────────────────────────────────────── */

export const docRegistration = {
  seo: {
    title: "The Do's & Don'ts of Clinical Documentation | Live CEU Workshop | Boss Clinician",
    description:
      "Join Yvette Howard, LCSW for a practical 3.5 hour Ethics CEU workshop on everyday, high risk, legal, telehealth, and AI assisted documentation.",
  },
  hero: {
    eyebrow: "A LIVE CEU WORKSHOP FOR DOCUMENTING CLINICIANS",
    title: "Every note tells a story.",
    titleAccent: "Make sure it's one you can defend.",
    sub: "Feeling confident about your documentation is not the same as knowing it would hold up under an audit, subpoena, records request, complaint, or board review.",
    body: "Join Yvette Howard, LCSW for a practical 3.5 hour Ethics CEU workshop on everyday, high risk, legal, telehealth, and AI assisted documentation, so you can write notes that show your clinical judgment without over documenting.",
    meta: ["Live on Zoom", "September 25, 2026", "1:00 to 4:30 PM PT", "60 day replay", "Instructor: Yvette Howard, LCSW"],
  },
  notes: {
    flagged: { tag: "Flagged", text: "Client reported feeling \"better.\" Provided support." },
    approved: {
      tag: "Approved",
      text: "Client demonstrated reduced avoidance per PHQ-9 tracking. CBT cognitive restructuring applied, targeting catastrophic thinking. Client verbalized increased coping confidence, tied to Treatment Plan Objective 2.",
    },
  },
  pain: {
    title: "You don't have to be bad at documentation to have documentation gaps.",
    paragraphs: [
      "Most clinicians are already doing a lot right. The gaps tend to hide in the details nobody ever taught you to think about: how a note connects to the treatment plan, how your clinical judgment actually shows up on the page, what changes when a session turns high risk, what belongs in the record, and what happens once AI starts helping you draft.",
      "The tricky part is that you usually do not find those gaps on your own. Someone else finds them first, while reading your chart.",
    ],
    closing: "This training is built to help you find them before they do.",
  },
  compare: {
    title: "Would your note explain the clinical work if you weren't there to explain it?",
    flaggedTag: "Flagged",
    strongerTag: "Stronger",
    note: "The goal is not a longer note. The goal is a note that makes the clinical reasoning clear.",
  },
  learn: {
    eyebrow: "What you'll learn",
    title: "Six modules. One habit: writing notes that hold up.",
    items: [
      "Identify the documentation habits that quietly increase audit and liability risk.",
      "Know what belongs in the note, what doesn't, and how to document clinical judgment without over-documenting.",
      "Write high risk documentation, including suicidality, mandated reporting, substance use, and crisis sessions, with clarity and sound clinical reasoning.",
      "Connect progress notes to treatment goals and medical necessity more clearly.",
      "Apply HIPAA-conscious retention, destruction, records request, telehealth, and subpoena practices.",
      "Evaluate AI assisted documentation more critically, including HIPAA considerations, client consent, review, and clinician responsibility.",
      "Build a monthly self-audit habit that protects your practice long after the training ends.",
    ],
    quote: {
      text: "Recognizing what was missing from what I was already doing. The examples were super helpful.",
      name: "Chelsea P., LCSW",
    },
    lede: "Ready to strengthen your documentation before someone else finds the gaps for you?",
  },
  who: {
    eyebrow: "Who it's for",
    title: "Built for clinicians handling real documentation, not hypothetical scenarios.",
    items: [
      "Licensed and pre-licensed mental health clinicians in solo or group practice.",
      "Group practice owners and clinical supervisors overseeing a team's charting.",
      "Supervisors overseeing interns or associates who need clear, defensible records.",
      "Clinicians who bill Medicaid, Medicare, or commercial insurance and want their notes to support medical necessity.",
      "Anyone who already feels solid in their documentation and wants to catch the smaller gaps before a reviewer does.",
    ],
  },
  instructor: {
    eyebrow: "Meet your instructor",
    name: "Yvette Howard, LCSW",
    role: "Clinical Supervisor · Private Practice Strategist · Founder, Boss Clinician",
    paragraphs: [
      "Early in private practice, Yvette experienced firsthand how confusing and stressful documentation audits can be after her own practice was audited in 2020, despite being a strong clinician.",
      "That experience pushed her to look more closely at what reviewers actually need to see in the record, how documentation connects to medical necessity and treatment planning, and where clinicians can unintentionally create risk by writing too little, too much, or simply documenting without a clear system.",
      "Today, she teaches mental health professionals how to document with greater clarity and confidence so their records are ethical, defensible, efficient, and audit-ready, without over-documenting.",
    ],
    lede: "Learn the system Yvette built after living through her own audit.",
    photo: {
      src: "/images/leadmagnets/yvette-documentation-instructor.jpg",
      alt: "Yvette Howard, LCSW, smiling in a black T-shirt that reads Empowered Women Empower the World",
      width: 600,
      height: 600,
    },
  },
  included: {
    eyebrow: "Everything you need to know",
    title: "What's included, your CEU details, and answers to common questions.",
    kicker: "What's included",
    blockTitle: "Two ways to join",
    tiers: [
      {
        name: "General Admission",
        price: "$167",
        sub: "Live training access, plus CEU",
        items: [
          "210-minute live CEU workshop",
          "3.5 Ethics CE contact hours",
          "The Audit-Proof Documentation Toolkit: SOAP + DAP templates and examples, treatment plan example, self-audit checklist",
          "CEU evaluation and certificate, issued after completion requirements are met",
          "60-day replay access",
          "Live Q&A with Yvette",
        ],
        cta: "Register Now, $167",
        to: "/checkout/dos-and-donts-of-documentation-ce",
      },
      {
        name: "Educational Access",
        price: "$127",
        sub: "Live training access, no CEU",
        items: [
          "210-minute live workshop",
          "The Audit-Proof Documentation Toolkit",
          "60-day replay access",
          "Live Q&A with Yvette",
          "No CEU certificate issued",
        ],
        cta: "Register, $127",
        to: "/checkout/dos-and-donts-of-documentation-edu",
      },
    ],
  },
  details: {
    kicker: "CEU and training details",
    blockTitle: "What to expect on the day",
    rows: [
      ["Date", "September 25, 2026"],
      ["Time", "1:00 PM to 4:30 PM PT"],
      ["Location", "Live on Zoom"],
      ["Replay", "60 day access"],
      ["CE credit", "3.5 Ethics CE contact hours"],
    ] as ReadonlyArray<readonly [string, string]>,
    approvals: [
      {
        label: "Nevada Board of Examiners for MFT & CPC:",
        body: "Approved for 3.5 hours of continuing education in Ethics. CEU Approval #2026-18.",
      },
      {
        label: "Licensed outside Nevada?",
        body: "Requirements vary by board. Please confirm directly with your own licensing board that Nevada Board of Examiners for MFT & CPC-approved continuing education is accepted if you plan to use these hours for license renewal.",
      },
    ],
  },
  modules: {
    kicker: "The case file",
    blockTitle: "Six modules, in order",
    items: [
      { num: "01", title: "Orientation & Ethics Framing", mins: "15 min", body: "What ethical documentation actually means." },
      {
        num: "02",
        title: "Everyday Documentation Do's & Don'ts",
        mins: "20 min",
        body: "The pitfalls hiding in routine notes, and how to document clearly without writing a novel.",
      },
      {
        num: "03",
        title: "High-Risk Documentation",
        mins: "35 min",
        body: "Suicidality, mandated reporting, substance use, crisis sessions, and documenting clinical judgment under pressure.",
      },
      {
        num: "04",
        title: "Legal & Regulatory Do's & Don'ts",
        mins: "25 min",
        body: "HIPAA, telehealth compliance, records requests, subpoenas, retention, and destruction.",
      },
      {
        num: "05",
        title: "AI-Assisted Documentation in Practice",
        mins: "25 min",
        body: "HIPAA-conscious tools, client consent, clinician review, and keeping AI-assisted notes defensible.",
      },
      {
        num: "06",
        title: "Audit Proof Your Practice",
        mins: "90 min",
        body: "Medicaid, Medicare, UHC, and commercial audit preparation, plus a repeatable self-audit process.",
      },
    ],
    total: "Total: 210 minutes, 3.5 Ethics CE contact hours. Includes two short breaks.",
  },
  ai: {
    title: "AI can make documentation faster. That doesn't automatically make it stronger.",
    body: "AI-assisted documentation is becoming part of everyday clinical practice, but the clinician remains responsible for what enters the record. Module 5 covers how to think critically about HIPAA-conscious tools, informed consent, reviewing AI-generated drafts, and the documentation risks that polished language can hide.",
    line: "AI can support your documentation. It cannot be your documentation.",
  },
  testimonials: {
    kicker: "What clinicians said",
    blockTitle: "From Audit Proof Your Practice",
    items: [
      {
        quote: "\"It was a very good wake up call about all the elements needed to be audit proof. I will never be the same as a clinician.\"",
        name: "Elizabeth W., LCPC",
      },
      {
        quote: "\"I found the entire training to be valuable. Being mindful to tie in the treatment plan in notes is a great emphasis I can share with my intern.\"",
        name: "Kristan L., LCSW",
      },
      {
        quote: "\"Your experience going through an actual audit to let us know what's needed made this real, not theoretical.\"",
        name: "Jessica M., MFT",
      },
      {
        quote: "\"Thanks a million Yvette! My notes were literally looked at a few days after your course. Truly appreciate your knowledge and direction.\"",
        name: "Nicole M., Facebook",
      },
    ],
  },
  faq: {
    eyebrow: "Before you register",
    title: "Frequently asked questions",
    items: [
      {
        q: "Who is this training for?",
        a: "Licensed and pre-licensed mental health clinicians, solo practitioners, group practice clinicians, supervisors, and anyone responsible for clinical documentation or billing.",
      },
      {
        q: "What if I already feel confident in my documentation?",
        a: "Perfect. This training is not only for clinicians who think their notes are weak. It is designed to help competent clinicians identify the smaller gaps that can be easy to miss until an auditor, attorney, payer, board, supervisor, or client is reading the record.",
      },
      {
        q: "Is this training about writing longer notes?",
        a: "No. The goal is not more documentation, it's clearer documentation: enough to show clinical reasoning, medical necessity, progress, risk assessment when applicable, and connection to the treatment plan, without adding unnecessary detail.",
      },
      {
        q: "Does this training use or teach AI tools?",
        a: "Yes. Module 5 covers AI-assisted documentation, including how to evaluate whether a tool is appropriate for clinical use, HIPAA considerations, informed consent, reviewing AI-generated drafts, and keeping the final record clinically accurate. AI can support your documentation, but it cannot replace your judgment or responsibility as the author of the record.",
      },
      {
        q: "Do I have to attend live to receive CE credit?",
        a: "No. If you can't attend live, you'll receive 60-day replay access. You must complete the required post-training evaluation and any CE completion requirements to receive your certificate.",
      },
      {
        q: "What if I already took Audit Proof Your Practice?",
        a: "Module 6 contains the Audit Proof Your Practice content, while this workshop adds five additional modules covering everyday documentation, high-risk documentation, legal and regulatory issues, telehealth, and AI-assisted documentation.",
      },
      {
        q: "I'm licensed outside Nevada. Will this CE count for me?",
        a: "This training is approved by the Nevada Board of Examiners for MFT & CPC for 3.5 hours of continuing education in Ethics. Acceptance by another state's licensing board varies. Please verify directly with your licensing board before registering if you plan to use these hours toward renewal.",
      },
      {
        q: "Will I receive templates?",
        a: "Yes. General Admission and Educational Access both include the Audit-Proof Documentation Toolkit with SOAP and DAP templates and examples, a treatment plan example, and a self-audit checklist.",
      },
    ],
  },
  final: {
    title: "Do not wait until someone else is reviewing your chart to find out what you missed.",
    body: "Learn what to look for now, strengthen the habits you already have, and leave with a documentation process you can keep using long after the workshop ends.",
    meta: ["Live September 25, 2026", "1:00 to 4:30 PM PT", "Replay available for 60 days"],
  },
} as const;

/* ── /dos-and-donts-ty and /dos-donts-ty ────────────────────────────── */

/** The two pages are one page; the CE one adds the registration tier and step 3. */
export const documentationThankYou = {
  seo: {
    ce: { title: "Dos and Donts TY CEU" },
    edu: { title: "Dos and Donts TY EDU" },
    description: "You're registered for The Do's & Don'ts of Clinical Documentation.",
  },
  title: "You're all set.",
  lede: "Your spot for The Do's & Don'ts of Clinical Documentation is confirmed. Here's everything you need before September 25.",
  confirm: {
    title: "Registration Confirmed",
    course: "The Do's & Don'ts of Clinical Documentation",
    rows: {
      date: ["Date", "September 25, 2026"],
      time: ["Time", "1:00 – 4:30 PM PT"],
      format: ["Format", "Live on Zoom"],
    },
    registration: {
      label: "Registration",
      ce: "General Admission ($167)",
      edu: "Educational Access ($127)",
    },
  },
  steps: {
    eyebrow: "Before September 25",
    title: "Here's what to do next.",
    email: {
      title: "Check your email",
      body: "A confirmation with your Zoom link is on its way. Add it to your calendar so it doesn't slip past you.",
      calendars: ["Apple", "Google", "Office 365", "Outlook", "Outlook.com", "Yahoo"] as const,
    },
    worksheets: {
      title: "Download your practice worksheets",
      body: "We use these live during the training. Make your own copy now so you're ready to write along, not just watch.",
      links: [
        {
          label: "Practice Progress Note Template",
          href: "/downloads/practice-progress-note-template.docx",
        },
        {
          label: "Practice Treatment Plan Template",
          href: "/downloads/practice-treatment-plan-template.docx",
        },
      ],
    },
    ceu: {
      title: "Know your CEU requirements",
      body: "To receive your 3.5 Ethics CEU certificate, attend the full live session and complete the evaluation form, or if you're using the replay, pass the post-test (75% minimum) plus the evaluation.",
    },
    replay: {
      title: "Can't make it live?",
      body: "No problem. Your replay will be available for 60 days after the training, sent to the email you registered with.",
    },
  },
  message: {
    paragraphs: [
      "I'm genuinely glad you're joining. This training comes from my own experience getting audited and having to rebuild my entire documentation process, and I built it so you don't have to learn it the hard way like I did.",
      "If you have any questions before the 25th, just reply to your confirmation email. I read every one.",
    ],
    signature: "Yvette Howard, LCSW",
    photo: {
      src: "/images/leadmagnets/yvette-documentation-thank-you.webp",
      alt: "Yvette Howard, LCSW, smiling",
      width: 815,
      height: 703,
    },
  },
  questions: "Questions about your registration?",
  email: "yvette@bossclinician.com",
} as const;

/* ── Shared by the two replay pages ─────────────────────────────────── */

const MEET_YVETTE_PARAGRAPHS_TAIL = [
  "Before starting my practice, I was constantly overwhelmed, balancing endless tasks, and feeling stuck in a cycle of burnout while trying to maintain a stable revenue. I knew there had to be a better way, and I was determined to find it.",
  "Through dedication and refining my approach, I developed a proven method that allowed me to build a thriving practice. This method not only helped me break free from the burnout cycle but also enabled me to achieve a balanced and fulfilling professional life.",
  "Now, I share this proven method with mental health therapists like you, guiding you on how to start and scale your private practice in a way that is profitable, predictable, and sustainable. My goal is to help you focus on what matters most – providing exceptional care to your clients while enjoying the freedom and flexibility of running your own successful practice.",
] as const;

const MEET_YVETTE_PHOTO = {
  src: "/images/leadmagnets/yvette-meet-boss-clinician.jpg",
  alt: "Yvette Howard, LCSW, seated beside a plant",
  width: 855,
  height: 1218,
} as const;

export const EARNINGS_DISCLAIMER =
  "ANY CASE STUDIES, EXAMPLES, ILLUSTRATIONS, OR TESTIMONIALS CANNOT GUARANTEE THAT YOU WILL ACHIEVE SIMILAR RESULTS. IN FACT, YOUR RESULTS MAY VARY SIGNIFICANTLY AND FACTORS SUCH AS YOUR PERSONAL EFFORT AND MANY OTHER CIRCUMSTANCES MAY AND WILL CAUSE RESULTS TO VARY. ANY AND ALL CLAIMS OR REPRESENTATIONS, AS TO INCOME EARNINGS ON THE SITE, ARE NOT TO BE CONSIDERED AS AVERAGE EARNINGS. THERE CAN BE NO ASSURANCE THAT ANY PRIOR SUCCESSES, OR PAST RESULTS, AS TO INCOME EARNINGS, CAN BE USED AS AN INDICATION OF YOUR FUTURE SUCCESS OR RESULTS. MONETARY AND INCOME RESULTS ARE BASED ON MANY FACTORS.";

/* ── /replay-documentation ──────────────────────────────────────────── */

export const replayDocumentation = {
  seo: {
    title: "Replay – Apply tools and Knowledge to Secure Your Practice",
    description: "Watch the replay of The Do's & Don'ts of Clinical Documentation with Yvette Howard, LCSW.",
  },
  /**
   * The video, as a link `playableVideo()` understands. It is her Kajabi
   * upload as Wistia serves it; swap it for an `/uploads/...` path once the
   * file is in this site's media library and nothing else changes.
   */
  videoUrl: "/uploads/leadmagnet-replay-documentation.mp4",
  videoTitle: "The Do's & Don'ts of Clinical Documentation — replay",
  /**
   * Kajabi's countdown ran to "2026-329T23:55:00-08:00" — day 329 of 2026,
   * i.e. 25 Nov 2026, 11:55 PM Pacific: the end of the 60-day replay window.
   */
  closesAt: "2026-11-25T23:55:00-08:00",
  countdownLabels: { days: "DAYS", hours: "HOURS", mins: "MINS", secs: "SECS" },
  title: "Click below to watch the replay",
  /** Her countdown sent people elsewhere when it ran out; that page is gone. */
  closed: "The replay window for this training has closed.",
  meet: {
    title: "Meet Yvette Howard, Boss Clinician",
    paragraphs: [
      "Two years ago, I started a journey to help mental health therapists take the guesswork out of starting their own private practice. With six years of experience running my own practice turned group practice, I understand the challenges and fears that come with this transition.",
      ...MEET_YVETTE_PARAGRAPHS_TAIL,
    ],
    cta: "LEARN MORE ABOUT YVETTE",
    to: "/about",
    photo: MEET_YVETTE_PHOTO,
  },
  copyright: "Copyright © 2025 Your Company. All Rights Reserved.",
} as const;

/* ── /on-demand-audit-your-private-practice ─────────────────────────── */

export const onDemandAudit = {
  seo: {
    title: "On-demand – Apply tools and Knowledge to Secure Your Practice",
    description: "Watch Audit Proof Your Practice on demand with Yvette Howard, LCSW.",
  },
  step1: {
    title: "Step 1: Grab your note template here to take notes on what your learning",
    cta: "CLICK HERE TO TAKE NOTES",
    href: "/downloads/audit-proof-note-template.pdf",
  },
  step2: { title: "Step 2: Click the play button below to watch the on-demand training" },
  /** See replayDocumentation.videoUrl. */
  videoUrl: "/uploads/leadmagnet-on-demand-audit.mp4",
  videoTitle: "Audit Proof Your Practice — on-demand training",
  step3: {
    cta: "Step 3: TAKE POST EXAM HERE",
    /**
     * Her Kajabi assessment 2148618320 ("Post-Test: Audit Proof Your Practice",
     * 15 questions, 75% to pass). It is built here as an assessment once its
     * answer key is copied out of Kajabi; the slug is fixed now so this link
     * does not have to change.
     */
    to: "/quiz/audit-proof-post-test",
  },
  meet: {
    title: "Meet Yvette Howard, Boss Clinician",
    paragraphs: [
      "After building my practice, I started a journey to help mental health therapists take the guesswork out of starting their own private practice. With six years of experience running my own practice turned group practice, I understand the challenges and fears that come with this transition.",
      ...MEET_YVETTE_PARAGRAPHS_TAIL,
    ],
    cta: "LEARN MORE ABOUT YVETTE",
    to: "/about",
    photo: MEET_YVETTE_PHOTO,
  },
  testimonial: {
    quote:
      "I am grateful to work with Yvette to help me become further independent with my private practice. Yvette is been helpful every step of the way by providing resources for my internal dilemmas, and providing support with video play backs , and setting goals to help hold me accountable.",
    name: "Mike M. LPC",
  },
  copyright: "Copyright © 2025 Your Company. All Rights Reserved.",
} as const;

/* ── /profile-audit-ty ──────────────────────────────────────────────── */

export const profileAuditThankYou = {
  seo: {
    title: "Profile Audit Thank You",
    description: "Your Directory Makeover Audit is booked. Here's what happens next.",
  },
  banner: {
    src: "/images/leadmagnets/directory-makeover-audit-banner.webp",
    alt: "Directory Makeover Audit — bossclinician.com",
    width: 1600,
    height: 900,
  },
  title: "Thank You — Your Directory Makeover Audit Is Officially Booked!",
  lede: "Your purchase is confirmed, and I’m so excited to help you elevate your therapist directory profile so you can attract more aligned clients with ease.",
  next: "Here’s what happens next:",
  steps: [
    {
      title: "✅ Step 1: Check Your Email for the Intake Form",
      paragraphs: [
        "You’ll receive a message titled: “Your Directory Makeover Audit\" — Intake Form + Next Steps”",
        "Click the link inside to complete your short intake questionnaire. This is required before I can begin your audit.",
      ],
    },
    {
      title: "✅ Step 2: Submit Your Intake Form",
      paragraphs: [
        "It only takes a few minutes — just paste your directory links and let me know your goals for the audit.",
        "Once submitted, your spot is confirmed in my queue.",
      ],
    },
    {
      title: "✅ Step 3: I Complete Your Audit (Within 3–5 Business Days)",
      paragraphs: ["I’ll review your directory profile(s) through the eyes of:"],
      perspectives: ["A therapist", "A referal source", "A client searching for support"],
      receiveTitle: "You’ll receive:",
      receive: [
        "🎥 A personalized audit video (10–15 mins)",
        "📝 Clear recommendations",
        "🔧 Specific edits + strategy notes",
        "🎯 Visibility + conversion tips tailored just for you",
      ],
    },
    {
      title: "✅ Step 4: You Implement the Changes",
      paragraphs: [
        "Make the recommended updates and watch how your visibility, profile views, and inquiries improve.",
        "Small tweaks → big results.",
      ],
    },
  ],
  help: {
    title: "❓Need help?",
    body: "If you have questions or didn’t receive your intake form, email me at:",
    email: "yvette@profitableprivatepractices.com",
  },
  closing: "I’m excited to help you upgrade your directory presence — let’s get you seen by the right clients.",
} as const;
