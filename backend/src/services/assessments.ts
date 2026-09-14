import { pool } from "../db/pool";

/**
 * Quiz and test scoring.
 *
 * The arithmetic is pure and lives above the database calls, because this is
 * where a quiz fails silently rather than loudly: a scoring bug does not throw,
 * it routes every visitor to the same archetype, and nobody notices until a
 * five-email sequence has gone to the wrong four hundred people. So the rules
 * are expressed once, over plain data, and tested directly.
 *
 * Two shapes share the table. A `quiz` weights each answer and lands the total
 * in a band, which selects the result page, the tag and the sequence — that is
 * the whole acquisition funnel. A `graded` test marks answers right or wrong
 * and compares a percentage against a pass mark.
 */

export type QuestionKind = "single" | "multiple" | "scale" | "text";
export type AssessmentKind = "quiz" | "graded" | "survey";

export interface AnswerOption {
  id: number;
  weight: number;
  isCorrect: boolean;
  feedback: string;
}

export interface QuestionDefinition {
  id: number;
  kind: QuestionKind;
  required: boolean;
  /** In `position` order. The order matters: see the single-choice rule below. */
  answers: AnswerOption[];
}

/** One row of `assessment_results` — a score band and what it resolves to. */
export interface ResultBand {
  id: number;
  position: number;
  minScore: number;
  maxScore: number;
}

export interface AssessmentDefinition {
  id: number;
  kind: AssessmentKind;
  /** Percentage. Only meaningful for a graded test. */
  passMark: number | null;
  questions: QuestionDefinition[];
  results: ResultBand[];
}

export interface AttemptResponse {
  questionId: number;
  answerIds?: number[];
  text?: string;
}

export interface AnswerFeedback {
  questionId: number;
  correct: boolean;
  text: string;
}

export interface ScoredAttempt {
  score: number;
  maxScore: number;
  /** 0–100, clamped. The `assessment_attempts` column has that CHECK on it. */
  percent: number;
  /** null for a quiz: "passing" is not a thing a lead-gen quiz has. */
  passed: boolean | null;
  /** null when no band matched — see `bandFor`. */
  resultId: number | null;
  /** Required questions left blank. The caller decides whether to refuse. */
  missingQuestionIds: number[];
  feedback: AnswerFeedback[];
}

/**
 * The band a score lands in, or null.
 *
 * First match in `position` order, which is the documented resolution for
 * overlapping bands: an editor who writes 0–10 and 8–20 gets the one she put
 * first rather than whichever the database happened to return first. Ties on
 * position fall back to id so the answer is stable across queries.
 *
 * A score above every band returns null rather than clamping into the top one.
 * Clamping would hide a misconfigured quiz — every high scorer quietly assigned
 * an archetype nobody chose — where null surfaces it on the first attempt.
 */
export function bandFor(score: number, results: ResultBand[]): number | null {
  const ordered = [...results].sort((a, b) => a.position - b.position || a.id - b.id);
  for (const band of ordered) {
    if (score >= band.minScore && score <= band.maxScore) return band.id;
  }
  return null;
}

/** The answers a response selected, in the question's own order, deduplicated. */
function chosenAnswers(question: QuestionDefinition, answerIds: number[]): AnswerOption[] {
  const wanted = new Set(answerIds);
  const chosen = question.answers.filter((answer) => wanted.has(answer.id));

  // A single-choice question counts one answer however many arrive. The client
  // is a form the visitor controls, and a POST carrying every option's id would
  // otherwise score the maximum on every question — the cheapest possible way
  // to force yourself into the archetype with the most expensive offer behind
  // it.
  return question.kind === "single" || question.kind === "scale" ? chosen.slice(0, 1) : chosen;
}

