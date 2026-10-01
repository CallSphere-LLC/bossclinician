/**
 * Copy for the one-off pages rebuilt from bossclinician.com (Kajabi): the
 * Practice Reset Audit family, the Profitable Practice Planner opt-in, the
 * purchase thank-you pages, the link-in-bio hub, the consulting next-steps page
 * and the masterclass review sheet.
 *
 * Verbatim from the live pages as fetched on 1 Oct 2026 — including their
 * typos — so a returning visitor reads exactly what Kajabi showed them. The
 * only changes are addresses: every bossclinician.com link points at the page
 * that now answers on this site, and every image is self-hosted under
 * /images/kajabi-pages/.
 */

const IMG = "/images/kajabi-pages";

/* ══ /reset-audit ══════════════════════════════════════════════════════ */

export const resetAudit = {
  seo: {
    title: "The Practice Reset Audit | Free Workbook | Boss Clinician",
    description:
      "A free practice audit for therapists — identify what's draining your time and income and walk away with a clear reset plan.",
  },
  back: { label: "← Back to Resource Hub", href: "/resource-hub" },
  eyebrow: "Free Workbook · Boss Clinician",
  title: "The Practice Reset Audit",
  titleAccent: "Because a misaligned practice costs you more than money.",
  lede: "A free, fillable audit for therapists who are ready to get honest about what's actually working — and what needs to go.",
  note: "Set aside 20–30 minutes. Grab your coffee. Be honest. This is for you.",
  cta: { label: "Get the Free Audit", href: "/reset-audit-form" },
  meta: "Free · Fillable PDF · 8 pages · No fluff",
  truth: {
    eyebrow: "The Truth Nobody Tells You",
    title: "You don't have a productivity problem.",
    titleAccent: "You have an alignment problem.",
    paragraphs: [
      "You're not behind because you're not working hard enough. You're behind because the structure underneath your practice is requiring more from you than it's giving back.",
      "This audit helps you get clear on exactly what's draining your time, energy, and income — and gives you a direct, honest path to resetting it. No fluff. No generic tips. Just you, your practice, and the truth.",
    ],
    bullets: [
      "Identify the tasks and patterns quietly draining your practice",
      "Run every time-consuming activity through a simple clarity filter",
      "Decide what to keep, what to restructure, and what to stop entirely",
      "Walk away with a real reset plan — and permission to act on it",
    ],
  },
  who: {
    eyebrow: "Who This Is For",
    title:
      "This audit is for the therapist who knows something isn't working — but hasn't stopped long enough to figure out what.",
    body: "You're showing up. You're working hard. And somehow your practice still feels heavier than it should. This audit gives you the clarity to see exactly what's costing you — and the structure to do something about it.",
    quote: "\"Busy is not the goal. Building is.\"",
    quoteBy: "— Yvette Howard, LCSW · Boss Clinician",
  },
  yvette: {
    image: `${IMG}/reset-audit/yvette.webp`,
    imageAlt: "Yvette Howard, LCSW — Private Practice Strategist, Boss Clinician",
    eyebrow: "From Yvette",
    title: "I built this audit because I needed it myself.",
    paragraphs: [
      "There was a point in my own practice where I was doing everything — and still felt behind. Not because I wasn't working hard enough. Because I was working on the wrong things.",
      "The Practice Reset Audit is the exact process I used to get honest about what was actually moving my practice forward — and what was just keeping me busy.",
    ],
    signature: "— Yvette Howard, LCSW · Private Practice Strategist · Boss Clinician",
  },
  close: {
    eyebrow: "Get the Free Audit",
    title: "Ready to reset your practice?",
    body: "Enter your name and email and we'll send the free fillable PDF straight to your inbox.",
    privacy:
      "We respect your privacy. No spam — just your audit and occasional strategy content from Boss Clinician.",
  },
} as const;

/* ══ /reset-audit-form ═════════════════════════════════════════════════ */

export const resetAuditForm = {
  seo: { title: "Reset Audit form | Boss Clinician", description: resetAudit.seo.description },
  formSlug: "reset-audit",
  eyebrow: "Get the Free Audit",
  title: "Ready to reset your practice?",
  body: "Enter your name and email and we'll send the free fillable PDF straight to your inbox.",
  submit: "AUDIT MY PRACTICE NOW",
  redirectTo: "/practice-reset-audit-ty",
} as const;

/* ══ /practice-reset-audit-ty ══════════════════════════════════════════ */

