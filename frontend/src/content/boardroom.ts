/**
 * The Boardroom — the mastermind's own sales page. The copy.
 *
 * Transcribed from the page Yvette designed for it
 * (boss-clinician-boardroom.yvette728001.chatgpt.site, 27 September 2026), band
 * by band and in the page's own order: hero → the statement → the CEO-decision
 * questions → the four things the room works on → the two ways in → what
 * happens inside → the CEO Council → her note → who it is for → only six seats
 * → the closing call → the application.
 *
 * Nothing here is paraphrased. Her apostrophes are mostly straight and her
 * quotation marks curly, and both are kept exactly as she typed them — "you’ll"
 * in the Council paragraph is the one curly apostrophe on her page, and it
 * stays curly. The only words that are not hers are the ones her page never
 * needed because it never sent anything: the thank-you shown after a real
 * submission, and the message shown when one fails.
 *
 * Her page carried its own fixed top bar and footer. On this site the shared
 * header and footer do that job, so her bar survives only as the three in-page
 * links (`subnav`) and the footer is dropped.
 */

/**
 * The form the application posts to. Created by migration
 * 074_boardroom_page.sql with exactly the keys, types and required flags listed
 * in `application.steps` below — the server validates every reply against that
 * row, so the two lists have to be changed together.
 */
export const BOARDROOM_FORM_SLUG = "boardroom-application";

/**
 * Where to write when sending fails. Named by the owner for this page rather
 * than taken from `contactPage.email`, which is the general enquiries address.
 */
export const BOARDROOM_FALLBACK_EMAIL = "bossclinician@gmail.com";