/** The most a question can contribute, which is what makes `percent` mean anything. */
function questionMax(question: QuestionDefinition, kind: AssessmentKind): number {
  if (question.kind === "text") return 0;

  if (kind === "graded") {
    return question.answers.some((answer) => answer.isCorrect) ? 1 : 0;
  }

  if (question.kind === "multiple") {
    return question.answers.reduce((sum, answer) => sum + Math.max(0, answer.weight), 0);
  }

  return question.answers.reduce((best, answer) => Math.max(best, answer.weight), 0);
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Scores a set of responses against a definition. Pure.
 *
 * Unknown question ids and answer ids that belong to another question are
 * ignored rather than rejected: a stale tab submitting against a quiz that was
 * edited two minutes ago should score what it can, not 500.
 */
export function scoreResponses(
  definition: AssessmentDefinition,
  responses: AttemptResponse[]
): ScoredAttempt {
  const selections = new Map<number, number[]>();
  const texts = new Map<number, string>();
  for (const response of responses) {
    const previous = selections.get(response.questionId) ?? [];
    selections.set(response.questionId, [...previous, ...(response.answerIds ?? [])]);
    if (response.text !== undefined) texts.set(response.questionId, response.text);
  }

  let score = 0;
  let maxScore = 0;
  const missingQuestionIds: number[] = [];
  const feedback: AnswerFeedback[] = [];

  for (const question of definition.questions) {
    maxScore += questionMax(question, definition.kind);

    if (question.kind === "text") {
      if (question.required && !(texts.get(question.id) ?? "").trim()) {
        missingQuestionIds.push(question.id);
      }
      continue;
    }

    const chosen = chosenAnswers(question, selections.get(question.id) ?? []);
    if (chosen.length === 0) {
      if (question.required) missingQuestionIds.push(question.id);
      continue;
    }

    if (definition.kind === "graded") {
      const correctIds = question.answers.filter((answer) => answer.isCorrect).map((a) => a.id);
      const chosenIds = chosen.map((answer) => answer.id);
      // Exactly the correct set: picking the right answer plus a wrong one is
      // not a right answer, and half marks are a rule nobody asked for.
      const correct =
        correctIds.length > 0 &&
        correctIds.length === chosenIds.length &&
        correctIds.every((id) => chosenIds.includes(id));

      if (correct) score += 1;
      feedback.push({
        questionId: question.id,
        correct,
        text: chosen.map((answer) => answer.feedback).find((text) => text !== "") ?? "",
      });
      continue;
    }

    score += chosen.reduce((sum, answer) => sum + answer.weight, 0);
    const explanation = chosen.map((answer) => answer.feedback).find((text) => text !== "");
    if (explanation) feedback.push({ questionId: question.id, correct: true, text: explanation });
  }

  const percent = maxScore > 0 ? clampPercent((score / maxScore) * 100) : 0;
  const passed =
    definition.kind === "graded" && definition.passMark !== null
      ? percent >= definition.passMark
      : null;

  return {
    score,
    maxScore,
    percent,
    passed,
    resultId: definition.kind === "survey" ? null : bandFor(score, definition.results),
    missingQuestionIds,
    feedback,
  };
}

/* ------------------------------------------------------------------ loading */

interface DefinitionRow {
  id: number;
  kind: AssessmentKind;
  pass_mark: number | null;
}

interface QuestionRow {
  id: number;
  kind: QuestionKind;
  required: boolean;
}

interface AnswerRow {
  id: number;
  question_id: number;
  weight: number;
  is_correct: boolean;
  feedback: string;
}

interface ResultRow {
  id: number;
  position: number;
  min_score: number;
  max_score: number;
}

/** The whole scoring definition, in one place, weights and all. Never public. */
export async function loadDefinition(assessmentId: number): Promise<AssessmentDefinition | null> {
  const assessment = await pool.query<DefinitionRow>(
    `SELECT id, kind, pass_mark FROM assessments WHERE id = $1`,
    [assessmentId]
  );
  const row = assessment.rows[0];
  if (!row) return null;

  const questions = await pool.query<QuestionRow>(
    `SELECT id, kind, required FROM assessment_questions
      WHERE assessment_id = $1 ORDER BY position, id`,
    [assessmentId]
  );
  const answers = await pool.query<AnswerRow>(
    `SELECT a.id, a.question_id, a.weight, a.is_correct, a.feedback
       FROM assessment_answers a
       JOIN assessment_questions q ON q.id = a.question_id
      WHERE q.assessment_id = $1
      ORDER BY a.position, a.id`,
    [assessmentId]
  );
  const results = await pool.query<ResultRow>(
    `SELECT id, position, min_score, max_score FROM assessment_results
      WHERE assessment_id = $1 ORDER BY position, id`,
    [assessmentId]
  );

  const byQuestion = new Map<number, AnswerOption[]>();
  for (const answer of answers.rows) {
    const list = byQuestion.get(answer.question_id) ?? [];
    list.push({
      id: answer.id,
      weight: answer.weight,
      isCorrect: answer.is_correct,
      feedback: answer.feedback,
    });
    byQuestion.set(answer.question_id, list);
  }

  return {
    id: row.id,
    kind: row.kind,
    passMark: row.pass_mark,
    questions: questions.rows.map((question) => ({
      id: question.id,
      kind: question.kind,
      required: question.required,
      answers: byQuestion.get(question.id) ?? [],
    })),
    results: results.rows.map((result) => ({
      id: result.id,
      position: result.position,
      minScore: result.min_score,
      maxScore: result.max_score,
    })),
  };
}

/**
 * Scores one submission against a stored assessment.
 *
 * Thin over `scoreResponses` on purpose: everything worth testing is in the
 * pure function, and this is the loading that surrounds it.
 */
export async function scoreAttempt(
  assessmentId: number,
  responses: AttemptResponse[]
): Promise<ScoredAttempt | null> {
  const definition = await loadDefinition(assessmentId);
  if (!definition) return null;
  return scoreResponses(definition, responses);
}

/* ------------------------------------------------------------- public shape */

export interface PublicAnswer {
  id: number;
  label: string;
}

export interface PublicQuestion {
  id: number;
  prompt: string;
  helpText: string;
  kind: QuestionKind;
  required: boolean;
  answers: PublicAnswer[];
}

export interface PublicAssessment {
  id: number;
  slug: string;
  title: string;
  introMd: string;
  kind: AssessmentKind;
  requireEmail: boolean;
  lessonId: number | null;
  passMark: number | null;
  requirePass: boolean;
  questions: PublicQuestion[];
}

/**
 * What a visitor is allowed to see.
 *
 * The column lists are exhaustive rather than `SELECT *`, and that is the whole
 * safety property: `weight` and `is_correct` are the answer key, and a quiz
 * that ships them to the browser can be scored perfectly by anyone who opens
 * the network tab. Written once here so no route has to remember.
 */
export async function loadPublicAssessment(slug: string): Promise<PublicAssessment | null> {
  const assessment = await pool.query<{
    id: number;
    slug: string;
    title: string;
    intro_md: string;
    kind: AssessmentKind;
    require_email: boolean;
    lesson_id: number | null;
    pass_mark: number | null;
    require_pass: boolean;
  }>(
    `SELECT id, slug::text AS slug, title, intro_md, kind, require_email, lesson_id, pass_mark, require_pass
       FROM assessments WHERE slug = $1 AND published`,
    [slug]
  );
  const row = assessment.rows[0];
  if (!row) return null;

  const questions = await pool.query<{
    id: number;
    prompt: string;
    help_text: string;
    kind: QuestionKind;
    required: boolean;
  }>(
    `SELECT id, prompt, help_text, kind, required
       FROM assessment_questions WHERE assessment_id = $1 ORDER BY position, id`,
    [row.id]
  );

  const answers = await pool.query<{ id: number; question_id: number; label: string }>(
    `SELECT a.id, a.question_id, a.label
       FROM assessment_answers a
       JOIN assessment_questions q ON q.id = a.question_id
      WHERE q.assessment_id = $1
      ORDER BY a.position, a.id`,
    [row.id]
  );

  const byQuestion = new Map<number, PublicAnswer[]>();
  for (const answer of answers.rows) {
    const list = byQuestion.get(answer.question_id) ?? [];
    list.push({ id: answer.id, label: answer.label });
    byQuestion.set(answer.question_id, list);
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    introMd: row.intro_md,
    kind: row.kind,
    requireEmail: row.require_email,
    lessonId: row.lesson_id,
    passMark: row.pass_mark,
    requirePass: row.kind === "graded" && row.require_pass,
    questions: questions.rows.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      helpText: question.help_text,
      kind: question.kind,
      required: question.required,
      answers: byQuestion.get(question.id) ?? [],
    })),
  };
}

