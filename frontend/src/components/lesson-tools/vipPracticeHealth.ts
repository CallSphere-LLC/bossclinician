/** The eight choices and scoring in the owner's 2-minute VIP package (QA row 182). */
export const VIP_HEALTH_KEY = "vip-practice-health";

export const AREAS = [
  { name: "Financial Health", question: "Which statement best describes your practice expenses and owner pay?", options: ["Expenses are difficult to cover", "Expenses are covered, but owner pay is rare", "Owner pay happens, but varies month to month", "Expenses and planned owner pay are consistently covered"], action: "Bring your last three months of revenue, overhead and owner-pay totals to your VIP session." },
  { name: "Revenue Model", question: "How do you evaluate the financial performance of your services and payers?", options: ["I do not know my numbers", "I have a rough idea but have not compared them", "I compare some rates and costs", "I regularly use reimbursement, fees and costs to make decisions"], action: "Compare your top revenue sources by collected amount, session time and associated costs." },
  { name: "Client Flow", question: "How consistent are inquiries from clients who fit your practice?", options: ["Very unpredictable or mostly absent", "Occasional inquiries from one source", "Fairly consistent inquiries from a few sources", "Reliable inquiries from diversified sources"], action: "List your top three referral sources and what happened to inquiries over the last 30 days." },
  { name: "Operations & Systems", question: "How reliably do daily practice operations run without your constant involvement?", options: ["Everything depends on me", "A few tasks are documented or automated", "Most routine tasks follow reliable workflows", "Key processes are documented, reliable and delegated or automated where appropriate"], action: "Map one client-facing process that repeatedly creates administrative work." },
  { name: "Capacity & Sustainability", question: "How well does your schedule support your income, boundaries, and time off?", options: ["I am regularly overextended", "I can manage, but breaks are difficult", "My workload is mostly manageable", "My schedule supports income, boundaries and planned time off"], action: "Track your clinical and administrative hours for one representative week." },
  { name: "Leadership & Strategy", question: "How consistently do you use business goals and numbers to make decisions?", options: ["I mainly react to urgent issues", "I have goals, but rarely review progress", "I review goals and some metrics periodically", "I review key metrics and make intentional decisions regularly"], action: "Choose one monthly metric and one leadership decision to review at your next check-in." },
] as const;

export const CHALLENGES = ["Owner pay or profitability", "Insurance rates or revenue mix", "Inconsistent referrals", "Admin workload or systems", "Overfull caseload or limited time off", "Business direction or leadership"] as const;
export const PRIORITIES = ["Improve take-home income", "Improve rates or revenue mix", "Build steadier client flow", "Simplify systems and operations", "Protect capacity and time off", "Strengthen business strategy"] as const;

export interface VipHealthState {
  scores: (number | null)[];
  challenges: string[];
  priority: string;
  completedAt: string | null;
}

export const emptyVipHealth = (): VipHealthState => ({
  scores: Array(6).fill(null), challenges: [], priority: "", completedAt: null,
});

export function normaliseVipHealth(raw: unknown): VipHealthState {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const rawScores = Array.isArray(source.scores) ? source.scores : [];
  const rawChallenges = Array.isArray(source.challenges) ? source.challenges : [];
  const scores = rawScores.length
    ? AREAS.map((_, i) => [1, 2, 3, 4].includes(rawScores[i]) ? rawScores[i] as number : null)
    : Array(6).fill(null) as null[];
  const challenges = CHALLENGES.filter((item) => rawChallenges.includes(item));
  const priority = typeof source.priority === "string" && PRIORITIES.some((item) => item === source.priority)
    ? source.priority : "";
  const completedAt = typeof source.completedAt === "string" && !Number.isNaN(Date.parse(source.completedAt))
    ? source.completedAt : null;
  return { scores, challenges: [...challenges], priority, completedAt };
}

export function vipHealthResult(state: VipHealthState) {
  if (state.scores.length !== 6 || state.scores.some((score) => score === null || ![1, 2, 3, 4].includes(score))
    || !PRIORITIES.some((item) => item === state.priority)) return null;
  const values = state.scores as number[];
  const lowest = Math.min(...values);
  const firstLowest = values.indexOf(lowest);
  return {
    score: Math.round(values.reduce((sum, value) => sum + value, 0) / 24 * 100),
    areas: AREAS.map((area, i) => ({ name: area.name, score: values[i] })),
    challenges: state.challenges.filter((item) => CHALLENGES.some((choice) => choice === item)),
    priority: state.priority,
    action: AREAS[firstLowest].action,
  };
}