export interface BoardroomPhoto {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * One question of the application.
 *
 * The types are the form builder's own (services/formLogic.ts), because each
 * of these becomes a stored question on the `boardroom-application` form and an
 * answer she can read in the admin under the same label.
 */
export type ApplicationFieldType =
  | "text"
  | "email"
  | "textarea"
  | "select"
  | "number"
  | "checkboxes"
  | "checkbox";

export interface ApplicationField {
  /** The key the answer is filed under. Must match the migration. */
  key: string;
  label: string;
  type: ApplicationFieldType;
  required: boolean;
  options?: readonly string[];
  placeholder?: string;
  /** The small grey line after a tick-any question: "Select all that apply." */
  hint?: string;
  autoComplete?: string;
  /** Number questions only. */
  min?: number;
  /** A required tick-any question's refusal when nothing is ticked. */
  groupError?: string;
}

export interface ApplicationStep {
  legend: string;
  fields: readonly ApplicationField[];
}

const SELECT_ALL = "Select all that apply.";

/**
 * The six steps of the application, in her order, with her labels and her
 * choices. Typed as the interface rather than left to `as const` so a question
 * without a hint or a placeholder reads as `undefined`, not as a type error.
 */
const APPLICATION_STEPS: readonly ApplicationStep[] = [
  {
    legend: "Let's start with you.",
    fields: [
      { key: "name", label: "Full name", type: "text", required: true, autoComplete: "name" },
      {
        key: "email",
        label: "Email address",
        type: "email",
        required: true,
        autoComplete: "email",
      },
      { key: "practice", label: "Practice name", type: "text", required: true },
      {
        // Optional here and on the stored form; required only when the
        // follow-up question below is answered "Instagram/Facebook", which
        // the page checks on submit exactly as her page did.
        key: "social_profile",
        label: "Instagram handle or Facebook profile link",
        type: "text",
        required: false,
        placeholder: "@yourhandle or https://facebook.com/yourprofile",
      },
    ],
  },
  {
    legend: "Where is your practice now?",
    fields: [
      {
        key: "stage",
        label: "Which best describes your current stage?",
        type: "select",
        required: true,
        options: [
          "Established solo practice preparing to hire within 3–6 months",
          "Recently made my first hire",
          "2–4 team members",
          "5–9 team members",
          "10+ team members",
        ],
      },
      {
        key: "experience",
        label:
          "How long have you been in private practice, and how long has it been your primary income?",
        type: "textarea",
        required: true,
      },
      {
        key: "revenue",
        label: "Approximate annual practice revenue",
        type: "select",
        required: true,
        options: [
          "Under $150K",
          "$150K–$249K",
          "$250K–$499K",
          "$500K–$749K",
          "$750K–$999K",
          "$1M+",
          "Prefer to discuss privately",
        ],
      },
    ],
  },
  {
    legend: "What needs to change?",
    fields: [
      {
        key: "driver",
        label: "What is driving your desire to grow beyond your current structure right now?",
        type: "textarea",
        required: true,
      },
      {
        key: "decision",
        label: "What is the biggest decision you are currently trying to make?",
        type: "textarea",
        required: true,
      },
      {
        key: "challenge",
        label: "What is the biggest challenge in your practice right now?",
        type: "checkboxes",
        required: true,
        hint: SELECT_ALL,
        groupError: "Choose at least one challenge.",
        options: [
          "Profitability",
          "Hiring",
          "Team performance",
          "Leadership",
          "Delegation",
          "Systems or SOPs",
          "Owner pay",
          "Provider utilization",
          "Compensation or benefits",
          "Reducing my own caseload",
          "Payer mix or insurance",
          "Other",
        ],
      },
      {
        key: "sessions",
        label:
          "How many client or patient appointments do you personally provide in an average week?",
        type: "number",
        required: true,
        min: 0,
      },
    ],
  },
  {
    legend: "Let's look under the hood.",
    fields: [
      {
        key: "confidence",
        label:
          "How confident are you that you understand your revenue, expenses, profit, payroll, and owner compensation?",
        type: "select",
        required: true,
        options: [
          "Very confident",
          "Mostly confident",
          "Somewhat confident",
          "Not very confident",
          "I mostly rely on my bookkeeper or accountant",
        ],
      },
      {
        key: "absence",
        label: "If you stepped away for two weeks, what would stop, slow down, or still require you?",
        type: "textarea",
        required: true,
      },
      {
        key: "leadership",
        label:
          "What is your biggest leadership or team challenge—or your biggest concern about becoming an employer?",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    legend: "Where are you going?",
    fields: [
      {
        key: "future_role",
        label: "What do you want your role in the practice to look like 12 months from now?",
        type: "textarea",
        required: true,
      },
      {
        key: "outcome",
        label: "If The Boardroom worked exactly as you hoped, what would be different a year from now?",
        type: "textarea",
        required: true,
      },
      {
        key: "tried",
        label: "What have you already tried, and what still feels unresolved?",
        type: "textarea",
        required: true,
      },
      {
        key: "why",
        label: "Why is The Boardroom the right room for you right now?",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    legend: "Before we close.",
    fields: [
      {
        key: "readiness",
        label:
          "Our Council is a small group of mental health practice owners who share real numbers, challenge one another with care, and follow through on decisions. How do you feel about participating in that kind of room?",
        type: "select",
        required: true,
        options: [
          "I'm ready to participate fully.",
          "I'm excited and a little nervous.",
          "I'm still deciding whether this is the right season.",
        ],
      },
      {
        key: "follow_up",
        label: "How would you prefer that I follow up with you?",
        type: "select",
        required: true,
        options: ["Instagram/Facebook", "Email", "Either"],
      },
      {
        key: "payment_preference",
        label: "If invited to join, which payment options would you consider?",
        type: "checkboxes",
        required: true,
        hint: SELECT_ALL,
        groupError: "Choose at least one payment option.",
        options: [
          "Pay in full — $18,000",
          "2 payments of $9,000",
          "6 payments of $3,000",
          "12 monthly payments of $1,500",
          "I'd like to discuss the options before deciding",
        ],
      },
      {
        key: "hesitation",
        label:
          "If you received an invitation today, what—if anything—would keep you from moving forward?",
        type: "textarea",
        required: true,
        placeholder: "It's okay to say nothing.",
      },
      {
        key: "commitment",
        label:
          "I understand the 12-month investment is $18,000, and I am willing to review my actual numbers, make decisions, and participate honestly in a small peer room.",
        type: "checkbox",
        required: true,
      },
    ],
  },
];

export const boardroom = {
  seo: {
    title: "The Boardroom | Boss Clinician",
    description:
      "The Boardroom is a private business mastermind for mental health practice owners building and leading growing practices.",
    image: "/images/boardroom/boardroom-share.jpg",
  },

  /** Her fixed top bar, reduced to what the site header does not already do. */
  subnav: {
    mark: "BC",
    brand: "The Boardroom",
    links: [
      { label: "Inside", href: "#inside" },
      { label: "Who it's for", href: "#fit" },
    ],
    cta: { label: "Apply", href: "#apply" },
  },

  hero: {
    titleLead: "The",
    titleAccent: "Boardroom",
    tag: "Build a practice that can grow beyond you.",
    intro:
      "A private business mastermind for mental health practice owners building and leading growing practices.",
    cta: "Apply for The Boardroom",
    seatNote: "Only six practice owners at a time.",
    photo: {
      src: "/images/boardroom/yvette-office.webp",
      alt: "Yvette Howard seated confidently at her desk in a polished executive setting",
      width: 1024,
      height: 1536,
    } satisfies BoardroomPhoto,
    caption: {
      name: "Yvette Howard, LCSW",
      role: "Founder · CEO · Private Practice Strategist",
    },
  },

  statement: {
    eyebrow: "This is your next level",
    title: "You've built a practice that works.",
    titleAccent: "Now you're ready for the decisions that come next.",
    body: "Hiring your first provider or team member. Strengthening the team you already have. Increasing profitability. Building better systems. Creating a business that doesn't need you at the center of everything.",
  },

  questions: {
    eyebrow: "CEO decisions",
    title: "Your Next Level Requires a Different Kind of Decision",
    lede: "At some point, growing your practice stops being about getting more clients.",
    list: [
      "“Am I actually ready to hire?”",
      "“What can I afford to pay someone?”",
      "“Should I hire another provider or strengthen the capacity I already have?”",
      "“How do I train my team without everything coming back to me?”",
      "“Why is revenue growing but my take-home pay isn't?”",
      "“How do I step back without everything falling apart?”",
    ],
    callout: {
      lead: "Those aren't startup questions.",
      accent: "They're CEO decisions.",
      close: "And that's what we work through inside The Boardroom.",
    },
  },

  focus: {
    eyebrow: "Build the structure underneath the business",
    title: "You Don't Have to Figure Out Mental Health Practice Ownership Alone",
    cards: [
      {
        number: "01",
        title: "Money",
        body: "Understand what your numbers are telling you about profit, payroll, hiring, owner pay, compensation, benefits, and growth.",
      },
      {
        number: "02",
        title: "Team",
        body: "Hire well, lead well, create accountability, improve performance, and stop being the answer to every question.",
      },
      {
        number: "03",
        title: "Systems",
        body: "Build repeatable processes for hiring, onboarding, credentialing, operations, delegation, and the things currently living in your head.",
      },
      {
        number: "04",
        title: "Growth",
        body: "Make better decisions about when to hire, when to slow down, what to improve, and what the business needs next.",
      },
    ],
  },

  pathways: {
    eyebrow: "Two ways in",
    title: "How You Might Enter The Boardroom",
    paths: [
      {
        number: "01",
        title: "You're Ready to Build the Team",
        body: "Your solo practice is established. Your caseload or capacity has reached the point where doing more yourself is no longer the answer. You're actively preparing to make your first hire and want to build the team correctly from the beginning.",
        close: "You don't want to create systems you'll have to undo later.",
      },
      {
        number: "02",
        title: "You're Ready to Lead the Team",
        body: "You've already hired providers or support staff. Now you're navigating payroll, profitability, utilization, compensation, leadership, delegation, systems, and the reality that growth created a whole new set of problems.",
        close: "You don't just want a bigger practice. You want a better-run one.",
      },
    ],
  },

  inside: {
    eyebrow: "What happens inside",
    title: "Strategy, numbers, and support for the decisions that matter.",
    photo: {
      src: "/images/boardroom/ceo-dashboard.webp",
      alt: "CEO dashboard showing practice revenue, team, profitability and capacity metrics",
      width: 1536,
      height: 864,
    } satisfies BoardroomPhoto,
    /** An accordion; the first item starts open, as on her page. */
    items: [
      {
        title: "Private Boardroom Strategy Sessions",
        body: "Bring the actual decisions happening inside your business. We work through them together.",
      },
      {
        title: "The Boardroom CEO Dashboard",
        body: "See what your numbers are telling you before you hire, give a raise, add benefits, step back, or make another major move.",
      },
      {
        title: "CEO Resource Vault",
        body: "Use hiring tools, SOPs, leadership templates, credentialing systems, financial planning resources, and compensation tools when you need to implement a decision.",
      },
      {
        title: "Quarterly CEO Reviews",
        body: "Step out of the day-to-day and assess what's working, what's costing you, and what your next priority needs to be.",
      },
      {
        title: "Direct Support Between Calls",
        body: "Because sometimes you need to make the decision before the next meeting.",
      },
    ],
  },

  council: {
    /** The two lines inside the drawn seal. Decorative; hidden from readers. */
    mark: ["Your CEO", "Council"],
    eyebrow: "Every CEO needs a council",
    title: "Your CEO Council",
    body: "Every successful CEO needs trusted advisors. Inside The Boardroom, you’ll join a private council of six mental health practice owners who understand the weight of leadership. Together, we’ll review numbers, work through challenges, evaluate opportunities, and make stronger decisions for your business.",
    promise: "Trusted perspectives · Stronger decisions · Healthier businesses",
  },

  story: {
    photo: {
      src: "/images/boardroom/yvette-coach.webp",
      alt: "Yvette Howard, LCSW and private practice strategist",
      width: 1024,
      height: 1536,
    } satisfies BoardroomPhoto,
    badge: { name: "Yvette Howard, LCSW", role: "Private Practice Strategist" },
    eyebrow: "A note from Yvette",
    title: "This Is Bigger Than Building a Team",
    opening: "I know what it feels like to build the practice you thought you were supposed to want.",
    /** The paragraph whose last words are set in bold. */
    revenue: {
      lead: "I built the team. I grew the revenue. My practice eventually reached ",
      figure: "$500,000.",
    },
    after: [
      "And the year we hit our highest revenue was also the year I realized I didn't want to keep running the business the same way. The number didn't save me because the structure underneath it was still built on me.",
      "I don't want you to wait until you're exhausted, resentful, or ready to burn the whole thing down before you build differently.",
    ],
    quote: "The Boardroom is where we work on the business underneath the revenue.",
  },

  fit: {
    eyebrow: "The right room",
    title: "Who The Boardroom Is For",
    items: [
      "Your solo practice is established and you are actively preparing for your first hire, or you already have a team.",
      "You want to make decisions from your actual numbers instead of guessing.",
      "You want your practice to become less dependent on you over time.",
      "You are ready to strengthen your leadership, systems, profitability, and team.",
      "You want a small room where people understand the weight of the decisions you are making.",
    ],
    /**
     * Her page linked the Lounge on bossclinician.com. The Lounge is a page of
     * this site, so the link stays here rather than sending a reader who is
     * one step early off to another domain.
     */
    lounge: {
      lead: "Still focused primarily on building your individual caseload? ",
      link: "The Lounge is your room right now.",
      to: "/lounge",
    },
    photo: {
      src: "/images/boardroom/yvette-writing.webp",
      alt: "Yvette planning business strategy at her desk",
      width: 1024,
      height: 1536,
    } satisfies BoardroomPhoto,
  },

  six: {
    photo: {
      src: "/images/boardroom/boardroom-hero.webp",
      alt: "Six diverse practice owners collaborating around an intimate Boardroom table",
      width: 1536,
      height: 864,
    } satisfies BoardroomPhoto,
    eyebrow: "Your CEO Council",
    title: "Only Six Seats.",
    body: "Six mental health practice owners. Six businesses. Real numbers. Real decisions. No disappearing in a giant coaching program.",
    process: ["Apply", "Personal Review", "Invitation"],
    close:
      "I want to know what's happening inside your practice, so when you bring a decision to your Council, we aren't starting from zero every time.",
  },

  finalCta: {
    eyebrow: "You already built something worth protecting.",
    title: "Now let's build the leadership, numbers, systems, and team around it.",
    body: "Whether your next move is your first hire or figuring out how to lead the team you already have, you don't have to make those decisions alone.",
    cta: "Apply for The Boardroom",
  },

  application: {
    eyebrow: "Application",
    title: "There are six chairs in this room.",
    paragraphs: [
      "If you believe one may be yours, apply.",
      "I personally review each application. You do not need to have everything figured out, but you should be ready to look honestly at your numbers, leadership, systems, and the decisions shaping your next stage of growth.",
    ],
    actions: {
      back: "Back",
      next: "Continue",
      submit: "Submit application",
      sending: "Sending…",
    },
    /** Her own refusal, for a social follow-up with nowhere to follow up. */
    socialRequired:
      "Please enter your Instagram handle or Facebook profile link for social follow-up.",
    /**
     * Shown after a real submission. The body is the form's own success message
     * as the server returns it — editable in the admin — and this text only
     * stands in if that comes back empty. Built from her own lines on this page,
     * and it promises no reply time, because she never named one.
     */
    success: {
      title: "Thank you.",
      fallback:
        "Your application is in. I personally review each application, and I'll follow up with you the way you asked me to. You already built something worth protecting.",
    },
    failure: `Your application didn't go through. Please try again in a moment, or email ${BOARDROOM_FALLBACK_EMAIL} and I'll take it from there.`,
    steps: APPLICATION_STEPS,
  },
} as const;

/** The follow-up answer that makes the social profile question required. */
export const SOCIAL_FOLLOW_UP = "Instagram/Facebook";
