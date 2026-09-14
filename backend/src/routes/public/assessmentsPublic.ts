import { assertLessonAssessmentAccess } from "../../services/lessonAssessments";
import { recomputeCourseProgress } from "../../services/curriculum";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { leadsLimiter } from "../../middleware/rateLimit";
import { applyTags, recordActivity, upsertContactWithStatus } from "../../services/contacts";
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
import { publishDomainEvent } from "../../services/domainEvents";
import { optionalMember } from "../../middleware/memberAuth";
import { forbidden } from "../../utils/httpError";

/**
 * The public quiz.
 *
 * This is the acquisition mechanic, so the two things that break it are guarded
 * here rather than left to a convention: the answer key never leaves the server
 * (see `loadPublicAssessment`), and the tag plus the sequence on the matched
 * result are applied on the way out, because that pairing is the entire funnel.
 */

export const assessmentsPublicRouter = Router();

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
  optionalMember,
  asyncHandler(async (req, res) => {
    const assessment = await loadPublicAssessment(req.params.slug);
    if (!assessment) throw notFound("Quiz not found");
    if (assessment.lessonId !== null) await assertLessonAssessmentAccess(req.member?.id, assessment.lessonId);
    res.json(assessment);
  })
);

assessmentsPublicRouter.post(
  "/assessments/:slug/submit",
  optionalMember,
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
      kind: string;
      lesson_id: number | null;
      max_attempts: number | null;
      require_pass: boolean;
      pass_message: string;
      fail_message: string;
    }>(
      `SELECT id, title, require_email, show_feedback, kind, lesson_id, max_attempts, require_pass, pass_message, fail_message
         FROM assessments WHERE slug = $1 AND published`,
      [req.params.slug]
    );
    const assessment = assessmentRes.rows[0];
    if (!assessment) throw notFound("Quiz not found");

    if (req.member?.impersonatedBy !== undefined) {
      throw forbidden("View as customer is read-only.");
    }

    if (assessment.lesson_id !== null) await assertLessonAssessmentAccess(req.member?.id, assessment.lesson_id);
    let memberIdentity: { contact_id: number | null; name: string } | null = null;
    if (req.member && assessment.lesson_id !== null) {
      const owned = await pool.query<{ contact_id: number | null; name: string }>(
        `SELECT m.contact_id, m.name
           FROM members m
          WHERE m.id = $1
            AND EXISTS (
              SELECT 1
                FROM course_lessons l
                JOIN course_modules cm ON cm.id = l.module_id
                JOIN products p ON p.kind = 'course' AND p.course_id = cm.course_id
                JOIN access_grants g ON g.product_id = p.id AND g.member_id = m.id
               WHERE l.id = $2 AND g.status = 'active'
                 AND (g.expires_at IS NULL OR g.expires_at > now())
            )`,
        [req.member.id, assessment.lesson_id],
      );
      memberIdentity = owned.rows[0] ?? null;
      if (!memberIdentity) throw notFound("Quiz not found");

      if (assessment.max_attempts !== null) {
        const attempts = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM assessment_attempts
            WHERE assessment_id = $1 AND member_id = $2 AND completed_at IS NOT NULL`,
          [assessment.id, req.member.id],
        );
        if (Number(attempts.rows[0]?.count ?? 0) >= assessment.max_attempts) {
          throw badRequest("You have used every attempt allowed for this test.");
        }
      }
    }

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

    const email = (req.member?.email ?? input.email ?? "").trim().toLowerCase();
    if (assessment.require_email && !email) {
      throw badRequest("An email address is needed to show your result");
    }

    const result = scored.resultId === null ? null : await loadResult(scored.resultId);

    // Fast readers and autofill can complete a short quiz in under two seconds.
    // Timing is not proof of abuse. A rejected submission must never look saved.
    if (!memberIdentity && input.company?.trim()) {
      throw badRequest("Your answers were not saved. Please refresh the quiz and try again.");
    }

    let contactId: number | null = null;
    let contactWasCreated = false;
    let attemptId: number | null = null;
    if (req.member && memberIdentity) {
      contactId = memberIdentity.contact_id;
      if (contactId === null) {
        const contact = await upsertContactWithStatus({ email, name: memberIdentity.name, source: "lesson assessment" });
        contactId = contact.id;
        await pool.query(`UPDATE members SET contact_id=$2 WHERE id=$1 AND contact_id IS NULL`,[req.member.id,contactId]);
      }
      attemptId = await saveAttempt({
        assessmentId: assessment.id,
        contactId,
        memberId: req.member.id,
        email,
        responses,
        scored,
      });
      if ((scored.passed === true || assessment.kind === "survey" || !assessment.require_pass) && assessment.lesson_id !== null) {
        await pool.query(
          `INSERT INTO lesson_progress (member_id, lesson_id, completed_at, first_viewed_at, last_viewed_at)
           VALUES ($1,$2,now(),now(),now())
           ON CONFLICT (member_id, lesson_id) DO UPDATE
             SET completed_at = COALESCE(lesson_progress.completed_at, now()), last_viewed_at = now()`,
          [req.member.id, assessment.lesson_id],
        );
        const course = await pool.query(`SELECT m.course_id FROM course_lessons l JOIN course_modules m ON m.id=l.module_id WHERE l.id=$1`,[assessment.lesson_id]);
        if (course.rows[0]) await recomputeCourseProgress(req.member.id, course.rows[0].course_id);
      }
    } else if (email) {
      const contact = await upsertContactWithStatus({
        email,
        name: memberIdentity?.name ?? input.name ?? "",
        timezone: input.timezone ?? "",
        source: `quiz: ${req.params.slug}`,
        consentSource: `quiz: ${req.params.slug}`,
        consentIp: req.ip ?? "",
      });
      contactId = contact.id;
      contactWasCreated = contact.created;

      attemptId = await saveAttempt({
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
      if (contactWasCreated) {
        await publishDomainEvent("contact_created", {
          eventKey: `contact-created:${contactId}`,
          contactId,
          email,
          name: input.name ?? "",
          source: `quiz:${req.params.slug}`,
        });
      }
    } else {
      // An anonymous quiz still records the attempt: the completion rate and
      // the archetype split are the numbers that say whether it is working.
      attemptId = await saveAttempt({
        assessmentId: assessment.id,
        contactId: null,
        memberId: null,
        email: "",
        responses,
        scored,
      });
    }

    if (attemptId !== null) {
      const eventFacts = {
        attemptId,
        score: scored.score,
        maxScore: scored.maxScore,
        percent: scored.percent,
        passed: scored.passed ?? false,
        resultId: scored.resultId ?? 0,
      };
      await publishDomainEvent("assessment_completed", {
        eventKey: `assessment-completed:attempt:${attemptId}`,
        contactId,
        email,
        name: input.name ?? "",
        subjectId: assessment.id,
        source: `quiz:${req.params.slug}`,
        facts: eventFacts,
      });
      if (scored.passed === true) {
        await publishDomainEvent("assessment_passed", {
          eventKey: `assessment-passed:attempt:${attemptId}`,
          contactId,
          email,
          name: input.name ?? "",
          subjectId: assessment.id,
          source: `quiz:${req.params.slug}`,
          facts: eventFacts,
        });
      }
    }

    res.status(201).json({
      attemptId,
      score: scored.score,
      maxScore: scored.maxScore,
      percent: scored.percent,
      passed: scored.passed,
      message: assessment.kind === "survey" ? "Your responses have been saved." : scored.passed ? assessment.pass_message : assessment.fail_message,
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

assessmentsPublicRouter.get("/assessments/:slug/my-results", optionalMember, asyncHandler(async (req,res) => {
  const assessment = await loadPublicAssessment(req.params.slug);
  if (!assessment || assessment.lessonId === null) throw notFound("Assessment not found");
  await assertLessonAssessmentAccess(req.member?.id, assessment.lessonId);
  const results = await pool.query(`SELECT id, score, max_score AS "maxScore", percent, passed,
    completed_at AS "completedAt", responses FROM assessment_attempts
    WHERE assessment_id=$1 AND member_id=$2 ORDER BY completed_at DESC LIMIT 50`,[assessment.id,req.member!.id]);
  res.json(results.rows);
}));