export const practiceResetAuditTy = {
  seo: {
    title: "Your Practice Reset Audit Is On Its Way | Boss Clinician",
    description: "Your free Practice Reset Audit is heading to your inbox. Here is what to do next.",
  },
  eyebrow: "Boss Clinician",
  title: "Your Practice Reset Audit is on its way.",
  lede: "Check your inbox. Your free audit guide is heading there right now so you can identify exactly what is draining your time and income, and what to restructure first.",
  inboxNote: "📬 Not seeing it? Check your spam or promotions folder",
  stepsEyebrow: "Get the Most From Your Audit",
  steps: [
    {
      title: "Set aside 20 quiet minutes",
      body: "The audit works best when you answer honestly, not aspirationally. Give yourself space to look at your practice as it actually is.",
    },
    {
      title: "Complete every section",
      body: "The pattern across your answers matters more than any single one. That pattern is what shows you where to start.",
    },
    {
      title: "Pick your one starting point",
      body: "Do not try to fix everything at once. The audit will surface your biggest drain. Start there and only there.",
    },
  ],
  keepEyebrow: "Keep Building",
  links: [
    {
      eyebrow: "Free 2-Minute Quiz",
      title: "Find Your Practice Builder Type",
      body: "Discover your archetype and get 3 next steps for your exact stage →",
      href: "/practice-quiz",
    },
    {
      eyebrow: "Free Resources",
      title: "Visit the Resource Hub",
      body: "More free guides, quizzes, and tools for every stage of practice →",
      href: "/resource-hub",
    },
    {
      eyebrow: "Monthly Membership",
      title: "The Boss Clinician Lounge",
      body: "Ready to restructure with support? Strategy and community for established clinicians →",
      href: "/lounge",
    },
  ],
} as const;

/* ══ /reset-planner-form ═══════════════════════════════════════════════ */

export const resetPlannerForm = {
  seo: {
    title: "Reset Planner Form | Boss Clinician",
    description:
      "30 days to work less, earn more, and rebuild your practice your way. Get The Practice Reset Planner free.",
  },
  formSlug: "reset-planner",
  eyebrow: "Get the Free Planner",
  title: "Your 30-day reset starts here.",
  body: "Enter your name and email below and we'll deliver The Practice Reset Planner directly to your inbox — free, instant, and ready to use today.",
  submit: "RESET MY PRACTICE!",
  /** Kajabi's form had no thank-you URL; this is the form's own success line (migration 100). */
  success: "You're in. Watch your inbox — The Practice Reset Planner is on its way.",
} as const;

/* ══ /practice-planner ═════════════════════════════════════════════════ */

export const practicePlanner = {
  seo: {
    title: "Free Budget Planner for Your Profitable Practice",
    description:
      "Download the Profitable Practice Planner today to ensure financial stability in your practice. Grab your free template now to plan and grow your business with confidence!",
    image: `${IMG}/practice-planner/og.png`,
  },
  formSlug: "practice-planner",
  eyebrow: "FREE DOWNLOAD",
  title: "Profitable Practice Planner Guide",
  body: "Want to ensure you will have financial stability in your practice? Make sure to grab your free template today.",
  submit: "GRAB MY PLANNER NOW!",
  consent:
    "Bossclinician.com needs the contact information you provide to us to contact you about our products and services. You may unsubscribe from these communications at anytime. See our privacy policy for terms and conditions and to learn how we protect your data.",
  redirectTo: "/practice-planner-thank-you",
  image: `${IMG}/practice-planner/planner-hero.webp`,
  portrait: `${IMG}/practice-planner/yvette.webp`,
  socials: [
    { label: "Facebook", href: "https://www.facebook.com/yvette.hwd" },
    { label: "Instagram", href: "https://www.instagram.com/profitwithyvette" },
  ],
} as const;

/* ══ Fully Booked upsell (practice-planner-thank-you, protectionpackthanks) ═ */

const FULLY_BOOKED_UPSELL_BODY = [
  "But before you go, I want to give you the opportunity to take your private practice from visible to fully booked with The Fully Booked Toolkit.",
  "Inside this powerful toolkit, you’ll get my From Profile to Profit Guide and Client Consultation Call Script —everything you need to attract your ideal clients and confidently convert inquiries into paid sessions.",
  "Start today and get the proven tools and scripts to help you fill your calendar with dream clients—without the stress or guesswork!",
] as const;

/**
 * Kajabi's "$67" button pointed at landing page 2151009693, which now 404s on
 * Kajabi; the $67 Fully Booked Toolkit offer's checkout is what it sold.
 */
const FULLY_BOOKED_CHECKOUT = "/checkout/fully-booked-toolkit";

