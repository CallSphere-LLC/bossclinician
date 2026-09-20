/**
 * Credential with Confidence — sales page copy.
 *
 * Transcribed from bossclinician.com/credentialsolo (20 September 2026), block
 * by block and in the published order. Every learning objective, the NBCC
 * statement, the refund and grievance terms and the presenter's biography are
 * the owner's own wording: nothing here is paraphrased, shortened or invented.
 *
 * Three things on the source are deliberately not carried over:
 *
 *  1. The price. The source prints "$27" twice, but the offer in the database
 *     owns what this course costs and is about to change; quoting money from a
 *     transcript would put two different numbers on one page. `hero.ctaPrefix`
 *     and `pricing` therefore stop short of the figure and the page renders it
 *     from the API offer.
 *  2. The Kajabi theme's chrome — its header nav, footer logo, "© 2026 Kajabi"
 *     and the "Join Our Free Trial" pop-up. None of it is this page's content.
 *  3. The two `mailto:` addresses keep their surrounding sentence intact by
 *     being split into before/after halves (see `MailLine`), because a link in
 *     the middle of a paragraph cannot survive a plain string.
 */

/** A self-hosted picture, with the file's intrinsic size so nothing shifts. */
export interface CwcPicture {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** One figure in the programme's stat row. */
export interface CwcStat {
  num: string;
  label: string;
}

/**
 * A line from the "what is inside" cards. The source sets the two training
 * names in bold and runs the rest of the line on, so the name is a field of its
 * own rather than markup baked into a string.
 */
export interface CwcInclusion {
  name?: string;
  detail: string;
}

/** One step of the certificate process: a heading and the sentence under it. */
export interface CwcStep {
  title: string;
  body: string;
}

/** A sentence with an email address in it, kept whole around the link. */
export interface CwcMailLine {
  before: string;
  email: string;
  after: string;
}

export const CWC_COURSE_SLUG = "credential-with-confidence";

/** Every mid-page action scrolls here; only this band leaves for checkout. */
export const CWC_INVESTMENT_ANCHOR = "#investment";

export const credentialWithConfidence = {
  seo: {
    title: "Credentialing with Confidence | NBCC Approved CE | Boss Clinician",
    description:
      "A self paced NBCC home study program that walks you through insurance enrollment and ethical billing step by step, so your paperwork is clean, your claims get paid, and your practice stays audit ready.",
  },

  /** The bar that runs above everything else on the source page. */
  compliance: "NBCC Home Study Program · 1.75 NBCC Clock Hours · Boss Clinician, LLC, ACEP No. 7998",

  hero: {
    badges: ["NBCC Approved CE Provider", "1.75 Clock Hours"],
    // One headline on the source; split at the sentence break so the third
    // sentence can take the foil italic line the hero gives an accent.
    title: "Get credentialed. Get paid correctly.",
    titleAccent: "Earn CE hours while you do it.",
    sub: "A self paced NBCC home study program that walks you through insurance enrollment and ethical billing step by step, so your paperwork is clean, your claims get paid, and your practice stays audit ready.",
    /** The published label is "Start the Program for $27"; the offer supplies the rest. */
    ctaPrefix: "Start the Program for",
    priceNote: "Instant access. Includes your NBCC certificate of completion once you pass the post-test.",
  },

  bundle: {
    src: "/images/cwc/credential-with-confidence-bundle.webp",
    alt: "The full bundle laid out: a laptop showing the “Credentialing with Confidence” title slide beside a photograph of a therapist writing at her desk, a tablet playing “The Boss Biller Blueprint”, cards labelled Credentialing Panel Tracker, CAQH Checklist, Insurance Panel Fee Guide and Insurance Panel Reference Guide, a fan of printed worksheet pages and a cup of coffee",
    width: 1920,
    height: 1080,
  } satisfies CwcPicture,

  understand: {
    title: "You will finally understand",
    items: [
      "Exactly what CAQH, NPI, and payer paperwork you actually need, in the right order",
      "How to track every panel application so nothing falls through the cracks",
      "What ethical billing looks like in real sessions, not just in theory",
      "How to handle a denied claim without losing your mind or your money",
    ],
  },

  stop: {
    title: "You will stop doing this",
    items: [
      "Guessing at credentialing timelines and missing follow up windows",
      "Learning coding and consent rules the hard way, after a claim gets flagged",
      "Juggling sticky notes and spreadsheets to track panel status",
      "Wondering if your billing practices would hold up under an audit",
    ],
  },

  program: {
    eyebrow: "The Program",
    title:
      "Credentialing with Confidence: Insurance Enrollment and Ethical Billing for Mental Health Therapists",
    body: "This home study program equips mental health therapists with practical, step by step guidance for navigating the insurance credentialing process and maintaining ethical billing practices in private practice. You will learn how to gather and submit credentialing documentation, complete the NPI and CAQH applications, understand payer specific requirements, and avoid common credentialing pitfalls. The program also covers ethical billing standards, including accurate coding, informed consent, confidentiality in billing communications, avoiding conflicts of interest, and handling client financial hardship. You will leave with a clear framework for building a credentialed, ethically sound, and audit ready practice.",
    stats: [
      { num: "1.75", label: "NBCC Clock Hours" },
      { num: "2", label: "Video Trainings" },
      { num: "15", label: "Post-Test Questions" },
      { num: "80%", label: "Passing Score" },
    ] satisfies CwcStat[],
  },

  objectives: {
    title: "What you will be able to do when you finish",
    intro:
      "Every NBCC home study program is built around clear learning objectives. Here is what this one covers, so you know exactly what you are earning credit for before you enroll.",
    items: [
      "Identify the required documentation for insurance credentialing, including licensure, NPI, and CAQH profile completion",
      "Differentiate between credentialing and provider enrollment",
      "Describe common credentialing myths that affect independent practitioners within group practice settings",
      "Explain typical credentialing timelines across commercial, Medicare, and Medicaid payers",
      "Apply strategies for tracking and following up on credentialing application status",
      "Identify ethical billing practices that prevent overbilling, upcoding, and inaccurate CPT code use",
      "Describe informed consent and fee transparency requirements related to client billing",
      "Explain the appropriate process for addressing insurance claim denials and appeals",
      "Identify conflicts of interest that may arise in billing and strategies to avoid them",
      "Apply strategies for maintaining client confidentiality throughout the billing process",
    ],
  },

  inside: {
    title: "Here is exactly what is inside",
    intro:
      "The video trainings below make up the NBCC-approved content. The bonus tools are practical extras to help you apply what you learn, but they are not part of the CE credit itself.",
    ce: {
      tag: "Counts toward your 1.75 CE hours",
      items: [
        {
          name: "Credentialing with Confidence",
          detail:
            "video training: documentation, NPI and CAQH setup, payer requirements, and tracking your applications",
        },
        {
          name: "The Boss Biller Blueprint",
          detail:
            "video training: ethical coding, informed consent, confidentiality, conflicts of interest, and claim denials",
        },
        { detail: "15-question post-test, 80 percent passing score required" },
        { detail: "Certificate of completion showing your 1.75 NBCC clock hours" },
      ] satisfies CwcInclusion[],
    },
    bonus: {
      tag: "Bonus tools, not eligible for CE credit",
      items: [
        "Credentialing Panel Tracker",
        "CAQH Checklist",
        "Insurance Panel Fee Guide",
        "Insurance Panel Reference Guide",
      ],
    },
  },

  certificate: {
    title: "How you will earn your certificate",
    steps: [
      {
        title: "Watch both video trainings in full",
        body: "Move at your own pace. Everything is pre-recorded and available on demand.",
      },
      {
        title: "Pass the post-test",
        body: "15 questions, 80 percent or higher to pass. You can retake it if you need to.",
      },
      {
        title: "Complete the program evaluation",
        body: "A quick evaluation form helps us keep the training sharp and NBCC compliant.",
      },
      {
        title: "Download your certificate",
        body: "Your certificate of completion with 1.75 NBCC clock hours is available immediately.",
      },
    ] satisfies CwcStep[],
  },

  presenter: {
    title: "Meet your presenter",
    name: "Yvette Howard, LCSW, MSW",
    creds: ["Founder, Brighter Tomorrow Therapy", "Founder, Boss Clinician, LLC"],
    portrait: {
      src: "/images/cwc/yvette-howard-portrait.webp",
      alt: "Yvette Howard sitting on the floor beside a tan leather sofa, smiling down at a sticker-covered laptop balanced on a knitted ottoman",
      width: 1152,
      height: 1440,
    } satisfies CwcPicture,
    paragraphs: [
      "Yvette Howard is a Licensed Clinical Social Worker and a group practice owner who built Brighter Tomorrow Therapy from the ground up. She holds a Master of Social Work from the University of Nevada, Las Vegas, and is the founder of Boss Clinician, LLC, an NBCC Approved Continuing Education Provider, ACEP No. 7998.",
      "When she opened her own practice, she credentialed herself with panel after panel, convinced she needed to be on every single one to survive. It took time, and it took mistakes, before she learned which panels were actually worth her time and how to move through the process without the guesswork.",
      "As her practice grew, credentialing became one of the first things she handed off. She trained her own admin to run the process from start to finish, and that system is the foundation of what you are learning here.",
      "Now she is handing it to you, so you do not have to pay a credentialing service two hundred dollars or more per panel for a process that comes with no guarantee you will even get approved.",
    ],
  },

  pricing: {
    title: "Ready to credential with confidence?",
    body: "Instant access to both video trainings, your post-test, your bonus tools, and 1.75 NBCC clock hours once you pass.",
    cta: "Yes, Enroll Me Now",
  },

  policy: {
    title: "Refund and grievance policy",
    opening:
      "Because this program includes NBCC continuing education credit, access to the video trainings and course materials begins immediately upon enrollment. Refunds are not available once course content has been accessed.",
    grievance: {
      before: "If you have a concern about the content, instruction, or the CE credit you received, contact Yvette Howard directly at ",
      email: "yvette@bossclinician.com",
      after: " within 30 days of completing the program. Every grievance is reviewed personally and you will receive a written response within 15 business days.",
    } satisfies CwcMailLine,
    closing:
      "If a technical issue prevents you from accessing or completing the program and it cannot be resolved, reach out before requesting a refund so we can make it right.",
  },

  footer: {
    nbcc: "Boss Clinician, LLC has been approved by NBCC as an Approved Continuing Education Provider, ACEP No. 7998. Programs that do not qualify for NBCC credit are clearly identified. Boss Clinician, LLC is solely responsible for all aspects of this program.",
    contact: {
      before: "Questions about this program or your CE credit? ",
      email: "yvette@bossclinician.com",
      after: "",
    } satisfies CwcMailLine,
  },
};
