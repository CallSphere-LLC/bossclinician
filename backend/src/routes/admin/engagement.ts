import { Router, type Request } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { recordAdminAction } from "../../services/adminAudit";
import { PRODUCT_CONTENT_COURSE_ID } from "../../services/access";
import {
  DEFAULT_LESSON_REMINDER,
  DEFAULT_REPLAY_EMAIL,
  lessonLink,
  matchesStatusFilter,
  parseSessionKey,
  watchStatusOf,
  watchedPercentOf,
  type WatchStatus,
} from "../../services/engagement";
import { queueEngagementSends, MAX_RECIPIENTS_PER_PRESS } from "../../services/engagementSends";
import { findSession, listSessions, sessionPeople, type LiveSession } from "../../services/liveSessions";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { csvCell } from "./reports";

/**
 * Analytics → Engagement (QA row 171) — mounted at /api/admin/engagement.
 *
 * "Did she watch the video?" and "who missed Thursday's call?" in one place,
 * with the two follow-ups the owner asked for beside them: a reminder email
 * about a lesson, and the replay emailed to whoever was not there.
 *
 * Reads are the products view permission; the two sends, and setting a replay
 * link, are writes and need products.manage (the mount's moduleGate). Both
 * sends go through services/engagementSends.ts — one row per person per day,
 * at most once, every marketing gate applied — never straight to the provider.
 */
export const adminEngagementRouter = Router();

function adminId(req: Request): number | null {
  const sub = (req as Request & { user?: { sub?: number } }).user?.sub;
  return typeof sub === "number" && sub > 0 ? sub : null;
}

/* ------------------------------------------------------------ lesson videos */

/** One member's live access to one course, the way the player decides it. */
const ACCESS_CTE = `
  access AS (
    SELECT g.member_id, ${PRODUCT_CONTENT_COURSE_ID} AS course_id,
           MIN(g.granted_at) AS granted_at,
           (ARRAY_AGG(p.slug::text ORDER BY g.granted_at, g.id))[1] AS product_slug
      FROM access_grants g
      JOIN products p ON p.id = g.product_id
     WHERE g.status = 'active'
       AND (g.expires_at IS NULL OR g.expires_at > now())
       AND ${PRODUCT_CONTENT_COURSE_ID} IS NOT NULL
     GROUP BY g.member_id, ${PRODUCT_CONTENT_COURSE_ID}
  )`;

/** Published lessons with a video or audio file, numbered in course order. */
const MEDIA_LESSONS_CTE = `
  media AS (
    SELECT l.id, l.slug, l.title, m.course_id, m.title AS module_title,
           COALESCE(l.video_duration_seconds, 0) AS duration_seconds,
           ROW_NUMBER() OVER (PARTITION BY m.course_id ORDER BY m.sort, m.id, l.sort, l.id) AS ord
      FROM course_lessons l
      JOIN course_modules m ON m.id = l.module_id
     WHERE l.published
       AND ((l.content_type = 'video' AND COALESCE(l.video_url, '') <> '')
         OR (l.content_type = 'audio' AND COALESCE(l.audio_url, '') <> ''))
  )`;

/**
 * GET /courses — every course with at least one video lesson, and how many
 * people can watch it.
 */
adminEngagementRouter.get(
  "/courses",
  asyncHandler(async (_req, res) => {
    const result = await pool.query<{ id: number; title: string; video_lessons: number; members: number }>(
      `WITH ${ACCESS_CTE}, ${MEDIA_LESSONS_CTE}
       SELECT c.id, c.title,
              (SELECT COUNT(*)::int FROM media x WHERE x.course_id = c.id) AS video_lessons,
              (SELECT COUNT(*)::int FROM access a JOIN members mem ON mem.id = a.member_id
                WHERE a.course_id = c.id AND mem.status = 'active') AS members
         FROM courses c
        WHERE EXISTS (SELECT 1 FROM media x WHERE x.course_id = c.id)
        ORDER BY c.title`
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        videoLessons: row.video_lessons,
        members: row.members,
      }))
    );
  })
);

/**
 * GET /courses/:courseId/lessons — the course's video lessons, each with how
 * many members have not started, are part way, and have finished it.
 */
