/**
 * Copy for the two self-scoring quizzes Kajabi ran as custom-code pages, and
 * the readiness quiz's thank-you page. Verbatim from bossclinician.com:
 *
 *  - /practice-reset-snapshot      (Boss Clinician Lounge onboarding snapshot)
 *  - /private-practice-for-you     (6-question readiness quiz)
 *  - /notyet-form, /almost-form, /ready-form (the quiz's three result opt-ins,
 *    folded into the quiz page as its last screen)
 *  - /private-practice-for-you-ty
 *
 * Scoring tables are copied from the pages' inline scripts, so a result here is
 * the result a visitor got on Kajabi for the same answers.
 */

/* ══════════════════════════════════════════════════════════════════════════
   Practice Reset Snapshot
   ══════════════════════════════════════════════════════════════════════════ */

/** A run of copy whose opening clause Kajabi set in <strong>. */
export interface BoldLead {
  strong: string;
  text: string;
}

export interface SnapshotQuestion {
  /** 1-based, as the page numbers them. */
  number: number;
  text: string;
  sub?: string;
  /** Scored questions carry 1–4; question 11 carries a direction key. */
  options: readonly { value: string; label: string }[];
}

export interface SnapshotSection {
  heading: string;
  questions: readonly SnapshotQuestion[];
}

export type SnapshotResultKey = "optimizer" | "maxedout" | "depleted";

export interface SnapshotResult {
  title: string;
  tag: string;
  lead: string;
  moves: readonly BoldLead[];
  close: BoldLead;
}

const scored = (labels: readonly [string, string, string, string]) =>
  labels.map((label, i) => ({ value: String(i + 1), label }));

