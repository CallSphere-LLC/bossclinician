import { Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound, unauthorized } from "../../utils/httpError";
import {
  denyImpersonation,
  requireVerifiedEmail,
  type AuthedMember,
} from "../../middleware/memberAuth";
import { hasCourseAccess } from "../../services/access";
import {
  AUTO_COMPLETE_PERCENT,
  loadDripSettings,
  recomputeCourseProgress,
  type CourseRollup,
} from "../../services/curriculum";
import { resolveDripState, describeUnlock } from "../../services/drip";

/**
 * `/api/member` — what a member writes while working through a course: how far
 * they got, what they have finished, their private notes and the discussion
 * under each lesson.
 *
 * Every route takes a lesson or comment id from the URL, and every one of them
 * proves that id sits inside a course this member holds a live grant for. Owning
 * *a* course is not owning *this* course, and lesson ids are sequential: without
 * the check, `POST /lessons/412/progress` is a way to enumerate a catalogue.
 *
 * Writes carry `denyImpersonation`. An admin viewing as a member is looking
 * through a window — a completion tick or a comment posted through it would land
 * on the customer's account attributed to the customer, with nothing afterwards
 * able to say who really did it.
 */
export const memberProgressRouter = Router();

/** Postgres int4 ceiling. An id it cannot hold is a 404, not a failed query. */
const MAX_INT4 = 2_147_483_647;

const TOO_MANY = { error: "Too many requests. Please try again later." };

/** Keyed on the member, not the IP: a clinic behind one address is many people. */
const byMember = (req: Request): string =>
  req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");

/**
 * Deliberately generous. The player posts its position every few seconds for as
 * long as a video is open, so a member with a lesson running in one tab and
 * another in a second tab legitimately produces a few hundred writes an hour.
 * The ceiling is here to stop a loop, not to ration watching.
 */
const progressLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: byMember,
});

/** Notes and comments are typed by a person, so a human pace is the ceiling. */
const authoringLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: byMember,
});

/** requireMember has already run; this keeps the guarantee in the type system too. */
function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

const idSchema = z.coerce.number().int().positive().max(MAX_INT4);