adminEngagementRouter.get(
  "/courses/:courseId/lessons",
  asyncHandler(async (req, res) => {
    const courseId = z.coerce.number().int().positive().parse(req.params.courseId);
    const result = await pool.query<{
      id: number;
      title: string;
      module_title: string;
      duration_seconds: number;
      members: number;
      completed: number;
      partial: number;
    }>(
      `WITH ${ACCESS_CTE}, ${MEDIA_LESSONS_CTE}
       SELECT x.id, x.title, x.module_title, x.duration_seconds,
              COUNT(a.member_id)::int AS members,
              COUNT(*) FILTER (WHERE lp.completed_at IS NOT NULL)::int AS completed,
              COUNT(*) FILTER (WHERE lp.completed_at IS NULL AND (
                 COALESCE(lp.watched_percent, 0) > 0 OR COALESCE(lp.last_position_seconds, 0) > 0
                 OR COALESCE(lp.max_position_seconds, 0) > 0 OR COALESCE(lp.watched_seconds, 0) > 0
              ))::int AS partial
         FROM media x
         LEFT JOIN access a ON a.course_id = x.course_id
              AND EXISTS (SELECT 1 FROM members mem WHERE mem.id = a.member_id AND mem.status = 'active')
         LEFT JOIN lesson_progress lp ON lp.lesson_id = x.id AND lp.member_id = a.member_id
        WHERE x.course_id = $1
        GROUP BY x.id, x.title, x.module_title, x.duration_seconds, x.ord
        ORDER BY x.ord`,
      [courseId]
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        moduleTitle: row.module_title,
        durationSeconds: row.duration_seconds,
        members: row.members,
        completed: row.completed,
        partial: row.partial,
        notStarted: Math.max(0, row.members - row.completed - row.partial),
      }))
    );
  })
);

const progressQuerySchema = z.object({
  courseId: z.coerce.number().int().positive().optional(),
  lessonId: z.coerce.number().int().positive().optional(),
  memberId: z.coerce.number().int().positive().optional(),
  status: z.enum(["all", "not_started", "partial", "completed", "not_completed"]).default("all"),
  q: z.string().trim().max(200).default(""),
});

type ProgressQuery = z.infer<typeof progressQuerySchema>;

interface ProgressRow {
  memberId: number;
  name: string;
  email: string;
  courseId: number;
  courseTitle: string;
  lessonId: number;
  lessonTitle: string;
  moduleTitle: string;
  status: WatchStatus;
  watchedPercent: number;
  completedAt: string | null;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  grantedAt: string;
  lastRemindedAt: string | null;
  lessonUrl: string;
}

/** The most rows one page of the report returns (members × lessons). */
const MAX_PROGRESS_ROWS = 5000;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** The statuses a filter keeps (the SQL above computes the same three). */
function statusesFor(wanted: ProgressQuery["status"]): WatchStatus[] {
  return (["not_started", "partial", "completed"] as WatchStatus[]).filter((status) =>
    matchesStatusFilter(status, wanted)
  );
}

