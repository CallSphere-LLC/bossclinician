/**
 * The free-guide opt-ins and their thank-you pages, word for word from the
 * Kajabi pages they replace (captured 1 Oct 2026):
 *
 *   /5-step-marketing  ->  /marketing-step-form            (5-Step Marketing Plan)
 *   /business-plan-guide  ->  /business-plan-ty            (Business Plan Guide)
 *   /insurance-guide  (its Kajabi thank-you page is gone)  (Insurance vs Superbills)
 *   /kickstartguide  ->  /step-by-step-guide-thank-you-page (Kickstart Guide)
 *
 * Each sign-up posts to its own form (migration 097_leadmagnet_pages.sql), which
 * tags the contact and fires the automation that emails the guide. The page
 * after it also links the guide directly, so nobody has to wait for an email.
 *
 * Source typos are kept where they are the owner's words ("PLANING",
 * "But Wait... Want to know how But wait…"): this is a copy of her page, not
 * an edit of it. Kajabi's own decorations (tick icons, theme backgrounds) are
 * replaced by the site's luxe components.
 */

/* ── Shared ─────────────────────────────────────────────────────────── */

/** The forms created by migration 097. The slugs are the page paths. */
export const LEAD_MAGNET_FORMS = {
  marketingPlan: "marketing-step-form",
  businessPlan: "business-plan-guide",
  insurance: "insurance-guide",
  kickstart: "kickstartguide",
} as const;

/**
 * Where each free guide lives on this site. The 5-Step Marketing Plan is the
 * fillable PDF from her media library; the other three are referenced at the
 * address they will be uploaded to (see the migration's header).
 */
export const FREEBIE_FILES = {
  marketingPlan: "/downloads/5-step-marketing-plan.pdf",
  businessPlan: "/downloads/private-practice-business-plan-guide.pdf",
  insurance: "/downloads/insurance-vs-superbills-guide.pdf",
  kickstart: "/downloads/private-practice-kickstart-guide.pdf",
} as const;

/** The consent line under most of her Kajabi opt-in forms. */
export const KAJABI_CONSENT =
  "Bossclinician.com needs the contact information you provide to us to contact you about our products and services. You may unsubscribe from these communications at anytime. See our privacy policy for terms and conditions and to learn how we protect your data.";

/** Shown under every "check your inbox" line: the same file, right now. */
export const DIRECT_DOWNLOAD = {
  label: "Download it now",
  note: "Prefer not to wait for the email? Your copy is right here.",
};

/* ── /5-step-marketing ──────────────────────────────────────────────── */

export const fiveStepMarketing = {
  seo: {
    title: "5-Step Marketing Plan for Therapists in Private Practice | Boss Clinician",
    description:
      "A free 5-step marketing plan for therapists in private practice — simple, actionable, and built around your schedule. Get yours free.",
  },
  back: "← Back to Resource Hub",
  hero: {
    eyebrow: "Free Guide · Boss Clinician",
    title: "5-Step Marketing Plan",
    titleAccent: "For Therapists in Private Practice",
    lede:
      "Stop guessing at your marketing. This free, fillable guide gives you a simple, actionable plan built specifically for therapists — so you can attract aligned clients without posting every day or depending on platforms to send referrals.",
    cta: "Get the Free Marketing Plan",
    meta: "Free · Fillable PDF · Instant access",
  },
  mockup: {
    title: "5 Step Marketing Plan",
    sub: "For Therapists in Private Practice",
    brand: "By Boss Clinician",
    steps: [
      "Define Your Ideal Client",
      "Choose Your Marketing Channels",
      "Craft Your Key Message",
      "Set a Simple Action Plan",
      "Track Your Results",
    ],
  },
  walkAway: {
    eyebrow: "What You'll Walk Away With",
    title: "A clear marketing plan — built around your practice, not someone else's.",
    body:
      "Most marketing advice for therapists assumes you have unlimited time and zero clients to see. This guide was built around your reality. Work through it once, fill it out honestly, and you'll have a focused marketing plan you can actually follow.",
    steps: [
      "Define Your Ideal Client",
      "Choose Your Channels",
      "Craft Your Message",
      "Set Your Action Plan",
      "Track Your Results",
    ],
    closing: "Five steps. One clear direction. No more guessing.",
  },
  who: {
    eyebrow: "Who This Is For",
    title:
      "This guide is for the therapist who is tired of inconsistent marketing that never fills their calendar.",
    body:
      "If you've tried posting consistently and burned out, joined directories that sent nothing, or been told to \"just be more consistent\" without anyone showing you what that actually looks like for a private practice — this guide is for you.",
  },
  about: {
    eyebrow: "From Yvette",
    title: "I made every marketing mistake in the book — so you don't have to.",
    paragraphs: [
      "I tried posting every day. I stayed on every platform. I joined directories that sent me maybe one client a year. And I spent years overcomplicating something that was actually pretty simple once I stripped it back.",
      "This is the plan I wish someone had handed me — focused, fillable, and built for the real schedule of a working therapist.",
    ],
    signature: "— Yvette Howard, LCSW · Private Practice Strategist · Boss Clinician",
    photo: {
      src: "/images/leadmagnets/yvette-marketing-plan.jpg",
      alt: "Yvette Howard, LCSW — Private Practice Strategist, Boss Clinician",
      width: 1200,
      height: 800,
    },
  },
  cta: {
    eyebrow: "Get the Free Guide",
    title: "Your marketing plan — in 5 simple steps.",
    body: "Enter your name and email and we'll send the free fillable PDF straight to your inbox.",
    button: "Get the Free Marketing Plan",
    privacy:
      "We respect your privacy. No spam — just your guide and occasional strategy content from Boss Clinician.",
  },
} as const;