/* ══ /practice-planner-thank-you ═══════════════════════════════════════ */

export const practicePlannerThankYou = {
  seo: {
    title: "Get Your Private Practice Planner Here",
    description:
      "Congratulations on unlocking your Practice Planner! You’re just a step away from scaling and protecting your practice. Check your inbox for the guide, and don’t forget to grab the Fully Booked Toolkit!",
    image: `${IMG}/thank-you-pages/og-pack.png`,
  },
  upsell: {
    eyebrow: "WAIT BEFORE YOU GO...",
    title: "Want More Support to have consistent dream clients on your calendar?",
    unlocked: "🎉 You now have access to The Profitable Practice Planner guide! 🎉",
    body: FULLY_BOOKED_UPSELL_BODY,
    cta: { label: "YES! GET ME FULLY BOOKED >> FOR JUST $67", href: FULLY_BOOKED_CHECKOUT },
  },
  banner: "Woohoo! Your Practice Just Got Financially Real!",
  image: `${IMG}/thank-you-pages/celebrate.webp`,
  confirm: {
    title: "Your Profitable Practice Planner Is All Yours!",
    paragraphs: [
      "You now have the tool to plan your practice finances with clarity and confidence—no more guessing your numbers or hoping it all works out. 🎉",
      "Check your inbox to download your planner and start mapping out a practice that supports your income, goals, and lifestyle.",
      "(Don’t see it after a few minutes? Try checking your Junk or Spam folder!)",
    ],
  },
} as const;

/* ══ /protectionpackthanks ═════════════════════════════════════════════ */

export const protectionPackThanks = {
  seo: {
    title: "Get Your Protection Pack Is Here",
    description:
      "Congratulations on unlocking your Practice Protection Pack! You’re just a step away from scaling and protecting your practice. Check your inbox for the pack, and don’t forget to join the Profitable Private Practice Starter Leap Academy!",
    image: `${IMG}/thank-you-pages/og-pack.png`,
  },
  upsell: {
    eyebrow: "WAIT BEFORE YOU GO...",
    title: "Want More Support to Build Your Private Practice?",
    unlocked: "🎉 You now have access to The Practice Protection Pack! 🎉",
    body: FULLY_BOOKED_UPSELL_BODY,
    cta: { label: "YES! GET ME FULLY BOOKED >> FOR JUST $67", href: FULLY_BOOKED_CHECKOUT },
  },
  banner: "YESSSSS!!!!!!.. YOUR PRACTICE IS PROTECTED",
  image: `${IMG}/thank-you-pages/celebrate.webp`,
  confirm: {
    title: "Your Practice Protection Pack Is All Yours!",
    paragraphs: [
      "Your days of scrambling to create forms from scratch and worrying about legal compliance are over! 🎉",
      "Check your inbox to download your Practice Protection Pack and start using lawyer-reviewed, ready-to-go forms that will keep your practice organized, secure, and stress-free.",
      "(Don’t see it after a few minutes? Try checking your Junk or Spam folder!)",
    ],
  },
  library: { label: "Open the Pack in My Library", href: "/library/private-practice-protection-pack" },
} as const;

/* ══ Short purchase confirmations ══════════════════════════════════════ */

export interface SimpleThankYou {
  seo: { title: string; description?: string; image?: string };
  title: string;
  paragraphs: readonly string[];
  signoff?: string;
  cta?: { label: string; href: string };
  image?: { src: string; alt: string };
}

export const credentialKitConfirmed: SimpleThankYou = {
  seo: {
    title: "Your Guide Is On Its Way!",
    description:
      "Check your email for your guide. If you don’t see it soon, check your spam folder to ensure you don’t miss out!",
    image: `${IMG}/thank-you-pages/og-guide.png`,
  },
  title: "Thank You!",
  paragraphs: [
    "Thank you for purchasing the Credential with Confidence Kit.",
    "A link has been sent to your email address for instant access.",
  ],
  signoff: "To much success!",
  cta: { label: "Open the Kit in My Library", href: "/library/credential-with-confidence" },
  image: {
    src: `${IMG}/thank-you-pages/credential-kit.webp`,
    alt: "The Credential with Confidence Kit: credentialing checklist, course and The Boss Biller Blueprint",
  },
};

export const thankYouAuditProof: SimpleThankYou = {
  seo: {
    title: "You are Registered For The Live Training",
    description:
      "Check your email for more information. If you don’t see it soon, check your spam folder to ensure you don’t miss out!",
    image: `${IMG}/thank-you-pages/og-guide.png`,
  },
  title: "Thank You!",
  paragraphs: [
    "Thank you for registering the Live Interactive CEU training to help you Audit Proof Your Practice!",
    "You will receive emails leading up to the training!",
    "Please check you spam folder if you did not receive an email",
  ],
  signoff: "To much success!",
};

