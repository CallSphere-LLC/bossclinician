/**
 * "Do You Actually Need This?" — the Income Stream Decision Assessment
 * (sheet row 240, Practice Elevation / The Board Room, Module 02).
 *
 * Copy, order and scoring are ported verbatim from Yvette's standalone page
 * (income-stream-assessment.html). Each question's choices are listed top to
 * bottom as A, B, C internally; the letters are never shown and the order is
 * never shuffled.
 *
 * Stateless by design: answers live only in component memory for the current
 * visit. Nothing here is saved, sent or logged.
 */

export const INCOME_STREAM_KEY = "income-stream-assessment";

/** Where "Back to Module 02" goes: the module's welcome lesson, same course. */
export const MODULE_02_RETURN_SLUG = "welcome-to-module-2";

export const QUESTION_COUNT = 5;

export interface IncomeQuestion {
  category: string;
  question: string;
  /** Top to bottom = A, B, C. */
  options: readonly [string, string, string];
}

export interface IncomeResult {
  title: string;
  headline: string;
  body: string;
  steps: readonly string[];
}

export const INCOME_INTRO = {
  title: "Do You Actually Need This?",
  subtitle: "Income Stream Decision Assessment",
  lead: "Your next best business decision",
  heading: "Before you add a single new offer",
  body: "Before you add a single new offer, take five minutes and answer honestly. Most Maxed Out Clinicians do not need another income stream. They need the one they already built to work better. This assessment tells you which one you are, and exactly what to do next.",
  note: "Five questions. A personalized next-step recommendation. No additional signup.",
  start: "Start the Assessment",
} as const;

export const INCOME_QUESTIONS: readonly IncomeQuestion[] = [
  {
    category: "Your Current Capacity",
    question: "How close is your current caseload to the number you actually want to maintain?",
    options: [
      "I am at or over capacity, and my income still is not where I want it to be",
      "My caseload is sustainable and my income is stable, but it has clearly plateaued",
      "My caseload is where I want it, my income goals are being met, and I have genuine room in my week",
    ],
  },
  {
    category: "Your Current Model",
    question: "Which best describes your rates, policies, and fees right now?",
    options: [
      "I have not raised my rates in over a year, my cancellation policy is not consistently enforced, or I regularly do non-session work like letters, forms, and coordination for free",
      "My rates are current and my policies are enforced, but I have not restructured how I package or sell my time",
      "My rates, cancellation policy, session packaging, and non-session fees are all set, enforced, and working",
    ],
  },
  {
    category: "Your Systems",
    question: "If you stepped away from your practice for two weeks, what would happen?",
    options: [
      "Things would fall apart. I am the system",
      "Clinical care would be covered, but admin and billing would pile up waiting for me",
      "The practice would run. My systems and support handle the day to day",
    ],
  },
  {
    category: "Your Time",
    question: "How much time could you realistically give a new offer every week without borrowing from sleep, family, or your current clients?",
    options: [
      "Honestly, none. I am already stretched",
      "Two to four focused hours, if I protect them",
      "Five or more hours. I have already created the space",
    ],
  },
  {
    category: "Your Why",
    question: "When you imagine launching a new income stream, what is underneath the excitement?",
    options: [
      "Relief. I want a way out of the pace I am keeping right now",
      "Curiosity. One specific idea keeps coming back, and it fits the practice I already have",
      "Strategy. I know exactly what it would add, who it serves, and what it needs to earn",
    ],
  },
];

