import { Request, Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import {
  flattenLessons,
  loadCourseForPreview,
  type PreviewCourseView,
} from "../../services/curriculum";
import {
  loadPublicAssessment,
  loadResult,
  scoreAttempt,
  type AttemptResponse,
} from "../../services/assessments";
import {
  ADMIN_PREVIEW_TTL_SECONDS,
  adminPreviewUrl,
  isProtectedRef,
} from "../../services/signedUrls";
import { neighbour, toOutlineJson } from "../member/library";

/**
 * `/api/admin/courses/:courseId/preview` — "Preview as student".
 *
 * The course as the member player renders it, answered to an administrator
 * instead of to a member. The responses are the member endpoints' shapes field
 * for field (routes/member/library.ts builds the outline for both), so the admin
 * app feeds the real player components from here rather than a lookalike.
 *
 * What makes this safe to hand to somebody with no grant is everything it does
 * not do. Nobody is impersonated and no member session is minted. Nothing is
 * written: no `lesson_progress` row, no attempt, no download event. And the
 * member entitlement check is not touched or widened — media leaves through the
 * administrator's own link family (`adminPreviewUrl`, redeemed at
 * `/api/admin-files`), which names a media-library row and the admin who asked,
 * and is refused the moment that admin account stops being active.
 *
 * Mounted inside the courses router, so it sits behind `requireAuth` and the
 * products module gate: the reads need `products.view`, and the one POST
 * (scoring a quiz, which stores nothing) is held to `products.manage` like every
 * other non-GET on that mount.
 */
export const adminCoursePreviewRouter = Router({ mergeParams: true });

/** Postgres int4 ceiling. An id it cannot hold is a 404, not a failed query. */
const MAX_INT4 = 2_147_483_647;

const COURSE_MISSING = "We couldn't find that course.";
const LESSON_MISSING = "We couldn't find that lesson.";
const FILE_MISSING = "We couldn't find that file.";
const QUIZ_MISSING = "Quiz not found";

const idSchema = z.coerce.number().int().positive().max(MAX_INT4);

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

/** The signed-in administrator. Non-null: this router is behind requireAuth. */
function adminId(req: Request): number {
  return Number(req.user?.sub);
}

function readCourseId(req: Request): number {
  const parsed = idSchema.safeParse(req.params.courseId);
  if (!parsed.success) throw notFound(COURSE_MISSING);
  return parsed.data;
}

/**
 * Where the preview lives in the admin app.
 *
 * The member API builds `/library/...` into every `href` it returns; these are
 * the same links pointed at the preview route, so "Start the course" and the
 * outline stay inside the admin instead of walking out to the member site.
 */
export function previewPath(courseId: number, lessonSlug?: string): string {
  const base = `/admin/courses/${courseId}/preview`;
  return lessonSlug === undefined ? base : `${base}/lessons/${lessonSlug}`;
}

function toPreviewOutline(course: PreviewCourseView) {
  const outline = toOutlineJson(course, String(course.courseId));
  const drafts = new Set(course.draftLessonIds);

  return {
    ...outline,
    continueLesson: outline.continueLesson
      ? {
          ...outline.continueLesson,
          href: previewPath(course.courseId, outline.continueLesson.lessonSlug),
        }
      : null,
    modules: outline.modules.map((mod) => ({
      ...mod,
      lessons: mod.lessons.map((lesson) => ({
        ...lesson,
        href: previewPath(course.courseId, lesson.slug),
        // Preview-only markers for the outline. The member endpoint never sends
        // either, which is what keeps them off a student's screen.
        draft: drafts.has(lesson.id),
        studentLock: course.studentLocks[lesson.id] ?? "",
      })),
    })),
  };
}

/**
 * A URL the player can use for one stored media reference, for this admin.
 *
 * The same three cases as the member player's `playableUrl`, with the first one
 * answered differently: a protected reference is looked up in the media library
 * and signed as an admin preview link — exactly what POST /admin/media/preview
 * does for the course builder. A reference the library no longer holds has no
 * row for a token to name, so it comes back empty and the player says the media
 * is not available rather than being handed a link that 404s.
 */
async function previewMedia(
  reference: string,
  adminUserId: number,
  now: Date
): Promise<{ url: string; expiresAt: Date | null }> {
  if (!isProtectedRef(reference)) return { url: reference, expiresAt: null };

  const found = await pool.query<{ id: number }>(
    "SELECT id FROM media_assets WHERE url = $1 ORDER BY id DESC LIMIT 1",
    [reference.trim()]
  );
  const asset = found.rows[0];
  if (asset === undefined) return { url: "", expiresAt: null };

  return adminPreviewUrl({ assetId: asset.id, adminUserId, now });
}

/** 404 unless the lesson sits inside the course the URL names. */
async function assertLessonInCourse(lessonId: number, courseId: number): Promise<void> {
  const found = await pool.query(
    `SELECT 1 FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
      WHERE l.id = $1 AND m.course_id = $2`,
    [lessonId, courseId]
  );
  if (found.rowCount === 0) throw notFound(QUIZ_MISSING);
}

/**
 * GET /api/admin/courses/:courseId/preview
 *
 * The member's `GET /api/member/library/:productSlug`, for a course product.
 * Addressed by course id rather than product slug because a course being built
 * may not be attached to a product yet; where one is, its title and artwork are
 * used, since that is what the student's page is headed with.
 */
adminCoursePreviewRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const courseId = readCourseId(req);

    const [course, productRes, publishedRes] = await Promise.all([
      loadCourseForPreview(courseId),
      pool.query<{
        id: number;
        title: string;
        subtitle: string;
        description: string;
        thumbnail_url: string;
      }>(
        `SELECT id, title, subtitle, description, thumbnail_url
           FROM products
          WHERE kind = 'course' AND course_id = $1 AND status <> 'archived'
          ORDER BY id LIMIT 1`,
        [courseId]
      ),
      pool.query<{ published: boolean }>(`SELECT published FROM courses WHERE id = $1`, [courseId]),
    ]);
    if (!course) throw notFound(COURSE_MISSING);

    const product = productRes.rows[0];

    res.json({
      productId: product?.id ?? 0,
      slug: String(courseId),
      title: product?.title ?? course.title,
      subtitle: product?.subtitle ?? course.subtitle,
      description: product?.description ?? course.description,
      thumbnailUrl: product?.thumbnail_url ?? course.image,
      kind: "course",
      kindLabel: "Courses",
      // Preview-only: the banner says so when the course itself is unpublished.
      courseDraft: publishedRes.rows[0]?.published === false,
      course: toPreviewOutline(course),
    });
  })
);