function readParamId(value: unknown, missing: string): number {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw notFound(missing);
  return parsed.data;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

const LESSON_MISSING = "We couldn't find that lesson.";
const COMMENT_MISSING = "We couldn't find that comment.";

/* ------------------------------------------------------- the entitlement gate */

interface OwnedLesson {
  id: number;
  title: string;
  moduleId: number;
  courseId: number;
  commentsEnabled: boolean;
  notesEnabled: boolean;
  unlocked: boolean;
  unlocksAt: Date | null;
  timezone: string;
}

interface LessonGateRow {
  id: number;
  title: string;
  module_id: number;
  course_id: number;
  preview: boolean;
  comments_enabled: boolean;
  notes_enabled: boolean;
  lesson_drip_days: number | null;
  lesson_drip_date: Date | null;
  module_drip_days: number | null;
  module_drip_date: Date | null;
  granted_at: Date | null;
}

/**
 * The lesson plus the clock its drip schedule runs on.
 *
 * The LEFT JOIN LATERAL fetches `granted_at` — the instant the drip counts from
 * — because that is the one thing access.ts does not expose and every unlock
 * date is measured from it. It deliberately does not decide anything: the
 * decision is `hasCourseAccess` below, so entitlement still has exactly one
 * source. The earliest live grant wins where a course was bought twice (once
 * alone, once inside a bundle) — a second purchase must not restart the drip.
 */
const LESSON_GATE_SQL = `
  SELECT l.id, l.title, l.module_id, m.course_id, l.preview,
         l.comments_enabled, l.notes_enabled,
         l.drip_days AS lesson_drip_days,
         l.drip_date AS lesson_drip_date,
         m.drip_days AS module_drip_days,
         m.drip_date AS module_drip_date,
         gr.granted_at
    FROM course_lessons l
    JOIN course_modules m ON m.id = l.module_id
    LEFT JOIN LATERAL (
      SELECT MIN(g.granted_at) AS granted_at
        FROM access_grants g
        JOIN products p ON p.id = g.product_id
       WHERE g.member_id = $1 AND p.course_id = m.course_id AND g.status = 'active'
         AND (g.expires_at IS NULL OR g.expires_at > now())
    ) gr ON true
   WHERE l.id = $2 AND l.published`;

/**
 * Resolves a lesson id the member is entitled to, or throws 404.
 *
 * 404 and not 403 for a lesson they do not own: ids are sequential, and a 403
 * would confirm the lesson exists and roughly how much of the catalogue does.
 * An unpublished lesson is the same 404 — a draft is not a locked lesson, it is
 * a lesson that does not exist yet.
 */
async function loadOwnedLesson(memberId: number, lessonId: number): Promise<OwnedLesson> {
  const found = await pool.query<LessonGateRow>(LESSON_GATE_SQL, [memberId, lessonId]);
  const row = found.rows[0];
  if (!row) throw notFound(LESSON_MISSING);

  const [entitled, settings] = await Promise.all([
    hasCourseAccess(memberId, row.course_id),
    loadDripSettings(),
  ]);
  if (!entitled) throw notFound(LESSON_MISSING);

  const state = resolveDripState({
    lesson: { dripDays: row.lesson_drip_days, dripDate: row.lesson_drip_date },
    module: { dripDays: row.module_drip_days, dripDate: row.module_drip_date },
    // hasCourseAccess just said there is a live grant, so the timestamp is
    // there; `now` only stands in if one were revoked between the two reads.
    grantedAt: row.granted_at ?? new Date(),
    now: new Date(),
    settings,
  });

  return {
    id: row.id,
    title: row.title,
    moduleId: row.module_id,
    courseId: row.course_id,
    commentsEnabled: row.comments_enabled,
    notesEnabled: row.notes_enabled,
    // A preview lesson already plays for strangers on the sales page; holding it
    // back from somebody who has paid would be the platform arguing with itself.
    unlocked: row.preview || state.unlocked,
    unlocksAt: row.preview ? null : state.unlocksAt,
    timezone: settings.timezone,
  };
}

/**
 * Refuses a lesson whose drip window has not opened.
 *
 * 403 rather than 404 here, unlike everywhere else in this file: they do own
 * this, and the outline has already told them the date. Saying so again is
 * useful and reveals nothing they were not shown.
 */
function assertUnlocked(lesson: OwnedLesson): void {
  if (lesson.unlocked) return;
  const when = lesson.unlocksAt
    ? ` It opens ${describeUnlock(lesson.unlocksAt, lesson.timezone)}.`
    : "";
  throw forbidden(`That lesson isn't open yet.${when}`);
}

/* ------------------------------------------------------------------ progress */

const progressSchema = z.object({
  positionSeconds: z.number().finite().min(0).max(1_000_000),
  watchedPercent: z.number().finite().min(0).max(100),
});

interface ProgressRow {
  last_position_seconds: number;
  watched_percent: number;
  completed_at: Date | null;
}

/**
 * The one statement a progress ping runs.
 *
 * `watched_percent` takes the greater of what is stored and what arrived, so
 * scrubbing backwards cannot un-earn the 90% that triggers auto-completion, and
 * `completed_at` is set from that same maximum rather than from the incoming
 * figure alone. Position is *not* monotonic: it is where to resume from, and
 * jumping back is exactly the thing a member does on purpose.
 *
 * Auto-completion never re-arms: once `completed_at` is set it is kept, so a
 * member who deliberately un-ticks a lesson is not overruled by the next ping.
 */
const PROGRESS_UPSERT_SQL = `
  INSERT INTO lesson_progress
    (member_id, lesson_id, last_position_seconds, watched_percent, completed_at,
     first_viewed_at, last_viewed_at)
  VALUES ($1, $2, $3::int, $4::int,
          CASE WHEN $4::int >= $5::int THEN now() ELSE NULL END, now(), now())
  ON CONFLICT (member_id, lesson_id) DO UPDATE SET
    last_position_seconds = EXCLUDED.last_position_seconds,
    watched_percent       = GREATEST(lesson_progress.watched_percent, EXCLUDED.watched_percent),
    completed_at          = CASE
                              WHEN lesson_progress.completed_at IS NOT NULL
                                THEN lesson_progress.completed_at
                              WHEN GREATEST(lesson_progress.watched_percent,
                                            EXCLUDED.watched_percent) >= $5::int
                                THEN now()
                              ELSE NULL
                            END,
    last_viewed_at        = now()
  RETURNING last_position_seconds, watched_percent, completed_at`;

/**
 * Writes progress and rebuilds the course rollup in one transaction.
 *
 * Together, or neither: a `course_progress` row that disagrees with the
 * `lesson_progress` rows under it is a progress bar that argues with its own
 * ticks, and the member has no way to make it agree again.
 */
async function writeProgress(
  memberId: number,
  courseId: number,
  statement: string,
  params: unknown[]
): Promise<{ progress: ProgressRow | null; rollup: CourseRollup }> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const written = await client.query<ProgressRow>(statement, params);
    const rollup = await recomputeCourseProgress(memberId, courseId, client);
    await client.query("COMMIT");
    return { progress: written.rows[0] ?? null, rollup };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

function progressJson(lessonId: number, row: ProgressRow | null, rollup: CourseRollup) {
  return {
    lessonId,
    lastPositionSeconds: row?.last_position_seconds ?? 0,
    watchedPercent: row?.watched_percent ?? 0,
    completed: (row?.completed_at ?? null) !== null,
    completedAt: iso(row?.completed_at ?? null),
    courseProgress: rollup,
  };
}

/**
 * POST /api/member/lessons/:lessonId/progress
 *
 * Called every few seconds by the player. Two reads to prove the lesson is one
 * this member may be watching, then a single statement for the write, sharing a
 * transaction with the rollup. The drip settings behind the unlock check are
 * cached in-process, so the steady-state cost of a ping is the gate and the
 * write.
 */
memberProgressRouter.post(
  "/lessons/:lessonId/progress",
  denyImpersonation,
  progressLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const lessonId = readParamId(req.params.lessonId, LESSON_MISSING);

    const parsed = progressSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid progress", parsed.error.flatten());

    const lesson = await loadOwnedLesson(member.id, lessonId);
    assertUnlocked(lesson);

    // The columns are integers; a player reporting 47.6% is rounded rather than
    // rejected, because a fractional percent is not a client error.
    const { progress, rollup } = await writeProgress(
      member.id,
      lesson.courseId,
      PROGRESS_UPSERT_SQL,
      [
        member.id,
        lesson.id,
        Math.round(parsed.data.positionSeconds),
        Math.round(parsed.data.watchedPercent),
        AUTO_COMPLETE_PERCENT,
      ]
    );

    res.json(progressJson(lesson.id, progress, rollup));
  })
);

