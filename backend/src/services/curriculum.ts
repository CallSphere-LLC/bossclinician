import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { hasCourseAccess } from "./access";
import {
  DEFAULT_DRIP_SETTINGS,
  describeUnlock,
  parseReleaseTime,
  resolveDripState,
  type DripConfig,
  type DripSettings,
} from "./drip";

/**
 * The curriculum as one particular member sees it.
 *
 * Three things have to be true at once for a lesson to be openable: the member
 * holds a live grant for a product pointing at the course, the lesson is
 * published, and its drip window has opened. This module is where those three
 * meet, so no route has to remember all of them — and so the answer given to
 * /library, to the player and to a progress write can never differ.
 *
 * Deliberately absent from every query below: `body_md`, `video_url`,
 * `audio_url`, `embed_html`, `transcript`. An outline is built for lessons the
 * member cannot open yet, and the surest way to never leak a locked lesson's
 * content is to never select it in the first place.
 */

type Queryable = Pick<PoolClient, "query"> | typeof pool;

/** Percent watched at which a video marks itself done without being asked. */
export const AUTO_COMPLETE_PERCENT = 90;

/* ------------------------------------------------- what a watch claim is worth */

/**
 * How much of a lesson a progress report has actually earned.
 *
 * A browser can say anything, and a member who wants a CEU certificate they did
 * not sit through has an obvious reason to. Nothing here makes that impossible —
 * a script that behaves like a player over the same wall-clock hour is
 * indistinguishable from a player. What it does is remove the cheap forgeries:
 * the percentage is derived from the position wherever the media's length is on
 * record rather than taken from the request, a position and a percentage that
 * cannot both be true are refused, and credit accrues no faster than real time
 * passes, so a course cannot be finished in a burst of requests.
 *
 * Pure, and separated from the route for that reason: this is the rule a
 * compliance record rests on, and it is worth being able to test it directly.
 */

/**
 * The fastest the player runs. `SpeedControl` offers 2x; the quarter on top
 * absorbs the ten-second write cadence and the gap between the browser's clock
 * and ours, so somebody listening at double speed is never told they were too
 * quick.
 */
const MAX_PLAYBACK_RATE = 2.5;

/**
 * A longer gap than this between two reports is not watching.
 *
 * The player writes every ten seconds while something plays, and a backgrounded
 * tab has its timers throttled to roughly one a minute, so two minutes is
 * generous for the honest case. The ceiling is what stops a script that pings
 * twice an hour from banking an hour of credit on each one.
 */
const MAX_CREDITED_GAP_SECONDS = 120;

/**
 * What the very first report on a lesson is worth. There is no earlier
 * timestamp to measure from, and the player's first write lands about ten
 * seconds into playback.
 */
const FIRST_REPORT_SECONDS = 15;

/**
 * The length assumed for a lesson carrying neither a media duration nor the
 * author's own estimate. Nothing can be checked against a length nobody
 * recorded; this at least keeps 0 to 100 from happening inside four seconds.
 */
const UNMEASURED_LESSON_SECONDS = 600;

/** Below this a lesson is short enough that "at the start" says nothing. */
const MEANINGFUL_LESSON_SECONDS = 60;

export interface LessonWatchFacts {
  /** Length of the media itself. 0 when nobody recorded one. */
  videoDurationSeconds: number;
  /** The author's estimate of how long the lesson takes. 0 when unset. */
  durationMinutes: number;
}

export interface StoredWatch {
  /** The highest figure credited so far. */
  watchedPercent: number;
  /** Seconds of the lesson credited so far. */
  watchedSeconds: number;
  /** When the previous report landed, or null when this is the first. */
  lastViewedAt: Date | null;
}

export type WatchVerdict =
  | { ok: true; percent: number; watchedSeconds: number }
  | { ok: false; message: string };

const CONTRADICTORY =
  "That progress report doesn't match the position in the lesson. Please reload the page and try again.";

