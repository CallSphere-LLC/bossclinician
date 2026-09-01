import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel, toSnake } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";
import { isExternalRef, isProtectedRef } from "../../services/signedUrls";
import { DEFAULT_DRIP_SETTINGS, zonedWallClockToUtc, type DripSettings } from "../../services/drip";
import { loadDripSettings } from "../../services/curriculum";

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
  audioUrl: string;
  contentType: string;
  commentsEnabled: boolean;
  attachmentUrl: string;
  durationMinutes: number;
  preview: boolean;
  published: boolean;
  sort: number;
  dripDays: number | null;
  dripDate: Date | null;
  /** The day `dripDate` names in the owner's release zone, "YYYY-MM-DD". */
  dripDateLocal?: string | null;
}

export interface CourseModule {
  id: number;
  courseId: number;
  title: string;
  summary: string;
  sort: number;
  dripDays: number | null;
  dripDate: Date | null;
  dripDateLocal?: string | null;
  lessons: CourseLesson[];
}

/**
 * Only these columns may be written from request bodies.
 *
 * The list is the whole write path: `buildUpdate` drops anything not on it, so
 * a column missing here is a column the admin screen cannot set no matter what
 * it sends. That is how the drip columns spent their existence at NULL on every
 * row while a finished scheduling engine read them — the PUT accepted the value
 * with a 200 and threw it away.
 */
export const MODULE_FIELDS = ["title", "summary", "sort", "drip_days", "drip_date"] as const;
export const LESSON_FIELDS = [
  "title",
  "body_md",
  "video_url",
  "audio_url",
  "attachment_url",
  "content_type",
  "comments_enabled",
  "duration_minutes",
  "preview",
  "published",
  "sort",
  "drip_days",
  "drip_date",
] as const;

/**
 * The lesson kinds `course_lessons_content_type_check` will accept.
 *
 * Checked here rather than left to the constraint: a value the constraint
 * refuses comes back from pg as a 500 with a raw Postgres message, and the
 * person who picked it gets "something went wrong" instead of being told which
 * box is wrong. The member player switches on this column to decide what to
 * render, so an unknown value would also mean a lesson that draws nothing.
 */
export const LESSON_CONTENT_TYPES = [
  "video",
  "audio",
  "text",
  "pdf",
  "embed",
  "assessment",
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
  { column: "audio_url", label: "audio" },
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
 * Refuses a lesson kind the CHECK constraint would reject with a 500.
 *
 * Reads the column, like `assertPaidMedia`, because `buildUpdate` decides what
 * to write from `toSnake(key)` — `content_type` and `contentType` are the same
 * write and have to be judged the same way.
 */
export function assertContentType(body: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(body)) {
    if (toSnake(key) !== "content_type") continue;
    if (value === undefined) continue;
    if (typeof value === "string" && (LESSON_CONTENT_TYPES as readonly string[]).includes(value)) {
      continue;
    }
    throw badRequest(`A lesson has to be one of: ${LESSON_CONTENT_TYPES.join(", ")}.`);
  }
}

/** The two columns that decide when something unlocks, either spelling. */
const DRIP_COLUMNS = ["drip_days", "drip_date"];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "N days after they bought it", as the CHECK constraint will take it. */
function parseDripDays(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const days = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(days) || days < 0) {
    throw badRequest(
      "Say how many days after someone buys this should open — a whole number, and not less than zero.",
    );
  }
  return days;
}

/**
 * The instant a fixed release date means.
 *
 * A date picker sends a bare "2026-03-01" with no time in it, and the day it
 * stands for depends entirely on which instant we pin it to: stored at midnight
 * UTC it reads as 28 February to an owner in New York and 2 March to one in
 * Auckland, and `unlockAt` takes the calendar day out of this column in the
 * owner's zone. So the day is pinned at the release time in that zone, which is
 * the very instant the engine will compute back out of it — store what it will
 * read, and the date she picked is the date her members get.
 *
 * A full timestamp is taken as given, for an API client that means a precise
 * instant rather than a day.
 */
function parseDripDate(value: unknown, settings: DripSettings): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value;

  const raw = String(value).trim();
  if (raw === "") return null;

  if (DATE_ONLY.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    // Rejects 2026-02-30 and friends, which Date would otherwise roll forward
    // into March and open the course on a day nobody chose.
    const real = new Date(Date.UTC(year, month - 1, day));
    if (real.getUTCMonth() + 1 !== month || real.getUTCDate() !== day) {
      throw badRequest("That release date isn't a real date.");
    }
    return zonedWallClockToUtc(year, month, day, settings.releaseMinute, settings.timezone);
  }

  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw badRequest("That release date isn't a real date.");
  return at;
}