async function loadProgress(query: ProgressQuery): Promise<{ rows: ProgressRow[]; truncated: boolean }> {
  if (!query.courseId && !query.memberId && !query.lessonId && query.q.length < 2) {
    throw badRequest("Choose a course, or search for a person by name or email.");
  }

  const result = await pool.query<{
    member_id: number;
    name: string;
    email: string;
    course_id: number;
    course_title: string;
    lesson_id: number;
    lesson_title: string;
    lesson_slug: string;
    module_title: string;
    duration_seconds: number;
    product_slug: string;
    granted_at: Date;
    watched_percent: number | null;
    last_position_seconds: number | null;
    max_position_seconds: number | null;
    watched_seconds: number | null;
    completed_at: Date | null;
    first_viewed_at: Date | null;
    last_viewed_at: Date | null;
    last_reminded_at: Date | null;
  }>(
    `WITH ${ACCESS_CTE}, ${MEDIA_LESSONS_CTE}
     SELECT a.member_id,
            COALESCE(NULLIF(TRIM(mem.first_name || ' ' || mem.last_name), ''), mem.name, '') AS name,
            mem.email::text AS email,
            x.course_id, c.title AS course_title,
            x.id AS lesson_id, x.title AS lesson_title, x.slug AS lesson_slug, x.module_title,
            x.duration_seconds, a.product_slug, a.granted_at,
            lp.watched_percent, lp.last_position_seconds, lp.max_position_seconds, lp.watched_seconds,
            lp.completed_at, lp.first_viewed_at, lp.last_viewed_at,
            (SELECT MAX(s.created_at) FROM engagement_sends s
              WHERE s.kind = 'lesson_reminder' AND s.lesson_id = x.id AND s.member_id = a.member_id
                AND s.status IN ('queued', 'sending', 'sent')) AS last_reminded_at
       FROM access a
       JOIN members mem ON mem.id = a.member_id
       JOIN media x ON x.course_id = a.course_id
       JOIN courses c ON c.id = x.course_id
       LEFT JOIN lesson_progress lp ON lp.member_id = a.member_id AND lp.lesson_id = x.id
      WHERE mem.status = 'active'
        AND ($1::int IS NULL OR x.course_id = $1)
        AND ($2::int IS NULL OR x.id = $2)
        AND ($3::int IS NULL OR a.member_id = $3)
        AND ($4::text = '' OR mem.email::text ILIKE '%' || $4::text || '%'
                     OR mem.name ILIKE '%' || $4::text || '%'
                     OR (mem.first_name || ' ' || mem.last_name) ILIKE '%' || $4::text || '%')
        -- The status filter in SQL, so the row cap applies to what is shown.
        AND (CASE
               WHEN lp.completed_at IS NOT NULL THEN 'completed'
               WHEN COALESCE(lp.watched_percent, 0) > 0 OR COALESCE(lp.last_position_seconds, 0) > 0
                 OR COALESCE(lp.max_position_seconds, 0) > 0 OR COALESCE(lp.watched_seconds, 0) > 0
                 THEN 'partial'
               ELSE 'not_started'
             END) = ANY($5::text[])
      ORDER BY c.title, LOWER(COALESCE(NULLIF(TRIM(mem.first_name || ' ' || mem.last_name), ''), mem.name, mem.email::text)),
               a.member_id, x.ord
      LIMIT ${MAX_PROGRESS_ROWS + 1}`,
    [query.courseId ?? null, query.lessonId ?? null, query.memberId ?? null, query.q, statusesFor(query.status)]
  );

  const truncated = result.rows.length > MAX_PROGRESS_ROWS;
  const rows: ProgressRow[] = [];
  for (const row of result.rows.slice(0, MAX_PROGRESS_ROWS)) {
    const facts = {
      completedAt: row.completed_at,
      watchedPercent: row.watched_percent ?? 0,
      lastPositionSeconds: row.last_position_seconds ?? 0,
      maxPositionSeconds: row.max_position_seconds ?? 0,
      watchedSeconds: row.watched_seconds ?? 0,
    };
    const status = watchStatusOf(facts);
    if (!matchesStatusFilter(status, query.status)) continue;
    rows.push({
      memberId: row.member_id,
      name: row.name,
      email: row.email,
      courseId: row.course_id,
      courseTitle: row.course_title,
      lessonId: row.lesson_id,
      lessonTitle: row.lesson_title,
      moduleTitle: row.module_title,
      status,
      watchedPercent: watchedPercentOf(facts, row.duration_seconds),
      completedAt: iso(row.completed_at),
      firstViewedAt: iso(row.first_viewed_at),
      lastViewedAt: iso(row.last_viewed_at),
      grantedAt: row.granted_at.toISOString(),
      lastRemindedAt: iso(row.last_reminded_at),
      lessonUrl: lessonLink(env.publicSiteUrl, row.product_slug, row.lesson_slug),
    });
  }
  return { rows, truncated };
}

/** GET /progress — who watched which video: one row per person per video lesson. */
adminEngagementRouter.get(
  "/progress",
  asyncHandler(async (req, res) => {
    const parsed = progressQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid filters", parsed.error.flatten());
    const { rows, truncated } = await loadProgress(parsed.data);
    const totals = { notStarted: 0, partial: 0, completed: 0 };
    for (const row of rows) {
      if (row.status === "not_started") totals.notStarted += 1;
      else if (row.status === "partial") totals.partial += 1;
      else totals.completed += 1;
    }
    res.json({ rows, totals, truncated, defaults: DEFAULT_LESSON_REMINDER });
  })
);

const STATUS_LABEL: Record<WatchStatus, string> = {
  not_started: "Not started",
  partial: "Partly watched",
  completed: "Completed",
};

