import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { badRequest, notFound } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";

/**
 * Quiz and test administration — mounted at /api/admin/assessments.
 *
 * The editor this serves reads as a sentence: "if someone scores 8 to 14, show
 * them the Steady Grower page and tag them Steady Grower". So the API answers
 * in those terms — a result carries the tag's name and the sequence's name, not
 * only their ids — because a screen that has to fetch three lists to render one
 * row is a screen that renders ids instead.
 */

export const adminAssessmentsRouter = Router();

/** The top of the INT range, which is what the migration defaults `max_score` to. */
const OPEN_ENDED = 2147483647;

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** A slug nothing else has taken, suffixed 2, 3, … the way the console does. */
async function freeSlug(table: "assessments" | "events", base: string): Promise<string> {
  const wanted = base || "quiz";
  const taken = await pool.query<{ slug: string }>(
    `SELECT slug::text AS slug FROM ${table} WHERE slug = $1 OR slug LIKE $2`,
    [wanted, `${wanted}-%`]
  );
  const used = new Set(taken.rows.map((row) => row.slug));
  if (!used.has(wanted)) return wanted;

  let suffix = 2;
  while (used.has(`${wanted}-${suffix}`)) suffix += 1;
  return `${wanted}-${suffix}`;
}

/* ----------------------------------------------------------------- schemas */

const assessmentSchema = z.object({
  title: z.string().trim().min(1, "Give this quiz a name").max(200),
  introMd: z.string().max(20_000).optional(),
  kind: z.enum(["quiz", "graded", "survey"]).optional(),
  requirePass: z.boolean().optional(),
  passMessage: z.string().max(2000).optional(),
  failMessage: z.string().max(2000).optional(),
  lessonId: z.number().int().positive().nullable().optional(),
  passMark: z.number().int().min(0).max(100).nullable().optional(),
  maxAttempts: z.number().int().min(1).max(100).nullable().optional(),
  showFeedback: z.boolean().optional(),
  requireEmail: z.boolean().optional(),
  published: z.boolean().optional(),
});

