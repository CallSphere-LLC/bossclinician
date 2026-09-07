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

export interface LessonFile {
  id: number;
  title: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  storagePath: string;
  sort: number;
}

export interface CourseLesson {
  id: number;
  moduleId: number;
  /** Downloadable resources attached to this lesson. */
  files?: LessonFile[];
  title: string;
  bodyMd: string;
  videoUrl: string;
  attachmentUrl: string;
  durationMinutes: number;
  preview: boolean;
  published: boolean;
  sort: number;
}

export interface CourseQuiz {
  id: number;
  title: string;
  slug: string;
  kind: string;
  published: boolean;
  sort: number;
  questionCount: number;
}

export interface CourseModule {
  id: number;
  courseId: number;
  /** Null for a top-level module; set for a submodule. */
  parentId: number | null;
  title: string;
  summary: string;
  sort: number;
  lessons: CourseLesson[];
  quizzes: CourseQuiz[];
  /** Only populated on top-level modules. */
  submodules: CourseModule[];
}

/** Only these columns may be written from request bodies. */
const MODULE_FIELDS = ["title", "summary", "sort"] as const;
/**
 * The lesson columns the admin may write.
 *
 * This list had fallen behind the table. Migrations 003 and 010 added
 * `audio_url`, `content_type`, `embed_html`, `captions_url`, `transcript`,
 * `comments_enabled`, `notes_enabled` and the drip pair, but none of them were
 * ever added here — so the columns existed, the player read them, and the
 * admin had no way to set them. `buildUpdate` silently drops any key not on
 * this list, which is why that failed quietly rather than erroring.
 */