export const thankYouFullyBooked: SimpleThankYou = {
  seo: {
    title: "Your Guide Is On Its Way!",
    description:
      "Check your email for your guide. If you don’t see it soon, check your spam folder to ensure you don’t miss out!",
    image: `${IMG}/thank-you-pages/og-guide.png`,
  },
  title: "Thank You!",
  paragraphs: [
    "Thank you for purchasing the Fully Booked Therapist Toolkit.",
    "Click the DOWNLOAD NOW button below to get started!",
    "A link has also been sent to your email address.",
  ],
  signoff: "To much success!",
  cta: { label: "DOWNLOAD NOW!", href: "/library/fully-booked-toolkit" },
};

/**
 * Kajabi's copy on this page named the Fully Booked Therapist Toolkit — a
 * template carried over from /thank-you-fullybooked and never edited. Corrected
 * here to name what was actually bought; the button opens it.
 */
export const thankYouRateRenegotiate: SimpleThankYou = {
  seo: {
    title: "Your Letter Templates Are On Its Way!",
    description:
      "Check your email for your letter templates. If you don’t see it soon, check your spam folder to ensure you don’t miss out!",
    image: `${IMG}/thank-you-pages/og-guide.png`,
  },
  title: "Thank You!",
  paragraphs: [
    "Thank you for purchasing the Rate Negotiation Letter Templates.",
    "Click the DOWNLOAD NOW button below to get started!",
    "A link has also been sent to your email address.",
  ],
  signoff: "To much success!",
  cta: { label: "DOWNLOAD NOW!", href: "/library/rate-negotiation-letter-template" },
};

/**
 * Kajabi's /thank-you is an unedited template: its body is the theme's
 * placeholder ("[ Instruction on how to get the value… ]") and its button has no
 * destination. The heading survives; the placeholder does not, and the button
 * goes where a buyer's downloads actually are.
 */
export const genericThankYou: SimpleThankYou = {
  seo: { title: "Thank You" },
  title: "Thank You",
  paragraphs: [],
  cta: { label: "Download Now", href: "/library" },
};

/* ══ /starterconfirmed ═════════════════════════════════════════════════ */

export const starterConfirmed = {
  seo: {
    title: "Attention! Your Private Practice Starter Suite is Confirmed",
    description: "Check your email for confirmation and get your private practice started",
    image: `${IMG}/starterconfirmed/og.png`,
  },
  upsell: {
    title: "You're On The Right Path To Getting Your Practice Started… But Let’s Take It to the Next Level!",
    paragraphs: [
      "You’ve already taken a BIG step toward building your dream private practice. You’ve got access to exclusive Q&As, bonus resources, and personalized guidance.",
      "But let’s talk about the next BIG thing—getting fully booked with the right clients!",
      "Even with the best strategies, you still need a steady flow of clients . You need a foolproof system to convert potential clients into paying ones. And let’s be honest—you don’t have time to figure it all out alone.",
    ],
    /** Kajabi: /resource_redirect/landing_pages/2150414734 → its /fullybooked sales page. */
    cta: { label: "YES! GET ME FULLY BOOKED! ->", href: "/courses/fully-booked-toolkit" },
  },
  congrats: {
    title: "Congrats on saying YES to building your dream private practice!",
    body: "You just took a powerful step toward creating the freedom, flexibility, and fulfillment you deserve. We’re so excited to walk this journey with you.",
  },
  stepsTitle: "Here's Your Next Steps So You're Set Up For Success",
  /** Kajabi set these three steps as text baked into square graphics; here they are text. */
  steps: [
    {
      number: "01",
      title: "Check Your Email",
      paragraphs: [
        "I mean it when I say that this Starter Suite isn’t just a collection of resources — it’s the launchpad for the private practice you’ve been dreaming of. But this transformation can only begin if you take that first step... and that starts with your access email.",
        "➡ Look out for an email from Boss Clinician with the subject line: \"Your Starter Suite Access – Let’s Get Started!\"",
      ],
    },
    {
      number: "02",
      title: "Save Your Access Link",
      paragraphs: [
        "You’ve made an incredible decision by grabbing the Starter Suite! You now have access to expert-crafted tools, step-by-step resources, and the clarity you need to confidently build your private practice from the ground up.",
        "That’s why I created the Starter Suite Dashboard — your one-stop hub for everything included in your purchase. From planning guides to pricing strategies and legal checklists, it’s all right there, waiting for you to take action.",
      ],
      action: { label: "Open My Starter Suite", href: "/library/private-practice-starter-suite" },
    },
    {
      number: "03",
      title: "INVITE A THERAPIST FRIEND",
      paragraphs: [
        "Click the button below to easily share an invite to this Private Practice Starter Suite with a colleague! 💌",
        "Think of it like collaborating on a client case together....",
        "But instead of case notes, you’ll both gain valuable insights on ways to start your practice, leave the agency, and have increased revenue. 🥂 (instead of more paperwork).",
      ],
    },
  ],
  /** Step 3's "button below" — Kajabi's invite widget, rebuilt as a share link. */
  invite: {
    label: "Invite a Therapist Friend",
    subject: "You need this Private Practice Starter Suite",
    path: "/courses/private-practice-starter-suite",
  },
  /** Kajabi: offer uTLp7Fuz, the toolkit's $67 checkout. */
  learnMore: { label: "LEARN MORE ABOUT GETTING FULLY BOOKED! >>", href: FULLY_BOOKED_CHECKOUT },
  image: {
    src: `${IMG}/starterconfirmed/fully-booked.webp`,
    alt: "Three therapists laughing together on a sofa",
  },
} as const;

