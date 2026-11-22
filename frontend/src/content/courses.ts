import type { Course } from "@/types";

/**
 * The Boss Clinician training library, transcribed from the live catalogue.
 *
 * Titles, subtitles, descriptions and bullets are the published wording — the
 * bullets are set on the live page with a 💛 glyph as the list marker, which
 * here is drawn by the card's own foil diamond rather than repeated in the
 * string. No prices are published on the catalogue page, so `priceText` is
 * empty on every fallback row and the price line simply does not render; a
 * DB-backed course that carries Stripe fields still prints its own price.
 */
export const courses: Course[] = [
  {
    id: "fully-booked-toolkit",
    slug: "fully-booked-toolkit",
    title: "FULLY BOOKED TOOLKIT",
    subtitle: "Make Your Profile and Consultation Calls Clearer.",
    description:
      "You worked hard to become a therapist — now let your practice reflect that. The Fully Booked Toolkit brings together two resources: the From Profile to Profit guide and the Client Consultation Call Script.",
    priceText: "",
    image: "/images/b9de41b029ed.webp",
    url: "/courses/fully-booked-toolkit",
    features: [
      "From Profile to Profit guide and video tutorial, with a step-by-step structure for your directory profile.",
      "Client Consultation Call Script and video tutorial, to help callers understand fit, fees, and payment options.",
    ],
    sort: 6,
    published: true,
  },
  {
    id: "credentialing-success-formula",
    slug: "credentialing-success-formula",
    title: "CREDENTIALING SUCCESS FORMULA",
    subtitle: "Stop Rebuilding Your Credentialing Process Every Time You Hire",
    description:
      "A step-by-step credentialing system for group practice owners, designed to be repeatable, not owner-dependent. Insurance companies make their own credentialing and network participation decisions.",
    priceText: "",
    image: "/images/5a8b78757b65.webp",
    url: "/courses/credentialing-success-formula",
    features: [
      "A streamlined credentialing workflow so you will stop scrambling and start credentialing clinicians efficiently.",
      "Organized documentation systems so you will always know where things stand and avoid costly errors.",
      "A repeatable workflow for future hires, so you can train an administrative team member to manage it.",
    ],
    sort: 13,
    published: true,
  },
  {
    id: "credential-with-confidence",
    slug: "credential-with-confidence",
    title: "CREDENTIAL WITH CONFIDENCE",
    subtitle: "Understand Insurance Enrollment and Ethical Billing, Step by Step.",
    description:
      "For solo therapists ready to start credentialing: learn how to prepare enrollment information, track applications, and review billing practices.",
    priceText: "",
    image: "/images/bf28804cb9be.webp",
    url: "/courses/credential-with-confidence",
    features: [
      "CAQH made simple so you will finally understand what’s required without confusion.",
      "Insurance panels clearly explained so you will know which panels to apply to and why.",
      "Step-by-step submission guidance so you will know how to prepare enrollment information and track your applications.",
    ],
    sort: 14,
    published: true,
  },
  {
    id: "private-practice-starter-suite",
    slug: "private-practice-starter-suite",
    title: "PRIVATE PRACTICE STARTER SUITE",
    subtitle: "Choose Your First Steps Toward Private Practice.",
    description:
      "A 3-step mini course: From Employee to Business Owner, Choosing Your Niche & Business Model, and the First 3 Clients Blueprint.",
    priceText: "",
    image: "/images/b638c609d53c.webp",
    url: "/courses/private-practice-starter-suite",
    features: [
      "From Employee to Business Owner, so you will shift from an employee mindset into a business owner mindset.",
      "Choosing Your Niche & Business Model, so you will gain clarity on your niche and how to structure your practice.",
      "First 3 Clients Blueprint, with referral and visibility strategies to attract clients without relying solely on social media.",
    ],
    sort: 1,
    published: true,
  },
  {
    id: "ramp-up-rate-formula",
    slug: "ramp-up-rate-formula",
    title: "🔥 RAMP-UP RATE FORMULA",
    subtitle: "Set a Session Rate Using Your Practice’s Numbers.",
    description:
      "A step-by-step way to calculate your private pay rate based on your unique numbers, with calculators to play out different pricing scenarios.",
    priceText: "",
    image: "/images/63feb84d0c9d.webp",
    url: "/courses/ramp-up-rate-formula",
    features: [
      "Fee clarity so you can set a rate without second-guessing yourself.",
      "No-guilt pricing support so you will feel confident asking for rates that support your life and values.",
      "A pricing formula and calculators so you can run your numbers and compare pricing scenarios.",
    ],
    sort: 10,
    published: true,
  },
  {
    id: "provider-partnership-guide",
    slug: "provider-partnership-guide",
    title: "PROVIDER PARTNERSHIP GUIDE",
    subtitle: "Know What to Say When You Reach Out to Referral Partners.",
    description:
      "Get the templates, scripts, and workflows to reach out to doctors and specialists, plus a tracker to turn outreach and follow-up into a repeatable habit.",
    priceText: "",
    image: "/images/674d37182903.jpeg",
    url: "/courses/provider-partnership-guide",
    features: [
      "Outreach and follow-up scripts so you will know exactly what to say to referral partners.",
      "Referral-building templates so you will build professional referral relationships.",
      "Referral tracking support so you will stay organized and know who to reconnect with.",
    ],
    sort: 9,
    published: true,
  },
  {
    id: "private-practice-protection-pack",
    slug: "private-practice-protection-pack",
    title: "PRIVATE PRACTICE PROTECTION PACK",
    subtitle: "Editable Forms to Help You Organize Your Practice Paperwork.",
    description:
      "Consent forms, HIPAA documents, policies, telehealth and safety templates you can tailor to your practice. Always review them with your legal counsel.",
    priceText: "",
    image: "/images/9d7fb2d1ba2d.webp",
    url: "/courses/private-practice-protection-pack",
    features: [
      "Editable, customizable documents so you can tailor each form to your practice.",
      "Templates designed with HIPAA compliance in mind, to review with your legal counsel.",
      "Ready-to-use forms so you don’t have to create documentation from scratch.",
    ],
    sort: 12,
    published: true,
  },
  {
    id: "marketing-mastery-for-therapists",
    slug: "marketing-mastery-for-therapists",
    title: "MARKETING MASTERY FOR THERAPISTS",
    subtitle: "Plan Your Next Month of Practice Marketing.",
    description:
      "A 30-day content calendar, checklists, scripts and quick-start guides for marketing your practice.",
    priceText: "",
    image: "/images/7df196fe83a2.png",
    url: "/courses/marketing-mastery-for-therapists",
    features: [
      "30-day content calendars so you will never wonder what to post again.",
      "SEO checklists and referral scripts so you will know what to say when reaching out to referral partners.",
      "An ethical review builder guide to gathering reviews. Check the professional requirements that apply to you before requesting reviews.",
      "A 5-step marketing plan so you will focus on what actually moves the needle.",
      "Profile and referral quick-start guides so you will implement faster with less overwhelm.",
    ],
    sort: 8,
    published: true,
  },
  {
    id: "therapist-niche-clarity-accelerator",
    slug: "therapist-niche-clarity-accelerator",
    title: "THERAPIST NICHE CLARITY ACCELERATOR",
    subtitle: "Explain Who You Help in Words Prospective Clients Recognize.",
    description:
      "A clarity tool with prompts to help you draft a clearer message about who you help.",
    priceText: "",
    image: "/images/792bcd2c2e26.png",
    url: "/courses/therapist-niche-clarity-accelerator",
    features: [
      "A niche statement draft so you can explain who you help.",
      "Ideal client breakdown so you can describe who you serve.",
      "Messaging prompts so you will stop sounding generic and start sounding clear.",
    ],
    sort: 2,
    published: true,
  },
  {
    id: "prepare-to-profit-journal",
    slug: "prepare-to-profit-journal",
    title: "PREPARE TO PROFIT JOURNAL",
    subtitle: "Make Space to Think Through Your Next Practice Decision.",
    description:
      "A 5-step digital journal with reflection and writing prompts for therapists starting or scaling their practice.",
    priceText: "",
    image: "/images/1126b9d16f01.webp",
    url: "/courses/prepare-to-profit-journal",
    features: [
      "Guided meditations.",
      "Therapeutic writing prompts for reflection.",
      "Gratitude and reflection sections.",
      "Motivational quotes.",
      "A simple 5-step journaling framework.",
    ],
    sort: 3,
    published: true,
  },
  {
    id: "client-consultation-call-script",
    slug: "client-consultation-call-script",
    title: "CLIENT CONSULTATION CALL SCRIPT",
    subtitle:
      "A Complete, Plug-and-Play Script to Guide Your First Client Calls — Confidently & Professionally",
    description:
      "Make your initial consult calls smooth, confident, and conversion-focused. This script helps you structure discovery calls so you can screen for fit, set expectations, and convert inquiries into booked sessions.",
    priceText: "",
    image: "/images/f6e89a66a1a7.webp",
    url: "/courses/client-consultation-call-script",
    features: [
      "A professionally written call script so you will lead consults with confidence.",
      "Easy customization options so you will align calls with your policies and fees.",
      "A clear call flow so you will screen for fit and convert more inquiries.",
    ],
    sort: 7,
    published: true,
  },
  {
    id: "from-profile-to-profit",
    slug: "from-profile-to-profit",
    title: "FROM PROFILE TO PROFIT",
    subtitle: "Write a Directory Profile That Helps the Right Client Recognize Your Support.",
    description:
      "A three-paragraph writing formula and step-by-step instructions for your profile on directories such as Psychology Today, TherapyDen, and GoodTherapy.",
    priceText: "",
    image: "/images/7d1cdf512574.webp",
    url: "/courses/from-profile-to-profit",
    features: [
      "Profile templates so you will stop blending in and start standing out.",
      "Directory optimization strategies so you will increase visibility on platforms like Psychology Today and TherapyDen.",
      "A three-paragraph writing formula so you can clearly explain how you help.",
    ],
    sort: 4,
    published: true,
  },
];

