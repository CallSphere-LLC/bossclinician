/**
 * The Practice Set Up Quiz — questions, scoring and the four results.
 *
 * Copied verbatim from the inline script on bossclinician.com/practice-quiz
 * (the `questions` and `results` objects in its page source) and from the four
 * Kajabi form pages that quiz hands off to (/visionary-form, /careful-form,
 * /steady-form, /reluctant-form). The source strips most of its em dashes, so
 * some answers read as two clauses with no stop between them ("…income yet I'm
 * still…"). That is the live wording and it is kept as it is; correcting it is
 * a copy decision for the owner, not something to do quietly in a port.
 *
 * Every answer carries a weight for each of the four builder types. The type
 * with the highest total wins; ties go to the type listed first (V, C, S, R),
 * which is what the source's `reduce((a, b) => t[a] >= t[b] ? a : b)` does.
 */

export type BuilderType = "V" | "C" | "S" | "R";

/** Order matters: it is the tie-break. */
export const BUILDER_TYPES: readonly BuilderType[] = ["V", "C", "S", "R"];

export interface PracticeQuizAnswer {
  text: string;
  scores: Record<BuilderType, number>;
}

export interface PracticeQuizQuestion {
  /** "Income", "Operations"… — the part after "Question N of 6 · ". */
  topic: string;
  text: string;
  answers: readonly PracticeQuizAnswer[];
}

export const PRACTICE_QUIZ_QUESTIONS: readonly PracticeQuizQuestion[] = [
  {
    topic: "Income",
    text: "When you think about your income right now, which is most true?",
    answers: [
      { text: "I don't have consistent income yet I'm still figuring out how to get clients reliably", scores: { V: 3, C: 1, S: 0, R: 0 } },
      { text: "I have clients but the money still feels unpredictable some months are great, others aren't", scores: { V: 1, C: 3, S: 1, R: 0 } },
      { text: "I'm making money but after expenses I can't figure out where it all goes", scores: { V: 0, C: 1, S: 3, R: 1 } },
      { text: "I generate solid revenue but I still can't pay myself what I'm worth after payroll and overhead", scores: { V: 0, C: 0, S: 1, R: 3 } },
    ],
  },
  {
    topic: "Operations",
    text: "When something in your practice needs to get done, what usually happens?",
    answers: [
      { text: "I freeze I don't always know what to do first so tasks pile up and overwhelm me", scores: { V: 3, C: 1, S: 0, R: 0 } },
      { text: "I do it myself even when I know I should probably delegate or automate", scores: { V: 1, C: 3, S: 2, R: 1 } },
      { text: "I have some systems but they mostly live in my head, not documented anywhere", scores: { V: 0, C: 1, S: 3, R: 1 } },
      { text: "My team handles some things but they still come to me for almost every decision", scores: { V: 0, C: 0, S: 1, R: 3 } },
    ],
  },
  {
    topic: "Marketing",
    text: "How do you feel about marketing your practice right now?",
    answers: [
      { text: "Overwhelmed I know I need to market but I don't know where to start or what actually works", scores: { V: 3, C: 2, S: 0, R: 0 } },
      { text: "Inconsistent I post when I remember but there's no real strategy or system behind it", scores: { V: 1, C: 3, S: 1, R: 0 } },
      { text: "Capable but tired I've figured some things out but it takes a lot of energy to maintain", scores: { V: 0, C: 1, S: 3, R: 1 } },
      { text: "Hands-off referrals come in but I'm not sure how to scale beyond word of mouth", scores: { V: 0, C: 0, S: 1, R: 3 } },
    ],
  },
  {
    topic: "Schedule",
    text: "When it comes to your schedule, which sounds most like you?",
    answers: [
      { text: "I'm still building my caseload to where I want it consistency is the challenge", scores: { V: 3, C: 1, S: 0, R: 0 } },
      { text: "I'm fully booked but I feel like I can't ever slow down or take time off without losing income", scores: { V: 0, C: 3, S: 1, R: 0 } },
      { text: "I know I need to restructure my schedule but I don't know how to make the change without losing clients", scores: { V: 1, C: 1, S: 3, R: 1 } },
      { text: "My team's schedule keeps me busy even when I try to step back from day-to-day operations", scores: { V: 0, C: 0, S: 1, R: 3 } },
    ],
  },
  {
    topic: "Vision",
    text: "What does success look like to you right now?",
    answers: [
      { text: "Having a steady stream of aligned clients and feeling confident and grounded in my practice", scores: { V: 3, C: 1, S: 0, R: 0 } },
      { text: "Working fewer hours without sacrificing income more freedom, less sessions", scores: { V: 0, C: 3, S: 1, R: 0 } },
      { text: "A practice that runs well and makes money whether or not I'm personally seeing clients", scores: { V: 0, C: 1, S: 3, R: 1 } },
      { text: "Leading a team and a business I'm genuinely proud of without the constant overwhelm", scores: { V: 0, C: 0, S: 1, R: 3 } },
    ],
  },
  {
    topic: "Biggest Block",
    text: "What's the one thing holding you back the most right now?",
    answers: [
      { text: "I don't know what to do next or what order to do it in I need a clear roadmap", scores: { V: 3, C: 1, S: 0, R: 0 } },
      { text: "I know what I need to do but I can't seem to do it consistently or alone", scores: { V: 1, C: 3, S: 1, R: 0 } },
      { text: "I've built something real but the structure underneath is shaky it can't hold more weight", scores: { V: 0, C: 1, S: 3, R: 1 } },
      { text: "I've outgrown the solo clinician version of this and I need a completely new playbook", scores: { V: 0, C: 0, S: 1, R: 3 } },
    ],
  },
];