export const snapshot = {
  seo: {
    title: "Practice Reset Snapshot | Boss Clinician Lounge",
    description:
      "Twelve questions. Ten minutes. Answer honestly. Your results identify your most urgent starting point and give you your first five moves inside the Lounge.",
  },
  hero: {
    eyebrow: "Boss Clinician Lounge",
    title: "Practice Reset Snapshot",
    tagline: "Your Starting Point",
    intro:
      "Twelve questions. Ten minutes. Answer honestly. Your results identify your most urgent starting point and give you your first five moves inside the Lounge.",
  },
  progressLabel: "Your Progress",
  /** Questions 1–11 must be answered; 12 is optional and never scored. */
  requiredCount: 11,
  sections: [
    {
      heading: "Section 1: Your Practice Today",
      questions: [
        {
          number: 1,
          text: "Which best describes your practice right now?",
          options: scored([
            "Fully booked or close to it, with a waitlist or steady inquiries",
            "Mostly full, but my caseload has ups and downs I cannot predict",
            "Full on paper, but a lot of my slots are low-paying or misaligned clients",
            "I have room in my caseload and want more clients",
          ]),
        },
        {
          number: 2,
          text: "How many clinical sessions do you personally deliver in a typical week?",
          options: scored(["Under 15", "15 to 22", "23 to 28", "29 or more"]),
        },
        {
          number: 3,
          text: "When you think about your current session load, which is most true?",
          options: scored([
            "It is sustainable. I could do this for years.",
            "It is manageable, but I have no margin for anything unexpected.",
            "I am tired most weeks and running on willpower.",
            "I am past my limit and something has to change soon.",
          ]),
        },
      ],
    },
    {
      heading: "Section 2: Your Income",
      questions: [
        {
          number: 4,
          text: "Do you know your real effective hourly rate?",
          sub: "What you actually keep per clinical hour after platform cuts, billing costs, and unpaid admin time.",
          options: scored([
            "Yes, I know the exact number",
            "I have a rough idea",
            "No, but I know what I bill",
            "No, and I avoid looking at my numbers",
          ]),
        },
        {
          number: 5,
          text: "What percentage of your income comes from insurance panels or platforms?",
          sub: "Alma, Headway, Grow, Rula, and similar platforms count here.",
          options: scored(["0 to 25 percent", "26 to 50 percent", "51 to 75 percent", "76 to 100 percent"]),
        },
        {
          number: 6,
          text: "When did you last raise your private pay rate?",
          options: scored([
            "Within the last 12 months",
            "1 to 2 years ago",
            "More than 2 years ago",
            "I have never raised it, or I do not have a private pay rate",
          ]),
        },
        {
          number: 7,
          text: "At the end of a typical month, which is most true about your income?",
          options: scored([
            "I pay myself a consistent salary and the practice holds a buffer",
            "I take what is left over, and the amount changes month to month",
            "I cover my bills, but there is nothing consistent left for me",
            "Some months I put my own money into the practice to keep it going",
          ]),
        },
      ],
    },
    {
      heading: "Section 3: Your Systems",
      questions: [
        {
          number: 8,
          text: "How many hours per week do you spend on unpaid admin?",
          sub: "Billing, claims, scheduling, messages, and paperwork.",
          options: scored(["Under 3 hours", "3 to 7 hours", "8 to 12 hours", "More than 12 hours"]),
        },
        {
          number: 9,
          text: "If you took two full weeks off tomorrow, what would happen to your practice?",
          options: scored([
            "It would run. My systems and support would hold things down.",
            "It would mostly hold, but a few things would pile up.",
            "Things would fall through the cracks. Nothing runs without me.",
            "I honestly cannot imagine taking two full weeks off.",
          ]),
        },
        {
          number: 10,
          text: "Who handles your billing and admin?",
          options: scored([
            "A biller, admin, or VA handles most of it",
            "Software automation handles most of it, I handle the rest",
            "I do all of it myself, but it is organized",
            "I do all of it myself, and it is held together by memory and late nights",
          ]),
        },
      ],
    },
    {
      heading: "Section 4: Your Direction",
      questions: [
        {
          number: 11,
          text: "What is the ONE thing that, if fixed in the next 90 days, would change your practice the most?",
          options: [
            { value: "rate", label: "Getting paid what my work is actually worth (rates, panels, platforms)" },
            {
              value: "systems",
              label: "Getting the operations off my plate (systems, billing, admin, hiring support)",
            },
            { value: "pay", label: "Paying myself consistently and taking real time off" },
            { value: "numbers", label: "Getting clear on my numbers so I know what to fix first" },
          ],
        },
      ],
    },
  ] satisfies readonly SnapshotSection[],
  reflection: {
    number: "Question 12 (Optional)",
    text: "Complete this sentence honestly.",
    sub: '"I built a full practice, and..."',
    placeholder:
      "Write whatever is true. Nobody sees this but you. Screenshot it or write it down. You will want it at your Transformation Checkpoint in Module 04.",
  },
  submitLabel: "See My Results",
  warning: "Answer every question above before viewing your results.",
  resultEyebrow: "Your Practice Reset Snapshot",
  movesTitle: "Your First 5 Moves",
  retakeLabel: "Retake the snapshot",
  footer: { strong: "Boss Clinician Consulting", text: "The BOSS Blueprint" },
  results: {
    optimizer: {
      title: "Maxed Out: Ready to Refine",
      tag: "Your foundation is solid. Now maximize it.",
      lead: "Your practice has real structure: your load is manageable, your systems mostly hold, and you have some command of your numbers. What you are missing is not stability. It is untapped revenue and refinement. Your work in the Lounge moves fast, and your gains come from precision.",
      moves: [
        {
          strong: "Complete the Current Model Audit",
          text: " to confirm your real effective hourly rate. Even solid practices find a gap here.",
        },
        {
          strong: "Run the Insurance Panel Audit Tracker",
          text: " on every panel you carry. Precision on effective rates is your biggest lever.",
        },
        {
          strong: "Review your rate against your income goal",
          text: " in the Design Your Model Worksheet. Confirm the math still holds.",
        },
        { strong: "Move quickly through Module 01", text: " and go deep in Module 02. That is where your growth lives." },
        { strong: "Bring your one biggest number surprise", text: " to your first monthly call." },
      ],
      close: {
        strong: "Where you are headed:",
        text: " Modules 03 and 04 will move fast for you, and the Boardroom may be your next room sooner than you think. Start with the audit anyway. Every optimized practice still has one number hiding.",
      },
    },
    maxedout: {
      title: "Maxed Out: Ready to Rebuild",
      tag: "Full practice. Broken model. This is exactly who the Lounge was built for.",
      lead: "You are working hard, your calendar proves it, and your bank account does not reflect it. That is not a discipline problem or a dedication problem. It is a structural problem, and structure can be rebuilt. The full BOSS Blueprint sequence is your path, starting with the audit that shows you exactly where the money is leaking.",
      moves: [
        {
          strong: "Complete the Current Model Audit before anything else.",
          text: " Your real number changes every decision that follows.",
        },
        {
          strong: "Complete the Attachment Style Quiz and Reflection Worksheet.",
          text: " Your patterns are quietly running your rates.",
        },
        {
          strong: "Complete the Design Your Model Worksheet.",
          text: " Your income goal and your sustainable session count, on paper.",
        },
        { strong: "Build your 90-Day Action Plan", text: " from what the audit reveals. One priority. Not five." },
        {
          strong: "Post your real effective hourly rate",
          text: " in the Module 01 community channel. Not to compare. To commit.",
        },
      ],
      close: {
        strong: "Where you are headed:",
        text: " Module 02 is where your income gets restructured, and it will be the most uncomfortable and most valuable work you do here. Go in order. The audit first.",
      },
    },
    depleted: {
      title: "Maxed Out: Ready to Reset",
      tag: "Running on empty. Structure first. Everything else second.",
      lead: "Your practice is running on you: your energy, your late nights, your willpower. That has carried you this far, and it is also exactly what is breaking. Nothing about your snapshot says you have failed. It says you have been doing the work of an entire operations team alone. The Lounge rebuilds the structure underneath you so the practice stops requiring everything you have.",
      moves: [
        {
          strong: "Watch the first lesson today:",
          text: " Why Working This Hard Still Doesn't Feel Like Enough. You need to hear it before you do anything else.",
        },
        {
          strong: "Complete the Current Model Audit with real numbers,",
          text: " even if looking feels hard. Clarity is lighter than dread.",
        },
        {
          strong: "Read the People-Pleasing in Your Practice Worksheet",
          text: " in Module 03, even before you get there. Your operations are the leak.",
        },
        {
          strong: "Complete the Design Your Model Worksheet",
          text: " with total honesty about your sustainable session count. Not the number you think you should say.",
        },
        {
          strong: "Book your hot seat for the next monthly call.",
          text: " Do not wait until you feel ready. Nobody at this stage ever feels ready. Come anyway.",
        },
      ],
      close: {
        strong: "Where you are headed:",
        text: " Module 04 is going to matter deeply for you: owner's pay, real PTO, and a calendar that protects your capacity. But the road there runs through the audit. Start today, and let the community carry some of this with you.",
      },
    },
  } satisfies Record<SnapshotResultKey, SnapshotResult>,
} as const;