/**
 * Per-course copy the shared `Course` record has no field for: the exact
 * lead-in line above the bullets, the exact button label, and the published
 * alt text for the cover. Keyed by slug so a course served by the API picks
 * up its own wording, and falls back to a neutral label when the API
 * introduces a course that is not in this table yet.
 */
export interface CourseMeta {
  /** The line printed immediately above the bullet list. */
  featuresLabel: string;
  /** The call-to-action label as published. */
  ctaLabel: string;
  /** Published alt text for the cover image; falls back to the course title. */
  imageAlt?: string;
}

export const courseMeta: Record<string, CourseMeta | undefined> = {
  "directory-makeover-audit": {
    featuresLabel: "You’ll Get:",
    ctaLabel: "Turn My profile into a booking magnet!",
    imageAlt: "Directory Makeover Audit banner",
  },
  "fully-booked-toolkit": {
    featuresLabel: "Inside You’ll Get:",
    ctaLabel: "GET FULLY BOOKED HERE",
    imageAlt: "Courses — Fully Booked Toolkit worksheets",
  },
  "credentialing-success-formula": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Grab Credentialing Success Formula",
    imageAlt: "Courses page — Credentialing Success Formula mockup for group practices.",
  },
  "credential-with-confidence": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Start Credentialing With Confidence",
    imageAlt: "Therapist confidence and credibility training Boss Clinician",
  },
  "private-practice-starter-suite": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Start Your Practice Today",
    imageAlt: "Private practice startup toolkit for therapists and clinicians",
  },
  "ramp-up-rate-formula": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Find Your Perfect Rate",
    imageAlt: "Therapist rate increase strategy Boss Clinician",
  },
  "provider-partnership-guide": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Build Referral Partnerships",
    imageAlt: "Referral partnership guide for private practice therapists",
  },
  "private-practice-protection-pack": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Protect Your Practice",
    imageAlt: "Private practice policies and protection resources for therapists",
  },
  "marketing-mastery-for-therapists": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Master Your Marketing",
    imageAlt: "Therapist marketing strategy training Boss Clinician",
  },
  "therapist-niche-clarity-accelerator": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Find Your Niche Today",
    imageAlt: "Therapist niche and branding training Boss Clinician",
  },
  "rate-negotiation-letter-template": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Download the Letter Template",
    imageAlt: "Therapist insurance rate negotiation template",
  },
  "prepare-to-profit-journal": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Start Shifting Into CEO Energy With the Journal",
    imageAlt: "Private practice planning and profit journal for therapists",
  },
  "client-consultation-call-script": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Get the Consultation Call Script",
    imageAlt: "Therapist consultation call script and conversion guide",
  },
  "from-profile-to-profit": {
    featuresLabel: "Inside you will get:",
    ctaLabel: "Transform Your Profile",
    imageAlt: "Private practice business growth training Boss Clinician",
  },
};

/** Used for any course the API returns that has no entry in `courseMeta`. */
export const defaultCourseMeta: CourseMeta = {
  featuresLabel: "Inside you will get:",
  ctaLabel: "Learn More",
};