export function creditWatchedPercent(input: {
  positionSeconds: number;
  /** What the client says it has watched — evidence, never the answer. */
  claimedPercent: number;
  lesson: LessonWatchFacts;
  stored: StoredWatch;
  now: Date;
}): WatchVerdict {
  const position = Math.max(0, Math.round(input.positionSeconds));
  const claimed = Math.min(100, Math.max(0, Math.round(input.claimedPercent)));

  // The media's own length is the only figure the server knows to be true. The
  // author's estimate is a label on a page and can be out by minutes, so it sets
  // the pace credit accrues at but never converts a position into a percentage.
  const measured = input.lesson.videoDurationSeconds > 0;
  const estimate = Math.max(0, Math.round(input.lesson.durationMinutes * 60));
  const reference = measured
    ? input.lesson.videoDurationSeconds
    : estimate > 0
      ? estimate
      : UNMEASURED_LESSON_SECONDS;

  const fromPosition = Math.min(100, Math.floor((position * 100) / Math.max(1, reference)));

  // Second nought of a lesson that runs for minutes, reported as watched: the two
  // halves of that report cannot both be true, and no player sends it. Refused
  // rather than quietly clamped, because a silent clamp only keeps whoever sent it
  // from noticing. Somebody who scrubs back to the start of a lesson they have
  // already watched is the honest version of the same shape, and the figure
  // already on record is what tells them apart.
  const atTheVeryStart =
    reference >= MEANINGFUL_LESSON_SECONDS && position < FIRST_REPORT_SECONDS;
  if (
    atTheVeryStart &&
    claimed >= AUTO_COMPLETE_PERCENT &&
    input.stored.watchedPercent < AUTO_COMPLETE_PERCENT
  ) {
    return { ok: false, message: CONTRADICTORY };
  }

  const sinceLast =
    input.stored.lastViewedAt === null
      ? FIRST_REPORT_SECONDS
      : Math.min(
          MAX_CREDITED_GAP_SECONDS,
          Math.max(0, (input.now.getTime() - input.stored.lastViewedAt.getTime()) / 1000)
        );

  // The running total is kept in seconds of lesson rather than in percent because
  // percent is too coarse to add to: ten seconds of a two-hour lecture rounds to
  // nothing, and a total that rounds to nothing never moves. Seconds of lesson,
  // not of clock — somebody listening at double speed covers two of the first for
  // each one of the second, and it is the lesson being measured.
  const watchedSeconds = Math.min(
    reference,
    Math.round(input.stored.watchedSeconds + sinceLast * MAX_PLAYBACK_RATE)
  );

  // Which makes a forty-minute lesson take at least sixteen minutes of wall clock
  // to reach 100, however many requests are spent trying, and a course of them
  // impossible to finish in a burst.
  const ceiling = Math.min(100, Math.floor((watchedSeconds * 100) / reference));

  return {
    ok: true,
    percent: Math.min(measured ? fromPosition : claimed, ceiling),
    watchedSeconds,
  };
}

/* ------------------------------------------------------------ drip settings */

interface CachedSettings {
  at: number;
  settings: DripSettings;
}

let settingsCache: CachedSettings | null = null;

/**
 * The release hour is one row an owner edits a few times a year, and it is read
 * on every progress ping. A short cache keeps the player's hot path from
 * querying `settings` sixty times a minute per viewer; a minute of staleness on
 * "lessons open at 6am" is not something anybody can perceive.
 */
const SETTINGS_TTL_MS = 60_000;

function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The site-wide drip schedule from `settings`, as `{releaseTime, timezone}`.
 *
 * Every field is treated as untrusted: the row is free-form JSONB the owner
 * edits herself, and an unknown IANA zone would throw inside Intl on every
 * lesson of every course rather than in the one place it was typed.
 */
