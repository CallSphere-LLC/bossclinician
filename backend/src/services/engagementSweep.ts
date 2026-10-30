import {
  AUTOMATION_SCOPE_FACT,
  SWEPT_TRIGGERS,
  parseLessonNotWatchedConfig,
  parseLiveSessionConfig,
  type TriggerV2,
} from "../automations/engineV2";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { PRODUCT_CONTENT_COURSE_ID } from "./access";
import { flattenLessons, loadCourseForMember, loadDripSettings } from "./curriculum";
import { automationIdentity, publishDomainEvent } from "./domainEvents";
import { resolveRelease, type DripSettings } from "./drip";
import {
  REMINDER_CATCHUP_HOURS,
  REPLAY_SEND_WINDOW_DAYS,
  isDueNow,
  lessonDueAt,
  lessonLink,
  needsReminder,
  replayWindowOpen,
  watchStatusOf,
  watchedPercentOf,
} from "./engagement";
import { listSessions, sessionPeople } from "./liveSessions";

/**
 * The engagement sweep (row 171): turns "nothing happened" into an automation
 * trigger.
 *
 * Every other trigger is somebody doing something. These three are somebody
 * *not* doing something by a deadline — a lesson video still unwatched N days
 * after it opened, a live session missed — so nothing in a request can raise
 * them, and a scheduled sweep (`job_schedules` 'engagement-sweep', every 30
 * minutes) works out who is due.
 *
 * Safety, in the order it is applied:
 *
 *  1. Nothing at all happens unless the owner has an ACTIVE automation on one
 *     of these triggers. New automations are created paused.
 *  2. Each automation is swept with its own settings, and each occurrence is
 *     published for that automation alone (`_automationId`, see engineV2
 *     SWEPT_TRIGGERS), so a 3-day and a 7-day reminder on one course do not
 *     both go out on day 3.
 *  3. Every occurrence has a stable event key — automation, person, lesson or
 *     session — and `domain_events.event_key` is unique, so a sweep that runs
 *     again, twice at once, or after a crash publishes nothing new. The run
 *     itself is unique on (automation, event key) as well.
 *  4. Only moments in the recent past count: a reminder due in the last
 *     REMINDER_CATCHUP_HOURS, a replay for a session that ended in the last
 *     REPLAY_SEND_WINDOW_DAYS. Turning an automation on never emails the whole
 *     history of a course; the backlog is the Engagement page's buttons.
 *  5. The email itself is the automation's `send_email` step, so suppressions,
 *     unsubscribes, both preference stores, the sending identity check and the
 *     staging recipient guard all apply exactly as for every other automation.
 */

/** Members looked at per automation per sweep. */
const MAX_MEMBERS_PER_AUTOMATION = 2000;

/**
 * How far back a grant can be and still be looked at. A drip that opens a
 * lesson more than a year after purchase is not one this platform has, and
 * without a bound every member who ever bought the course would be re-read
 * every half hour for good.
 */
const MAX_RELEASE_LOOKBACK_DAYS = 400;

interface SweptAutomation {
  id: number;
  trigger_type: TriggerV2;
  trigger_config: Record<string, unknown> | null;
}