/* ══ /the-club-ty ══════════════════════════════════════════════════════ */

export const clubThankYou = {
  seo: { title: "You're Officially in the Club! | Boss Clinician" },
  eyebrow: "Boss Clinician Club",
  title: "You're Officially in the",
  titleAccent: "Club!",
  sub: "You just made your first boss move. Here's exactly what happens next.",
  gif: { src: `${IMG}/the-club-ty/yesss.webp`, alt: "Sherri Shepherd celebrating: YESSS", credit: "via GIPHY" },
  stepsEyebrow: "Your Next Steps",
  stepsTitle: "Here's exactly what to do next",
  steps: [
    {
      title: "Check your email",
      body: "Your confirmation and login details just landed in your inbox. Can't find it? Check spam or promotions.",
    },
    {
      title: "Log in and go to Start Here",
      body: "Your first stop inside the Club is the Start Here section of The Boss Move. Complete every lesson there before moving into any other module, including your onboarding survey and your introduction to the community. This is your foundation. Everything after it builds on top.",
      action: { label: "Log In to Your Portal", href: "/library" },
    },
    {
      title: "Book your Kickstart Call",
      body: "As a Club member, you get a personal 15-minute call with me before you dive in. Come with the one thing loudest in your head about starting this practice. You'll leave knowing your first three moves.",
      action: {
        label: "Book Your Kickstart Call",
        href: "/book-a-call/boss-move-kickstart-call",
      },
    },
    {
      title: "Introduce yourself in the community",
      body: "Post your name, your specialty, and where you're starting from: never seen a client yet, coming back to private practice, or already seeing clients without a structure underneath you. Your cohort is building right alongside you, and nobody in this room is starting from a place you need to explain or defend.",
    },
  ],
  bonusesTitle: "Your bonuses are already unlocked",
  bonuses: [
    { name: "The Therapist Niche Clarity Accelerator", rest: " — find it in your course library now." },
    { name: "The Boss Move Kickstart Call", rest: " — book it in Step 3 above." },
    { name: "The Ramp-Up Rate Pricing Formula", rest: " (fast action enrollees) — find it in your course library now." },
  ],
  pace: {
    label: "A note on pace:",
    body: "Some of you will move fast. Some of you will build steadily, and that is exactly right too. There is no clock running against you here. Just a roadmap, a coach, and a cohort of clinicians building right alongside you. Take Start Here one lesson at a time, and the rest will follow.",
  },
  closing: [
    "You didn't just enroll in a program. You made the decision to stop waiting and start building. That's the hardest part, and you already did it.",
    "We're glad you're here. Let's make your move.",
  ],
  signature: "Yvette",
} as const;

/* ══ /link-in-bio ══════════════════════════════════════════════════════ */