interface LessonContentRow {
  body_md: string;
  video_url: string;
  audio_url: string;
  embed_html: string;
  transcript: string;
  captions_url: string;
  attachment_url: string;
  assessment_slug: string | null;
  tool_key: string | null;
}

/**
 * GET /api/admin/courses/:courseId/preview/lessons/:lessonSlug
 *
 * The member's lesson read, minus the two things that are about a member: the
 * `first_viewed_at` row it records, and the member-bound media links. Every
 * lesson is answered unlocked — draft, dripped or sequenced — because seeing the
 * content before students can is the reason to open a preview.
 *
 * The linked assessment keeps the member rule (published only): a quiz still in
 * draft shows the same "not live yet" panel a student would get.
 */
adminCoursePreviewRouter.get(
  "/lessons/:lessonSlug",
  asyncHandler(async (req, res) => {
    const courseId = readCourseId(req);
    const slug = slugSchema.safeParse(req.params.lessonSlug);
    if (!slug.success) throw notFound(LESSON_MISSING);

    const course = await loadCourseForPreview(courseId);
    if (!course) throw notFound(LESSON_MISSING);

    const lessons = flattenLessons(course.modules);
    // Curriculum order decides between two lessons sharing a slug in different
    // modules, exactly as it does for a member.
    const index = lessons.findIndex((l) => l.slug === slug.data);
    if (index < 0) throw notFound(LESSON_MISSING);
    const lesson = lessons[index];

    const [content, files] = await Promise.all([
      pool.query<LessonContentRow>(
        `SELECT l.body_md, l.video_url, l.audio_url, l.embed_html, l.transcript, l.captions_url,
                l.attachment_url, l.tool_key, a.slug::text AS assessment_slug
           FROM course_lessons l
           LEFT JOIN LATERAL (
             SELECT slug FROM assessments
              WHERE lesson_id = l.id AND kind IN ('graded','survey') AND published
              ORDER BY id LIMIT 1
           ) a ON true
          WHERE l.id = $1`,
        [lesson.id]
      ),
      pool.query<{
        id: number;
        title: string;
        filename: string;
        mime: string;
        size_bytes: string | number;
      }>(
        `SELECT id, title, filename, mime, size_bytes
           FROM lesson_files WHERE lesson_id = $1 ORDER BY sort, id`,
        [lesson.id]
      ),
    ]);

    const body = content.rows[0];
    if (!body) throw notFound(LESSON_MISSING);

    const mintedAt = new Date();
    const admin = adminId(req);
    const [video, audio, captions, attachment] = await Promise.all([
      previewMedia(body.video_url, admin, mintedAt),
      previewMedia(body.audio_url, admin, mintedAt),
      previewMedia(body.captions_url, admin, mintedAt),
      previewMedia(body.attachment_url, admin, mintedAt),
    ]);
    const mediaExpiresAt =
      [video, audio, captions, attachment]
        .map((signed) => signed.expiresAt)
        .find((value) => value !== null) ?? null;

    res.json({
      product: { slug: String(courseId), title: course.title },
      course: {
        courseId: course.courseId,
        slug: course.slug,
        title: course.title,
        timezone: course.timezone,
        progress: course.progress,
      },
      prev: neighbour(lessons[index - 1]),
      next: neighbour(lessons[index + 1]),
      lesson: {
        id: lesson.id,
        slug: lesson.slug,
        title: lesson.title,
        contentType: lesson.contentType,
        moduleId: lesson.moduleId,
        moduleTitle: lesson.moduleTitle,
        locked: false,
        unlocksAt: null,
        unlockLabel: "",
        durationMinutes: lesson.durationMinutes,
        videoDurationSeconds: lesson.videoDurationSeconds,
        preview: lesson.preview,
        bodyMd: body.body_md,
        videoUrl: video.url,
        audioUrl: audio.url,
        embedHtml: body.embed_html,
        transcript: body.transcript,
        captionsUrl: captions.url,
        attachmentUrl: attachment.url,
        assessmentSlug: body.assessment_slug,
        toolKey: body.tool_key,
        mediaExpiresAt: mediaExpiresAt === null ? null : mediaExpiresAt.toISOString(),
        commentsEnabled: lesson.commentsEnabled,
        notesEnabled: lesson.notesEnabled,
        files: files.rows.map((f) => ({
          id: f.id,
          title: f.title || f.filename,
          filename: f.filename,
          mime: f.mime,
          sizeBytes: Number(f.size_bytes) || 0,
          downloadUrl: `/api${previewPath(courseId)}/files/${f.id}/link`,
        })),
        progress: {
          completed: false,
          completedAt: null,
          lastPositionSeconds: 0,
          watchedPercent: 0,
        },
      },
    });
  })
);