/* ------------------------------------------------------------ manual complete */

const MARK_COMPLETE_SQL = `
  INSERT INTO lesson_progress
    (member_id, lesson_id, last_position_seconds, watched_percent, completed_at,
     first_viewed_at, last_viewed_at)
  VALUES ($1, $2, 0, 0, now(), now(), now())
  ON CONFLICT (member_id, lesson_id) DO UPDATE SET
    -- The first tick is the one that counts: re-ticking must not move the date a
    -- certificate is issued against.
    completed_at   = COALESCE(lesson_progress.completed_at, now()),
    last_viewed_at = now()
  RETURNING last_position_seconds, watched_percent, completed_at`;

/**
 * Un-ticking clears the watched figure along with the completion.
 *
 * It is the one place the monotonic rule gives way, and it has to: leaving 94%
 * behind would let the next progress ping re-complete the lesson within seconds,
 * so the member's explicit "I am not done with this" would be silently overruled
 * by the player. The resume position survives, so they do not lose their place.
 */
const MARK_INCOMPLETE_SQL = `
  UPDATE lesson_progress
     SET completed_at = NULL, watched_percent = 0, last_viewed_at = now()
   WHERE member_id = $1 AND lesson_id = $2
  RETURNING last_position_seconds, watched_percent, completed_at`;