/* ── /marketing-step-form ───────────────────────────────────────────── */

export const marketingStepForm = {
  seo: {
    title: "Get the Free 5-Step Marketing Plan | Boss Clinician",
    description:
      "Enter your name and email and we'll send the free fillable 5-Step Marketing Plan for therapists straight to your inbox.",
  },
  eyebrow: "Get the Free Guide",
  title: "Your marketing plan — in 5 simple steps.",
  body: "Enter your name and email and we'll send the free fillable PDF straight to your inbox.",
  fields: {
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    practiceYears: {
      label: "How Long Have You Been In Practice",
      options: ["0-1 year", "2-3 years", "4-5+ years"],
    },
  },
  submit: "READY TO MARKET MY PRACTICE",
  consent:
    "By submitting this form you agree to receive emails from Boss Clinician, LLC. This resource is educational only and is not legal, financial, or clinical advice. You can unsubscribe anytime. See our Privacy Policy and Terms.",
  /**
   * Her Kajabi form had no thank-you page of its own (Kajabi showed its stock
   * confirmation), so the confirmation is the page's own promise, kept short.
   */
  success: {
    title: "Your 5-Step Marketing Plan is on its way.",
    body: "Check your inbox — we've sent the free fillable PDF to the email you entered.",
  },
} as const;

/* ── /business-plan-guide ───────────────────────────────────────────── */

