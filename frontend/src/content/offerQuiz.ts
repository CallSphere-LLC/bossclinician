/**
 * "Which Boss Clinician Offer Is Right for You?" — the offer quiz at /offer-quiz.
 *
 * Copied verbatim from the inline script and markup on bossclinician.com/offer-quiz
 * (its `questions` and `results` objects, hero, offer strip and result card).
 * Kajabi's absolute bossclinician.com links are replaced by this site's own
 * routes; `ctaUrl` is the address line printed under the button and stays as
 * display text only.
 *
 * Every answer carries a weight for each of the three offers. The offer with
 * the highest total wins; ties go to the offer listed first (club, lounge,
 * boardroom), which is what the source's
 * `Object.keys(totals).reduce((a, b) => totals[a] >= totals[b] ? a : b)` does.
 *
 * Kajabi's quiz asks for no email ("No email required") and shows the result
 * straight away. That is kept. Under the result this site adds an optional
 * "email me my result" form, one per offer (migration 099), which files the
 * taker as a contact with the matching tag and sends them the result
 * (automation "Offer quiz result email — …", generated from this file).
 */

export type OfferKey = "club" | "lounge" | "boardroom";

/** Order matters: it is the tie-break. */
export const OFFER_KEYS: readonly OfferKey[] = ["club", "lounge", "boardroom"];

export interface OfferQuizAnswer {
  text: string;
  scores: Record<OfferKey, number>;
}

export interface OfferQuizQuestion {
  text: string;
  answers: readonly OfferQuizAnswer[];
}

export const OFFER_QUIZ_QUESTIONS: readonly OfferQuizQuestion[] = [
  {
    text: "How would you describe where you are in your private practice right now?",
    answers: [
      { text: "I'm just getting started — or starting over from agency or platform work", scores: { club: 3, lounge: 0, boardroom: 0 } },
      { text: "I've been in practice 1–3 years and I'm building momentum but need more structure", scores: { club: 2, lounge: 1, boardroom: 0 } },
      { text: "I'm fully booked but my income still feels capped — I've hit a ceiling", scores: { club: 0, lounge: 3, boardroom: 0 } },
      { text: "I have a team — I'm running a group practice and feeling stretched thin", scores: { club: 0, lounge: 0, boardroom: 3 } },
    ],
  },
  {
    text: "What is your biggest challenge in your practice right now?",
    answers: [
      { text: "I don't know what to set up first — niche, pricing, marketing, systems — it feels overwhelming", scores: { club: 3, lounge: 0, boardroom: 0 } },
      { text: "I'm seeing a full caseload but still feel financially anxious and burnt out", scores: { club: 0, lounge: 3, boardroom: 0 } },
      { text: "I'm on platforms like Alma, Headway, or Talkspace and want to build something more independently profitable", scores: { club: 1, lounge: 3, boardroom: 0 } },
      { text: "I'm managing clinicians, payroll, and operations — and I can't figure out how to step back", scores: { club: 0, lounge: 0, boardroom: 3 } },
    ],
  },
  {
    text: "How long have you been in private practice?",
    answers: [
      { text: "Less than 1 year or I haven't launched yet", scores: { club: 3, lounge: 0, boardroom: 0 } },
      { text: "1–3 years", scores: { club: 2, lounge: 2, boardroom: 0 } },
      { text: "3–6 years", scores: { club: 0, lounge: 3, boardroom: 1 } },
      { text: "More than 6 years", scores: { club: 0, lounge: 1, boardroom: 3 } },
    ],
  },
  {
    text: "Which of these sounds most like you right now?",
    answers: [
      { text: "I need someone to walk me through the foundation — I don't want to guess at what to do first", scores: { club: 3, lounge: 0, boardroom: 0 } },
      { text: "I need to work smarter, charge more, and stop trading all my time for money", scores: { club: 0, lounge: 3, boardroom: 0 } },
      { text: "I need a community of clinicians at my level who actually get what I'm building", scores: { club: 1, lounge: 2, boardroom: 2 } },
      { text: "I need peer-level strategy — I'm done figuring out team leadership and group practice alone", scores: { club: 0, lounge: 0, boardroom: 3 } },
    ],
  },
  {
    text: "What does your income situation look like right now?",
    answers: [
      { text: "I'm not generating consistent practice income yet — I'm still in early stages", scores: { club: 3, lounge: 0, boardroom: 0 } },
      { text: "I have consistent income but I know I'm leaving money on the table with my current rates and structure", scores: { club: 0, lounge: 3, boardroom: 0 } },
      { text: "I generate solid income but I can't seem to pay myself what I'm worth after covering team and overhead", scores: { club: 0, lounge: 1, boardroom: 3 } },
      { text: "My income is inconsistent and I'm not sure why — some months are great, others not", scores: { club: 1, lounge: 2, boardroom: 1 } },
    ],
  },
  {
    text: "What kind of support would move the needle most for you right now?",
    answers: [
      { text: "A structured program with clear steps, tools, and someone holding me accountable as I build", scores: { club: 3, lounge: 0, boardroom: 0 } },
      { text: "Monthly live coaching, done-for-you resources, and a community of clinicians scaling at my level", scores: { club: 0, lounge: 3, boardroom: 0 } },
      { text: "A small, exclusive mastermind where I can bring real numbers and real challenges — and leave with real plans", scores: { club: 0, lounge: 0, boardroom: 3 } },
      { text: "Honestly I'm not sure — I just know what I'm doing right now isn't working", scores: { club: 1, lounge: 2, boardroom: 1 } },
    ],
  },
];