/**
 * GET /api/admin/courses/:courseId/preview/files/:fileId/link
 *
 * The member's `POST /downloads/lesson/:id/link`, answered with an admin preview
 * link. A GET, and so on the `view` permission, because unlike the member's it
 * mints nothing that is logged against a customer: `/api/admin-files` writes no
 * `download_events` row.
 */
adminCoursePreviewRouter.get(
  "/files/:fileId/link",
  asyncHandler(async (req, res) => {
    const courseId = readCourseId(req);
    const fileId = idSchema.safeParse(req.params.fileId);
    if (!fileId.success) throw notFound(FILE_MISSING);

    const found = await pool.query<{
      id: number;
      title: string;
      storage_path: string;
      filename: string;
      size_bytes: string | number | null;
    }>(
      `SELECT lf.id, lf.title, lf.storage_path, lf.filename, lf.size_bytes
         FROM lesson_files lf
         JOIN course_lessons l ON l.id = lf.lesson_id
         JOIN course_modules m ON m.id = l.module_id
        WHERE lf.id = $1 AND m.course_id = $2`,
      [fileId.data, courseId]
    );
    const file = found.rows[0];
    if (!file) throw notFound(FILE_MISSING);

    const now = new Date();
    const link = await previewMedia(file.storage_path, adminId(req), now);
    if (link.url === "") {
      throw notFound(
        "That file is no longer in the media library, so it cannot be opened in the preview."
      );
    }

    const expiresAt =
      link.expiresAt ?? new Date(now.getTime() + ADMIN_PREVIEW_TTL_SECONDS * 1000);

    res.json({
      url: link.url,
      filename: file.filename,
      title: file.title || file.filename,
      sizeBytes: Number(file.size_bytes) || 0,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: ADMIN_PREVIEW_TTL_SECONDS,
    });
  })
);