/** GET /progress.csv — the same rows, for a spreadsheet. */
adminEngagementRouter.get(
  "/progress.csv",
  asyncHandler(async (req, res) => {
    const parsed = progressQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid filters", parsed.error.flatten());
    const { rows } = await loadProgress(parsed.data);

    const lines = [
      [
        "Name",
        "Email",
        "Course",
        "Section",
        "Lesson",
        "Status",
        "Watched %",
        "Completed at",
        "First opened",
        "Last watched",
        "Has access since",
        "Last reminder",
      ]
        .map(csvCell)
        .join(","),
    ];
    for (const row of rows) {
      lines.push(
        [
          row.name,
          row.email,
          row.courseTitle,
          row.moduleTitle,
          row.lessonTitle,
          STATUS_LABEL[row.status],
          row.watchedPercent,
          row.completedAt ?? "",
          row.firstViewedAt ?? "",
          row.lastViewedAt ?? "",
          row.grantedAt,
          row.lastRemindedAt ?? "",
        ]
          .map(csvCell)
          .join(",")
      );
    }

    await recordAdminAction({
      req,
      action: "engagement.export_csv",
      entityType: "course",
      entityId: String(parsed.data.courseId ?? ""),
      after: { rows: rows.length },
    });

    const filename = `video-engagement-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(`﻿${lines.join("\r\n")}\r\n`);
  })
);

const emailCopySchema = z.object({
  subject: z.string().trim().min(1, "Give the email a subject").max(300),
  bodyMd: z.string().trim().min(1, "Write something for the email to say").max(20_000),
});

const remindSchema = emailCopySchema.extend({
  lessonId: z.coerce.number().int().positive(),
  memberIds: z.array(z.coerce.number().int().positive()).min(1, "Choose who to remind").max(MAX_RECIPIENTS_PER_PRESS),
});

/**
 * POST /remind — "Send reminder" for one lesson to the members ticked.
 *
 * Only members who can open the lesson's course are emailed, whatever ids
 * arrive. Once per person per lesson per day.
 */
adminEngagementRouter.post(
  "/remind",
  asyncHandler(async (req, res) => {
    const input = remindSchema.parse(req.body);

    const lessonRes = await pool.query<{ id: number; slug: string; title: string; course_id: number; course_title: string }>(
      `SELECT l.id, l.slug, l.title, m.course_id, c.title AS course_title
         FROM course_lessons l
         JOIN course_modules m ON m.id = l.module_id
         JOIN courses c ON c.id = m.course_id
        WHERE l.id = $1`,
      [input.lessonId]
    );
    const lesson = lessonRes.rows[0];
    if (!lesson) throw notFound("That lesson no longer exists");

    const recipients = await pool.query<{
      member_id: number;
      contact_id: number | null;
      email: string;
      name: string;
      product_slug: string;
    }>(
      `WITH ${ACCESS_CTE}
       SELECT a.member_id, mem.contact_id, mem.email::text AS email,
              COALESCE(NULLIF(TRIM(mem.first_name || ' ' || mem.last_name), ''), mem.name, '') AS name,
              a.product_slug
         FROM access a
         JOIN members mem ON mem.id = a.member_id
        WHERE a.course_id = $1 AND a.member_id = ANY($2::int[]) AND mem.status = 'active'`,
      [lesson.course_id, input.memberIds]
    );

    const lessonUrlFor = (productSlug: string) => lessonLink(env.publicSiteUrl, productSlug, lesson.slug);
    const result = await queueEngagementSends({
      kind: "lesson_reminder",
      ref: `lesson:${lesson.id}`,
      lessonId: lesson.id,
      subject: input.subject,
      bodyMd: input.bodyMd,
      createdBy: adminId(req),
      recipients: recipients.rows.map((row) => ({
        memberId: row.member_id,
        contactId: row.contact_id,
        email: row.email,
        name: row.name,
        merge: {
          courseTitle: lesson.course_title,
          lessonTitle: lesson.title,
          lessonUrl: lessonUrlFor(row.product_slug),
        },
      })),
    });

    await recordAdminAction({
      req,
      action: "engagement.lesson_reminder",
      entityType: "course_lesson",
      entityId: String(lesson.id),
      after: { ...result, requested: input.memberIds.length },
    });

    res.status(202).json({
      ...result,
      // Asked for, but not people who can open this course (any more).
      notEligible: Math.max(0, input.memberIds.length - recipients.rows.length),
    });
  })
);

/* ------------------------------------------------------------ live sessions */

function sessionJson(session: LiveSession) {
  return {
    key: session.key,
    source: session.source,
    eventId: session.eventId,
    communityId: session.communityId,
    communityName: session.communityName,
    title: session.title,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    dateLabel: session.dateLabel,
    replayUrl: session.replayUrl,
    attendanceTracked: session.attendanceTracked,
    recurring: session.recurring,
  };
}

const sessionsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(60),
  communityId: z.coerce.number().int().positive().optional(),
  eventId: z.coerce.number().int().positive().optional(),
});

/** Sessions shown with counts on the list; older ones are reached by narrowing. */
const MAX_LISTED_SESSIONS = 100;

/**
 * GET /sessions — live sessions that have started in the last `days`, newest
 * first, with how many were invited, came, and missed it.
 */
adminEngagementRouter.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const query = sessionsQuerySchema.parse(req.query);
    const now = new Date();
    const sessions = (
      await listSessions({
        since: new Date(now.getTime() - query.days * 86_400_000),
        until: now,
        communityId: query.communityId ?? null,
        eventId: query.eventId ?? null,
      })
    ).slice(0, MAX_LISTED_SESSIONS);

    const out: Array<ReturnType<typeof sessionJson> & Record<string, unknown>> = [];
    for (const session of sessions) {
      const people = await sessionPeople(session, "registered");
      const invited = people.filter((person) => person.invited);
      out.push({
        ...sessionJson(session),
        ended: session.endsAt.getTime() <= now.getTime(),
        invited: invited.length,
        attended: people.filter((person) => person.attended === true).length,
        missed: invited.filter((person) => person.attended === false).length,
      });
    }
    res.json({ sessions: out, defaults: DEFAULT_REPLAY_EMAIL });
  })
);

const sessionKeySchema = z.string().trim().min(3).max(200);

async function sessionFromKey(rawKey: unknown): Promise<LiveSession> {
  const parsed = parseSessionKey(sessionKeySchema.parse(rawKey));
  if (!parsed) throw badRequest("That session could not be found");
  const session = await findSession(parsed.source, parsed.eventId, parsed.startsAt);
  if (!session) throw notFound("That session could not be found");
  return session;
}

/** GET /sessions/people?key=…&audience=registered|members — who it was for, who came. */
adminEngagementRouter.get(
  "/sessions/people",
  asyncHandler(async (req, res) => {
    const session = await sessionFromKey(req.query.key);
    const audience = z.enum(["registered", "members"]).default("registered").parse(req.query.audience ?? undefined);
    const people = await sessionPeople(session, session.source === "event" ? "registered" : audience);

    const lastSent = await pool.query<{ member_id: number | null; email: string; created_at: Date }>(
      `SELECT member_id, email::text AS email, MAX(created_at) AS created_at
         FROM engagement_sends
        WHERE kind = 'replay' AND status IN ('queued', 'sending', 'sent')
          AND ((community_event_id = $1 AND $3::text = 'community') OR (event_id = $1 AND $3::text = 'event'))
          AND session_starts_at = $2
        GROUP BY member_id, email`,
      [session.eventId, session.startsAt, session.source]
    );
    const sentTo = new Map<string, string>();
    for (const row of lastSent.rows) {
      sentTo.set(row.member_id !== null ? `m${row.member_id}` : row.email, row.created_at.toISOString());
    }

    res.json({
      session: sessionJson(session),
      people: people.map((person) => ({
        ...person,
        replaySentAt:
          sentTo.get(person.memberId !== null ? `m${person.memberId}` : person.email.toLowerCase()) ?? null,
      })),
      defaults: DEFAULT_REPLAY_EMAIL,
    });
  })
);

const replaySchema = z.object({
  key: sessionKeySchema,
  replayUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => value === "" || /^https?:\/\/\S+$/i.test(value), "Paste a full web address, starting https://"),
});

/**
 * PUT /sessions/replay — set (or clear) the replay link for a session.
 *
 * A meetup's link belongs to that one session. A site-wide event has a single
 * replay link for all its sessions (`events.replay_url`), the one its own
 * editor shows, and this writes that same column.
 */
adminEngagementRouter.put(
  "/sessions/replay",
  asyncHandler(async (req, res) => {
    const input = replaySchema.parse(req.body);
    const session = await sessionFromKey(input.key);

    if (session.source === "community") {
      await pool.query(
        `INSERT INTO community_event_replays (event_id, session_starts_at, replay_url, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id, session_starts_at)
           DO UPDATE SET replay_url = EXCLUDED.replay_url, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [session.eventId, session.startsAt, input.replayUrl, adminId(req)]
      );
    } else {
      await pool.query(`UPDATE events SET replay_url = $2, updated_at = now() WHERE id = $1`, [
        session.eventId,
        input.replayUrl,
      ]);
    }

    await recordAdminAction({
      req,
      action: "engagement.set_replay",
      entityType: session.source === "community" ? "community_event" : "event",
      entityId: String(session.eventId),
      before: { replayUrl: session.replayUrl },
      after: { replayUrl: input.replayUrl, session: session.key },
    });

    res.json({ ...sessionJson(session), replayUrl: input.replayUrl });
  })
);