export interface PracticeQuizStep {
  bold: string;
  text: string;
}

export interface PracticeQuizResult {
  tag: string;
  archetype: string;
  tagline: string;
  what: string;
  desc: string;
  steps: readonly PracticeQuizStep[];
  offerName: string;
  offerDesc: string;
  offerBtn: string;
  /**
   * Internal routes in place of the source's absolute bossclinician.com links,
   * so nothing on the result screen sends the visitor back to the old site.
   * Careful Clinician's source link is /offer-quiz, the second Kajabi quiz,
   * which now runs on this site at the same address (pages/kajabi/quizzes).
   */
  offerLink: string;
  /** The form this result's lead is filed under (migration 091). */
  formSlug: string;
}

export const PRACTICE_QUIZ_RESULTS: Record<BuilderType, PracticeQuizResult> = {
  V: {
    tag: "Your Practice Builder Type",
    archetype: "The Visionary Builder",
    tagline: "You can see exactly where you want to go. The gap is in the foundation.",
    what: "You have a clear vision for your practice. What's missing is the structural foundation that turns that vision into something consistent and profitable.",
    desc: "You're not behind. You're building. And the right framework right now will save you years of guessing, second-guessing, and starting over. You don't need more information you need a structured path that builds on itself, with someone who has already walked the road you're on.",
    steps: [
      { bold: "Get your foundation right from day one.", text: "Niche, pricing, marketing, and systems in the right order. Not all at once." },
      { bold: "Stop building in isolation.", text: "You need a community of clinicians at the same stage so you're not guessing alone." },
      { bold: "Build toward sustainability from the start.", text: "Not just getting clients building a practice you can sustain for years without burning out." },
    ],
    offerName: "Boss Clinician Club",
    offerDesc: "A 6-month structured coaching program for clinicians who are done guessing and ready to build their foundation the right way. Biweekly coaching calls, monthly growth kits, and a community of clinicians navigating the same season.",
    offerBtn: "Join the Boss Clinician Club →",
    offerLink: "/club",
    formSlug: "quiz-visionary",
  },
  C: {
    tag: "Your Practice Builder Type",
    archetype: "The Careful Clinician",
    tagline: "You're excellent at the clinical work. The business side still feels uncertain.",
    what: "You show up for your clients with excellence. But the business decisions pricing, marketing, systems, positioning still feel shaky or more overwhelming than they should.",
    desc: "You're not lacking in talent or dedication. You're lacking in business infrastructure and the consistent support to execute on what you already know. You know what you need to do. What you're missing is a structure that holds you accountable and a community that keeps you moving forward even when motivation runs low.",
    steps: [
      { bold: "Stop relying on motivation build a system instead.", text: "Consistency comes from structure, not inspiration. Build the container first." },
      { bold: "Raise your rates and stop trading time for money alone.", text: "A full caseload at low rates is not financial peace. That math will never work." },
      { bold: "Get into community.", text: "You need people building at your level not ahead of you or behind you. Your exact season." },
    ],
    offerName: "Boss Clinician Club or Lounge",
    offerDesc: "If you're still building your foundation, the Club gives you structure and curriculum. If you're established and just need monthly strategy and accountability, the Lounge is your level. Take the full offer quiz to find out which fits.",
    offerBtn: "Find Your Right Offer →",
    offerLink: "/offer-quiz",
    formSlug: "quiz-careful",
  },
  S: {
    tag: "Your Practice Builder Type",
    archetype: "The Steady Grower",
    tagline: "You've built something real. Now it needs restructuring to grow without costing you.",
    what: "You have a practice. You have clients. You have income. But the pace is unsustainable and the structure underneath isn't built for where you want to go next.",
    desc: "You're not starting over you're leveling up. The work now is optimization, not creation. You've proven you can build. The question is whether what you've built can hold the next level of growth without breaking down or breaking you. The answer is yes. But not without restructuring the foundation it's sitting on.",
    steps: [
      { bold: "Restructure before you scale.", text: "\"You cannot scale on top of a broken structure.\" Audit what's actually working and rebuild around it." },
      { bold: "Build scalable income streams.", text: "Stop trading all your time for money. One additional offer changes everything about your income ceiling." },
      { bold: "Protect your energy with systems.", text: "Automate, delegate, and document. The practice should run even when you're not running it." },
    ],
    offerName: "Boss Clinician Lounge",
    offerDesc: "A monthly membership for established clinicians who are ready to scale without sacrificing their life. Monthly live coaching, done-for-you strategy resources, and a community of clinicians building at your level. Member and VIP tiers available.",
    offerBtn: "Join the Boss Clinician Lounge →",
    offerLink: "/lounge",
    formSlug: "quiz-steady",
  },
  R: {
    tag: "Your Practice Builder Type",
    archetype: "The Reluctant CEO",
    tagline: "You built the team. Now you need to learn how to lead one.",
    what: "You took the leap into group practice and built something most clinicians only dream about. But nobody taught you how to lead a team, structure owner compensation, or build systems that work without you.",
    desc: "You're not doing it wrong. You're doing it alone. You've built a real business and that business now needs a real CEO. Not a therapist who also does payroll. Not a manager who also sees clients. A leader who has the strategy, the peer support, and the room to make decisions from strength instead of survival mode.",
    steps: [
      { bold: "Stop being the only one who holds everything together.", text: "Leadership infrastructure documented systems, delegated decisions is the work now." },
      { bold: "Fix your pay structure.", text: "If your team is paid and you're not, that is a structural problem not a cash flow problem." },
      { bold: "Get into a room with people at your level.", text: "You've outgrown solo clinician communities. You need peers who are also running teams." },
    ],
    offerName: "Boss Clinician Boardroom",
    offerDesc: "An exclusive annual mastermind for group practice owners who are done doing it alone. Limited to 8–12 members. Monthly strategy sessions, quarterly in-person meetups, Voxer access, and peer accountability with clinicians building at the same level.",
    offerBtn: "Apply for the Boardroom →",
    offerLink: "/boardroom",
    formSlug: "quiz-reluctant",
  },
};

