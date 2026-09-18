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
    id: "directory-makeover-audit",
    slug: "directory-makeover-audit",
    title: "DIRECTORY MAKEOVER AUDIT",
    subtitle: "Make Your Profile Irresistible — Get Seen. Get Chosen. Get Booked.",
    description:
      "A personalized audit that shows you exactly how to transform your Psychology Today or TherapyDen profile into a client-attracting powerhouse.",
    priceText: "",
    image: "/images/87e2e475b3ec.webp",
    url: "/courses/directory-makeover-audit",
    features: [
      "Clear, personalized feedback so you will know exactly what’s holding your profile back.",
      "A high-converting improvement plan so you will make changes with confidence.",
      "SEO and visibility insights so you will rank higher and get noticed.",
      "Actionable steps so you will increase bookings quickly without rewriting everything.",
    ],
    sort: 1,
    published: true,
  },
  {
    id: "fully-booked-toolkit",
    slug: "fully-booked-toolkit",
    title: "FULLY BOOKED TOOLKIT",
    subtitle: "Confidence. Consistency. Clients — This Toolkit Gets You Booked.",
    description:
      "You worked hard to become a therapist — now let your practice reflect that. The Fully Booked Toolkit is designed to help you attract consistent clients, streamline systems, and run a thriving practice that fills your schedule without chaos.",
    priceText: "",
    image: "/images/b9de41b029ed.webp",
    url: "/courses/fully-booked-toolkit",
    features: [
      "A proven client-attraction plan so you will know exactly how to fill your calendar with aligned clients without burnout or guesswork.",
      "Systems for intake, scheduling, and onboarding so you will create a smooth, professional client experience from first contact to first session.",
      "Strategies for consistent client volume so you will stay booked even during slow seasons instead of constantly starting over.",
      "Tools to manage caseloads, referrals, and retention so you will remain balanced, organized, and in control of your workload.",
    ],
    sort: 2,
    published: true,
  },
  {
    id: "credentialing-success-formula",
    slug: "credentialing-success-formula",
    title: "CREDENTIALING SUCCESS FORMULA",
    subtitle: "For Group Practice Owners Who Need Their Team Credentialed ASAP",
    description: "A simple, repeatable system to credential your clinicians quickly and cleanly.",
    priceText: "",
    image: "/images/5a8b78757b65.webp",
    url: "/courses/credentialing-success-formula",
    features: [
      "A streamlined credentialing workflow so you will stop scrambling and start credentialing clinicians efficiently.",
      "Organized documentation systems so you will always know where things stand and avoid costly errors.",
      "Fewer delays and more approvals so you will get your clinicians paneled faster and generating revenue sooner.",
    ],
    sort: 3,
    published: true,
  },
  {
    id: "credential-with-confidence",
    slug: "credential-with-confidence",
    title: "CREDENTIAL WITH CONFIDENCE",
    subtitle: "For Solo Therapists Ready to Start Credentialing",
    description: "No confusion. No overwhelm. Just clear direction.",
    priceText: "",
    image: "/images/bf28804cb9be.webp",
    url: "/courses/credential-with-confidence",
    features: [
      "CAQH made simple so you will finally understand what’s required without confusion.",
      "Insurance panels clearly explained so you will know which panels to apply to and why.",
      "Step-by-step submission guidance so you will credential correctly the first time and avoid delays.",
    ],
    sort: 4,
    published: true,
  },
  {
    id: "private-practice-starter-suite",
    slug: "private-practice-starter-suite",
    title: "PRIVATE PRACTICE STARTER SUITE",
    subtitle: "A 3-Step Mini Course to Launch Your Private Practice",
    description: "Your roadmap for setting up your business legally & confidently.",
    priceText: "",
    image: "/images/b638c609d53c.webp",
    url: "/courses/private-practice-starter-suite",
    features: [
      "Business structure guidance so you will choose the right setup from the beginning.",
      "Clear filing instructions so you will complete what matters legally and skip what doesn’t.",
      "A confident launch roadmap so you will start your practice the right way without fear or overwhelm.",
    ],
    sort: 5,
    published: true,
  },
  {
    id: "ramp-up-rate-formula",
    slug: "ramp-up-rate-formula",
    title: "🔥 RAMP-UP RATE FORMULA",
    subtitle: "Set Your Rates Like a CEO — Not a Guessing Therapist",
    description: "Discover your exact profitable, ethical session rate.",
    priceText: "",
    image: "/images/63feb84d0c9d.webp",
    url: "/courses/ramp-up-rate-formula",
    features: [
      "Fee clarity so you will know exactly what to charge without second-guessing yourself.",
      "No-guilt pricing support so you will feel confident asking for rates that support your life and values.",
      "A proven pricing formula so you will trust your numbers and stop undercharging.",
    ],
    sort: 6,
    published: true,
  },
  {
    id: "provider-partnership-guide",
    slug: "provider-partnership-guide",
    title: "PROVIDER PARTNERSHIP GUIDE",
    subtitle: "Create Referral Streams That Never Dry Up",
    description:
      "Get the templates, scripts, and workflows to build strong referral relationships with doctors and specialists — consistently sending clients your way.",
    priceText: "",
    image: "/images/674d37182903.jpeg",
    url: "/courses/provider-partnership-guide",
    features: [
      "Outreach and follow-up scripts so you will know exactly what to say to referral partners.",
      "Referral-building templates so you will build professional, lasting relationships with ease.",
      "Referral tracking support so you will stay organized and nurture high-quality referral streams.",
    ],
    sort: 7,
    published: true,
  },
  {
    id: "private-practice-protection-pack",
    slug: "private-practice-protection-pack",
    title: "PRIVATE PRACTICE PROTECTION PACK",
    subtitle: "Protect Your Practice With Lawyer-Reviewed Forms",
    description:
      "Get everything you need — consent forms, HIPAA documents, policies, telehealth and safety templates — to stay compliant and run your practice like a professional.",
    priceText: "",
    image: "/images/9d7fb2d1ba2d.webp",
    url: "/courses/private-practice-protection-pack",
    features: [
      "Lawyer-reviewed documents so you will operate confidently and professionally.",
      "HIPAA and compliance-ready templates so you will reduce legal risk and protect your license.",
      "Peace of mind so you will focus on clients instead of worrying about paperwork.",
    ],
    sort: 8,
    published: true,
  },
  {
    id: "marketing-mastery-for-therapists",
    slug: "marketing-mastery-for-therapists",
    title: "MARKETING MASTERY FOR THERAPISTS",
    subtitle: "A Complete Therapist-Friendly Marketing System",
    description: "Done-for-you content that helps you get clients consistently.",
    priceText: "",
    image: "/images/7df196fe83a2.png",
    url: "/courses/marketing-mastery-for-therapists",
    features: [
      "30-day content calendars so you will never wonder what to post again.",
      "SEO checklists and referral scripts so you will get found and referred consistently.",
      "Ethical review builder so you will collect social proof without risking compliance.",
      "A 5-step marketing plan so you will focus on what actually moves the needle.",
      "Profile and referral quick-start guides so you will implement faster with less overwhelm.",
    ],
    sort: 9,
    published: true,
  },
  {
    id: "therapist-niche-clarity-accelerator",
    slug: "therapist-niche-clarity-accelerator",
    title: "THERAPIST NICHE CLARITY ACCELERATOR",
    subtitle: "Find Your Niche Fast — So Clients Find YOU",
    description: "A powerful clarity tool to identify your ideal client & message.",
    priceText: "",
    image: "/images/792bcd2c2e26.png",
    url: "/courses/therapist-niche-clarity-accelerator",
    features: [
      "A clear niche statement so you will confidently explain who you help.",
      "Ideal client breakdown so you will attract aligned clients with ease.",
      "Messaging prompts so you will stop sounding generic and start sounding clear.",
    ],
    sort: 10,
    published: true,
  },
  {
    id: "rate-negotiation-letter-template",
    slug: "rate-negotiation-letter-template",
    title: "RATE NEGOTIATION LETTER TEMPLATE",
    subtitle: "Ask for Higher Rates With Ease",
    description:
      "A plug-and-play, therapist-friendly template that helps you request (and often secure) better reimbursement rates.",
    priceText: "",
    image: "/images/fb13cb030751.webp",
    url: "/courses/rate-negotiation-letter-template",
    features: [
      "A professional, therapist-friendly letter so you will advocate for better reimbursement confidently.",
      "Easy customization so you will send it quickly without overthinking.",
      "A clear negotiation structure so you will increase your chances of approval.",
    ],
    sort: 11,
    published: true,
  },
  {
    id: "prepare-to-profit-journal",
    slug: "prepare-to-profit-journal",
    title: "PREPARE TO PROFIT JOURNAL",
    subtitle: "A Guided Meditation & Mindset Journal to Release Fear & Step Into CEO Energy",
    description:
      "A 5-step digital journal designed for therapists to ditch self-doubt and step into the confidence needed to start or scale their practice.",
    priceText: "",
    image: "/images/1126b9d16f01.webp",
    url: "/courses/prepare-to-profit-journal",
    features: [
      "Guided meditations so you will ground your nervous system and release fear.",
      "Therapeutic writing prompts so you will gain clarity and confidence.",
      "Gratitude and reflection sections so you will stay centered during growth.",
      "Motivational quotes so you will stay empowered through transitions.",
      "A mindset transformation framework so you will show up as the CEO of your practice.",
    ],
    sort: 12,
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
    sort: 13,
    published: true,
  },
  {
    id: "from-profile-to-profit",
    slug: "from-profile-to-profit",
    title: "FROM PROFILE TO PROFIT",
    subtitle: "Turn Your Therapist Directory Profile Into Booked Clients",
    description:
      "Stop blending in — make your directory profile stand out, attract your ideal clients, and convert profile views into booked sessions.",
    priceText: "",
    image: "/images/7d1cdf512574.webp",
    url: "/courses/from-profile-to-profit",
    features: [
      "High-converting profile templates so you will stop blending in and start standing out.",
      "Directory optimization strategies so you will increase visibility on platforms like Psychology Today and TherapyDen.",
      "Messaging that converts so you will turn profile views into booked sessions.",
    ],
    sort: 14,
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
    ctaLabel: "Get the Client Consultation Call Script",
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