export interface OfferQuizResult {
  tag: string;
  headline: string;
  sub: string;
  p1: string;
  p2: string;
  getLabel: string;
  getItems: readonly string[];
  ctaText: string;
  /** This site's route in place of the source's absolute bossclinician.com link. */
  ctaLink: string;
  /** The address line printed under the button on the source. Display text only. */
  ctaUrl: string;
  /** The optional "email me my result" form this result files under (migration 099). */
  formSlug: string;
}

export const OFFER_QUIZ_RESULTS: Record<OfferKey, OfferQuizResult> = {
  club: {
    tag: "6-Month Coaching Program",
    headline: "Boss Clinician Club",
    sub: "Your foundation starts here.",
    p1: "Based on your answers, you're in the building season — and what you need most right now is structure, not hustle. The Boss Clinician Club is a 6-month coaching program designed specifically for clinicians who are starting or rebuilding their practice and want to get it right from the beginning.",
    // Row 245 (21 Nov 2026): the three results now match each offer as sold.
    p2: "You'll move through the Boss Move curriculum with two live coaching calls a month, practical resources, and a community of clinicians navigating the same season. No more guessing. No more doing it alone.",
    getLabel: "What you get inside the Club",
    getItems: [
      "The Boss Move curriculum: practice foundations, business decisions, visibility, referral relationships, launch planning, and practice systems",
      "Two live coaching calls a month with Yvette, 12 coaching calls in total",
      "Checklists, trackers, templates, outreach tools, and worksheets",
      "Community access with clinicians at the same stage",
      "Natural graduation path to the Boss Clinician Lounge",
    ],
    ctaText: "Join the Boss Clinician Club",
    ctaLink: "/club",
    ctaUrl: "www.bossclinician.com/club",
    formSlug: "offer-quiz-club",
  },
  lounge: {
    tag: "Monthly Membership",
    headline: "Boss Clinician Lounge",
    sub: "Scale past the ceiling — without burning out.",
    p1: "Based on your answers, you've already built something real — and now you need a strategy for income and a workload that better support your life. The Boss Clinician Lounge is a membership for clinicians who already own a practice and want it to be more sustainable.",
    p2: "You'll get a monthly live Strategy Session with Yvette, practical tools and resources, and a community of clinicians who are in the same season — building toward something better and done doing it alone.",
    getLabel: "What you get inside the Lounge",
    getItems: [
      "One monthly 90-minute live Strategy Session with Yvette, with teaching, hot seats, and Q&A",
      "Practical tools and resources for income, caseload, systems, and time off",
      "Community access with clinicians at your level",
      "VIP tier option for personalized feedback and private strategy support",
      "Recordings and resources in the Replay Vault during active membership",
    ],
    ctaText: "Join the Boss Clinician Lounge",
    ctaLink: "/lounge",
    ctaUrl: "www.bossclinician.com/lounge",
    formSlug: "offer-quiz-lounge",
  },
  boardroom: {
    tag: "Mastermind",
    headline: "Boss Clinician Boardroom",
    sub: "Peer-level strategy for the group practice owner who's done doing it alone.",
    p1: "Based on your answers, you've built something real — a team, a practice, a vision. What you need now isn't more content or another course. You need a room full of people building at the same level, with Yvette guiding the strategy.",
    p2: "The Boss Clinician Boardroom is an application-only, 12-month mastermind for established mental health practice owners preparing for their first hire or already leading a team, who are ready to bring their real numbers, real challenges, and real goals — and leave with a real plan.",
    getLabel: "What you get inside the Boardroom",
    getItems: [
      "An intimate group of exactly six practice owners",
      "4 quarterly CEO strategy intensives, 3–4 hours each, with peer hot seats",
      "8 momentum check-ins, 60 minutes each, in the months without an intensive",
      "2 private 45-minute CEO strategy sessions during your 12-month term",
      "Up to 2 voice-note questions per month, with a response targeted within 2 business days",
      "2 guest expert sessions each year",
    ],
    ctaText: "Apply for the Boss Clinician Boardroom",
    ctaLink: "/boardroom",
    ctaUrl: "www.bossclinician.com/boardroom",
    formSlug: "offer-quiz-boardroom",
  },
};