export const businessPlanGuide = {
  seo: {
    title: "Start, Scale, and Expand Your Private Practice",
    description:
      "A step-by-step guide to help you start, scale or expand your private practice without the overwhelm.",
  },
  hero: {
    eyebrow: "FREE PLANING GUIDE EVERY THERAPIST NEEDS TO MOVE FROM CLINICIAN TO CEO",
    title: "THE PRIVATE PRACTICE",
    titleAccent: "BUSINESS PLAN",
    lede:
      "Turn your practice vision into an actionable, income-generating business—without confusion, overwhelm, or guessing your way through it.",
    cta: "YES, I NEED THIS!",
    image: {
      src: "/images/leadmagnets/business-plan-laptop-mockup.webp",
      alt: "The Private Practice Business Plan guide shown on a laptop",
      width: 500,
      height: 500,
    },
  },
  helpImage: {
    src: "/images/leadmagnets/business-plan-free-guide-will-help.jpg",
    alt: "This free guide will help you — a therapist planning her practice at her desk",
    width: 1000,
    height: 969,
  },
  benefits: [
    {
      title: "Clarify Your Practice Vision & Goals",
      body: "Identify your ideal practice model, income goals, and long-term vision—so you're building with purpose, not guessing.",
    },
    {
      title: "Plan Your Business Structure the Right Way",
      body: "Gain clarity on legal setup, business name, EIN, NPI, paperwork, and foundational requirements without confusion.",
    },
    {
      title: "Design Services That Align With Your Purpose & Income",
      body: "Define what you offer, who it’s for, and how it fits your lifestyle—so your services work for you, not just your clients.",
    },
    {
      title: "Build a CEO-Level Pricing & Profit Plan",
      body: "Map out your fees, expenses, and revenue goals—so you can confidently build a financially sustainable private practice.",
    },
    {
      title: "Create Your Strategic Roadmap to Launch, Grow, and Expand",
      body: "Walk away with a step-by-step plan to start, scale, or eventually hire, so you always know your next move.",
    },
  ],
  benefitsCta: "ORGANIZE MY PRACTICE",
  passion: {
    title: "You’re a therapist with a passion for helping others.",
    paragraphs: [
      "The missing link? A clear, strategic plan to start, grow, or expand your practice—without overwhelm, confusion, or random Googling. Because without a roadmap, even the most passionate therapist can stay stuck in vision mode instead of CEO mode..",
      "That’s where I come in—guide in one hand, roadmap in the other. Shall we get started?",
    ],
    whyTitle: "WHY YOU’LL LOVE THIS GUIDE:",
    why: [
      { label: "Actionable Steps", body: "No fluff—just clear, practical steps to move forward." },
      { label: "Expert Tips", body: "Learn from a therapist who successfully made the leap." },
      { label: "Confidence Boost", body: "Mindset shifts to help you own your role as a business owner." },
    ],
    image: {
      src: "/images/leadmagnets/yvette-business-plan.jpg",
      alt: "Yvette Howard, LCSW, arms folded and smiling",
      width: 900,
      height: 1017,
    },
  },
  grab: {
    title: "Grab it now 👇",
    body: "The strategic planning guide therapists use to start, structure, and scale their private practice the right way.",
    submit: "YES, LET'S DO THIS!",
    image: {
      src: "/images/leadmagnets/business-plan-guide-cover.webp",
      alt: "Cover of the free Private Practice Business Plan guide",
      width: 500,
      height: 500,
    },
  },
  guide: {
    eyebrow: "Meet Your Guide",
    title: "Hi, I’m Yvette",
    paragraphs: [
      "Therapist turned private practice strategist, self-care enthusiast, and founder of Brighter Tomorrow Therapy and Boss Clinician Consulting, helping therapists leave their 9-5 and build thriving private practices.",
      "You’re a talented therapist with a passion for helping others. The missing link? A clear plan to build a profitable practice—without the overwhelm. Because without the right steps, your dream practice can feel out of reach.",
      "That’s where I come in… guide in one hand, strategy in the other—ready to help you make the leap with confidence. Shall we get started?",
    ],
    cta: "Let’s get you started!",
    photo: {
      src: "/images/leadmagnets/yvette-meet-your-guide.jpg",
      alt: "Yvette Howard, LCSW, smiling in a green top",
      width: 900,
      height: 1336,
    },
  },
  ps: {
    title: "P.S. Don’t miss out— your dream practice is closer than you think!",
    body: "Grab the guide and start your journey today.",
  },
} as const;

/* ── /business-plan-ty ──────────────────────────────────────────────── */

export const businessPlanThankYou = {
  seo: {
    title: "Business Plan- Thank you Page",
    description: "Your Private Practice Business Plan Guide is on its way to your inbox.",
  },
  shout: "Yesssss!!!!!!",
  title: "Your Private Practice Business Plan Guide Is All Yours!",
  body:
    "You’re officially out of “dreaming mode” and stepping into “design-and-build mode.” This guide helps you start planning like a CEO—so your practice becomes intentional, profitable, and sustainable.",
  inbox: "Check your inbox to grab your new guide!",
  junk: "(Don't see it after a few minutes? Try checking your Junk Folder",
  upsell: {
    title: "Want to know how I was able to have consistent clients and now have my staff fully booked?",
    subtitle: "Grab Your Fully Booked Toolkit for only $67",
    body:
      "Whether you're ready to start your journey to private practice or looking for practical tools to ensure a fully booked practice, this is your go-to resource bundle.",
    cta: "SIGN UP FOR THE FULLY BOOKED TOOLKIT ($67)",
    to: "/courses/fully-booked-toolkit",
  },
  training: {
    title:
      "But Wait... Want to know how But wait… want to see the exact 4-step blueprint I used to go from overworked clinician to CEO of my own thriving group practice?",
    register: "Register for the Free Training that Reveals the steps needed to become the CEO of your practice.",
    image: {
      src: "/images/leadmagnets/four-step-blueprint-training.webp",
      alt: "From Imposter to CEO: The 4-Step Blueprint to Building a Profitable Private Practice — free training",
      width: 1200,
      height: 675,
    },
    consent: KAJABI_CONSENT,
  },
  photo: {
    src: "/images/leadmagnets/thank-you-celebrate.jpg",
    alt: "A therapist celebrating at her desk",
    width: 1200,
    height: 933,
  },
} as const;