/**
 * Normalises the schedule on a request body so the two columns cannot disagree.
 *
 * `unlockAt` resolves a row by letting `drip_date` win over `drip_days`, so a
 * row holding both is a row whose second value is dead — the screen would show
 * "7 days after they buy" beside a date that is what members actually get. The
 * two are one choice, so a body that mentions either one rewrites both, and
 * switching a section from a day count to a fixed date leaves nothing behind.
 *
 * Bodies that say nothing about the schedule are returned untouched: a rename
 * or a reorder must not quietly clear a release date.
 */
export function normalizeDrip(
  body: Record<string, unknown>,
  settings: DripSettings = DEFAULT_DRIP_SETTINGS,
): Record<string, unknown> {
  const mentioned = Object.keys(body).filter((key) => DRIP_COLUMNS.includes(toSnake(key)));
  if (mentioned.length === 0) return body;

  let days: number | null = null;
  let date: Date | null = null;
  for (const key of mentioned) {
    if (toSnake(key) === "drip_days") days = parseDripDays(body[key]);
    else date = parseDripDate(body[key], settings);
  }

  if (days !== null && days > 0 && date !== null) {
    throw badRequest(
      "This can open a number of days after someone buys, or on a fixed date — not both. Clear one of them.",
    );
  }

  // Rebuilt rather than spread over: leaving `dripDays` beside `drip_days` in
  // the body would have `buildUpdate` assign the same column twice, which
  // Postgres refuses outright.
  const rest = Object.fromEntries(
    Object.entries(body).filter(([key]) => !DRIP_COLUMNS.includes(toSnake(key))),
  );
  return { ...rest, drip_days: days, drip_date: date };
}

/**
 * The day a stored release instant names, in the owner's release zone.
 *
 * Sent alongside the raw column because the screen's date picker needs a plain
 * "YYYY-MM-DD" and the raw value is a UTC instant: read off that instant, the
 * date she picked comes back a day out for half the world. The server knows the
 * release zone; the course builder does not, so it is answered here.
 */
export function dripDateLocal(value: unknown, timeZone: string): string | null {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(at.getTime())) return null;
  // en-CA formats as YYYY-MM-DD, which is what <input type="date"> wants.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
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

    const { timezone } = await loadDripSettings();

    const byModule = new Map<number, CourseLesson[]>();
    for (const lesson of rowsToCamel<CourseLesson>(lessons.rows)) {
      const bucket = byModule.get(lesson.moduleId);
      const withDay = { ...lesson, dripDateLocal: dripDateLocal(lesson.dripDate, timezone) };
      if (bucket) bucket.push(withDay);
      else byModule.set(lesson.moduleId, [withDay]);
    }

    const payload = rowsToCamel<CourseModule>(modules.rows).map((mod) => ({
      ...mod,
      dripDateLocal: dripDateLocal(mod.dripDate, timezone),
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
    const body = normalizeDrip(req.body as Record<string, unknown>, await loadDripSettings());
    const update = buildUpdate(body, MODULE_FIELDS);
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
    assertContentType(body);

    // Insert takes the schedule too, so the first save of a brand-new lesson
    // keeps what the form was showing rather than dropping it and reopening the
    // lesson to a blank "release immediately".
    const drip = normalizeDrip(body, await loadDripSettings());

    // Two lessons called "Introduction" in one section is the ordinary case, so
    // the slug is disambiguated in the same statement that reads the sort.
    const result = await pool.query(
      `INSERT INTO course_lessons
         (module_id, slug, title, body_md, video_url, attachment_url, duration_minutes,
          preview, published, content_type, comments_enabled, drip_days, drip_date, sort)
       SELECT $1,
              CASE WHEN taken.n = 0 THEN $9::text ELSE $9::text || '-' || (taken.n + 1) END,
              $2, $3, $4, $5, $6, $7, $8, $10, $11, $12, $13,
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
        body.contentType ?? "text",
        body.commentsEnabled ?? true,
        drip.drip_days ?? null,
        drip.drip_date ?? null,
      ],
    );
    res.status(201).json(rowToCamel<CourseLesson>(result.rows[0]));
  }),
);

adminCurriculumRouter.put(
  "/lessons/:id",
  asyncHandler(async (req, res) => {
    assertPaidMedia(req.body as Record<string, unknown>);
    assertContentType(req.body as Record<string, unknown>);

    const body = normalizeDrip(req.body as Record<string, unknown>, await loadDripSettings());
    const update = buildUpdate(body, LESSON_FIELDS);
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
