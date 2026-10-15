import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel, toSnake } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";
import { isExternalRef, isProtectedRef } from "../../services/signedUrls";
import { DEFAULT_DRIP_SETTINGS, zonedWallClockToUtc, type DripSettings } from "../../services/drip";
import { loadDripSettings } from "../../services/curriculum";
import { clearCertificateTemplateCache } from "../../services/certificates";
import { z } from "zod";

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
  toolKey: string | null;
  toolConfig: Record<string, unknown>;
  commentsEnabled: boolean;
  attachmentUrl: string;
  embedHtml: string;
  thumbnailUrl: string;
  requiresPreviousLesson: boolean;
  durationMinutes: number;
  preview: boolean;
  published: boolean;
  sort: number;
  dripDays: number | null;
  dripDate: Date | null;
  /** The day `dripDate` names in the owner's release zone, "YYYY-MM-DD". */
  dripDateLocal?: string | null;
  /** Kajabi "Scheduled": the exact instant the lesson opens. null = not scheduled. */
  publishAt?: Date | null;
  /** `publishAt` as "YYYY-MM-DDTHH:MM" in the owner's release zone. */
  publishAtLocal?: string | null;
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
  "embed_html",
  "thumbnail_url",
  "requires_previous_lesson",
  "content_type",
  "tool_key",
  "tool_config",
  "comments_enabled",
  "duration_minutes",
  "preview",
  "published",
  "sort",
  "drip_days",
  "drip_date",
  "publish_at",
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

/** Calculator definitions are lesson data; only bounded arithmetic expressions are accepted. */
const calculatorSchema = z.object({
  title: z.string().trim().min(1).max(120),
  outputLabel: z.string().trim().min(1).max(120),
  unit: z.string().max(20).optional(),
  formula: z.string().trim().min(1).max(200).regex(/^[0-9x()+*/.\s-]+$/),
  inputs: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    defaultValue: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  })).min(1).max(8),
});

export function assertLessonTool(body: Record<string, unknown>): void {
  const key = body.toolKey ?? body.tool_key;
  if (key !== undefined && key !== null && (typeof key !== "string" || key.length > 120)) {
    throw badRequest("Choose a valid lesson tool.");
  }
  if (key === "custom-calculator") {
    const parsed = calculatorSchema.safeParse(body.toolConfig ?? body.tool_config);
    if (!parsed.success) throw badRequest("Check the calculator title, inputs, and formula.");
    const tokens = parsed.data.formula.match(/x\d+/g) ?? [];
    if (tokens.some((token) => Number(token.slice(1)) < 1 || Number(token.slice(1)) > parsed.data.inputs.length)) {
      throw badRequest("The formula refers to an input that does not exist.");
    }
  }
}

/** Longer than any real provider's embed snippet, short of a pasted page. */
const EMBED_HTML_MAX = 20_000;

/**
 * Refuses embed code the NOT NULL column or the player cannot take.
 *
 * The code runs only inside the player's sandboxed, opaque-origin iframe, so it
 * is not filtered here — only shaped: null clears it, and anything that is not
 * text or would be a whole page pasted by mistake is sent back with a sentence.
 */