/* ── /insurance-guide ───────────────────────────────────────────────── */

export const insuranceGuide = {
  seo: {
    title: "Free Insurance vs Superbills Guide for Private Practice Owners",
    description:
      "Download the Insurance vs Superbills guide to understand the benefits, challenges, and requirements for each approach in managing your private practice’s billing. Streamline your practice today!",
  },
  eyebrow: "FREE DOWNLOAD",
  title: "Insurance vs Superbills",
  /** The second block on her page repeats the first under this title. */
  repeatTitle: "Insurance vs. Superbill Guide",
  lede: "Learn the benefits, challenges, and requirements for each approach to streamline your private practice.",
  submit: "DOWNLOAD NOW",
  consent: KAJABI_CONSENT,
  image: {
    src: "/images/leadmagnets/insurance-vs-superbills-guide.webp",
    alt: "Free Guide: Ins & Outs of Insurance vs Superbill",
    width: 900,
    height: 900,
  },
  /** Her Kajabi thank-you page has been deleted; this stands in for it. */
  success: {
    title: "Your Insurance vs Superbills guide is on its way.",
    body: "Check your inbox to grab your new guide!",
  },
} as const;

/* ── /kickstartguide ────────────────────────────────────────────────── */

export const kickstartGuide = {
  seo: {
    title: "Leave your 9-5 and Start a Profitable Private Practice",
    description:
      "A step-by-step guide to help you ditch your 9-5 or agency job and start a profitable private practice.",
  },
  hero: {
    eyebrow: "FREE GUIDE FOR THERAPISTS WANTING TO LEAVE THEIR 9-5",
    title: "THE PRIVATE PRACTICE",
    titleAccent: "KICKSTART",
    lede: "3 Steps to Go From 9-5 to Your Own Profitable Private Practice—Without the Overwhelm",
    cta: "YES, I NEED THIS!",
    image: {
      src: "/images/leadmagnets/kickstart-guide-cover.webp",
      alt: "Cover of the free Private Practice Kickstart Guide: How to Leave Your 9-5 with Confidence",
      width: 900,
      height: 1008,
    },
  },
  mockup: {
    src: "/images/leadmagnets/kickstart-laptop-mockup.webp",
    alt: "The Private Practice Kickstart guide shown on a laptop",
    width: 1000,
    height: 690,
  },
  helpImage: {
    src: "/images/leadmagnets/kickstart-free-guide-will-help.jpg",
    alt: "This free guide will help you — a therapist working on her laptop",
    width: 1000,
    height: 969,
  },
  benefits: [
    {
      title: "Shift to a CEO Mindset",
      body: "Say goodbye to self-doubt and step into your role as a business owner with confidence.",
    },
    {
      title: "Structure Your Private Practice for Success",
      body: "Learn how to organize and streamline your business to support sustainable growth.",
    },
    {
      title: "Craft a Niche That Attracts Clients",
      body: "Define who you serve, what problems you solve, and why clients should choose you.",
    },
    {
      title: "Set Profitable Fees Without Guilt",
      body: "Discover how to calculate your rates confidently, so you’re never underpaid.",
    },
    {
      title: "Transition from 9-5 to Private Practice with Confidence",
      body: "Get a clear roadmap to leave your job and build a practice that thrives",
    },
  ],
  benefitsCta: "GIVE ME THE GOODS!",
  passion: {
    title: "You’re a therapist with a passion for helping others.",
    paragraphs: [
      "The missing link? A clear plan to leave your 9-5 and start a private practice that actually pays. Because without the right steps, your dream practice can feel out of reach.",
      "That’s where I come in—guide in one hand, roadmap in the other. Shall we get started?",
    ],
    whyTitle: "WHY YOU’LL LOVE THIS GUIDE:",
    why: [
      { label: "Actionable Steps", body: "No fluff—just clear, practical steps to move forward." },
      { label: "Expert Tips", body: "Learn from a therapist who successfully made the leap." },
      { label: "Confidence Boost", body: "Mindset shifts to help you own your role as a business owner." },
    ],
    image: {
      src: "/images/leadmagnets/kickstart-celebrate.jpg",
      alt: "A therapist celebrating with her arms raised",
      width: 900,
      height: 1017,
    },
  },
  grab: {
    title: "Grab it now 👇",
    body: "3 Steps to Go From 9-5 to Your Own Profitable Private Practice—Without the Overwhelm",
    submit: "YES, LET'S DO THIS!",
    image: {
      src: "/images/leadmagnets/kickstart-guide-cover.webp",
      alt: "Cover of the free Private Practice Kickstart Guide",
      width: 900,
      height: 1008,
    },
  },
  guide: {
    eyebrow: "Meet Your Guide",
    title: "Hi, I’m Yvette",
    paragraphs: [
      "Therapist turned business coach, self-care enthusiast, and founder of Boss Clinician, helping therapists leave their 9-5 and build thriving private practices.",
      "You’re a talented therapist with a passion for helping others. The missing link? A clear plan to build a profitable practice—without the overwhelm. Because without the right steps, your dream practice can feel out of reach.",
      "That’s where I come in… guide in one hand, strategy in the other—ready to help you make the leap with confidence. Shall we get started?",
    ],
    cta: "Let’s get you started!",
    photo: {
      src: "/images/leadmagnets/yvette-kickstart-guide.jpg",
      alt: "Yvette Howard, LCSW, seated in a green chair",
      width: 359,
      height: 512,
    },
  },
  ps: {
    title: "P.S. Don’t miss out— your dream practice is closer than you think!",
    body: "Grab the guide and start your journey today.",
  },
} as const;