export const linkInBio = {
  seo: {
    title: "Yvette Howard, LCSW | Boss Clinician",
    description:
      "Private Practice Strategist helping therapists build profitable, sustainable practices. Find your resources, offers, and next step here.",
  },
  portrait: { src: `${IMG}/link-in-bio/yvette.webp`, alt: "Yvette Howard, LCSW" },
  title: "Build a private practice you can actually stay in.",
  name: "Yvette Howard, LCSW",
  handle: "@bossclinician",
  bio: "Helping therapists build private practices that support their income, energy, life, and future, without requiring them to max themselves out to maintain them.",
  credentials: ["LCSW", "Group Practice Owner", "Doctoral Candidate"],
  tagline: "Build it. Sustain it. Lead it. Leave it on your terms.",
  intro:
    "Whether you're building your practice, making an established practice more sustainable, or learning to lead a growing team, start with the stage you're in now.",
  groups: [
    {
      heading: "Start Here",
      links: [
        {
          glyph: "📋",
          eyebrow: "Live Training · Sept 25",
          title: "Documentation That Protects Your Practice",
          body: "Live CE training on 9/25. Save your seat before it fills.",
          href: "/doc-registration",
        },
        {
          glyph: "🎥",
          eyebrow: "Free Masterclass:",
          title: "Create a Private Practice That Supports Your Income, Energy & Future",
          body: "For established therapists who don't want to see 25 to 30 clients forever. Includes the Practice Freedom Audit.",
          href: "/freedom-masterclass",
        },
        {
          glyph: "🧠",
          eyebrow: "Free Quiz",
          title: "Is Your Practice Set Up to Pay You, or Just Keep You Busy?",
          body: "2 minutes. Find out what stage your practice is in and what to focus on next.",
          href: "/practice-quiz",
        },
      ],
    },
    {
      heading: "Work With Me",
      links: [
        {
          glyph: "🌱",
          eyebrow: "Build It",
          title: "Boss Clinician Club",
          body: "Build a private practice you won't have to undo later. 6-month program for therapists building or rebuilding their private practice foundation.",
          href: "/club",
        },
        {
          glyph: "💜",
          eyebrow: "Sustain It",
          title: "Boss Clinician Lounge",
          body: "Make the practice you already built work better for the life you actually want. Monthly membership for established therapists ready to create more income, capacity, freedom, and sustainability.",
          href: "/lounge",
        },
        {
          glyph: "👑",
          eyebrow: "Lead It",
          title: "Boss Clinician Boardroom",
          body: "Build a practice that can grow beyond you. Strategic mastermind for group practice owners ready to lead with stronger systems, structure, and less owner dependence.",
          href: "/boardroom",
        },
      ],
    },
    {
      heading: "Free Resources",
      links: [
        {
          glyph: "📚",
          title: "Free Resource Hub",
          body: "Free resources for every stage of practice: Build It, Sustain It, or Lead It.",
          href: "/resource-hub",
        },
        {
          glyph: "📋",
          title: "Free Group Practice Self-Assessment",
          body: "See where your group practice is still too dependent on you, and what needs strengthening next.",
          href: "/boss-assessment",
        },
      ],
    },
    {
      heading: "About",
      links: [
        {
          glyph: "👋🏾",
          title: "My Story",
          body: "From dialysis social worker to multi-six-figure group practice",
          href: "/about",
        },
      ],
    },
  ],
  testimonialsHeading: "What Clinicians Say",
  testimonials: [
    {
      quote:
        "\"Yvette helped me launch my private practice while still working full-time. Within weeks I was seeing clients and bringing in consistent extra income. That income gave me the confidence to leave my 9 to 5 and go full-time in my own practice.\"",
      initial: "K",
      name: "Kristan L., LCSW",
      practice: "Intentional Focus Health and Wellness",
    },
    {
      quote:
        "\"With Yvette's support and guidance I was able to shift into my journey in private practice. She kept me accountable with clear, realistic goals and provided exactly the resources I needed.\"",
      initial: "R",
      name: "Rosa M., LCSW",
      practice: "Follow Your Path Therapy Services",
    },
    {
      quote:
        "\"Working with Yvette has been a game changer for my private practice. She supported me through my doubts, provided exactly the resources I needed, and kept me accountable with clear, realistic goals.\"",
      initial: "M",
      name: "Michael M., LPC",
      practice: "Mike Counseling",
    },
    {
      quote:
        "\"Once I took the time to set up my business legally and got clear on my pricing and structure, I felt like a true CEO. Everything became easier.\"",
      initial: "S",
      name: "Sharon S., LPC",
      practice: "Stilwaters Counseling",
    },
  ],
  about: {
    eyebrow: "About Yvette",
    name: "Yvette Howard, LCSW",
    role: "Private Practice Strategist · Boss Clinician",
    body: "I started my private practice in 2018 while working in dialysis and took it full-time in 2019. I went on to build a multi-six-figure group practice, and learned firsthand that revenue alone does not create freedom. Today, I help therapists build businesses that support their income, energy, life, and future instead of requiring them to stay maxed out forever.",
  },
  socials: [
    { label: "📷 Instagram", href: "https://instagram.com/bossclinician" },
    { label: "Facebook", href: "https://facebook.com/yvette.hwd" },
    { label: "Threads", href: "https://threads.net/@bossclinician" },
  ],
  policies: [
    { label: "Privacy Policy", to: "/privacy-policy" },
    { label: "Terms of Use", to: "/terms-of-use" },
    { label: "Financial Disclaimer", to: "/financial-disclaimer" },
    { label: "Disclaimer", to: "/disclaimer" },
  ],
} as const;