/**
 * Kajabi's scoring, unchanged: questions 1–10 are worth 1–4 each (question 11
 * is direction, not scored), so the total runs 10–40.
 * ≤18 → optimizer, ≤30 → maxedout, otherwise depleted.
 */
export function scoreSnapshot(answers: Readonly<Record<number, string>>): SnapshotResultKey {
  let score = 0;
  for (let i = 1; i <= 10; i += 1) score += Number.parseInt(answers[i] ?? "0", 10) || 0;
  if (score <= 18) return "optimizer";
  if (score <= 30) return "maxedout";
  return "depleted";
}

/* ══════════════════════════════════════════════════════════════════════════
   Is Private Practice Actually Right for You Right Now?
   ══════════════════════════════════════════════════════════════════════════ */

/** N = Not Quite Yet, A = Almost Ready, R = Ready to Build (Kajabi's own key). */
export type ReadinessKey = "N" | "A" | "R";

export interface ReadinessQuestion {
  eyebrow: string;
  text: string;
  answers: readonly { text: string; scores: Record<ReadinessKey, number> }[];
}

export const readinessQuestions: readonly ReadinessQuestion[] = [
  {
    eyebrow: "Question 1 of 6 · Where You Are",
    text: "Which best describes your current work situation?",
    answers: [
      {
        text: "I work full time at an agency or group practice and private practice is still just an idea",
        scores: { N: 3, A: 1, R: 0 },
      },
      {
        text: "I work for an agency or platform but I have started taking real steps toward my own practice",
        scores: { N: 1, A: 3, R: 1 },
      },
      {
        text: "I am on a platform like Talkspace, Grow, or Headway and I am tired of splitting my income",
        scores: { N: 0, A: 2, R: 2 },
      },
      {
        text: "I have already started my practice but I am still holding on to my agency or platform work",
        scores: { N: 0, A: 1, R: 3 },
      },
    ],
  },
  {
    eyebrow: "Question 2 of 6 · Finances",
    text: "If you left your agency or platform income today, what would happen?",
    answers: [
      {
        text: "I would be in trouble fast. I do not have savings or another income stream yet",
        scores: { N: 3, A: 1, R: 0 },
      },
      { text: "I could survive a few months but it would be tight and stressful", scores: { N: 1, A: 3, R: 1 } },
      {
        text: "I have some savings and a rough plan but I have not run the actual numbers",
        scores: { N: 1, A: 2, R: 2 },
      },
      {
        text: "I have a financial cushion or existing client income that could carry me through the transition",
        scores: { N: 0, A: 1, R: 3 },
      },
    ],
  },
  {
    eyebrow: "Question 3 of 6 · Business Foundation",
    text: "How much of your business foundation is actually in place?",
    answers: [
      {
        text: "Nothing yet. I have not registered a business, picked a name, or looked into any of it",
        scores: { N: 3, A: 1, R: 0 },
      },
      { text: "I have done some research but nothing is official or set up yet", scores: { N: 2, A: 3, R: 0 } },
      {
        text: "Some pieces exist. Maybe an LLC or an NPI, but there are big gaps I know I need to fill",
        scores: { N: 0, A: 3, R: 2 },
      },
      {
        text: "Most of my foundation is set up. I mainly need clients, systems, and a real plan",
        scores: { N: 0, A: 1, R: 3 },
      },
    ],
  },
  {
    eyebrow: "Question 4 of 6 · Clients",
    text: "Be honest: if you opened your doors tomorrow, where would your clients come from?",
    answers: [
      { text: "I honestly have no idea. That question stresses me out", scores: { N: 3, A: 2, R: 0 } },
      { text: "Probably word of mouth and hoping people find me", scores: { N: 2, A: 3, R: 1 } },
      {
        text: "I have a few referral sources or a directory profile but nothing consistent",
        scores: { N: 0, A: 2, R: 2 },
      },
      {
        text: "I already have clients or strong referral relationships that would follow me",
        scores: { N: 0, A: 0, R: 3 },
      },
    ],
  },
  {
    eyebrow: "Question 5 of 6 · The Real Block",
    text: "What is actually keeping you where you are right now?",
    answers: [
      {
        text: "I do not know enough yet. The business side feels completely overwhelming",
        scores: { N: 3, A: 1, R: 0 },
      },
      {
        text: "Fear. I know more than I give myself credit for but the leap feels too risky",
        scores: { N: 1, A: 3, R: 1 },
      },
      { text: "The steady paycheck. It is not great money but it is predictable", scores: { N: 1, A: 2, R: 2 } },
      { text: "Honestly, nothing concrete. I keep waiting for a moment that never comes", scores: { N: 0, A: 1, R: 3 } },
    ],
  },
  {
    eyebrow: "Question 6 of 6 · Your Vision",
    text: "When you picture yourself one year from now, what do you see?",
    answers: [
      {
        text: "I want my own practice someday but I cannot picture the path from here to there yet",
        scores: { N: 3, A: 1, R: 0 },
      },
      {
        text: "I see myself in my own practice but I need a clear roadmap to trust the timing",
        scores: { N: 1, A: 3, R: 1 },
      },
      {
        text: "I see myself fully out of my agency or platform with my own clients and my own income",
        scores: { N: 0, A: 2, R: 3 },
      },
      {
        text: "I see a practice that is fully mine. I just need the structure to make it real",
        scores: { N: 0, A: 1, R: 3 },
      },
    ],
  },
];