/** POST /api/member/lessons/:lessonId/complete */
memberProgressRouter.post(
  "/lessons/:lessonId/complete",
  denyImpersonation,
  authoringLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const lessonId = readParamId(req.params.lessonId, LESSON_MISSING);

    const lesson = await loadOwnedLesson(member.id, lessonId);
    assertUnlocked(lesson);

    const { progress, rollup } = await writeProgress(
      member.id,
      lesson.courseId,
      MARK_COMPLETE_SQL,
      [member.id, lesson.id]
    );

    res.json(progressJson(lesson.id, progress, rollup));
  })
);

/**
 * DELETE /api/member/lessons/:lessonId/complete
 *
 * No drip check: a lesson that unlocked, was finished, and has since been given
 * a future release date by an edit in the admin must still be un-tickable. The
 * gate that matters is ownership, and this route reveals nothing about content.
 */
memberProgressRouter.delete(
  "/lessons/:lessonId/complete",
  denyImpersonation,
  authoringLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const lessonId = readParamId(req.params.lessonId, LESSON_MISSING);

    const lesson = await loadOwnedLesson(member.id, lessonId);

    const { progress, rollup } = await writeProgress(
      member.id,
      lesson.courseId,
      MARK_INCOMPLETE_SQL,
      [member.id, lesson.id]
    );

    res.json(progressJson(lesson.id, progress, rollup));
  })
);

/* --------------------------------------------------------------------- notes */

/**
 * A member's private notebook.
 *
 * These rows are never exposed on any admin route, and must not be: people write
 * things in a course notebook about their own practice, their clients and their
 * money that they would not write anywhere somebody else can read. There is no
 * admin read of `lesson_notes` anywhere in this codebase, and adding one would
 * be a change of promise, not a feature.
 *
 * No drip gate either — the note is the member's own words. Drip decides when we
 * show them our content, not when they may read what they wrote.
 */
const noteSchema = z.object({
  body: z.string().max(50_000),
});

memberProgressRouter.get(
  "/lessons/:lessonId/notes",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const lessonId = readParamId(req.params.lessonId, LESSON_MISSING);
    const lesson = await loadOwnedLesson(member.id, lessonId);

    const found = await pool.query<{ body: string; updated_at: Date }>(
      `SELECT body, updated_at FROM lesson_notes WHERE member_id = $1 AND lesson_id = $2`,
      [member.id, lesson.id]
    );
    const row = found.rows[0];

    res.json({
      lessonId: lesson.id,
      notesEnabled: lesson.notesEnabled,
      body: row?.body ?? "",
      updatedAt: iso(row?.updated_at ?? null),
    });
  })
);

memberProgressRouter.put(
  "/lessons/:lessonId/notes",
  denyImpersonation,
  authoringLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const lessonId = readParamId(req.params.lessonId, LESSON_MISSING);

    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid note", parsed.error.flatten());

    const lesson = await loadOwnedLesson(member.id, lessonId);
    if (!lesson.notesEnabled) throw badRequest("Notes are turned off for this lesson.");

    const saved = await pool.query<{ body: string; updated_at: Date }>(
      `INSERT INTO lesson_notes (member_id, lesson_id, body)
       VALUES ($1, $2, $3)
       ON CONFLICT (member_id, lesson_id) DO UPDATE SET
         body = EXCLUDED.body, updated_at = now()
       RETURNING body, updated_at`,
      [member.id, lesson.id, parsed.data.body]
    );
    const row = saved.rows[0];

    res.json({
      lessonId: lesson.id,
      notesEnabled: true,
      body: row?.body ?? "",
      updatedAt: iso(row?.updated_at ?? null),
    });
  })
);

/* ------------------------------------------------------------------ comments */

const commentSchema = z.object({
  body: z.string().trim().min(1, "Please write something first.").max(10_000),
  parentId: idSchema.nullish(),
});

const commentEditSchema = z.object({
  body: z.string().trim().min(1, "Please write something first.").max(10_000),
});

interface CommentRow {
  id: number;
  parent_id: number | null;
  member_id: number | null;
  admin_user_id: number | null;
  author_name: string;
  body: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  first_name: string | null;
  last_name: string | null;
  member_name: string | null;
  avatar_url: string | null;
  admin_name: string | null;
}

interface CommentJson {
  id: number;
  parentId: number | null;
  memberId: number | null;
  authorName: string;
  authorAvatarUrl: string;
  authorIsHost: boolean;
  body: string;
  pending: boolean;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
  replies: CommentJson[];
}