export async function runEngagementSweep(now: Date = new Date()): Promise<Record<string, number>> {
  const active = await pool.query<SweptAutomation>(
    `SELECT id, trigger_type, trigger_config
       FROM automations
      WHERE status = 'active' AND trigger_type = ANY($1::text[])
      ORDER BY id`,
    [[...SWEPT_TRIGGERS]]
  );
  // The common case, and the shipped one: no automation is using these.
  if (active.rows.length === 0) return { automations: 0, published: 0, failed: 0 };

  let published = 0;
  let failed = 0;
  const settings = await loadDripSettings();
  for (const automation of active.rows) {
    try {
      published +=
        automation.trigger_type === "lesson_not_watched"
          ? await sweepLessonReminders(automation, now, settings)
          : await sweepLiveSessions(automation, now);
    } catch (err) {
      // One automation's bad settings must not stop the others' reminders.
      failed += 1;
      console.error(
        `[engagement] sweep of automation ${automation.id} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return { automations: active.rows.length, published, failed };
}

/* ------------------------------------------------------------ lesson videos */

interface MediaLessonRow {
  id: number;
  slug: string;
  title: string;
  preview: boolean;
  video_duration_seconds: number;
  drip_days: number | null;
  drip_date: Date | null;
  publish_at: Date | null;
  module_drip_days: number | null;
  module_drip_date: Date | null;
}

/** Published lessons with a video or audio file, in the order the player walks them. */
export async function mediaLessonsOf(courseId: number): Promise<MediaLessonRow[]> {
  const res = await pool.query<MediaLessonRow>(
    `SELECT l.id, l.slug, l.title, l.preview, COALESCE(l.video_duration_seconds, 0) AS video_duration_seconds,
            l.drip_days, l.drip_date, l.publish_at,
            m.drip_days AS module_drip_days, m.drip_date AS module_drip_date
       FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
      WHERE m.course_id = $1
        AND l.published
        AND ((l.content_type = 'video' AND COALESCE(l.video_url, '') <> '')
          OR (l.content_type = 'audio' AND COALESCE(l.audio_url, '') <> ''))
      ORDER BY m.sort, m.id, l.sort, l.id`,
    [courseId]
  );
  return res.rows;
}

/**
 * When a lesson opened for somebody who got the course at `grantedAt`: the
 * drip schedule and the "Scheduled" date, read exactly as the player reads
 * them, evaluated at the moment of the grant. Open from the start is null.
 */
export function dripReleaseOf(
  lesson: MediaLessonRow,
  grantedAt: Date,
  settings: DripSettings
): Date | null {
  const state = resolveRelease({
    lesson: { dripDays: lesson.drip_days, dripDate: lesson.drip_date },
    module: { dripDays: lesson.module_drip_days, dripDate: lesson.module_drip_date },
    publishAt: lesson.publish_at,
    preview: lesson.preview,
    grantedAt,
    now: grantedAt,
    settings,
  });
  return state.unlocked ? null : state.unlocksAt;
}

async function sweepLessonReminders(
  automation: SweptAutomation,
  now: Date,
  settings: DripSettings
): Promise<number> {
  const config = parseLessonNotWatchedConfig(automation.trigger_config);
  if (!config) return 0;

  const courseRes = await pool.query<{ id: number; slug: string; title: string }>(
    `SELECT id, slug, title FROM courses WHERE id = $1`,
    [config.courseId]
  );
  const course = courseRes.rows[0];
  if (!course) return 0;

  const media = await mediaLessonsOf(course.id);
  const targets = config.lessonId ? media.filter((lesson) => lesson.id === config.lessonId) : media;
  if (targets.length === 0) return 0;

  // Nobody can be due before `days` have passed since they got the course,
  // whatever the basis. Counting from the grant, nobody can be due either once
  // the catch-up window has closed on it.
  const latestGrant = new Date(now.getTime() - config.days * 86_400_000);
  const earliestGrant =
    config.basis === "access"
      ? new Date(latestGrant.getTime() - REMINDER_CATCHUP_HOURS * 3_600_000)
      : null;

  const members = await pool.query<{ member_id: number; granted_at: Date; product_slug: string }>(
    `SELECT g.member_id, MIN(g.granted_at) AS granted_at,
            (ARRAY_AGG(p.slug::text ORDER BY g.granted_at, g.id))[1] AS product_slug
       FROM access_grants g
       JOIN products p ON p.id = g.product_id
       JOIN members m ON m.id = g.member_id
      WHERE ${PRODUCT_CONTENT_COURSE_ID} = $1
        AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND m.status = 'active'
      GROUP BY g.member_id
     HAVING MIN(g.granted_at) <= $2
        AND MIN(g.granted_at) > $2::timestamptz - make_interval(days => ${MAX_RELEASE_LOOKBACK_DAYS})
        AND ($3::timestamptz IS NULL OR MIN(g.granted_at) > $3)
        -- Somebody who has finished every target lesson has nothing to be reminded of.
        AND EXISTS (
              SELECT 1 FROM unnest($4::int[]) AS t(lesson_id)
               WHERE NOT EXISTS (SELECT 1 FROM lesson_progress lp
                                  WHERE lp.member_id = g.member_id AND lp.lesson_id = t.lesson_id
                                    AND lp.completed_at IS NOT NULL))
      ORDER BY MIN(g.granted_at) DESC
      LIMIT ${MAX_MEMBERS_PER_AUTOMATION}`,
    [course.id, latestGrant, earliestGrant, targets.map((lesson) => lesson.id)]
  );

  let published = 0;
  for (const member of members.rows) {
    try {
      if (await remindOneMember(automation.id, config, course, targets, member, now, settings)) {
        published += 1;
      }
    } catch (err) {
      console.error(
        `[engagement] lesson reminder for member ${member.member_id} (automation ${automation.id}) failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return published;
}

/**
 * At most one reminder per member per sweep: the first target lesson that is
 * open, not watched the way the automation asks about, and due right now.
 * In "next lesson" mode (no lesson chosen) the walk stops at the first open
 * unwatched lesson whether or not it is due — a reminder never skips ahead to
 * lesson 5 while lesson 2 is still waiting.
 */
async function remindOneMember(
  automationId: number,
  config: NonNullable<ReturnType<typeof parseLessonNotWatchedConfig>>,
  course: { id: number; slug: string; title: string },
  targets: MediaLessonRow[],
  member: { member_id: number; granted_at: Date; product_slug: string },
  now: Date,
  settings: DripSettings
): Promise<boolean> {
  const view = await loadCourseForMember(member.member_id, course.id, now);
  if (!view) return false;
  const lessons = flattenLessons(view.modules);
  const position = new Map(lessons.map((lesson, index) => [lesson.id, index]));

  for (const target of targets) {
    const index = position.get(target.id);
    if (index === undefined) continue;
    const lesson = lessons[index];
    // In "next lesson" mode an optional video is not what they are waiting on. An
    // automation that names this lesson is the owner asking, so it still reminds.
    if (lesson.skippable && !config.lessonId) continue;
    // Locked — by the drip, a schedule, or the lesson before it — is not
    // "not watched"; there is nothing they could have watched.
    if (!lesson.unlocked) {
      if (config.lessonId) return false;
      continue;
    }

    const status = watchStatusOf({
      completedAt: lesson.completedAt,
      watchedPercent: lesson.watchedPercent,
      lastPositionSeconds: lesson.lastPositionSeconds,
      maxPositionSeconds: lesson.fullWatch.playedToSeconds,
    });
    if (!needsReminder(status, config.watch)) continue;

    // When it opened: the drip / schedule, or — for a lesson held behind the
    // one before it — when that one was finished.
    let releasedAt = dripReleaseOf(target, member.granted_at, settings);
    const previous = index > 0 ? lessons[index - 1] : null;
    const sequenced =
      previous !== null && (lesson.requiresPreviousLesson || previous.fullWatch.required);
    if (sequenced && previous?.completedAt) {
      const finished = new Date(previous.completedAt);
      if (!releasedAt || finished.getTime() > releasedAt.getTime()) releasedAt = finished;
    }

    const dueAt = lessonDueAt({
      grantedAt: member.granted_at,
      releasedAt,
      basis: config.basis,
      days: config.days,
    });
    if (!isDueNow(dueAt, now)) return false;

    const identity = await automationIdentity(member.member_id);
    if (!identity.email) return false;

    const result = await publishDomainEvent("lesson_not_watched", {
      eventKey: `lesson-not-watched:${automationId}:${member.member_id}:${lesson.id}`,
      contactId: identity.contactId,
      email: identity.email,
      name: identity.name,
      subjectId: course.id,
      source: `course:${course.slug}`,
      facts: {
        [AUTOMATION_SCOPE_FACT]: automationId,
        memberId: member.member_id,
        courseId: course.id,
        lessonId: lesson.id,
        courseTitle: course.title,
        lessonTitle: lesson.title,
        lessonUrl: lessonLink(env.publicSiteUrl, member.product_slug, lesson.slug),
        watchedPercent: watchedPercentOf(
          {
            completedAt: lesson.completedAt,
            watchedPercent: lesson.watchedPercent,
            lastPositionSeconds: lesson.lastPositionSeconds,
            maxPositionSeconds: lesson.fullWatch.playedToSeconds,
          },
          target.video_duration_seconds
        ),
        watchStatus: status,
        dueAt: dueAt.toISOString(),
      },
    });
    return result.created;
  }
  return false;
}

/* ------------------------------------------------------------ live sessions */

async function sweepLiveSessions(automation: SweptAutomation, now: Date): Promise<number> {
  const config = parseLiveSessionConfig(automation.trigger_config);
  const missedOnly = automation.trigger_type === "live_session_missed";

  const sessions = (
    await listSessions({
      since: new Date(now.getTime() - REPLAY_SEND_WINDOW_DAYS * 86_400_000),
      until: now,
      communityId: config.communityId ?? null,
      eventId: config.eventId ?? null,
    })
  ).filter(
    (session) =>
      // Over, inside the window, and with somewhere to send them.
      replayWindowOpen(session.endsAt, now) &&
      /^https?:\/\//i.test(session.replayUrl.trim()) &&
      // "Missed" needs to know who came; a meetup on an external link cannot.
      (!missedOnly || session.attendanceTracked)
  );

  let published = 0;
  for (const session of sessions) {
    const people = await sessionPeople(session, config.audience);
    for (const person of people) {
      if (missedOnly && (person.attended !== false || !person.invited)) continue;
      if (!person.email) continue;
      const personKey = person.memberId !== null ? `m${person.memberId}` : person.email.toLowerCase();
      try {
        const identity =
          person.memberId !== null
            ? await automationIdentity(person.memberId, person.email, person.name)
            : { contactId: person.contactId, email: person.email, name: person.name };
        const result = await publishDomainEvent(automation.trigger_type, {
          eventKey: `${automation.trigger_type}:${automation.id}:${session.key}:${personKey}`,
          contactId: identity.contactId ?? person.contactId,
          email: identity.email || person.email,
          name: identity.name || person.name,
          subjectId: session.communityId,
          source: session.source === "community" ? `community:${session.communitySlug}` : `event:${session.eventId}`,
          facts: {
            [AUTOMATION_SCOPE_FACT]: automation.id,
            sessionKey: session.key,
            sessionSource: session.source,
            eventId: session.eventId,
            sessionTitle: session.title,
            sessionDate: session.dateLabel,
            replayUrl: session.replayUrl.trim(),
            communityName: session.communityName,
            attended: person.attended === null ? "unknown" : person.attended ? "yes" : "no",
            invitedAs: person.invitedAs,
          },
        });
        if (result.created) published += 1;
      } catch (err) {
        console.error(
          `[engagement] replay event for ${personKey} on ${session.key} (automation ${automation.id}) failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }
  return published;
}
