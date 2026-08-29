import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel, toSnake } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";
import { isExternalRef, isProtectedRef } from "../../services/signedUrls";

/**
 * Course curriculum: course -> modules -> lessons.
 *
 * Mounted at /admin/curriculum. A lesson never owns bytes directly: its video
 * and attachment fields hold a reference the media library produced, and the
 * only two references worth holding are one into the protected directory and
 * one on somebody else's host.
 */
export const adminCurriculumRouter = Router();

export interface CourseLesson {
  id: number;
  moduleId: number;
  title: string;
  bodyMd: string;
  videoUrl: string;
  attachmentUrl: string;
  durationMinutes: number;
  preview: boolean;
  published: boolean;
  sort: number;
}

export interface CourseModule {
  id: number;
  courseId: number;
  title: string;
  summary: string;
  sort: number;
  lessons: CourseLesson[];
}

/** Only these columns may be written from request bodies. */
const MODULE_FIELDS = ["title", "summary", "sort"] as const;
const LESSON_FIELDS = [
  "title",
  "body_md",
  "video_url",
  "attachment_url",
  "duration_minutes",
  "preview",
  "published",
  "sort",
] as const;

/**
 * The two lesson columns that hold the thing somebody paid for.
 *
 * Keyed by the COLUMN rather than by the camelCase spelling, because that is
 * what decides whether a value gets written: `buildUpdate` runs every body key
 * through `toSnake`, so `{"video_url": "/uploads/course.mp4"}` updates the same
 * column `{"videoUrl": ...}` does. Matching only the camelCase name left the
 * snake_case spelling writing a public URL straight past the check below.
 * The label is what the sentence calls it, in the words the person filling in
 * the form would use.
 */
const LESSON_MEDIA: { column: string; label: string }[] = [
  { column: "video_url", label: "video" },
  { column: "attachment_url", label: "file" },
];

/**
 * Refuses a lesson whose media anybody could open without paying.
 *
 * Three shapes can land in these columns and only two of them are safe. A
 * protected reference is a file in the directory nothing serves, handed to the
 * player as a link bound to one member and dead in two hours. An https:// link
 * is somebody else's host — a Vimeo embed, a Zoom recording — and is theirs to
 * gate, not ours. A bare key or an /uploads path is the third: a permanent,
 * unexpiring, forwardable address on the open web, which is the entire course
 * published by accident. Empty is fine; a lesson does not have to carry media.
 */
export function assertPaidMedia(body: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(body)) {
    const column = toSnake(key);
    const field = LESSON_MEDIA.find((entry) => entry.column === column);
    if (!field) continue;
    if (value === undefined || value === null) continue;
    const reference = String(value).trim();
    if (reference === "" || isProtectedRef(reference) || isExternalRef(reference)) continue;
    throw badRequest(
      `That ${field.label} was uploaded for everyone, so anyone with the web address can watch ` +
        `it without paying. Upload it again and choose 'only people who bought it'.`,
    );
  }
}

/**
 * The address the member's player reaches a lesson at.
 *
 * `course_lessons.slug` is NOT NULL DEFAULT '' with a UNIQUE (module_id, slug)
 * index over it, so a lesson inserted without one takes the empty string — the
 * first lesson in a section works and the second one fails on the index. The
 * member player addresses lessons by slug
 * (/library/:productSlug/lessons/:lessonSlug) and its slug parameter has to
 * match `^[A-Za-z0-9]`, so an empty slug is also a lesson nobody can open.
 *
 * Not exposed as an editable field: the slug is in the URL a member bookmarked
 * and in the link a "your next lesson" email already sent.
 */
export function lessonSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "lesson"
  );
}

/** GET /admin/curriculum/:courseId — modules with their lessons nested. */
adminCurriculumRouter.get(
  "/:courseId",
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;

    const modules = await pool.query(
      "SELECT * FROM course_modules WHERE course_id = $1 ORDER BY sort, id",
      [courseId],
    );
    const lessons = await pool.query(
      `SELECT l.* FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
       WHERE m.course_id = $1
       ORDER BY l.sort, l.id`,
      [courseId],
    );

    const byModule = new Map<number, CourseLesson[]>();
    for (const lesson of rowsToCamel<CourseLesson>(lessons.rows)) {
      const bucket = byModule.get(lesson.moduleId);
      if (bucket) bucket.push(lesson);
      else byModule.set(lesson.moduleId, [lesson]);
    }

    const payload = rowsToCamel<CourseModule>(modules.rows).map((mod) => ({
      ...mod,
      lessons: byModule.get(mod.id) ?? [],
    }));

    res.json(payload);
  }),
);

