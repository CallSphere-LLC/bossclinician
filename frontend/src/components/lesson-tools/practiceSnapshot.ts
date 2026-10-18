import { scoreSnapshot, snapshot, type SnapshotQuestion, type SnapshotResultKey } from "@/content/kajabiPagesQuiz";

/**
 * The Practice Reset Snapshot as a lesson tool (QA sheet row 101): the same
 * twelve questions, scoring and results as the public /practice-reset-snapshot
 * page (content/kajabiPagesQuiz.ts, verbatim from Kajabi), with the member's
 * answers saved to their account under one tool key.
 *
 * The Practice Elevation dashboard (row 103) reads the same saved answers, so
 * a member answers once — in the orientation lesson or in the dashboard — and
 * both see it. `snapshotPathway` is the dashboard prototype's `derive()`:
 * question 11 picks the pathway, and answers in the two heavier options of
 * questions 4–10 add a flag.
 */

export const SNAPSHOT_KEY = "practice-reset-snapshot";

/** The lesson that carries the Practice Elevation dashboard (migration 119). */
export const ELEVATION_DASHBOARD_LESSON_SLUG = "my-practice-elevation-dashboard";

export interface SnapshotState {
  /** Question number ("1"–"11") → the chosen option's value. */
  answers: Record<string, string>;
  /** Question 12, optional and never scored. */
  reflection: string;
  result: SnapshotResultKey | null;
  completedAt: string | null;
}

export const snapshotDefaults = (): SnapshotState => ({ answers: {}, reflection: "", result: null, completedAt: null });

export const SNAPSHOT_QUESTIONS: readonly SnapshotQuestion[] = snapshot.sections.flatMap(
  (section): readonly SnapshotQuestion[] => section.questions,
);

const VALID_VALUES = new Map<string, Set<string>>(
  SNAPSHOT_QUESTIONS.map((q) => [String(q.number), new Set<string>(q.options.map((o) => o.value))]),
);

export function normaliseSnapshot(raw: unknown): SnapshotState {
  const base = snapshotDefaults();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  const answers: Record<string, string> = {};
  if (src.answers && typeof src.answers === "object" && !Array.isArray(src.answers)) {
    for (const [key, value] of Object.entries(src.answers as Record<string, unknown>)) {
      if (typeof value === "string" && VALID_VALUES.get(key)?.has(value)) answers[key] = value;
    }
  }
  const result = src.result === "optimizer" || src.result === "maxedout" || src.result === "depleted" ? src.result : null;
  return {
    answers,
    reflection: typeof src.reflection === "string" ? src.reflection.slice(0, 5000) : "",
    result: result && isComplete(answers) ? result : null,
    completedAt: typeof src.completedAt === "string" && result ? src.completedAt : null,
  };
}

export const answeredCount = (answers: Record<string, string>): number =>
  SNAPSHOT_QUESTIONS.filter((q) => q.number <= snapshot.requiredCount && answers[String(q.number)]).length;

/** Questions 1–11 answered (12 is optional, as on Kajabi). */
export const isComplete = (answers: Record<string, string>): boolean => answeredCount(answers) >= snapshot.requiredCount;

/** First unanswered required question, for scrolling to it. */
export const firstMissing = (answers: Record<string, string>): number | null => {
  for (let i = 1; i <= snapshot.requiredCount; i += 1) if (!answers[String(i)]) return i;
  return null;
};

export function scoreAnswers(answers: Record<string, string>): SnapshotResultKey {
  const byNumber: Record<number, string> = {};
  for (const [key, value] of Object.entries(answers)) byNumber[Number(key)] = value;
  return scoreSnapshot(byNumber);
}

/* ----------------------------------------------- Practice Elevation pathway */

export type ElevationFocus = "clarity" | "revenue" | "systems" | "owner";

const FOCUS_BY_DIRECTION: Record<string, ElevationFocus> = {
  rate: "revenue",
  systems: "systems",
  pay: "owner",
  numbers: "clarity",
};

/** The two heavier options (C and D) of a scored question. */
const heavy = (answers: Record<string, string>, question: number) => Number(answers[String(question)] ?? "0") >= 3;

export function snapshotPathway(answers: Record<string, string>): { focus: ElevationFocus; flags: string[] } {
  const focus = FOCUS_BY_DIRECTION[answers["11"] ?? ""] ?? "clarity";
  const flags: string[] = [];
  if (heavy(answers, 4)) flags.push("Current Model Audit first: effective rate is unclear.");
  if (heavy(answers, 5)) flags.push("Platform/payer dependency needs evaluation.");
  if (heavy(answers, 6)) flags.push("Consider reviewing the private-pay rate strategy.");
  if (heavy(answers, 7)) flags.push("Owner pay needs attention.");
  if ([8, 9, 10].some((q) => heavy(answers, q))) flags.push("Systems gap: assess administrative workload.");
  return { focus, flags };
}

/**
 * A backup made with the standalone dashboard prototype stored answers as a
 * 12-item array of option indexes (0–3) with the reflection last. Mapped onto
 * this snapshot's values so an old backup still restores.
 */
export function answersFromPrototype(list: unknown): { answers: Record<string, string>; reflection: string } | null {
  if (!Array.isArray(list)) return null;
  const answers: Record<string, string> = {};
  for (const question of SNAPSHOT_QUESTIONS) {
    const index = list[question.number - 1];
    if (typeof index === "number" && question.options[index]) answers[String(question.number)] = question.options[index].value;
  }
  return { answers, reflection: typeof list[11] === "string" ? list[11] : "" };
}