export function assertEmbedHtml(body: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(body)) {
    if (toSnake(key) !== "embed_html") continue;
    if (value === undefined) continue;
    if (value === null) {
      body[key] = "";
      continue;
    }
    if (typeof value !== "string") throw badRequest("The embed code has to be text.");
    if (value.length > EMBED_HTML_MAX) {
      throw badRequest("That embed code is too long. Paste just the snippet the site gives you to embed it.");
    }
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

/** Every spelling a body may use for the scheduled-publish instant. */
const PUBLISH_AT_KEYS = ["publishAt", "publish_at", "publishAtLocal", "publish_at_local"];

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

/**
 * Kajabi's "Scheduled" status: the instant a lesson opens to members.
 *
 * The course builder sends `publishAtLocal`, a bare "2026-10-20T09:00" from a
 * datetime box, which means that wall-clock time in the owner's release zone
 * (Settings → Delivery) — the same zone every drip date is quoted in, so the
 * time she typed is the time her members are told, wherever her browser is. An
 * API client may send `publishAt` as a full timestamp instead. Empty clears it.
 *
 * Bodies that say nothing about it are returned untouched, so a rename does not
 * quietly unschedule a lesson.
 */
export function normalizePublishAt(
  body: Record<string, unknown>,
  settings: DripSettings = DEFAULT_DRIP_SETTINGS,
): Record<string, unknown> {
  const mentioned = Object.keys(body).filter((key) => PUBLISH_AT_KEYS.includes(key));
  if (mentioned.length === 0) return body;

  let at: Date | null = null;
  for (const key of mentioned) {
    const value = body[key];
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const raw = value instanceof Date ? value.toISOString() : String(value).trim();
    const local = LOCAL_DATE_TIME.exec(raw);
    if (local && key.toLowerCase().includes("local")) {
      const [year, month, day, hour, minute] = local.slice(1).map(Number);
      const real = new Date(Date.UTC(year, month - 1, day));
      if (real.getUTCMonth() + 1 !== month || real.getUTCDate() !== day || hour > 23 || minute > 59) {
        throw badRequest("That publish date isn't a real date and time.");
      }
      at = zonedWallClockToUtc(year, month, day, hour * 60 + minute, settings.timezone);
    } else {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw badRequest("That publish date isn't a real date and time.");
      at = parsed;
    }
  }

  const rest = Object.fromEntries(Object.entries(body).filter(([key]) => !PUBLISH_AT_KEYS.includes(key)));
  return { ...rest, publish_at: at };
}

/** A stored publish instant as "YYYY-MM-DDTHH:MM" in the owner's zone, for a datetime box. */
export function publishAtLocal(value: unknown, timeZone: string): string | null {
  if (value === null || value === undefined) return null;
  const at = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(at.getTime())) return null;
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
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

/**
 * The first slug in a section that no lesson there holds yet.
 *
 * Numbered from the highest suffix already in use rather than from a count of
 * the lessons sharing the base: with "intro" and "intro-2" in a section and the
 * first one deleted, a count of one handed the next "Introduction" "intro-2"
 * again, and the UNIQUE (module_id, slug) index refused the lesson with a 500.
 * `taken` is every slug in the section that is the base or the base plus a
 * suffix; anything else in it is ignored.
 */
export function nextLessonSlug(base: string, taken: string[]): string {
  const prefix = `${base}-`;
  let highest = 0;
  for (const slug of taken) {
    if (slug === base) highest = Math.max(highest, 1);
    else if (slug.startsWith(prefix) && /^\d+$/.test(slug.slice(prefix.length))) {
      highest = Math.max(highest, Number(slug.slice(prefix.length)));
    }
  }
  return highest === 0 ? base : `${base}-${highest + 1}`;
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
      `SELECT l.*, a.id AS assessment_id, a.slug::text AS assessment_slug,
              a.title AS assessment_title, a.kind AS assessment_kind,
              a.require_pass AS assessment_require_pass, a.pass_mark AS assessment_pass_mark
         FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
       LEFT JOIN LATERAL (
         SELECT id, slug, title, kind, require_pass, pass_mark FROM assessments
          WHERE lesson_id = l.id AND kind IN ('graded','survey')
          ORDER BY id LIMIT 1
       ) a ON true
       WHERE m.course_id = $1
       ORDER BY l.sort, l.id`,
      [courseId],
    );

    const { timezone } = await loadDripSettings();

    const byModule = new Map<number, CourseLesson[]>();
    for (const lesson of rowsToCamel<CourseLesson>(lessons.rows)) {
      const bucket = byModule.get(lesson.moduleId);
      const withDay = {
        ...lesson,
        dripDateLocal: dripDateLocal(lesson.dripDate, timezone),
        publishAtLocal: publishAtLocal(lesson.publishAt, timezone),
      };
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
    assertEmbedHtml(body);
    assertLessonTool(body);

    // Insert takes the schedule too, so the first save of a brand-new lesson
    // keeps what the form was showing rather than dropping it and reopening the
    // lesson to a blank "release immediately".
    const settings = await loadDripSettings();
    const drip = normalizeDrip(body, settings);
    const schedule = normalizePublishAt(body, settings);

    // Two lessons called "Introduction" in one section is the ordinary case, so
    // the slug is disambiguated against the ones the section already holds.
    const base = lessonSlug(title);
    const taken = await pool.query<{ slug: string }>(
      `SELECT slug FROM course_lessons
        WHERE module_id = $1 AND (slug = $2::text OR slug LIKE $2::text || '-%')`,
      [req.params.moduleId, base],
    );
    const result = await pool.query(
      `INSERT INTO course_lessons
         (module_id, slug, title, body_md, video_url, audio_url, attachment_url, thumbnail_url,
          duration_minutes, preview, published, content_type, comments_enabled,
          requires_previous_lesson, drip_days, drip_date, embed_html, publish_at, tool_key, tool_config, sort)
       SELECT $1, $11::text,
              $2, $3, $4, $5, $6, $7, $8, $9, $10, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb,
              (SELECT COALESCE(MAX(sort), -1) + 1 FROM course_lessons WHERE module_id = $1)
       RETURNING *`,
      [
        req.params.moduleId,
        title,
        body.bodyMd ?? "",
        body.videoUrl ?? "",
        body.audioUrl ?? "",
        body.attachmentUrl ?? "",
        body.thumbnailUrl ?? "",
        body.durationMinutes ?? 0,
        body.preview ?? false,
        body.published ?? true,
        nextLessonSlug(base, taken.rows.map((row) => row.slug)),
        body.contentType ?? "text",
        body.commentsEnabled ?? true,
        body.requiresPreviousLesson ?? false,
        drip.drip_days ?? null,
        drip.drip_date ?? null,
        body.embedHtml ?? "",
        schedule.publish_at ?? null,
        body.toolKey ?? null,
        JSON.stringify(body.toolConfig ?? {}),
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
    assertEmbedHtml(req.body as Record<string, unknown>);
    assertLessonTool(req.body as Record<string, unknown>);

    const settings = await loadDripSettings();
    const body = normalizePublishAt(normalizeDrip(req.body as Record<string, unknown>, settings), settings);
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

/**
 * POST /admin/curriculum/:courseId/lock-sequence  { locked: boolean }
 *
 * Kajabi's "Lock" for a whole course in one click: every lesson waits for the
 * one before it (and for a pass on it, where its quiz requires one). The first
 * lesson has nothing before it, so the flag on it is harmless. Turning it off
 * clears every lesson's lock. Returns the number of lessons changed.
 */
adminCurriculumRouter.post(
  "/:courseId/lock-sequence",
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId) || courseId <= 0) throw notFound("Course not found");
    const parsed = z.object({ locked: z.boolean() }).safeParse(req.body);
    if (!parsed.success) throw badRequest("Say whether lessons should be locked in order.");

    const result = await pool.query(
      `UPDATE course_lessons l
          SET requires_previous_lesson = $2, updated_at = now()
         FROM course_modules m
        WHERE m.id = l.module_id AND m.course_id = $1
          AND l.requires_previous_lesson IS DISTINCT FROM $2`,
      [courseId, parsed.data.locked],
    );
    res.json({ locked: parsed.data.locked, updated: result.rowCount ?? 0 });
  }),
);