/**
 * Comments a member may see: the visible ones, plus their own awaiting review.
 *
 * Hidden and deleted rows are filtered in SQL rather than after the read, so a
 * moderated comment's text is never in a response body at all. Email addresses
 * are not selected — a name and an avatar are what a discussion needs.
 */
const COMMENT_SELECT = `
  SELECT c.id, c.parent_id, c.member_id, c.admin_user_id, c.author_name, c.body,
         c.status, c.created_at, c.updated_at,
         mem.first_name, mem.last_name, mem.name AS member_name, mem.avatar_url,
         au.name AS admin_name
    FROM lesson_comments c
    LEFT JOIN members     mem ON mem.id = c.member_id
    LEFT JOIN admin_users au  ON au.id  = c.admin_user_id
   WHERE c.lesson_id = $1
     AND (c.status = 'visible' OR (c.status = 'pending' AND c.member_id = $2))`;

function authorNameOf(row: CommentRow): string {
  // The business name rather than a guess at which person is behind the admin
  // account, for the same reason billing does it: an empty `name` column must
  // not put somebody's name on words they may not have written.
  if (row.admin_user_id !== null) return row.admin_name || "Boss Clinician";
  const split = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return split || row.member_name || row.author_name || "Member";
}

function toCommentJson(row: CommentRow, memberId: number): CommentJson {
  return {
    id: row.id,
    parentId: row.parent_id,
    memberId: row.member_id,
    authorName: authorNameOf(row),
    authorAvatarUrl: row.avatar_url ?? "",
    // The coach's replies are the ones people scroll looking for.
    authorIsHost: row.admin_user_id !== null,
    body: row.body,
    pending: row.status === "pending",
    mine: row.member_id !== null && row.member_id === memberId,
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
    replies: [],
  };
}

/**
 * Nests the flat rows by `parent_id`.
 *
 * A reply whose parent is not in the visible set — moderated away, or deleted by
 * its author — is promoted to the top level rather than dropped with it. The
 * removed text stays removed, and somebody else's answer does not disappear
 * because of what it was answering.
 */
function threadComments(rows: CommentRow[], memberId: number): CommentJson[] {
  const byId = new Map<number, CommentJson>();
  for (const row of rows) byId.set(row.id, toCommentJson(row, memberId));

  const roots: CommentJson[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    const parent = row.parent_id === null ? undefined : byId.get(row.parent_id);
    if (parent) parent.replies.push(node);
    else {
      node.parentId = null;
      roots.push(node);
    }
  }
  return roots;
}

/** GET /api/member/lessons/:lessonId/comments */
memberProgressRouter.get(
  "/lessons/:lessonId/comments",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const lessonId = readParamId(req.params.lessonId, LESSON_MISSING);

    const lesson = await loadOwnedLesson(member.id, lessonId);
    // The discussion under a lesson is about the lesson. Handing it over before
    // the lesson opens leaks the content in everybody else's words.
    assertUnlocked(lesson);

    const found = await pool.query<CommentRow>(
      `${COMMENT_SELECT} ORDER BY c.created_at, c.id`,
      [lesson.id, member.id]
    );

    res.json({
      lessonId: lesson.id,
      commentsEnabled: lesson.commentsEnabled,
      comments: threadComments(found.rows, member.id),
    });
  })
);

/**
 * POST /api/member/lessons/:lessonId/comments
 *
 * `requireVerifiedEmail` on top of the ownership check: this is the one thing a
 * member writes that other people read, and an unverified address is a name
 * nobody has proved belongs to them.
 */