/** Index 0 = mostly A, 1 = mostly B, 2 = mostly C. */
export const INCOME_RESULTS: readonly IncomeResult[] = [
  {
    title: "Optimize First",
    headline: "Do not add anything yet. Your current model is leaving money and time on the table.",
    body: "The pull toward a new income stream is real, but right now it is working as an escape hatch. You are hoping a new offer will rescue you from a model that is overworking you, and it will not. A new income stream built on top of an unoptimized practice adds workload, not freedom. Here is the good news: the fastest raise you will ever give yourself is restructuring the revenue you already have. No new audience, no new offer, no launch. Just a model that finally pays you properly for the work you are already doing.",
    steps: [
      "Go back through Module 02 and work the restructuring lessons in order: review and raise your rates, enforce your cancellation and no-show policy, set your non-session services fee schedule, and package your individual sessions",
      "Pick the one restructure move that recovers the most money or time first, and implement it within 30 days",
      "Retake this assessment in 90 days. When your answers shift, you will be ready for the next step",
    ],
  },
  {
    title: "One Strategic Add",
    headline: "Your foundation can support one new income stream. One.",
    body: "Your rates are current, your policies hold, and your practice is stable. You have earned the right to add something new. The risk at your stage is not whether to add. It is adding three things at once, splitting your limited time across all of them, and finishing none. The clinicians who expand successfully from where you are choose one addition that uses the clients, skills, and systems they already have, and they give it a full 90 days before evaluating anything else.",
    steps: [
      "Open the Income Stream Decision Guide in this sub-module and compare your options honestly",
      "Choose one addition. For most clinicians at your stage, a group therapy launch is the strongest first add because it builds on clients and clinical skills you already have",
      "Protect your two to four weekly hours for it, set a 90-day revenue target, and do not evaluate or add anything else until that date",
    ],
  },
  {
    title: "Ready to Expand",
    headline: "You built the foundation. Now expand deliberately.",
    body: "Your model is optimized, your systems run without you, and you have real protected time. Expansion at your stage is not a rescue. It is a design decision. That changes the question from \"what could I add?\" to \"what deserves a place in the business I have built?\" The right addition for you is the one with the strongest margin for the energy it takes, not the one that looks most impressive from the outside.",
    steps: [
      "Use the Income Stream Decision Guide to compare intensives, groups, and courses side by side on revenue potential, time cost, and energy cost",
      "Choose based on margin and energy, set a specific revenue target and a review date before you build anything",
      "Design the new stream so it runs on the same systems your practice already uses. If it needs you in the room every time, it is a second job, not an income stream",
    ],
  },
];

export const INCOME_RESULT_NOTE = {
  lead: "Make this useful:",
  body: "Pick your first action and decide when you will complete it. You can revisit the lesson and retake the assessment as your practice changes.",
} as const;

export type Choice = 0 | 1 | 2;
export type Answers = readonly (Choice | null)[];

/**
 * The most-chosen category wins. Ties are conservative, as the source
 * specifies: any tie that includes A is Optimize First, and a B/C tie is One
 * Strategic Add. Taking the first index of the maximum gives exactly that,
 * because A=0, B=1, C=2.
 */
export function scoreIncomeStream(answers: readonly Choice[]): 0 | 1 | 2 {
  const counts = [0, 0, 0];
  for (const a of answers) counts[a]++;
  return counts.indexOf(Math.max(...counts)) as 0 | 1 | 2;
}

/** -1 = introduction, 0-4 = question, 5 = result. */
export interface AssessmentState {
  stage: number;
  answers: Answers;
}

export type AssessmentAction =
  | { type: "start" }
  | { type: "choose"; choice: Choice }
  | { type: "back" }
  | { type: "next" }
  | { type: "retake" };

export const RESULT_STAGE = QUESTION_COUNT;

export const initialAssessment: AssessmentState = {
  stage: -1,
  answers: Array<Choice | null>(QUESTION_COUNT).fill(null),
};

export function assessmentReducer(state: AssessmentState, action: AssessmentAction): AssessmentState {
  const onQuestion = state.stage >= 0 && state.stage < QUESTION_COUNT;
  switch (action.type) {
    case "start":
      return state.stage === -1 ? { ...state, stage: 0 } : state;
    case "choose": {
      if (!onQuestion) return state;
      const answers = [...state.answers];
      answers[state.stage] = action.choice;
      return { ...state, answers };
    }
    case "back":
      return onQuestion ? { ...state, stage: state.stage - 1 } : state;
    case "next":
      // An answer must be selected before moving on.
      if (!onQuestion || state.answers[state.stage] === null) return state;
      return { ...state, stage: state.stage + 1 };
    case "retake":
      return initialAssessment;
  }
}

/** The result for a finished assessment, or null while any answer is missing. */
export function assessmentResult(state: AssessmentState): IncomeResult | null {
  if (state.stage !== RESULT_STAGE || state.answers.some((a) => a === null)) return null;
  return INCOME_RESULTS[scoreIncomeStream(state.answers as Choice[])];
}
