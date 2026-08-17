import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { leadsLimiter } from "../../middleware/rateLimit";
import { applyTags, recordActivity, upsertContact } from "../../services/contacts";
import { enrollContact } from "../../services/sequences";
import {
  loadPublicAssessment,
  loadResult,
  saveAttempt,
  scoreAttempt,
  type AttemptResponse,
} from "../../services/assessments";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { plainText } from "../../utils/plainText";

/**
 * The public quiz.
 *
 * This is the acquisition mechanic, so the two things that break it are guarded
 * here rather than left to a convention: the answer key never leaves the server
 * (see `loadPublicAssessment`), and the tag plus the sequence on the matched
 * result are applied on the way out, because that pairing is the entire funnel.
 */

export const assessmentsPublicRouter = Router();

/** Faster than this and nobody read the questions, let alone answered them. */
const MIN_FILL_MS = 2000;

/** Enough for the longest quiz here, and a ceiling on what one POST can cost. */
const MAX_RESPONSES = 200;

const submitSchema = z.object({
  responses: z
    .array(
      z.object({
        questionId: z.number().int().positive(),
        answerIds: z.array(z.number().int().positive()).max(50).optional(),
        text: z.string().max(2000).optional(),
      })
    )
    .max(MAX_RESPONSES),
  email: z.string().trim().email().max(320).optional(),
  name: z.string().trim().max(200).optional(),
  timezone: z.string().trim().max(80).optional(),
  // The honeypot pair, same shape as the lead form's.
  company: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
});

assessmentsPublicRouter.get(
  "/assessments/:slug",
  asyncHandler(async (req, res) => {
    const assessment = await loadPublicAssessment(req.params.slug);
    if (!assessment) throw notFound("Quiz not found");
    res.json(assessment);
  })
);

assessmentsPublicRouter.post(
  "/assessments/:slug/submit",
  leadsLimiter,
  asyncHandler(async (req, res) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid submission", parsed.error.flatten());
    const input = parsed.data;

    const assessmentRes = await pool.query<{
      id: number;
      title: string;
      require_email: boolean;
      show_feedback: boolean;
    }>(
      `SELECT id, title, require_email, show_feedback
         FROM assessments WHERE slug = $1 AND published`,
      [req.params.slug]
    );
    const assessment = assessmentRes.rows[0];
    if (!assessment) throw notFound("Quiz not found");

    const responses: AttemptResponse[] = input.responses.map((response) => ({
      questionId: response.questionId,
      answerIds: response.answerIds,
      // Free-text answers are shown back on the admin's attempt list, so they
      // go through the one sanitiser every member-authored string does.
      text: response.text === undefined ? undefined : plainText(response.text),
    }));

    const scored = await scoreAttempt(assessment.id, responses);
    if (!scored) throw notFound("Quiz not found");
    if (scored.missingQuestionIds.length > 0) {
      throw badRequest("Some questions still need an answer", {
        missingQuestionIds: scored.missingQuestionIds,
      });
    }

    const email = (input.email ?? "").trim().toLowerCase();
    if (assessment.require_email && !email) {
      throw badRequest("An email address is needed to show your result");
    }

    const result = scored.resultId === null ? null : await loadResult(scored.resultId);

    // A filled honeypot, or a form returned faster than anyone can read it, is
    // a script. It gets its score back — that costs nothing and tells a bot
    // nothing — but no contact is created, no tag applied and no sequence
    // started, which is what it was actually after.
    const isBot =
      Boolean(input.company?.trim()) ||
      (input.elapsedMs !== undefined && input.elapsedMs < MIN_FILL_MS);

    let contactId: number | null = null;
    if (email && !isBot) {
      contactId = await upsertContact({
        email,
        name: input.name ?? "",
        timezone: input.timezone ?? "",
        source: `quiz: ${req.params.slug}`,
        consentSource: `quiz: ${req.params.slug}`,
        consentIp: req.ip ?? "",
      });

      await saveAttempt({
        assessmentId: assessment.id,
        contactId,
        memberId: null,
        email,
        responses,
        scored,
      });

      await recordActivity({
        contactId,
        kind: "assessment.completed",
        title: `Took the ${assessment.title} quiz`,
        body: result ? `Result: ${result.title}` : "",
        subjectType: "assessment",
        subjectId: assessment.id,
        meta: { score: scored.score, percent: scored.percent, result: result?.slug ?? "" },
      });

      if (result?.applyTagId !== null && result?.applyTagId !== undefined) {
        const tag = await pool.query<{ slug: string }>(`SELECT slug::text AS slug FROM tags WHERE id = $1`, [
          result.applyTagId,
        ]);
        const slug = tag.rows[0]?.slug;
        if (slug) await applyTags(contactId, [slug], `quiz:${req.params.slug}`);
      }

      // The archetype's own five-email sequence. Failing to enrol must not cost
      // the reader their result page — they answered the questions, and the
      // page is what they were promised.
      if (result?.subscribeSequenceId) {
        await enrollContact(result.subscribeSequenceId, contactId, {
          reason: `quiz result: ${result.slug}`,
        }).catch((err: unknown) => {
          console.error(
            `[quiz] enrolling contact ${contactId} in sequence ${result.subscribeSequenceId} failed:`,
            err instanceof Error ? err.message : err
          );
        });
      }
    } else if (!isBot) {
      // An anonymous quiz still records the attempt: the completion rate and
      // the archetype split are the numbers that say whether it is working.
      await saveAttempt({
        assessmentId: assessment.id,
        contactId: null,
        memberId: null,
        email: "",
        responses,
        scored,
      });
    }

    res.status(201).json({
      score: scored.score,
      maxScore: scored.maxScore,
      percent: scored.percent,
      passed: scored.passed,
      // Feedback is per-answer and only shown when the owner turned it on; on a
      // graded test it is otherwise a route to the answer key, one attempt at a
      // time.
      feedback: assessment.show_feedback ? scored.feedback : [],
      result: result
        ? {
            slug: result.slug,
            title: result.title,
            bodyMd: result.bodyMd,
            imageUrl: result.imageUrl,
            ctaLabel: result.ctaLabel,
            ctaUrl: result.ctaUrl,
          }
        : null,
    });
  })
);