const questionSchema = z.object({
  prompt: z.string().trim().max(1000).optional(),
  helpText: z.string().max(1000).optional(),
  kind: z.enum(["single", "multiple", "scale", "text"]).optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const answerSchema = z.object({
  label: z.string().trim().max(500).optional(),
  weight: z.number().int().min(-1000).max(1000).optional(),
  isCorrect: z.boolean().optional(),
  feedback: z.string().max(2000).optional(),
  position: z.number().int().min(0).optional(),
});

const resultSchema = z.object({
  title: z.string().trim().max(200).optional(),
  bodyMd: z.string().max(50_000).optional(),
  imageUrl: z.string().max(500).optional(),
  minScore: z.number().int().optional(),
  maxScore: z.number().int().optional(),
  applyTagId: z.number().int().positive().nullable().optional(),
  subscribeSequenceId: z.number().int().positive().nullable().optional(),
  ctaLabel: z.string().max(200).optional(),
  ctaUrl: z.string().max(500).optional(),
  position: z.number().int().min(0).optional(),
});

const reorderSchema = z.object({ ids: z.array(z.number().int().positive()).max(500) });

/* ------------------------------------------------------------- assessments */

adminAssessmentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT a.id, a.slug::text AS slug, a.title, a.kind, a.published, a.require_email,
              a.pass_mark, a.lesson_id, a.updated_at,
              (SELECT count(*)::int FROM assessment_questions q WHERE q.assessment_id = a.id) AS question_count,
              (SELECT count(*)::int FROM assessment_results r WHERE r.assessment_id = a.id)   AS result_count,
              (SELECT count(*)::int FROM assessment_attempts t
                WHERE t.assessment_id = a.id AND t.completed_at IS NOT NULL)                  AS attempt_count
         FROM assessments a
        ORDER BY a.title`
    );
    res.json(rowsToCamel(result.rows));
  })
);

adminAssessmentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = assessmentSchema.parse(req.body);
    const slug = await freeSlug("assessments", slugify(input.title));

    // A graded test without a pass mark violates the table's own constraint;
    // 70 is the conventional default and she can change it in the editor.
    const passMark = input.kind === "survey" ? null : input.kind === "graded" ? input.passMark ?? 70 : input.passMark ?? null;

    const result = await pool.query(
      `INSERT INTO assessments
         (slug, title, intro_md, kind, lesson_id, pass_mark, max_attempts,
          show_feedback, require_email, published, require_pass, pass_message, fail_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        slug,
        input.title,
        input.introMd ?? "",
        input.kind ?? "quiz",
        input.lessonId ?? null,
        passMark,
        input.maxAttempts ?? null,
        input.showFeedback ?? true,
        input.requireEmail ?? (input.kind === undefined || input.kind === "quiz"),
        input.published ?? false,
        input.kind === "survey" ? false : input.requirePass ?? true,
        input.passMessage ?? "You passed. Continue to the next lesson.",
        input.failMessage ?? "Review the lesson and try again.",
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

adminAssessmentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const assessment = await pool.query(
      `SELECT a.*, a.slug::text AS slug, m.course_id, l.published AS lesson_published
         FROM assessments a
         LEFT JOIN course_lessons l ON l.id = a.lesson_id
         LEFT JOIN course_modules m ON m.id = l.module_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (assessment.rowCount === 0) throw notFound("Quiz not found");

    const questions = await pool.query(
      `SELECT id, position, prompt, help_text, kind, required
         FROM assessment_questions WHERE assessment_id = $1 ORDER BY position, id`,
      [req.params.id]
    );
    const answers = await pool.query(
      `SELECT a.id, a.question_id, a.position, a.label, a.weight, a.is_correct, a.feedback
         FROM assessment_answers a
         JOIN assessment_questions q ON q.id = a.question_id
        WHERE q.assessment_id = $1
        ORDER BY a.position, a.id`,
      [req.params.id]
    );
    const results = await pool.query(
      `SELECT r.id, r.position, r.slug, r.title, r.body_md, r.image_url,
              r.min_score, r.max_score, r.apply_tag_id, r.subscribe_sequence_id,
              r.cta_label, r.cta_url,
              t.name AS tag_name, s.name AS sequence_name,
              (SELECT count(*)::int FROM assessment_attempts x WHERE x.result_id = r.id) AS attempt_count
         FROM assessment_results r
         LEFT JOIN tags t            ON t.id = r.apply_tag_id
         LEFT JOIN email_sequences s ON s.id = r.subscribe_sequence_id
        WHERE r.assessment_id = $1
        ORDER BY r.position, r.id`,
      [req.params.id]
    );

    const byQuestion = new Map<number, Record<string, unknown>[]>();
    for (const answer of answers.rows) {
      const list = byQuestion.get(answer.question_id as number) ?? [];
      list.push(rowToCamel(answer));
      byQuestion.set(answer.question_id as number, list);
    }

    res.json({
      ...rowToCamel(assessment.rows[0]),
      questions: questions.rows.map((question) => ({
        ...rowToCamel(question),
        answers: byQuestion.get(question.id as number) ?? [],
      })),
      results: rowsToCamel(results.rows),
    });
  })
);

const ASSESSMENT_COLUMNS = [
  "require_pass",
  "pass_message",
  "fail_message",
  "title",
  "intro_md",
  "kind",
  "lesson_id",
  "pass_mark",
  "max_attempts",
  "show_feedback",
  "require_email",
  "published",
] as const;

adminAssessmentsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = assessmentSchema.partial().parse(req.body);
    const stored = await pool.query(`SELECT kind,pass_mark FROM assessments WHERE id=$1`,[req.params.id]);
    if (!stored.rows[0]) throw notFound("Assessment not found");
    const kind = input.kind ?? stored.rows[0].kind;
    if (kind === "survey") { input.passMark = null; input.requirePass = false; }
    if (kind === "graded" && (input.passMark === null || (input.passMark === undefined && stored.rows[0].pass_mark === null))) {
      throw badRequest("A graded quiz needs a pass mark from 0 to 100. Choose Survey for ungraded responses.");
    }
    const update = buildUpdate(input, ASSESSMENT_COLUMNS);
    if (!update) throw badRequest("Nothing to update");

    const result = await pool.query(
      `UPDATE assessments SET ${update.clause}, updated_at = now()
        WHERE id = $${update.values.length + 1}
        RETURNING *, slug::text AS slug`,
      [...update.values, req.params.id]
    );
    if (result.rowCount === 0) throw notFound("Quiz not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

adminAssessmentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM assessments WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) throw notFound("Quiz not found");
    res.status(204).end();
  })
);

/* --------------------------------------------------------------- questions */

adminAssessmentsRouter.post(
  "/:id/questions",
  asyncHandler(async (req, res) => {
    const input = questionSchema.parse(req.body);
    const next = await pool.query<{ position: number }>(
      `SELECT COALESCE(MAX(position) + 1, 0) AS position
         FROM assessment_questions WHERE assessment_id = $1`,
      [req.params.id]
    );

    const result = await pool.query(
      `INSERT INTO assessment_questions (assessment_id, position, prompt, help_text, kind, required)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.params.id,
        input.position ?? next.rows[0].position,
        input.prompt ?? "New question",
        input.helpText ?? "",
        input.kind ?? "single",
        input.required ?? true,
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

const QUESTION_COLUMNS = ["prompt", "help_text", "kind", "required", "position"] as const;

adminAssessmentsRouter.patch(
  "/questions/:questionId",
  asyncHandler(async (req, res) => {
    const input = questionSchema.parse(req.body);
    const update = buildUpdate(input, QUESTION_COLUMNS);
    if (!update) throw badRequest("Nothing to update");

    const result = await pool.query(
      `UPDATE assessment_questions SET ${update.clause}
        WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.questionId]
    );
    if (result.rowCount === 0) throw notFound("Question not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

adminAssessmentsRouter.delete(
  "/questions/:questionId",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM assessment_questions WHERE id = $1`, [
      req.params.questionId,
    ]);
    if (result.rowCount === 0) throw notFound("Question not found");
    res.status(204).end();
  })
);

adminAssessmentsRouter.post(
  "/:id/questions/reorder",
  asyncHandler(async (req, res) => {
    const { ids } = reorderSchema.parse(req.body);
    // One statement rather than a loop: a half-applied reorder leaves two
    // questions sharing a position, and the editor then shows them in an order
    // nobody chose.
    await pool.query(
      `UPDATE assessment_questions q
          SET position = ordered.position
         FROM unnest($2::int[]) WITH ORDINALITY AS ordered(id, position)
        WHERE q.id = ordered.id AND q.assessment_id = $1`,
      [req.params.id, ids]
    );
    res.status(204).end();
  })
);

/* ----------------------------------------------------------------- answers */

adminAssessmentsRouter.post(
  "/questions/:questionId/answers",
  asyncHandler(async (req, res) => {
    const input = answerSchema.parse(req.body);
    const next = await pool.query<{ position: number }>(
      `SELECT COALESCE(MAX(position) + 1, 0) AS position
         FROM assessment_answers WHERE question_id = $1`,
      [req.params.questionId]
    );

    const result = await pool.query(
      `INSERT INTO assessment_answers (question_id, position, label, weight, is_correct, feedback)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.params.questionId,
        input.position ?? next.rows[0].position,
        input.label ?? "New answer",
        input.weight ?? 0,
        input.isCorrect ?? false,
        input.feedback ?? "",
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

const ANSWER_COLUMNS = ["label", "weight", "is_correct", "feedback", "position"] as const;

adminAssessmentsRouter.patch(
  "/answers/:answerId",
  asyncHandler(async (req, res) => {
    const input = answerSchema.parse(req.body);
    const update = buildUpdate(input, ANSWER_COLUMNS);
    if (!update) throw badRequest("Nothing to update");

    const result = await pool.query(
      `UPDATE assessment_answers SET ${update.clause}
        WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.answerId]
    );
    if (result.rowCount === 0) throw notFound("Answer not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

adminAssessmentsRouter.delete(
  "/answers/:answerId",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM assessment_answers WHERE id = $1`, [
      req.params.answerId,
    ]);
    if (result.rowCount === 0) throw notFound("Answer not found");
    res.status(204).end();
  })
);

/* ----------------------------------------------------------------- results */

adminAssessmentsRouter.post(
  "/:id/results",
  asyncHandler(async (req, res) => {
    const input = resultSchema.parse(req.body);
    const title = input.title ?? "New result";

    const existing = await pool.query<{ slug: string; position: number }>(
      `SELECT slug, position FROM assessment_results WHERE assessment_id = $1`,
      [req.params.id]
    );
    const used = new Set(existing.rows.map((row) => row.slug));
    const base = slugify(title) || "result";
    let slug = base;
    let suffix = 2;
    while (used.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }

    const nextPosition = existing.rows.reduce((max, row) => Math.max(max, row.position + 1), 0);

    const result = await pool.query(
      `INSERT INTO assessment_results
         (assessment_id, position, slug, title, body_md, image_url, min_score, max_score,
          apply_tag_id, subscribe_sequence_id, cta_label, cta_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        req.params.id,
        input.position ?? nextPosition,
        slug,
        title,
        input.bodyMd ?? "",
        input.imageUrl ?? "",
        input.minScore ?? 0,
        input.maxScore ?? OPEN_ENDED,
        input.applyTagId ?? null,
        input.subscribeSequenceId ?? null,
        input.ctaLabel ?? "",
        input.ctaUrl ?? "",
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

const RESULT_COLUMNS = [
  "title",
  "body_md",
  "image_url",
  "min_score",
  "max_score",
  "apply_tag_id",
  "subscribe_sequence_id",
  "cta_label",
  "cta_url",
  "position",
] as const;

adminAssessmentsRouter.patch(
  "/results/:resultId",
  asyncHandler(async (req, res) => {
    const input = resultSchema.parse(req.body);
    if (
      input.minScore !== undefined &&
      input.maxScore !== undefined &&
      input.minScore > input.maxScore
    ) {
      throw badRequest("The lowest score has to be below the highest");
    }

    const update = buildUpdate(input, RESULT_COLUMNS);
    if (!update) throw badRequest("Nothing to update");

    // The slug is left alone on rename: it is what the result page is addressed
    // by, and a renamed archetype must not break a link somebody has already
    // shared.
    const result = await pool.query(
      `UPDATE assessment_results SET ${update.clause}
        WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.resultId]
    );
    if (result.rowCount === 0) throw notFound("Result not found");
    res.json(rowToCamel(result.rows[0]));
  })
);

adminAssessmentsRouter.delete(
  "/results/:resultId",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM assessment_results WHERE id = $1`, [
      req.params.resultId,
    ]);
    if (result.rowCount === 0) throw notFound("Result not found");
    res.status(204).end();
  })
);

adminAssessmentsRouter.post(
  "/:id/results/reorder",
  asyncHandler(async (req, res) => {
    const { ids } = reorderSchema.parse(req.body);
    // Order is not cosmetic here: overlapping bands are resolved by taking the
    // first match in position order, so this statement decides where a score
    // that sits in two bands actually lands.
    await pool.query(
      `UPDATE assessment_results r
          SET position = ordered.position
         FROM unnest($2::int[]) WITH ORDINALITY AS ordered(id, position)
        WHERE r.id = ordered.id AND r.assessment_id = $1`,
      [req.params.id, ids]
    );
    res.status(204).end();
  })
);

/* ---------------------------------------------------------------- reports */

adminAssessmentsRouter.get(
  "/:id/attempts",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const result = await pool.query<{ id: string }>(
      `SELECT t.id, t.email::text AS email, t.score, t.max_score, t.percent, t.passed,
              t.completed_at, t.responses, t.member_id, r.title AS result_title, COALESCE(c.name, m.name) AS contact_name, c.id AS contact_id
         FROM assessment_attempts t
         LEFT JOIN assessment_results r ON r.id = t.result_id
         LEFT JOIN contacts c           ON c.id = t.contact_id
         LEFT JOIN members m            ON m.id = t.member_id
        WHERE t.assessment_id = $1 AND t.completed_at IS NOT NULL
        ORDER BY t.completed_at DESC
        LIMIT $2`,
      [req.params.id, limit]
    );
    // The attempt id is a BIGSERIAL, which node-postgres hands back as a string
    // because a bigint does not fit a JS number in the general case. Coerced
    // here so a client is not left to remember it.
    res.json(result.rows.map((row) => ({ ...rowToCamel(row), id: Number(row.id) })));
  })
);

/**
 * How the people who finished it were split.
 *
 * `unmatched` is the number this report exists for: attempts that landed in no
 * band at all mean the score ranges do not cover the scores the questions can
 * produce, and every one of those people saw a quiz with no result on the end.
 */
adminAssessmentsRouter.get(
  "/:id/report",
  asyncHandler(async (req, res) => {
    const totals = await pool.query<{
      attempts: string;
      unmatched: string;
      average_percent: string | null;
      passed: string;
    }>(
      `SELECT count(*)::text                                          AS attempts,
              count(*) FILTER (WHERE result_id IS NULL)::text         AS unmatched,
              round(avg(percent))::text                               AS average_percent,
              count(*) FILTER (WHERE passed)::text                    AS passed
         FROM assessment_attempts
        WHERE assessment_id = $1 AND completed_at IS NOT NULL`,
      [req.params.id]
    );

    const split = await pool.query(
      `SELECT r.id, r.title, r.min_score, r.max_score, t.name AS tag_name,
              count(a.id)::int AS attempt_count
         FROM assessment_results r
         LEFT JOIN tags t                 ON t.id = r.apply_tag_id
         LEFT JOIN assessment_attempts a  ON a.result_id = r.id AND a.completed_at IS NOT NULL
        WHERE r.assessment_id = $1
        GROUP BY r.id, r.title, r.min_score, r.max_score, r.position, t.name
        ORDER BY r.position, r.id`,
      [req.params.id]
    );

    const row = totals.rows[0];
    res.json({
      attempts: Number(row?.attempts ?? 0),
      unmatched: Number(row?.unmatched ?? 0),
      averagePercent: Number(row?.average_percent ?? 0),
      passed: Number(row?.passed ?? 0),
      results: rowsToCamel(split.rows),
    });
  })
);