const sendReplaySchema = emailCopySchema.extend({
  key: sessionKeySchema,
  audience: z.enum(["registered", "members"]).default("registered"),
  /** `m<memberId>` or an email address, as the people list gives them. */
  people: z.array(z.string().trim().min(1).max(320)).min(1, "Choose who to email").max(MAX_RECIPIENTS_PER_PRESS),
});

/**
 * POST /sessions/send-replay — "Email the replay" to the people ticked.
 *
 * Refused until the session has a replay link: the email exists to send them
 * to it. Once per person per session per day.
 */
adminEngagementRouter.post(
  "/sessions/send-replay",
  asyncHandler(async (req, res) => {
    const input = sendReplaySchema.parse(req.body);
    const session = await sessionFromKey(input.key);
    const replayUrl = session.replayUrl.trim();
    if (!/^https?:\/\//i.test(replayUrl)) {
      throw badRequest("Add the replay link for this session first, then email it.");
    }
    if (session.endsAt.getTime() > Date.now()) {
      throw badRequest("This session has not finished yet.");
    }

    const wanted = new Set(input.people.map((value) => value.toLowerCase()));
    const people = (await sessionPeople(session, session.source === "event" ? "registered" : input.audience)).filter(
      (person) =>
        wanted.has(person.memberId !== null ? `m${person.memberId}` : person.email.toLowerCase())
    );

    const result = await queueEngagementSends({
      kind: "replay",
      ref: session.key,
      communityEventId: session.source === "community" ? session.eventId : null,
      eventId: session.source === "event" ? session.eventId : null,
      sessionStartsAt: session.startsAt,
      subject: input.subject,
      bodyMd: input.bodyMd,
      createdBy: adminId(req),
      recipients: people.map((person) => ({
        memberId: person.memberId,
        contactId: person.contactId,
        email: person.email,
        name: person.name,
        merge: {
          sessionTitle: session.title,
          sessionDate: session.dateLabel,
          replayUrl,
          communityName: session.communityName,
        },
      })),
    });

    await recordAdminAction({
      req,
      action: "engagement.replay_email",
      entityType: session.source === "community" ? "community_event" : "event",
      entityId: String(session.eventId),
      after: { ...result, session: session.key, requested: input.people.length },
    });

    res.status(202).json({ ...result, notEligible: Math.max(0, wanted.size - people.length) });
  })
);