export async function loadDripSettings(db: Queryable = pool): Promise<DripSettings> {
  const cached = settingsCache;
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.settings;

  const res = await db.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'drip'`);
  const value = res.rows[0]?.value;
  const raw =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const releaseTime = typeof raw.releaseTime === "string" ? raw.releaseTime : "";
  const timezone = typeof raw.timezone === "string" ? raw.timezone.trim() : "";

  const settings: DripSettings = {
    releaseMinute: releaseTime
      ? parseReleaseTime(releaseTime)
      : DEFAULT_DRIP_SETTINGS.releaseMinute,
    timezone: isKnownTimeZone(timezone) ? timezone : DEFAULT_DRIP_SETTINGS.timezone,
  };

  settingsCache = { at: Date.now(), settings };
  return settings;
}

/** Drops the cached schedule. For the admin settings writer and for tests. */
export function clearDripSettingsCache(): void {
  settingsCache = null;
}

/* -------------------------------------------------------------------- shapes */

export interface MemberLessonView {
  id: number;
  slug: string;
  title: string;
  contentType: string;
  durationMinutes: number;
  videoDurationSeconds: number;
  preview: boolean;
  moduleId: number;
  moduleTitle: string;
  commentsEnabled: boolean;
  notesEnabled: boolean;
  unlocked: boolean;
  /** null once the lesson is open. */
  unlocksAt: string | null;
  /** "Unlocks Tuesday, 3 March", or "" when it is already open. */
  unlockLabel: string;
  completed: boolean;
  requiresPreviousLesson: boolean;
  completedAt: string | null;
  lastPositionSeconds: number;
  watchedPercent: number;
  lastViewedAt: string | null;
}

export interface MemberModuleView {
  id: number;
  title: string;
  summary: string;
  unlocked: boolean;
  unlocksAt: string | null;
  unlockLabel: string;
  lessons: MemberLessonView[];
}

export interface CourseRollup {
  lessonsTotal: number;
  lessonsCompleted: number;
  percent: number;
  completedAt: string | null;
}

export interface MemberCourseView {
  courseId: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  grantedAt: string;
  /** The zone the unlock dates are quoted in — the one the owner scheduled in. */
  timezone: string;
  modules: MemberModuleView[];
  progress: CourseRollup;
  continueLesson: MemberLessonView | null;
}

/* ----------------------------------------------------------------- row types */

interface OutlineRow {
  course_id: number;
  module_id: number;
  module_title: string;
  module_summary: string;
  module_drip_days: number | null;
  module_drip_date: Date | null;
  lesson_id: number | null;
  slug: string | null;
  title: string | null;
  content_type: string | null;
  duration_minutes: number | null;
  video_duration_seconds: number | null;
  preview: boolean | null;
  lesson_drip_days: number | null;
  lesson_drip_date: Date | null;
  comments_enabled: boolean | null;
  requires_previous_lesson: boolean | null;
  notes_enabled: boolean | null;
  last_position_seconds: number | null;
  watched_percent: number | null;
  completed_at: Date | null;
  last_viewed_at: Date | null;
}

/**
 * Modules with their published lessons and this member's progress on each.
 *
 * The lesson join is a LEFT JOIN so a module with nothing in it yet still comes
 * back — 17 courses currently have no lessons at all, and an outline that
 * silently omits their modules would look like a loading bug rather than an
 * empty course.
 */
const OUTLINE_SQL = `
  SELECT m.course_id,
         m.id       AS module_id,
         m.title    AS module_title,
         m.summary  AS module_summary,
         m.drip_days AS module_drip_days,
         m.drip_date AS module_drip_date,
         l.id       AS lesson_id,
         l.slug, l.title, l.content_type, l.duration_minutes, l.video_duration_seconds,
         l.preview, l.comments_enabled, l.notes_enabled, l.requires_previous_lesson,
         l.drip_days AS lesson_drip_days,
         l.drip_date AS lesson_drip_date,
         lp.last_position_seconds, lp.watched_percent, lp.completed_at, lp.last_viewed_at
    FROM course_modules m
    LEFT JOIN course_lessons  l  ON l.module_id = m.id AND l.published
    LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.member_id = $1
   WHERE m.course_id = ANY($2::int[])
   ORDER BY m.course_id, m.sort, m.id, l.sort, l.id`;

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function dripConfig(days: number | null, date: Date | null): DripConfig {
  return { dripDays: days, dripDate: date };
}

/* ------------------------------------------------------------------ building */

function toLessonView(
  row: OutlineRow,
  moduleTitle: string,
  grantedAt: Date,
  now: Date,
  settings: DripSettings
): MemberLessonView {
  const state = resolveDripState({
    lesson: dripConfig(row.lesson_drip_days, row.lesson_drip_date),
    module: dripConfig(row.module_drip_days, row.module_drip_date),
    grantedAt,
    now,
    settings,
  });

  // A preview lesson is the one the sales page already plays to strangers.
  // Holding it back from somebody who has paid, because the module it happens
  // to sit in drips on day 14, would be the platform arguing with itself.
  const unlocked = row.preview === true || state.unlocked;
  const unlocksAt = unlocked ? null : state.unlocksAt;

  return {
    id: row.lesson_id ?? 0,
    slug: row.slug ?? "",
    title: row.title ?? "",
    contentType: row.content_type ?? "text",
    durationMinutes: row.duration_minutes ?? 0,
    videoDurationSeconds: row.video_duration_seconds ?? 0,
    preview: row.preview === true,
    moduleId: row.module_id,
    moduleTitle,
    commentsEnabled: row.comments_enabled !== false,
    notesEnabled: row.notes_enabled !== false,
    requiresPreviousLesson: row.requires_previous_lesson === true,
    unlocked,
    unlocksAt: iso(unlocksAt),
    unlockLabel: unlocksAt ? `Unlocks ${describeUnlock(unlocksAt, settings.timezone)}` : "",
    completed: row.completed_at !== null,
    completedAt: iso(row.completed_at),
    lastPositionSeconds: row.last_position_seconds ?? 0,
    watchedPercent: row.watched_percent ?? 0,
    lastViewedAt: iso(row.last_viewed_at),
  };
}

function buildModules(
  rows: OutlineRow[],
  grantedAt: Date,
  now: Date,
  settings: DripSettings
): MemberModuleView[] {
  const modules: MemberModuleView[] = [];
  const byId = new Map<number, MemberModuleView>();

  for (const row of rows) {
    let mod = byId.get(row.module_id);
    if (!mod) {
      const state = resolveDripState({
        lesson: dripConfig(row.module_drip_days, row.module_drip_date),
        grantedAt,
        now,
        settings,
      });
      mod = {
        id: row.module_id,
        title: row.module_title,
        summary: row.module_summary,
        unlocked: state.unlocked,
        unlocksAt: iso(state.unlocksAt),
        unlockLabel: state.unlocksAt
          ? `Unlocks ${describeUnlock(state.unlocksAt, settings.timezone)}`
          : "",
        lessons: [],
      };
      byId.set(row.module_id, mod);
      modules.push(mod);
    }
    if (row.lesson_id !== null) {
      mod.lessons.push(toLessonView(row, mod.title, grantedAt, now, settings));
    }
  }

  // Completion prerequisites follow the actual course order, across section
  // boundaries. A preview remains available by definition.
  let previous: MemberLessonView | null = null;
  for (const mod of modules) {
    for (const lesson of mod.lessons) {
      if (lesson.requiresPreviousLesson && previous && !previous.completed && !lesson.preview) {
        lesson.unlocked = false;
        lesson.unlocksAt = null;
        lesson.unlockLabel = `Finish “${previous.title}” first`;
      }
      previous = lesson;
    }
  }

  return modules;
}

/** Every lesson of a course in the order the player walks them. */
export function flattenLessons(modules: MemberModuleView[]): MemberLessonView[] {
  return modules.flatMap((m) => m.lessons);
}

/**
 * Percent complete, floored rather than rounded.
 *
 * Integer division cannot reach 100 until every lesson is done, which is what
 * makes "100%" mean finished — a rounded 99.6% would light up a completion
 * badge, and on a CEU course that badge is attached to a certificate.
 */
function percentOf(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((completed * 100) / total);
}

export function summariseProgress(lessons: MemberLessonView[]): CourseRollup {
  const completed = lessons.filter((l) => l.completed);
  const completedAt = completed
    .map((l) => l.completedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .pop();

  return {
    lessonsTotal: lessons.length,
    lessonsCompleted: completed.length,
    percent: percentOf(completed.length, lessons.length),
    // Only a finished course has a completion date; the latest lesson's is it.
    completedAt:
      lessons.length > 0 && completed.length === lessons.length ? (completedAt ?? null) : null,
  };
}

/**
 * The lesson the "continue" button points at.
 *
 * Whatever they were last in the middle of, so closing the tab mid-video and
 * coming back tomorrow lands in the same place. Failing that, the first thing
 * they have not finished. A course whose every open lesson is done returns
 * null — there is nothing to continue, and pointing at a locked lesson would be
 * a button that cannot be pressed.
 */
export function pickContinueLesson(lessons: MemberLessonView[]): MemberLessonView | null {
  const unfinished = lessons.filter((l) => l.unlocked && !l.completed);
  if (unfinished.length === 0) return null;

  const started = unfinished
    .filter((l) => l.lastViewedAt !== null)
    .sort((a, b) => (b.lastViewedAt ?? "").localeCompare(a.lastViewedAt ?? ""));

  return started[0] ?? unfinished[0] ?? null;
}

/* ------------------------------------------------------------- grant lookups */

/**
 * When each of these courses was unlocked for this member.
 *
 * The earliest live grant wins where a course is reachable through more than
 * one product — someone who bought a course and later a bundle containing it
 * must not have their drip schedule restarted by the second purchase.
 */
export async function loadCourseGrantTimes(
  memberId: number,
  courseIds: number[]
): Promise<Map<number, Date>> {
  const out = new Map<number, Date>();
  if (courseIds.length === 0) return out;

  const res = await pool.query<{ course_id: number; granted_at: Date }>(
    `SELECT p.course_id, MIN(g.granted_at) AS granted_at
       FROM access_grants g
       JOIN products p ON p.id = g.product_id
      WHERE g.member_id = $1 AND p.course_id = ANY($2::int[]) AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
      GROUP BY p.course_id`,
    [memberId, courseIds]
  );

  for (const row of res.rows) out.set(row.course_id, row.granted_at);
  return out;
}

/* ------------------------------------------------------------- course loading */

interface CourseRow {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  image: string | null;
}

/**
 * The whole course as this member may see it, or null when they may not.
 *
 * null covers every refusal — no grant, an expired grant, a course that does
 * not exist — because a caller that cannot tell them apart cannot leak the
 * difference to a browser either.
 */
export async function loadCourseForMember(
  memberId: number,
  courseId: number,
  now: Date = new Date()
): Promise<MemberCourseView | null> {
  const [entitled, courseRes, grantTimes, settings] = await Promise.all([
    hasCourseAccess(memberId, courseId),
    pool.query<CourseRow>(
      `SELECT id, slug, title, subtitle, description, image FROM courses WHERE id = $1`,
      [courseId]
    ),
    loadCourseGrantTimes(memberId, [courseId]),
    loadDripSettings(),
  ]);

  if (!entitled) return null;
  const course = courseRes.rows[0];
  if (!course) return null;

  // hasCourseAccess just said there is a live grant, so the timestamp is there;
  // `now` only stands in if a grant were revoked between the two reads, in which
  // case the drip clock starting today is the cautious way to be wrong.
  const grantedAt = grantTimes.get(courseId) ?? now;

  const outline = await pool.query<OutlineRow>(OUTLINE_SQL, [memberId, [courseId]]);
  const modules = buildModules(outline.rows, grantedAt, now, settings);
  const lessons = flattenLessons(modules);

  return {
    courseId: course.id,
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    image: course.image ?? "",
    grantedAt: grantedAt.toISOString(),
    timezone: settings.timezone,
    modules,
    progress: summariseProgress(lessons),
    continueLesson: pickContinueLesson(lessons),
  };
}

export interface CourseCardSummary {
  progress: CourseRollup;
  continueLesson: MemberLessonView | null;
}

/**
 * The same numbers for many courses at once, for the library grid.
 *
 * One outline query for every course owned rather than one per card. The counts
 * are derived from the lessons themselves rather than read from
 * `course_progress`, because the rollup is only as fresh as the last time the
 * member touched a lesson — publish a new lesson today and every stored
 * `lessons_total` is a lesson short until they do.
 */
export async function summariseCoursesForMember(
  memberId: number,
  courseIds: number[],
  now: Date = new Date()
): Promise<Map<number, CourseCardSummary>> {
  const out = new Map<number, CourseCardSummary>();
  if (courseIds.length === 0) return out;

  const [grantTimes, settings] = await Promise.all([
    loadCourseGrantTimes(memberId, courseIds),
    loadDripSettings(),
  ]);

  const outline = await pool.query<OutlineRow>(OUTLINE_SQL, [memberId, courseIds]);

  const byCourse = new Map<number, OutlineRow[]>();
  for (const row of outline.rows) {
    const bucket = byCourse.get(row.course_id);
    if (bucket) bucket.push(row);
    else byCourse.set(row.course_id, [row]);
  }

  for (const courseId of courseIds) {
    const grantedAt = grantTimes.get(courseId);
    if (!grantedAt) continue;
    const lessons = flattenLessons(
      buildModules(byCourse.get(courseId) ?? [], grantedAt, now, settings)
    );
    out.set(courseId, {
      progress: summariseProgress(lessons),
      continueLesson: pickContinueLesson(lessons),
    });
  }

  return out;
}

/* ----------------------------------------------------------------- the rollup */

/**
 * Rebuilds `course_progress` for one member and course from `lesson_progress`.
 *
 * Called inside the same transaction as every progress write, so the summary a
 * library card reads and the ticks a player draws cannot disagree. It derives
 * everything and stores nothing incrementally — a rollup that is added to on
 * each write drifts the first time a lesson is unpublished, deleted or added.
 *
 * `completed_at` is kept once earned unless the course stops being complete:
 * un-ticking a lesson clears it, which is what a certificate check has to see.
 */
export async function recomputeCourseProgress(
  memberId: number,
  courseId: number,
  client?: Queryable
): Promise<CourseRollup> {
  const db = client ?? pool;

  const res = await db.query<{
    lessons_total: number;
    lessons_completed: number;
    percent: number;
    completed_at: Date | null;
  }>(
    `WITH counted AS (
       SELECT COUNT(l.id)::int             AS lessons_total,
              COUNT(lp.completed_at)::int  AS lessons_completed,
              MAX(lp.completed_at)         AS newest_completion
         FROM course_lessons l
         JOIN course_modules m ON m.id = l.module_id
         LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.member_id = $1
        WHERE m.course_id = $2 AND l.published
     ), latest AS (
       SELECT l.id
         FROM lesson_progress lp
         JOIN course_lessons  l ON l.id = lp.lesson_id
         JOIN course_modules  m ON m.id = l.module_id
        WHERE lp.member_id = $1 AND m.course_id = $2
        ORDER BY lp.last_viewed_at DESC, l.id DESC
        LIMIT 1
     )
     INSERT INTO course_progress
       (member_id, course_id, lessons_total, lessons_completed, percent,
        last_lesson_id, completed_at, updated_at)
     SELECT $1, $2, c.lessons_total, c.lessons_completed,
            -- Integer division: 100 is unreachable until the last lesson is done.
            CASE WHEN c.lessons_total = 0 THEN 0
                 ELSE (c.lessons_completed * 100) / c.lessons_total END,
            (SELECT id FROM latest),
            CASE WHEN c.lessons_total > 0 AND c.lessons_completed >= c.lessons_total
                 THEN c.newest_completion ELSE NULL END,
            now()
       FROM counted c
     ON CONFLICT (member_id, course_id) DO UPDATE SET
       lessons_total     = EXCLUDED.lessons_total,
       lessons_completed = EXCLUDED.lessons_completed,
       percent           = EXCLUDED.percent,
       last_lesson_id    = COALESCE(EXCLUDED.last_lesson_id, course_progress.last_lesson_id),
       completed_at      = CASE WHEN EXCLUDED.completed_at IS NULL THEN NULL
                                ELSE COALESCE(course_progress.completed_at, EXCLUDED.completed_at)
                           END,
       updated_at        = now()
     RETURNING lessons_total, lessons_completed, percent, completed_at`,
    [memberId, courseId]
  );

  const row = res.rows[0];
  return {
    lessonsTotal: row?.lessons_total ?? 0,
    lessonsCompleted: row?.lessons_completed ?? 0,
    percent: row?.percent ?? 0,
    completedAt: iso(row?.completed_at ?? null),
  };
}