/**
 * GET /admin/curriculum/:courseId/certificate
 *
 * The course's certificate switchboard: whether finishing it issues a
 * certificate at all, and whether every graded quiz must be passed first. Also
 * lists the graded quizzes that rule would apply to, so the screen can name them.
 */
adminCurriculumRouter.get(
  "/:courseId/certificate",
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId) || courseId <= 0) throw notFound("Course not found");
    res.json(await loadCertificateSettings(courseId));
  }),
);

/** PUT /admin/curriculum/:courseId/certificate  { enabled?, requirePass?, title? } */
adminCurriculumRouter.put(
  "/:courseId/certificate",
  asyncHandler(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!Number.isInteger(courseId) || courseId <= 0) throw notFound("Course not found");
    const parsed = z
      .object({
        enabled: z.boolean().optional(),
        requirePass: z.boolean().optional(),
        title: z.string().trim().min(1).max(200).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) throw badRequest("Those certificate settings aren't valid.");
    const { enabled, requirePass, title } = parsed.data;

    const course = await pool.query(`SELECT id FROM courses WHERE id = $1`, [courseId]);
    if (course.rowCount === 0) throw notFound("Course not found");

    if (requirePass !== undefined) {
      await pool.query(`UPDATE courses SET certificate_requires_pass = $2, updated_at = now() WHERE id = $1`, [
        courseId,
        requirePass,
      ]);
    }
    if (enabled === true) {
      const own = await pool.query<{ id: number }>(
        `SELECT id FROM certificate_templates WHERE course_id = $1 ORDER BY id LIMIT 1`,
        [courseId],
      );
      if (own.rows[0]) {
        await pool.query(
          `UPDATE certificate_templates
              SET enabled = true, issue_on = 'completion', title = COALESCE($2, title), updated_at = now()
            WHERE id = $1`,
          [own.rows[0].id, title ?? null],
        );
      } else {
        await pool.query(
          `INSERT INTO certificate_templates (course_id, title, issue_on, enabled)
           VALUES ($1, COALESCE($2, 'Certificate of Completion'), 'completion', true)`,
          [courseId, title ?? null],
        );
      }
    } else if (enabled === false) {
      await pool.query(
        `UPDATE certificate_templates SET enabled = false, updated_at = now()
          WHERE course_id = $1 OR product_id IN (SELECT id FROM products WHERE course_id = $1)`,
        [courseId],
      );
    } else if (title !== undefined) {
      await pool.query(`UPDATE certificate_templates SET title = $2, updated_at = now() WHERE course_id = $1`, [
        courseId,
        title,
      ]);
    }

    // The issuer remembers "no template" for a minute; a switch flipped here
    // should take effect on the very next lesson a student finishes.
    clearCertificateTemplateCache();
    res.json(await loadCertificateSettings(courseId));
  }),
);