/* ══ /next-steps-consult ═══════════════════════════════════════════════ */

const NSC = `${IMG}/next-steps-consult`;
const COACHING_PORTAL = "/coaching";

export const nextStepsConsult = {
  seo: { title: "BC Consulting Next Steps | Boss Clinician" },
  title: "Woohoo! You're in! 🔥",
  sub: "So excited to work with you!!",
  portrait: { src: `${NSC}/yvette.webp`, alt: "Yvette Howard, LCSW" },
  intro: "Here’s What to do next to get your practice to where you want it to be…",
  steps: [
    {
      number: "STEP 1:",
      title: "Review and Sign Your Coaching Agreement",
      icon: `${NSC}/icon-contract.webp`,
      paragraphs: [
        "This is your official agreement with Boss Clinician, LLC and outlines everything you need to know about how we work together — communication, payments, confidentiality, and program expectations.",
        "Please read through the full agreement carefully, then sign and return it before we get started. This keeps us both protected and sets the foundation for a strong partnership.",
        "Once signed, hold onto a copy for your records.",
      ],
      action: { label: "Review and Sign Contract Here", href: "https://form.jotform.com/261546887220058" },
    },
    {
      number: "STEP 2:",
      title: "Connect With Me on Voxer",
      icon: `${NSC}/icon-voxer.webp`,
      paragraphs: [
        "This is where we’ll stay connected between sessions. You’ll use Voxer to send updates, questions, wins, or anything you need coaching support on in real time. It’s your direct line to me throughout our time together.",
        "Once you connect, send a quick “hello” so I know you’re inside.",
      ],
      action: { label: "Connect with me on Voxer", href: "https://web.voxer.com/u?username=independentmind" },
    },
    {
      number: "STEP 3:",
      title: "Log Into Your Coaching Portal",
      icon: `${NSC}/icon-portal.webp`,
      paragraphs: [
        "Your portal is your home base. This is where you’ll access your contract, session notes, upcoming call details, call replays, coaching check-ins, and all program resources.",
      ],
      portalLabel: "Portal Login:",
      after: "Go ahead and bookmark this page — you’ll use it throughout the program.",
      action: { label: "Log in to your portal", href: COACHING_PORTAL },
    },
    {
      number: "STEP 4:",
      title: "Complete Your Clarity & Alignment Questionnaire",
      icon: `${NSC}/icon-questionnaire.webp`,
      paragraphs: [
        "This questionnaire is the foundation of our work together. It gives me a clear picture of where you are right now and where you want to be, so I can build your customized plan.",
        "Take your time and be honest. This is for you .",
        "Please check your email for the link.",
      ],
    },
    {
      number: "STEP 5:",
      title: "Schedule Your First Coaching Call",
      icon: `${NSC}/icon-call.webp`,
      paragraphs: [
        "Once your audit is submitted, you can schedule your first call directly inside the coaching portal. You’re welcome to schedule all sessions upfront or one at a time — choose whatever rhythm supports you best.",
      ],
      action: { label: "Schedule your first call", href: COACHING_PORTAL },
    },
  ],
  note: {
    title: "📌 Please note:",
    body: "Calls require 24 hours’ notice for rescheduling. Any missed or late-canceled sessions (under 24 hours) count as a missed call. This policy protects your time, my time, and the momentum we’re building together.",
  },
  bonus: {
    icon: `${NSC}/icon-guide.webp`,
    title: "Bonus: Download your free Psychology Today Profile Guide",
    action: { label: "Download Your Guide Here", href: "/downloads/pages/psychology-today-profile-guide.pdf" },
  },
  here: {
    avatar: { src: `${NSC}/yvette-avatar.webp`, alt: "Yvette Howard" },
    title: "I’m Here For You Every Step of the Way",
    lead: "If you need anything at all, simply message me on Voxer or DM me on instagram at ",
    handle: { label: "@profitwithyvette", href: "https://www.instagram.com/profitwithyvette" },
    paragraphs: [
      "I am truly honored to support you as you step into your most aligned, profitable, powerful season yet.",
      "Let’s build this with clarity, intention, ease, and momentum.",
      "I can’t wait to see you succeed, Yvette. 🔥",
    ],
  },
  follow: {
    title: "follow me @profitwithyvette",
    href: "https://www.instagram.com/p/DQOMaJiALaT/",
    images: [1, 2, 3, 4, 5].map((n) => `${NSC}/ig-${n}.webp`),
  },
} as const;