adminCurriculumRouter.post(
  "/:courseId/modules",
  asyncHandler(async (req, res) => {
    const { title, summary, sort } = req.body as {
      title?: string;
      summary?: string;
      sort?: number;
    };
    if (!title?.trim()) throw badRequest("Module title is required");

    const result = await pool.query(
      `INSERT INTO course_modules (course_id, title, summary, sort)
       VALUES ($1, $2, $3, COALESCE($4, (SELECT COALESCE(MAX(sort), -1) + 1 FROM course_modules WHERE course_id = $1)))
       RETURNING *`,
      [req.params.courseId, title.trim(), summary ?? "", sort ?? null],
    );
    res.status(201).json({ ...rowToCamel<CourseModule>(result.rows[0]), lessons: [] });
  }),
);

adminCurriculumRouter.put(
  "/modules/:id",
  asyncHandler(async (req, res) => {
    const update = buildUpdate(req.body as Record<string, unknown>, MODULE_FIELDS);
    if (!update) throw badRequest("No updatable fields supplied");

    const result = await pool.query(
      `UPDATE course_modules SET ${update.clause}, updated_at = now()
       WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.id],
    );
    if (result.rowCount === 0) throw notFound("Module not found");
    res.json(rowToCamel<CourseModule>(result.rows[0]));
  }),
);

adminCurriculumRouter.delete(
  "/modules/:id",
  asyncHandler(async (req, res) => {
    // Lessons cascade via the FK.
    const result = await pool.query("DELETE FROM course_modules WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) throw notFound("Module not found");
    res.status(204).end();
  }),
);

adminCurriculumRouter.post(
  "/modules/:moduleId/lessons",
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) throw badRequest("Lesson title is required");
    assertPaidMedia(body);

    // Two lessons called "Introduction" in one section is the ordinary case, so
    // the slug is disambiguated in the same statement that reads the sort.
    const result = await pool.query(
      `INSERT INTO course_lessons
         (module_id, slug, title, body_md, video_url, attachment_url, duration_minutes,
          preview, published, sort)
       SELECT $1,
              CASE WHEN taken.n = 0 THEN $9::text ELSE $9::text || '-' || (taken.n + 1) END,
              $2, $3, $4, $5, $6, $7, $8,
              (SELECT COALESCE(MAX(sort), -1) + 1 FROM course_lessons WHERE module_id = $1)
         FROM (SELECT COUNT(*)::int AS n FROM course_lessons
                WHERE module_id = $1
                  AND (slug = $9::text OR slug LIKE $9::text || '-%')) taken
       RETURNING *`,
      [
        req.params.moduleId,
        title,
        body.bodyMd ?? "",
        body.videoUrl ?? "",
        body.attachmentUrl ?? "",
        body.durationMinutes ?? 0,
        body.preview ?? false,
        body.published ?? true,
        lessonSlug(title),
      ],
    );
    res.status(201).json(rowToCamel<CourseLesson>(result.rows[0]));
  }),
);

adminCurriculumRouter.put(
  "/lessons/:id",
  asyncHandler(async (req, res) => {
    assertPaidMedia(req.body as Record<string, unknown>);

    const update = buildUpdate(req.body as Record<string, unknown>, LESSON_FIELDS);
    if (!update) throw badRequest("No updatable fields supplied");

    const result = await pool.query(
      `UPDATE course_lessons SET ${update.clause}, updated_at = now()
       WHERE id = $${update.values.length + 1} RETURNING *`,
      [...update.values, req.params.id],
    );
    if (result.rowCount === 0) throw notFound("Lesson not found");
    res.json(rowToCamel<CourseLesson>(result.rows[0]));
  }),
);

adminCurriculumRouter.delete(
  "/lessons/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM course_lessons WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) throw notFound("Lesson not found");
    res.status(204).end();
  }),
);