/* ── /step-by-step-guide-thank-you-page ─────────────────────────────── */

export const kickstartThankYou = {
  seo: {
    title: "Get Your Pathway to Private Practice Guide + Free Training",
    description:
      "Congratulations on unlocking your Pathway to Private Practice guide! You’re just a step away from leaving your 9-5 and stepping into a profitable private practice. Check your inbox for the guide, and don’t forget to register for the free training to learn the exact steps to start your journey!",
  },
  shout: "Yesssss!!!!!!",
  title: "Your Private Practice Kickstart Guide Is All Yours!",
  body: "Your days of collecting the same ol' paycheck and 1 to 3% annual raises are soon to be a thing of the past.",
  inbox: "Check your inbox to grab your new guide!",
  junk: "(Don't see it after a few minutes? Try checking your Junk Folder",
  upsell: {
    title: "Are you ready to take quick action to get your private practice started?",
    subtitle: "Sign up for the PRIVATE PRACTICE STARTER SUITE for only $27",
    body:
      "Whether you're ready to start your journey to private practice on the side or looking for practical tools to ensure a successful practice, this is your go-to resource bundle.",
    cta: "SIGN UP FOR THE STARTER PACK ($27)",
    to: "/courses/private-practice-starter-suite",
  },
  photo: businessPlanThankYou.photo,
} as const;

/* ── /opt-in ────────────────────────────────────────────────────────── */

/**
 * Her Kajabi /opt-in page was an unfinished template — its headings were still
 * Kajabi's "[ Describe the value ]" placeholders and its form fed no freebie.
 * Rather than publish placeholder brackets, the address lists the free guides
 * that do exist, and keeps the template's two real lines.
 */
export const optIn = {
  seo: {
    title: "Free Guides for Therapists | Boss Clinician",
    description:
      "Free guides for therapists building a private practice: the 5-Step Marketing Plan, the Private Practice Kickstart Guide, the Insurance vs Superbills guide and the Private Practice Business Plan.",
  },
  eyebrow: "Free resources",
  title: "Get it now",
  lede: "Choose your free guide below. We won't send spam. Unsubscribe at any time.",
  guides: [
    {
      title: "5-Step Marketing Plan For Therapists in Private Practice",
      body: "A free, fillable guide to attract aligned clients without posting every day.",
      to: "/5-step-marketing",
      cta: "Get the Free Marketing Plan",
      image: "/images/leadmagnets/yvette-marketing-plan.jpg",
    },
    {
      title: "The Private Practice Kickstart",
      body: "3 Steps to Go From 9-5 to Your Own Profitable Private Practice—Without the Overwhelm",
      to: "/kickstartguide",
      cta: "YES, I NEED THIS!",
      image: "/images/leadmagnets/kickstart-guide-cover.webp",
    },
    {
      title: "Insurance vs Superbills",
      body: "Learn the benefits, challenges, and requirements for each approach to streamline your private practice.",
      to: "/insurance-guide",
      cta: "DOWNLOAD NOW",
      image: "/images/leadmagnets/insurance-vs-superbills-guide.webp",
    },
    {
      title: "The Private Practice Business Plan",
      body: "Turn your practice vision into an actionable, income-generating business—without confusion, overwhelm, or guessing your way through it.",
      to: "/business-plan-guide",
      cta: "YES, I NEED THIS!",
      image: "/images/leadmagnets/business-plan-guide-cover.webp",
    },
  ],
} as const;
