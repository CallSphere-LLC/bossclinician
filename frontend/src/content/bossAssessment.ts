/**
 * "Are You Running Your Practice—or Is It Running You?", the group practice
 * self-assessment at /boss-assessment.
 *
 * Copied from the owner's source page (QA sheet row 209): ten statements answered
 * from 1 (never) to 5 (always), two for each of five blockers. Each blocker scores
 * 2 to 10 and the total 10 to 50. A total of 24 or less, 39 or less, or more than
 * that picks the tier. The highest-scoring blocker is the starting point, and ties
 * are shown together.
 *
 * The one line not copied is the source's note to its developer in the email card
 * ("Your developer can connect this form..."), replaced by `email.sub`.
 *
 * The server keeps its own copy of the blockers and tiers, because it works the
 * result out again before emailing it (backend/src/services/bossAssessment.ts).
 * Its test fails if the words here and there drift apart.
 *
 * The free PDF this page used to offer is retired, and the two paused automations
 * that would have sent it are marked so (migration 177).
 */

export interface BlockerArea {
  title: string;
  description: string;
  action: string;
  questions: readonly [string, string];
}

export const BOSS_ASSESSMENT_AREAS: readonly BlockerArea[] = [
  {
    title: "Leadership Dependency",
    description: "Leadership infrastructure may need strengthening so appropriate decisions no longer depend on you.",
    action: "Identify one recurring decision that can be delegated with clear ownership and decision boundaries.",
    questions: [
      "My team asks for my input or approval before making decisions they could reasonably make on their own.",
      "When I’m unavailable — out of the office, in a session, or on vacation — things slow down or fall apart.",
    ],
  },
  {
    title: "Broken Pay Structure",
    description: "Owner compensation may not be adequately reflected in your pricing and financial planning.",
    action: "Review collected revenue, payroll, overhead, taxes, and a realistic owner-pay target with your financial advisor.",
    questions: [
      "I know what my clinicians earn but I’m not consistently clear on what I should be paying myself.",
      "After covering payroll, overhead, and taxes, my take-home pay doesn’t reflect the volume of work moving through my practice.",
    ],
  },
  {
    title: "Missing Systems",
    description: "Undocumented processes may be keeping everyday operations dependent on your personal knowledge.",
    action: "Choose one recurring process—intake, scheduling, billing, or onboarding—and document the steps and responsible owner.",
    questions: [
      "If a new clinician joined today, there is no documented onboarding process they could follow without my direct involvement.",
      "Key processes — intake, scheduling, billing, documentation review — depend on my personal knowledge rather than written systems.",
    ],
  },
  {
    title: "Team Misalignment",
    description: "Your team may need clearer expectations, leadership communication, and retention strategies.",
    action: "Schedule a team leadership check-in to clarify expectations, culture, ownership, and common friction points.",
    questions: [
      "My clinicians do good clinical work but don’t understand or actively participate in the culture and direction of the practice.",
      "Retaining clinicians is a recurring challenge — I spend significant time or money on turnover that disrupts the practice.",
    ],
  },
  {
    title: "No Exit Strategy",
    description: "The business may not have a documented plan to operate while you are unavailable.",
    action: "Map what happens during a two-week absence and identify the owner-dependent tasks that require backup coverage.",
    questions: [
      "I have not clearly defined what my role in this practice looks like when I am fully leading it — rather than operating in it daily.",
      "A real vacation, maternity leave, or extended time away would currently create a significant disruption to operations or revenue.",
    ],
  },
];

export const BOSS_ASSESSMENT_QUESTIONS = BOSS_ASSESSMENT_AREAS.flatMap((area, areaIndex) =>
  area.questions.map((text) => ({ text, areaIndex })),
);

export const BOSS_ASSESSMENT_CHOICES = ["Never", "Rarely", "Sometimes", "Often", "Always"] as const;