memberProgressRouter.post(
  "/lessons/:lessonId/comments",
  denyImpersonation,
  requireVerifiedEmail,
  authoringLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const lessonId = readParamId(req.params.lessonId, LESSON_MISSING);

    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid comment", parsed.error.flatten());
    const { body, parentId } = parsed.data;

    const lesson = await loadOwnedLesson(member.id, lessonId);
    assertUnlocked(lesson);
    if (!lesson.commentsEnabled) throw badRequest("Comments are turned off for this lesson.");

    if (parentId !== null && parentId !== undefined) {
      // The parent has to belong to this same lesson: an id from another course's
      // discussion would otherwise graft a reply onto a thread nobody here owns.
      // Visibility is the same test the listing applies, so a reply cannot be
      // hung off a comment the member was never shown.
      const parent = await pool.query(
        `SELECT 1 FROM lesson_comments
          WHERE id = $1 AND lesson_id = $2
            AND (status = 'visible' OR (status = 'pending' AND member_id = $3))`,
        [parentId, lesson.id, member.id]
      );
      if (parent.rows.length === 0) throw notFound(COMMENT_MISSING);
    }

    // author_name is denormalised so a comment keeps its byline after the account
    // behind it is deleted and `member_id` goes null.
    const profile = await pool.query<{ display_name: string }>(
      `SELECT COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), NULLIF(name, ''), 'Member')
              AS display_name
         FROM members WHERE id = $1`,
      [member.id]
    );

    const created = await pool.query<{ id: number }>(
      `INSERT INTO lesson_comments (lesson_id, member_id, author_name, parent_id, body, status)
       VALUES ($1, $2, $3, $4, $5, 'visible')
       RETURNING id`,
      [lesson.id, member.id, profile.rows[0]?.display_name ?? "Member", parentId ?? null, body]
    );

    const reread = await pool.query<CommentRow>(`${COMMENT_SELECT} AND c.id = $3`, [
      lesson.id,
      member.id,
      created.rows[0].id,
    ]);
    const row = reread.rows[0];
    if (!row) throw notFound(COMMENT_MISSING);

    res.status(201).json(toCommentJson(row, member.id));
  })
);

/**
 * Loads a comment this member wrote, or 404s.
 *
 * `member_id = $2` is in the WHERE clause rather than compared after the read,
 * and entitlement to the lesson is re-proved on top: a member whose access has
 * lapsed does not get to keep editing what they left behind. A comment posted by
 * the admin has a null `member_id` and so matches nothing here.
 */
async function loadOwnComment(memberId: number, commentId: number): Promise<{ lessonId: number }> {
  const found = await pool.query<{ lesson_id: number }>(
    `SELECT lesson_id FROM lesson_comments
      WHERE id = $1 AND member_id = $2 AND status <> 'deleted'`,
    [commentId, memberId]
  );
  const row = found.rows[0];
  if (!row) throw notFound(COMMENT_MISSING);

  await loadOwnedLesson(memberId, row.lesson_id);
  return { lessonId: row.lesson_id };
}

/** PATCH /api/member/comments/:id — the author, editing their own. */
memberProgressRouter.patch(
  "/comments/:id",
  denyImpersonation,
  requireVerifiedEmail,
  authoringLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const commentId = readParamId(req.params.id, COMMENT_MISSING);

    const parsed = commentEditSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid comment", parsed.error.flatten());

    const { lessonId } = await loadOwnComment(member.id, commentId);

    await pool.query(
      `UPDATE lesson_comments SET body = $3, updated_at = now()
        WHERE id = $1 AND member_id = $2 AND status <> 'deleted'`,
      [commentId, member.id, parsed.data.body]
    );

    const reread = await pool.query<CommentRow>(`${COMMENT_SELECT} AND c.id = $3`, [
      lessonId,
      member.id,
      commentId,
    ]);
    const row = reread.rows[0];
    if (!row) throw notFound(COMMENT_MISSING);

    res.json(toCommentJson(row, member.id));
  })
);

/**
 * DELETE /api/member/comments/:id
 *
 * The row survives with `status = 'deleted'` so the replies hanging off it are
 * not cascade-deleted along with it, but the text does not: a member removing
 * their own words should not find them still sitting in the database afterwards.
 */
memberProgressRouter.delete(
  "/comments/:id",
  denyImpersonation,
  authoringLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const commentId = readParamId(req.params.id, COMMENT_MISSING);

    await loadOwnComment(member.id, commentId);

    await pool.query(
      `UPDATE lesson_comments
          SET status = 'deleted', body = '', updated_at = now()
        WHERE id = $1 AND member_id = $2`,
      [commentId, member.id]
    );

    res.json({ id: commentId, deleted: true });
  })
);