/**
 * GET /api/admin/courses/:courseId/preview/assessments/:slug
 *
 * The quiz exactly as a student is sent it — `loadPublicAssessment`, so no
 * answer key — once it is shown to belong to a lesson of this course.
 */
adminCoursePreviewRouter.get(
  "/assessments/:slug",
  asyncHandler(async (req, res) => {
    const courseId = readCourseId(req);
    const assessment = await loadPublicAssessment(String(req.params.slug ?? ""));
    if (!assessment || assessment.lessonId === null) throw notFound(QUIZ_MISSING);
    await assertLessonInCourse(assessment.lessonId, courseId);
    res.json(assessment);
  })
);

const scoreSchema = z.object({
  responses: z
    .array(
      z.object({
        questionId: z.number().int().positive(),
        answerIds: z.array(z.number().int().positive()).max(50).optional(),
        text: z.string().max(2000).optional(),
      })
    )
    .max(200),
});

/**
 * POST /api/admin/courses/:courseId/preview/assessments/:slug/score
 *
 * Marks a submission with the same scorer a student's goes through and stores
 * none of it: no attempt row, no lesson completion, no contact, no domain event.
 * `attemptId` is 0 for that reason — there is no attempt to point at.
 */
adminCoursePreviewRouter.post(
  "/assessments/:slug/score",
  asyncHandler(async (req, res) => {
    const courseId = readCourseId(req);
    const parsed = scoreSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid submission", parsed.error.flatten());

    const assessmentRes = await pool.query<{
      id: number;
      show_feedback: boolean;
      kind: string;
      lesson_id: number | null;
      pass_message: string;
      fail_message: string;
    }>(
      `SELECT id, show_feedback, kind, lesson_id, pass_message, fail_message
         FROM assessments WHERE slug = $1 AND published`,
      [String(req.params.slug ?? "")]
    );
    const assessment = assessmentRes.rows[0];
    if (!assessment || assessment.lesson_id === null) throw notFound(QUIZ_MISSING);
    await assertLessonInCourse(assessment.lesson_id, courseId);

    const responses: AttemptResponse[] = parsed.data.responses.map((response) => ({
      questionId: response.questionId,
      answerIds: response.answerIds,
      text: response.text,
    }));

    const scored = await scoreAttempt(assessment.id, responses);
    if (!scored) throw notFound(QUIZ_MISSING);
    if (scored.missingQuestionIds.length > 0) {
      throw badRequest("Some questions still need an answer", {
        missingQuestionIds: scored.missingQuestionIds,
      });
    }

    const result = scored.resultId === null ? null : await loadResult(scored.resultId);

    res.json({
      attemptId: 0,
      score: scored.score,
      maxScore: scored.maxScore,
      percent: scored.percent,
      passed: scored.passed,
      message:
        assessment.kind === "survey"
          ? "Preview only — these responses were not saved."
          : scored.passed
            ? assessment.pass_message
            : assessment.fail_message,
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