const LESSON_FIELDS = [
  "title",
  "body_md",
  "video_url",
  "audio_url",
  "embed_html",
  "captions_url",
  "transcript",
  "content_type",
  "attachment_url",
  "thumbnail_url",
  "duration_minutes",
  "video_duration_seconds",
  "preview",
  "published",
  "comments_enabled",
  "notes_enabled",
  "require_completion",
  "drip_days",
  "drip_date",
  "module_id",
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

/**
 * GET /admin/curriculum/:courseId — the course outline.
 *
 * Modules, each with their lessons and quizzes, and each top-level module with
 * its submodules nested underneath. `lessons` stays exactly where it was on
 * every module so the existing client keeps working; `submodules` and
 * `quizzes` are additions beside it, not a reshape.
 *
 * Three queries rather than one join: a module with four lessons and two
 * quizzes would repeat its own row eight times, and the grouping has to happen
 * in JS either way.
 */
adminCurriculumRouter.get(
  "/:courseId",
  asyncHandler(async (req, res) => {
    const { courseId } = req.params;

    const [modules, lessons, quizzes, files] = await Promise.all([
      pool.query("SELECT * FROM course_modules WHERE course_id = $1 ORDER BY sort, id", [courseId]),
      pool.query(
        `SELECT l.* FROM course_lessons l
         JOIN course_modules m ON m.id = l.module_id
         WHERE m.course_id = $1
         ORDER BY l.sort, l.id`,
        [courseId],
      ),
      pool.query(
        `SELECT a.id, a.title, a.slug::text AS slug, a.kind, a.published, a.sort, a.module_id,
                (SELECT count(*)::int FROM assessment_questions q WHERE q.assessment_id = a.id)
                  AS question_count
           FROM assessments a
           JOIN course_modules m ON m.id = a.module_id
          WHERE m.course_id = $1
          ORDER BY a.sort, a.id`,
        [courseId],
      ),
      // Lesson resources, so the preview can show what a student would be able
      // to download. Read-only: this endpoint never writes.
      pool.query(
        `SELECT f.id, f.lesson_id, f.title, f.filename, f.mime, f.size_bytes,
                f.storage_path, f.sort
           FROM lesson_files f
           JOIN course_lessons l ON l.id = f.lesson_id
           JOIN course_modules m ON m.id = l.module_id
          WHERE m.course_id = $1
          ORDER BY f.sort, f.id`,
        [courseId],
      ),
    ]);

    const filesByLesson = new Map<number, LessonFile[]>();
    for (const row of rowsToCamel<LessonFile & { lessonId: number }>(files.rows)) {
      const bucket = filesByLesson.get(row.lessonId);
      if (bucket) bucket.push(row);
      else filesByLesson.set(row.lessonId, [row]);
    }

    const lessonsByModule = new Map<number, CourseLesson[]>();
    for (const raw of rowsToCamel<CourseLesson>(lessons.rows)) {
      const lesson = { ...raw, files: filesByLesson.get(Number(raw.id)) ?? [] };
      const bucket = lessonsByModule.get(lesson.moduleId);
      if (bucket) bucket.push(lesson);
      else lessonsByModule.set(lesson.moduleId, [lesson]);
    }

    const quizzesByModule = new Map<number, CourseQuiz[]>();
    for (const row of rowsToCamel<CourseQuiz & { moduleId: number }>(quizzes.rows)) {
      const { moduleId, ...quiz } = row;
      const bucket = quizzesByModule.get(moduleId);
      if (bucket) bucket.push(quiz);
      else quizzesByModule.set(moduleId, [quiz]);
    }

    const all = rowsToCamel<CourseModule>(modules.rows).map((mod) => ({
      ...mod,
      lessons: lessonsByModule.get(mod.id) ?? [],
      quizzes: quizzesByModule.get(mod.id) ?? [],
      submodules: [] as CourseModule[],
    }));

    const byId = new Map(all.map((mod) => [mod.id, mod]));
    const top: CourseModule[] = [];
    for (const mod of all) {
      // A submodule whose parent has vanished is promoted rather than dropped.
      // The cascade should prevent it, but a row nobody can see is worse than
      // a row in the wrong place.
      const parent = mod.parentId === null ? null : (byId.get(mod.parentId) ?? null);
      if (parent) parent.submodules.push(mod);
      else top.push(mod);
    }

    res.json(top);
  }),
);

adminCurriculumRouter.post(
  "/:courseId/modules",
  asyncHandler(async (req, res) => {
    const { title, summary, sort, parentId } = req.body as {
      title?: string;
      summary?: string;
      sort?: number;
      parentId?: number | null;
    };
    if (!title?.trim()) throw badRequest("Module title is required");

    // One level of nesting only. A submodule of a submodule renders as an
    // outline nobody can follow, and the read above flattens at one level
    // anyway — so it is refused here rather than written and lost.
    if (parentId != null) {
      const parent = await pool.query<{ course_id: number; parent_id: number | null }>(
        "SELECT course_id, parent_id FROM course_modules WHERE id = $1",
        [parentId],
      );
      const row = parent.rows[0];
      if (!row) throw notFound("That section doesn't exist");
      if (String(row.course_id) !== String(req.params.courseId)) {
        throw badRequest("That section belongs to a different course.");
      }
      if (row.parent_id !== null) {
        throw badRequest("A subsection can't go inside another subsection.");
      }
    }

    const result = await pool.query(
      `INSERT INTO course_modules (course_id, title, summary, parent_id, sort)
       VALUES ($1, $2, $3, $4,
               COALESCE($5, (SELECT COALESCE(MAX(sort), -1) + 1
                               FROM course_modules
                              WHERE course_id = $1
                                AND parent_id IS NOT DISTINCT FROM $4)))
       RETURNING *`,
      [req.params.courseId, title.trim(), summary ?? "", parentId ?? null, sort ?? null],
    );
    res.status(201).json({
      ...rowToCamel<CourseModule>(result.rows[0]),
      lessons: [],
      quizzes: [],
      submodules: [],
    });
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

/* ------------------------------------------------- §C. Quizzes in a course */

/**
 * POST /admin/curriculum/modules/:moduleId/quizzes
 *
 * "Do not make Yvette leave Courses just to create the quiz." This creates a
 * real row in `assessments` — the same table the standalone Quizzes page
 * reads — linked to the module and given a place in the running order. There
 * is no separate course-quiz system; a course quiz is an assessment that
 * knows where it lives.
 */
adminCurriculumRouter.post(
  "/modules/:moduleId/quizzes",
  asyncHandler(async (req, res) => {
    const body = req.body as { title?: string; kind?: string };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) throw badRequest("Quiz title is required");

    const kind = body.kind === "graded" ? "graded" : "quiz";

    const module = await pool.query<{ id: number }>(
      "SELECT id FROM course_modules WHERE id = $1",
      [req.params.moduleId],
    );
    if (module.rowCount === 0) throw notFound("That section doesn't exist");

    // `assessments.slug` is unique across the whole table, not per course, so
    // "Module quiz" in two courses would collide. Disambiguated in the same
    // statement that reads the sort, exactly as lessons are.
    const base = lessonSlug(title);
    const result = await pool.query(
      `INSERT INTO assessments (slug, title, intro_md, kind, module_id, pass_mark, published, sort)
       SELECT CASE WHEN taken.n = 0 THEN $1::text ELSE $1::text || '-' || (taken.n + 1) END,
              $2, '', $3, $4,
              CASE WHEN $3 = 'graded' THEN 70 ELSE NULL END,
              false,
              (SELECT COALESCE(MAX(sort), -1) + 1 FROM assessments WHERE module_id = $4)
         FROM (SELECT COUNT(*)::int AS n FROM assessments
                WHERE slug::text = $1::text OR slug::text LIKE $1::text || '-%') taken
       RETURNING id, title, slug::text AS slug, kind, published, sort`,
      [base, title, kind, req.params.moduleId],
    );

    res.status(201).json({ ...rowToCamel(result.rows[0]), questionCount: 0 });
  }),
);

/**
 * PUT /admin/curriculum/:courseId/order
 *
 * Reordering, as one atomic statement per kind rather than a request per row.
 * Dragging a lesson to the top of a ten-lesson module is ten position changes;
 * sending ten PUTs means ten chances to end up half-applied, and an outline
 * that disagrees with itself is worse than one that would not reorder.
 *
 * Every id is checked to belong to this course before anything is written, so
 * a crafted body cannot renumber another course's outline.
 */
adminCurriculumRouter.put(
  "/:courseId/order",
  asyncHandler(async (req, res) => {
    const body = req.body as {
      modules?: { id: number; sort: number; parentId?: number | null }[];
      lessons?: { id: number; sort: number; moduleId?: number }[];
      quizzes?: { id: number; sort: number; moduleId?: number }[];
    };

    const courseId = req.params.courseId;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const row of body.modules ?? []) {
        await client.query(
          `UPDATE course_modules SET sort = $2, updated_at = now()
            WHERE id = $1 AND course_id = $3`,
          [row.id, row.sort, courseId],
        );
      }

      for (const row of body.lessons ?? []) {
        await client.query(
          `UPDATE course_lessons l
              SET sort = $2,
                  module_id = COALESCE($4, l.module_id),
                  updated_at = now()
            FROM course_modules m
           WHERE l.id = $1 AND m.id = l.module_id AND m.course_id = $3`,
          [row.id, row.sort, courseId, row.moduleId ?? null],
        );
      }

      for (const row of body.quizzes ?? []) {
        await client.query(
          `UPDATE assessments a
              SET sort = $2,
                  module_id = COALESCE($4, a.module_id),
                  updated_at = now()
            FROM course_modules m
           WHERE a.id = $1 AND m.id = a.module_id AND m.course_id = $3`,
          [row.id, row.sort, courseId, row.moduleId ?? null],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.status(204).end();
  }),
);