/** The email gate — copy from the four Kajabi result forms (identical on all four). */
export const PRACTICE_QUIZ_GATE = {
  eyebrow: "One More Step",
  heading: "Your result is ready.",
  sub: "Enter your name and email and we will send you your personalized result plus your free action plan with 3 specific next steps for your practice builder type.",
  firstName: "First Name",
  lastName: "Last Name",
  email: "Email",
  submit: "GET MY RESULT",
  disclaimer:
    "By submitting this form you agree to receive emails from Boss Clinician, LLC. This resource is educational only and is not legal, financial, or clinical advice. You can unsubscribe anytime. See our Privacy Policy and Terms.",
} as const;

/** The fixed lines of the result screen, from the source's markup. */
export const PRACTICE_QUIZ_RESULT_COPY = {
  whatLabel: "What This Means For You",
  offerEyebrow: "Your Recommended Next Step",
  secondaryLead: "Not sure?",
  offerQuizLabel: "Take the full offer quiz →",
  /** The offer quiz, rebuilt at its Kajabi address (pages/kajabi/quizzes/OfferQuiz.tsx). */
  offerQuizHref: "/offer-quiz",
  secondaryJoin: "or",
  callLabel: "book a free Practice Alignment Call",
  callHref: "/book-a-call/practice-alignment-call",
  retake: "Take the quiz again",
  shareLabel: "Know someone who needs this?",
  instagramHref: "https://www.instagram.com/bossclinician",
} as const;

/** Sums every answered question's weights and picks the winner, ties to the earlier type. */
export function scorePracticeQuiz(picks: readonly (number | null)[]): {
  winner: BuilderType;
  totals: Record<BuilderType, number>;
} {
  const totals: Record<BuilderType, number> = { V: 0, C: 0, S: 0, R: 0 };
  PRACTICE_QUIZ_QUESTIONS.forEach((question, qi) => {
    const pick = picks[qi];
    if (pick === null || pick === undefined) return;
    const answer = question.answers[pick];
    if (!answer) return;
    for (const type of BUILDER_TYPES) totals[type] += answer.scores[type];
  });

  // Mirrors the source's reduce exactly: the running winner `a` keeps the title
  // on a tie (`t[a] >= t[b]`), so the earliest type in V, C, S, R order wins.
  let winner: BuilderType = BUILDER_TYPES[0];
  for (const type of BUILDER_TYPES.slice(1)) {
    if (!(totals[winner] >= totals[type])) winner = type;
  }
  return { winner, totals };
}
