import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";

/**
 * Course curriculum: course -> modules -> lessons.
 *
 * Mounted at /admin/curriculum. Lesson video/attachment fields hold URLs
 * produced by the media library, so a lesson never owns bytes directly.
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

    const result = await pool.query(
      `INSERT INTO course_lessons
         (module_id, title, body_md, video_url, attachment_url, duration_minutes, preview, published, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
         (SELECT COALESCE(MAX(sort), -1) + 1 FROM course_lessons WHERE module_id = $1))
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
      ],
    );
    res.status(201).json(rowToCamel<CourseLesson>(result.rows[0]));
  }),
);

adminCurriculumRouter.put(
  "/lessons/:id",
  asyncHandler(async (req, res) => {
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