/* -------------------------------------------------------------------- log */

/** GET /sends — the last presses of either button, newest first, with what happened. */
adminEngagementRouter.get(
  "/sends",
  asyncHandler(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit ?? undefined);
    const result = await pool.query<{
      id: string;
      kind: string;
      email: string;
      subject: string;
      status: string;
      error: string;
      created_at: Date;
      sent_at: Date | null;
      lesson_title: string | null;
      session_title: string | null;
      session_starts_at: Date | null;
    }>(
      `SELECT s.id, s.kind, s.email::text AS email, s.subject, s.status, s.error, s.created_at, s.sent_at,
              l.title AS lesson_title,
              COALESCE(ce.title, e.title) AS session_title,
              s.session_starts_at
         FROM engagement_sends s
         LEFT JOIN course_lessons l ON l.id = s.lesson_id
         LEFT JOIN community_events ce ON ce.id = s.community_event_id
         LEFT JOIN events e ON e.id = s.event_id
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT $1`,
      [limit]
    );
    res.json(
      result.rows.map((row) => ({
        id: Number(row.id),
        kind: row.kind,
        email: row.email,
        subject: row.subject,
        status: row.status,
        error: row.error,
        createdAt: row.created_at.toISOString(),
        sentAt: iso(row.sent_at),
        about: row.kind === "lesson_reminder" ? row.lesson_title ?? "" : row.session_title ?? "",
        sessionStartsAt: iso(row.session_starts_at),
      }))
    );
  })
);