/* ══ /masterclass-review-sheet ═════════════════════════════════════════ */

export const masterclassReview = {
  seo: {
    title: "Share Your Masterclass Experience – Profitable Private Practice",
    description:
      "Thank you for joining Yvette's masterclass on transitioning into private practice without social media. Share your feedback on how this session has inspired you to start or grow your practice. Your insights help us refine our resources for therapists like you!",
    image: `${IMG}/masterclass-review-sheet/og.png`,
  },
  title: "I’d Love to Hear What Shifted for You",
  paragraphs: [
    "Thank you for taking the time to watch How to Create a Private Practice That Supports Your Income, Energy and Future — Without Seeing 25–30 Clients Forever.",
    "This masterclass was created for clinicians who have already built the practice — and are now asking whether the way they’re running it is something they actually want to maintain long-term.",
    "I’d love to hear what stood out to you, what made you think differently about your practice, and what you’re ready to change next.",
    "Your feedback helps me continue improving this training, but it also helps other therapists recognize themselves in these conversations. Sometimes hearing another clinician say, “I thought it was just me,” is exactly what helps someone realize their practice may need to be built differently too.",
    "You don’t need to have made a huge change yet. An aha moment, a new decision, or simply seeing your practice differently is valuable.",
    "This not only helps us continue to deliver FREE strategies to genuinely help therapists like you but also encourages other therapists to invest their time in valuable learning experiences.",
    "Thank you so much for your contribution and for being part of this journey. Your feedback is crucial in helping us create more impactful resources tailored to your needs.",
  ],
  signoff: ["Cheering you on always,", "Yvette"],
  portrait: { src: `${IMG}/masterclass-review-sheet/yvette.webp`, alt: "Yvette Howard, LCSW" },
  formTitle: "I would love to get your feedback! Please share your thoughts below",
  formSlug: "masterclass-review",
  submit: "Submit",
  /** Kajabi assessment 2148148279's closing screen. */
  thanks: [
    "Thank you for sharing your experience with me. I read these. And I genuinely appreciate you taking the time to reflect on what this brought up for you and your practice.",
    "Cheering you on! Yvette ❤️",
  ],
} as const;

/** Kajabi assessment 2148148279, question for question. Keys match migration 100. */
export const MASTERCLASS_REVIEW_FIELDS = [
  {
    key: "credentials",
    label:
      "First Name, Last Name (or Last Name Initial) and Credentials (LCSW. LMFT, LPC, PMHNP, etc.) Private practice/business name (optional)",
    type: "textarea",
    required: true,
  },
  {
    key: "hardest_before",
    label: "Before watching the masterclass, what felt hardest about the way your practice was currently running?",
    type: "textarea",
    required: true,
  },
  {
    key: "aha_moment",
    label: "What was your biggest “aha” moment from the masterclass?",
    type: "textarea",
    required: true,
  },
  {
    key: "sustainability_confidence",
    label:
      "After today’s training, how do you feel about your ability to make your current practice more sustainable?",
    type: "radio",
    required: true,
    options: [
      "Much more confident",
      "Somewhat more confident",
      "I have more clarity, but still need support",
      "I know something needs to change, but I’m not sure where to start",
      "I still feel overwhelmed by what needs to change",
    ],
  },
  {
    key: "ready_to_change",
    label:
      "What is one thing you’re now ready to change, reduce, simplify, or look at differently in your practice?",
    type: "textarea",
    required: true,
  },
  {
    key: "advice_to_therapist",
    label:
      "What would you say to another therapist who is fully booked or successful on paper, but knows they don’t want to keep working this way forever?",
    type: "textarea",
    required: true,
  },
  {
    key: "testimonial_permission",
    label: "May we use your comments as a testimonial?",
    type: "radio",
    required: true,
    options: [
      "Yes, you may use my first name, credentials, and feedback.",
      "Yes, but please use my first name only.",
      "Yes, but please keep my feedback anonymous.",
      "No, please keep my feedback private.",
    ],
  },
  { key: "name", label: "Full Name", type: "text", required: true, autoComplete: "name", half: true },
  { key: "email", label: "Email", type: "email", required: true, half: true },
] as const;