export const BOSS_ASSESSMENT = {
  formSlug: "boss-assessment",
  seoTitle: "Are You Running Your Practice—or Is It Running You? | Free Group Practice Self-Assessment",
  seoDescription: "Discover the five blockers keeping you tied to daily group practice operations.",
  eyebrow: "Free group practice self-assessment",
  titleLead: "Are You Running Your Practice—",
  titleAccent: "or Is It Running You?",
  sub: "Discover which of five hidden blockers is keeping you tied to day-to-day operations—and where to focus first.",
  start: "Take the 3-minute assessment",
  intro: {
    heading: "You built the team. Now build the freedom.",
    body: "You hired clinicians, handled payroll, and created a practice bigger than yourself. But if every decision still lands on your desk, something in the structure needs attention.",
    howLead: "Answer ten statements from ",
    howLow: "1 (never)",
    howTo: " to ",
    howHigh: "5 (always)",
    howRest: ". Higher scores indicate areas that may need more attention. You'll receive a personalized results summary and suggested starting action.",
  },
  quiz: {
    scale: "1 = Never · 5 = Always",
    choiceGroup: "Choose how frequently this is true",
    chooseFirst: "Choose a response before continuing.",
    back: "Back",
    next: "Next",
    finish: "See my results",
  },
  results: {
    eyebrow: "Your results",
    heading: "Here's what may be keeping you in the weeds.",
    totalLabel: "Total blocker score",
    outOf: "/ 50",
    blockersHeading: "Your five blockers",
    startingEyebrow: "Your starting point",
    tryFirst: "Try this first: ",
    disclaimer:
      "Scores are self-reported reflection tools, not a validated diagnostic measure or financial audit. Each domain has two responses from 1 to 5, so scores range from 2 to 10. Your highest score identifies the blocker to consider first. Ties are shown together.",
  },
  move: {
    heading: "Make your next boss move",
    body: "Reflect on the result: What will you stop doing, what will you restructure, and what would you reclaim that time for?",
    commitLabel: "One change I'll make this month:",
    commitPlaceholder: "Write your next move...",
    copy: "Copy my results",
    copied: "Your results were copied.",
    copyFailed: "Copy was unavailable in this browser. You can select the results above.",
    retake: "Retake assessment",
  },
  email: {
    eyebrow: "Keep your results",
    heading: "Want your personalized next steps by email?",
    sub: "Enter your information below and we'll email you your results and suggested starting action.",
    firstName: "First name",
    address: "Email address",
    consent: "Yes, I'd also like Boss Clinician emails with practical business tips, program information, and resources. I understand I can unsubscribe.",
    submit: "Email my results",
    sending: "Sending…",
    sentTo: "Your results are on their way to",
    /** The reply is saved either way; this is when the email itself did not go. */
    notSent: "We couldn't email your results to that address just now. Please use “Copy my results” above to keep them.",
  },
  boardroom: {
    eyebrow: "Your next level",
    heading: "You don't have to lead alone.",
    body: "The Boss Clinician Boardroom is an executive advisory experience for practice owners ready to strengthen leadership, profitability, systems, and the structure behind the business.",
    cta: "Explore The Boardroom",
    to: "/boardroom",
    fine: "Applying does not guarantee acceptance.",
  },
  footer: "© 2026 Boss Clinician, LLC · For business education and self-reflection.",
  terms: { label: "Terms", to: "/terms" },
} as const;

export interface BossAssessmentResult {
  /** The five blockers' scores, 2 to 10, in the order of BOSS_ASSESSMENT_AREAS. */
  totals: number[];
  /** 10 to 50. */
  sum: number;
  tierTitle: string;
  tierText: string;
  /** Indexes of the highest-scoring blockers. More than one when they tie. */
  leaders: number[];
}

/** `answers` is ten whole numbers from 1 to 5. */
export function scoreBossAssessment(answers: readonly number[]): BossAssessmentResult {
  const totals = BOSS_ASSESSMENT_AREAS.map((_, i) => answers[2 * i] + answers[2 * i + 1]);
  const sum = totals.reduce((a, b) => a + b, 0);
  const max = Math.max(...totals);
  const leaders = totals.flatMap((value, i) => (value === max ? [i] : []));
  const [tierTitle, tierText] =
    sum <= 24
      ? ["Focus on your highest blocker", "Your foundation shows some strength. Focus your energy on the blocker with the highest score."]
      : sum <= 39
        ? ["Focus on your top priorities", "Several structural gaps may be costing you time or money. Start with the highest priorities."]
        : ["Consider a structural reset", "Several areas are creating significant dependency on your daily involvement. A structured operational reset may help."];
  return { totals, sum, tierTitle, tierText, leaders };
}

/** What "Copy my results" puts on the clipboard, in the source's format. */
export function bossAssessmentResultText(result: BossAssessmentResult, commitment: string, boardroomUrl: string): string {
  const leaders = result.leaders.map((i) => BOSS_ASSESSMENT_AREAS[i]);
  return [
    "Boss Clinician Group Practice Self-Assessment",
    `Total: ${result.sum}/50`,
    ...BOSS_ASSESSMENT_AREAS.map((area, i) => `${area.title}: ${result.totals[i]}/10`),
    `Highest blocker(s): ${leaders.map((area) => area.title).join(", ")}`,
    `Next move: ${leaders.map((area) => area.action).join(" ")}`,
    `Commitment: ${commitment}`,
    boardroomUrl,
  ].join("\n");
}