/* ------------------------------------------------------------------ results */

export interface ResultPage {
  id: number;
  slug: string;
  title: string;
  bodyMd: string;
  imageUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  applyTagId: number | null;
  subscribeSequenceId: number | null;
}

export async function loadResult(resultId: number): Promise<ResultPage | null> {
  const res = await pool.query<{
    id: number;
    slug: string;
    title: string;
    body_md: string;
    image_url: string;
    cta_label: string;
    cta_url: string;
    apply_tag_id: number | null;
    subscribe_sequence_id: number | null;
  }>(
    `SELECT id, slug, title, body_md, image_url, cta_label, cta_url,
            apply_tag_id, subscribe_sequence_id
       FROM assessment_results WHERE id = $1`,
    [resultId]
  );
  const row = res.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    bodyMd: row.body_md,
    imageUrl: row.image_url,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    applyTagId: row.apply_tag_id,
    subscribeSequenceId: row.subscribe_sequence_id,
  };
}

export interface SaveAttemptInput {
  assessmentId: number;
  contactId: number | null;
  memberId: number | null;
  email: string;
  responses: AttemptResponse[];
  scored: ScoredAttempt;
}

/** Records a completed attempt and returns its id. */
export async function saveAttempt(input: SaveAttemptInput): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO assessment_attempts
       (assessment_id, contact_id, member_id, email, responses,
        score, max_score, percent, passed, result_id, completed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, now())
     RETURNING id`,
    [
      input.assessmentId,
      input.contactId,
      input.memberId,
      input.email,
      JSON.stringify(input.responses),
      input.scored.score,
      input.scored.maxScore,
      input.scored.percent,
      input.scored.passed,
      input.scored.resultId,
    ]
  );
  return Number(res.rows[0].id);
}