/**
 * Kajabi's tally: sum each answer's N/A/R weights; ties go to the more
 * empowering result (R over A over N).
 */
export function scoreReadiness(answers: readonly (number | null)[]): ReadinessKey {
  const t: Record<ReadinessKey, number> = { N: 0, A: 0, R: 0 };
  readinessQuestions.forEach((q, qi) => {
    const pick = answers[qi];
    if (pick === null || pick === undefined) return;
    const s = q.answers[pick]?.scores;
    if (!s) return;
    t.N += s.N;
    t.A += s.A;
    t.R += s.R;
  });
  if (t.R >= t.A && t.R >= t.N) return "R";
  if (t.A >= t.N) return "A";
  return "N";
}

export const readiness = {
  seo: {
    title: "Is Private Practice Actually Right for You Right Now? | Boss Clinician",
    description:
      "An honest 2-minute quiz for therapists thinking about leaving their agency or platform. Find out if you are ready, almost ready, or what needs to happen first.",
  },
  backLabel: "← Resource Hub",
  intro: {
    eyebrow: "Free 2-Minute Quiz · Boss Clinician",
    title: "Is Private Practice Actually Right for You",
    titleAccent: "Right Now?",
    sub: "An honest quiz for therapists thinking about leaving their agency, group practice, or platform. Answer 6 quick questions and find out if you are ready, almost ready, or what needs to happen first.",
    meta: ["6 questions", "2 minutes", "An honest answer", "Your next step, clearly"],
    start: "Take the Free Quiz →",
    note: "No pressure. No judgment. Just clarity.",
  },
  back: "← Back",
  next: "Next →",
  finish: "See My Result →",
  /** The three Kajabi result opt-ins (/notyet-form, /almost-form, /ready-form). */
  capture: {
    heading: "Get Your Result is Ready!",
    submit: "Send Me My Result",
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    bodies: {
      N: "Enter your name and email and I will send you your full result plus the exact steps to take so that when you do make the leap, you land on solid ground.",
      A: "Enter your name and email and I will send you your full result plus what is standing between you and ready, and exactly how to close the gap.",
      R: "Enter your name and email and I will send you your full result plus what to do next so you build it right the first time.",
    } satisfies Record<ReadinessKey, string>,
  },
  /** Stored with the reply so Yvette can see which result each person got. */
  resultLabels: { N: "Not Quite Yet", A: "Almost Ready", R: "Ready to Build" } satisfies Record<ReadinessKey, string>,
  formSlug: "private-practice-for-you",
  thankYouPath: "/private-practice-for-you-ty",
} as const;