async function loadCertificateSettings(courseId: number) {
  const [course, template, quizzes] = await Promise.all([
    pool.query<{ certificate_requires_pass: boolean }>(
      `SELECT certificate_requires_pass FROM courses WHERE id = $1`,
      [courseId],
    ),
    // The same template the issuer would use (services/certificates.ts).
    pool.query<{ id: number; title: string }>(
      `SELECT t.id, t.title
         FROM certificate_templates t
         LEFT JOIN products p ON p.id = t.product_id
        WHERE t.enabled AND t.issue_on = 'completion'
          AND (t.course_id = $1 OR p.course_id = $1)
        ORDER BY (t.course_id = $1) DESC, t.id
        LIMIT 1`,
      [courseId],
    ),
    pool.query<{ lesson_title: string; title: string; pass_mark: number | null; require_pass: boolean; published: boolean }>(
      `SELECT l.title AS lesson_title, a.title, a.pass_mark, a.require_pass, (a.published AND l.published) AS published
         FROM assessments a
         JOIN course_lessons l ON l.id = a.lesson_id
         JOIN course_modules m ON m.id = l.module_id
        WHERE m.course_id = $1 AND a.kind = 'graded'
        ORDER BY m.sort, m.id, l.sort, l.id`,
      [courseId],
    ),
  ]);
  if (!course.rows[0]) throw notFound("Course not found");
  return {
    enabled: template.rows[0] !== undefined,
    templateId: template.rows[0]?.id ?? null,
    title: template.rows[0]?.title ?? "Certificate of Completion",
    requirePass: course.rows[0].certificate_requires_pass,
    gradedQuizzes: quizzes.rows.map((row) => ({
      lessonTitle: row.lesson_title,
      title: row.title,
      passMark: row.pass_mark,
      requirePass: row.require_pass,
      published: row.published,
    })),
  };
}

adminCurriculumRouter.delete(
  "/lessons/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM course_lessons WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) throw notFound("Lesson not found");
    res.status(204).end();
  }),
);

const lessonFileSchema = z.object({
  mediaId: z.number().int().positive().nullable().default(null),
  title: z.string().trim().max(300).default(""),
  storagePath: z.string().trim().min(1).max(1000),
  filename: z.string().trim().max(300).default(""),
  mime: z.string().trim().max(200).default(""),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  sort: z.number().int().min(0).max(9999).default(0),
});

adminCurriculumRouter.get(
  "/lessons/:id/files",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM lesson_files WHERE lesson_id = $1 ORDER BY sort, id`,
      [req.params.id],
    );
    res.json(rowsToCamel(result.rows));
  }),
);

adminCurriculumRouter.post(
  "/lessons/:id/files",
  asyncHandler(async (req, res) => {
    const parsed = lessonFileSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid file", parsed.error.flatten());
    if (!isProtectedRef(parsed.data.storagePath)) {
      throw badRequest("Upload lesson downloads for buyers only before attaching them.");
    }
    const lesson = await pool.query(`SELECT 1 FROM course_lessons WHERE id = $1`, [req.params.id]);
    if (lesson.rowCount === 0) throw notFound("Lesson not found");
    const file = await pool.query(
      `INSERT INTO lesson_files
         (lesson_id, media_id, title, storage_path, filename, mime, size_bytes, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, parsed.data.mediaId, parsed.data.title, parsed.data.storagePath,
       parsed.data.filename, parsed.data.mime, parsed.data.sizeBytes, parsed.data.sort],
    );
    res.status(201).json(rowToCamel(file.rows[0]));
  }),
);

adminCurriculumRouter.patch(
  "/lessons/:id/files/:fileId",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ title: z.string().trim().max(300).optional(), sort: z.number().int().min(0).max(9999).optional() }).safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid file", parsed.error.flatten());
    const file = await pool.query(
      `UPDATE lesson_files
          SET title = COALESCE($1, title), sort = COALESCE($2, sort)
        WHERE id = $3 AND lesson_id = $4 RETURNING *`,
      [parsed.data.title, parsed.data.sort, req.params.fileId, req.params.id],
    );
    if (file.rowCount === 0) throw notFound("File not found");
    res.json(rowToCamel(file.rows[0]));
  }),
);

adminCurriculumRouter.delete(
  "/lessons/:id/files/:fileId",
  asyncHandler(async (req, res) => {
    const removed = await pool.query(
      `DELETE FROM lesson_files WHERE id = $1 AND lesson_id = $2`,
      [req.params.fileId, req.params.id],
    );
    if (removed.rowCount === 0) throw notFound("File not found");
    res.status(204).end();
  }),
);