/** The page around the quiz, from the source's markup. */
export const OFFER_QUIZ_PAGE = {
  backLabel: "← Back to Resource Hub",
  backHref: "/resource-hub",
  eyebrow: "Free 2-Minute Quiz · Boss Clinician",
  titleLead: "Which Boss Clinician Offer Is",
  titleAccent: "Right for You?",
  sub: "Answer 6 quick questions about where you are in your practice and we'll match you to the right offer — no pressure, no pitch, just clarity.",
  meta: "Free · 2 minutes · No email required",
  /** The offer strip under the hero, with the source's dot colours. */
  chips: [
    { label: "Boss Clinician Club", dot: "green" },
    { label: "Boss Clinician Lounge", dot: "purple" },
    { label: "Boss Clinician Boardroom", dot: "navy" },
  ],
  next: "Next →",
  last: "See My Result →",
  back: "← Back",
  complete: "Complete!",
  resultEyebrow: "Your Result",
  bookLead: "Not sure yet?",
  bookLabel: "Book a free Practice Alignment Call",
  bookTail: "and we'll figure it out together.",
  bookHref: "/book-a-call/practice-alignment-call",
  retake: "← Take the quiz again",
} as const;

/**
 * The optional email step under the result. Not on the source (which asks for
 * no email); worded to match the practice quiz's result forms.
 */
export const OFFER_QUIZ_EMAIL = {
  eyebrow: "Keep Your Result",
  heading: "Want this in your inbox?",
  sub: "Enter your name and email and we will send you your offer match and what's inside, so you have it when you're ready.",
  submit: "EMAIL MY RESULT",
  sent: "Sent — check your inbox (and your spam folder, just in case).",
} as const;

/** Sums every answered question's weights and picks the winner, ties to the earlier offer. */
export function scoreOfferQuiz(picks: readonly (number | null)[]): {
  winner: OfferKey;
  totals: Record<OfferKey, number>;
} {
  const totals: Record<OfferKey, number> = { club: 0, lounge: 0, boardroom: 0 };
  OFFER_QUIZ_QUESTIONS.forEach((question, qi) => {
    const pick = picks[qi];
    if (pick === null || pick === undefined) return;
    const answer = question.answers[pick];
    if (!answer) return;
    for (const key of OFFER_KEYS) totals[key] += answer.scores[key];
  });

  let winner: OfferKey = OFFER_KEYS[0];
  for (const key of OFFER_KEYS.slice(1)) {
    if (!(totals[winner] >= totals[key])) winner = key;
  }
  return { winner, totals };
}