/* ══════════════════════════════════════════════════════════════════════════
   /private-practice-for-you-ty
   ══════════════════════════════════════════════════════════════════════════ */

export const readinessThankYou = {
  seo: {
    title: "Your Result Is On Its Way | Boss Clinician",
    description: "Your private practice readiness result and next steps are heading to your inbox.",
  },
  eyebrow: "Boss Clinician",
  title: "Your result is on its way.",
  lede: "Your private practice readiness result and your personalized next steps are heading to your inbox right now.",
  inboxNote: "📬 Check your inbox, and your spam folder just in case",
  nextHeading: "What Happens Next",
  steps: [
    {
      title: "Your result lands in your inbox",
      body: "You will see exactly where you stand and why, based on your answers.",
    },
    {
      title: "Your next steps follow",
      body: "Over the next two weeks I will share my real story, the mistakes that cost me thousands, and what to do differently.",
    },
    {
      title: "You decide what building looks like for you",
      body: "Whether that is preparing quietly, taking a small first step, or going all in with full support.",
    },
  ],
  waitHeading: "While You Wait",
  links: [
    {
      eyebrow: "Free Resources",
      title: "Visit the Resource Hub",
      body: "Free guides, audits, and tools for every stage of practice building",
      href: "/resource-hub",
    },
    {
      eyebrow: "6-Month Coaching Program",
      title: "The Boss Clinician Club",
      body: "Ready now? The full roadmap, live coaching, and community are waiting",
      href: "/club",
    },
  ],
} as const;
