import { pool } from "../db/pool";
import { upcomingSessions, type CommunityEventSeries } from "./communityEventSeries";
import {
  ATTENDANCE_EARLY_MINUTES,
  formatSessionDate,
  heldInLiveRoom,
  sessionEndsAt,
  sessionKey,
} from "./engagement";

/**
 * Live sessions that have happened, who was invited, and who turned up (row 171).
 *
 * Two kinds of session, because the platform has two kinds of live event:
 *
 *  - community meetups (`community_events`), one-off or repeating, held in the
 *    community's live room. Attendance is read from `community_live_visits` —
 *    the room records every stay — by overlap with the session's own window.
 *    The room is per community, not per event, so a session's window is the
 *    only thing that says which call a visit belonged to. A meetup held on an
 *    external link (Zoom) has no attendance the platform can see, and says so
 *    rather than reporting that nobody came.
 *  - site-wide webinar events (`events`), whose registrations already carry
 *    `attended`, set by the event page. Their replay is `events.replay_url`.
 *
 * A meetup's replay is per session (`community_event_replays`, 150): a monthly
 * call has a different recording every month.
 */

export type SessionSource = "community" | "event";

export interface LiveSession {
  key: string;
  source: SessionSource;
  /** `community_events.id` or `events.id`, per `source`. */
  eventId: number;
  communityId: number | null;
  communityName: string;
  communitySlug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  timezone: string;
  /** "Friday, October 9, 10:00 AM PDT". */
  dateLabel: string;
  replayUrl: string;
  /** False for a meetup held on an external link: nobody's attendance is known. */
  attendanceTracked: boolean;
  recurring: boolean;
  accessGroupId: number | null;
}

interface CommunityEventRow extends CommunityEventSeries {
  id: number;
  community_id: number;
  community_name: string;
  community_slug: string;
  title: string;
  location_url: string;
  access_group_id: number | null;
}

/** How many sessions of one series are looked at in a window. */
const MAX_SESSIONS_PER_SERIES = 120;

/**
 * Every session that started inside [since, until], newest first.
 *
 * `communityId` / `eventId` narrow it the way an automation's settings do: an
 * event id means that one site-wide event only, a community id means that
 * community's meetups only, neither means everything.
 */
export async function listSessions(input: {
  since: Date;
  until: Date;
  communityId?: number | null;
  eventId?: number | null;
}): Promise<LiveSession[]> {
  const out: LiveSession[] = [];
  const eventId = input.eventId && input.eventId > 0 ? input.eventId : null;
  const communityId = input.communityId && input.communityId > 0 ? input.communityId : null;

  if (eventId === null) {
    out.push(...(await communitySessions(input.since, input.until, communityId)));
  }
  if (communityId === null) {
    out.push(...(await siteEventSessions(input.since, input.until, eventId)));
  }
  return out.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
}

async function communitySessions(
  since: Date,
  until: Date,
  communityId: number | null
): Promise<LiveSession[]> {
  const events = await pool.query<CommunityEventRow>(
    `SELECT e.id, e.community_id, c.name AS community_name, c.slug::text AS community_slug,
            e.title, e.location_url, e.starts_at, e.duration_minutes, e.timezone,
            e.recurrence_freq, e.recurrence_interval,
            e.recurrence_until::text AS recurrence_until, e.recurrence_count,
            e.access_group_id
       FROM community_events e
       JOIN communities c ON c.id = e.community_id
      WHERE e.published
        AND e.starts_at IS NOT NULL
        AND e.starts_at <= $2
        AND ($1::int IS NULL OR e.community_id = $1)`,
    [communityId, until]
  );
  if (events.rows.length === 0) return [];

  const replays = await pool.query<{ event_id: number; session_starts_at: Date; replay_url: string }>(
    `SELECT event_id, session_starts_at, replay_url
       FROM community_event_replays
      WHERE event_id = ANY($1::int[])`,
    [events.rows.map((row) => row.id)]
  );
  const replayFor = new Map<string, string>();
  for (const row of replays.rows) {
    replayFor.set(sessionKey("community", row.event_id, row.session_starts_at), row.replay_url);
  }

  const out: LiveSession[] = [];
  for (const row of events.rows) {
    // "Not finished by `since`" from the series helper, then only those that
    // had started by `until`: the sessions that fall inside the window.
    const starts = upcomingSessions(row, since, MAX_SESSIONS_PER_SERIES).filter(
      (at) => at.getTime() <= until.getTime()
    );
    for (const startsAt of starts) {
      const key = sessionKey("community", row.id, startsAt);
      out.push({
        key,
        source: "community",
        eventId: row.id,
        communityId: row.community_id,
        communityName: row.community_name,
        communitySlug: row.community_slug,
        title: row.title,
        startsAt,
        endsAt: sessionEndsAt(startsAt, row.duration_minutes),
        durationMinutes: row.duration_minutes,
        timezone: row.timezone,
        dateLabel: formatSessionDate(startsAt, row.timezone),
        replayUrl: replayFor.get(key) ?? "",
        attendanceTracked: heldInLiveRoom(row.location_url, row.community_slug),
        recurring: row.recurrence_freq !== null,
        accessGroupId: row.access_group_id,
      });
    }
  }
  return out;
}

/** Evergreen webinars make a session every few minutes; the page needs a ceiling. */
const MAX_SITE_SESSIONS = 300;

async function siteEventSessions(
  since: Date,
  until: Date,
  eventId: number | null
): Promise<LiveSession[]> {
  const rows = await pool.query<{
    event_id: number;
    session_at: Date;
    title: string;
    duration_minutes: number;
    timezone: string;
    replay_url: string;
    recurring: boolean;
  }>(
    `SELECT r.event_id, r.session_at, e.title, e.duration_minutes, e.timezone,
            e.replay_url, (e.kind = 'evergreen' OR e.recurrence_freq IS NOT NULL) AS recurring
       FROM event_registrations r
       JOIN events e ON e.id = r.event_id
      WHERE e.kind IN ('live', 'evergreen')
        AND r.session_at + make_interval(mins => e.duration_minutes) >= $1
        AND r.session_at <= $2
        AND ($3::int IS NULL OR r.event_id = $3)
      GROUP BY r.event_id, r.session_at, e.title, e.duration_minutes, e.timezone,
               e.replay_url, e.kind, e.recurrence_freq
      ORDER BY r.session_at DESC
      LIMIT ${MAX_SITE_SESSIONS}`,
    [since, until, eventId]
  );

  return rows.rows.map((row) => ({
    key: sessionKey("event", row.event_id, row.session_at),
    source: "event" as const,
    eventId: row.event_id,
    communityId: null,
    communityName: "",
    communitySlug: "",
    title: row.title,
    startsAt: row.session_at,
    endsAt: sessionEndsAt(row.session_at, row.duration_minutes),
    durationMinutes: row.duration_minutes,
    timezone: row.timezone,
    dateLabel: formatSessionDate(row.session_at, row.timezone),
    replayUrl: row.replay_url ?? "",
    attendanceTracked: true,
    recurring: row.recurring,
    accessGroupId: null,
  }));
}

/** One session, found again by its key (the page's and the sends' handle on it). */
export async function findSession(
  source: SessionSource,
  eventId: number,
  startsAt: Date
): Promise<LiveSession | null> {
  const since = new Date(startsAt.getTime() - 60_000);
  const until = new Date(startsAt.getTime() + 60_000);
  const sessions =
    source === "community"
      ? await communitySessions(since, until, null)
      : await siteEventSessions(since, until, eventId);
  const key = sessionKey(source, eventId, startsAt);
  return sessions.find((session) => session.key === key) ?? null;
}

/* ------------------------------------------------------------------ people */

export interface SessionPerson {
  memberId: number | null;
  contactId: number | null;
  email: string;
  name: string;
  /** going / maybe (RSVP), member (in the room's audience), registered (site event), walk_in. */
  invitedAs: "going" | "maybe" | "member" | "registered" | "walk_in";
  invited: boolean;
  /** null when the session's attendance is not tracked. */
  attended: boolean | null;
  minutesAttended: number;
}

/**
 * Who a session was for, and who came.
 *
 * `audience` "registered" is the people who said they were coming — the RSVPs
 * of a meetup, the registrants of a webinar. "members" adds every member of the
 * community (kept to the event's access group when it has one), for a room
 * where nobody RSVPs and everybody is welcome. Somebody who came without being
 * on either list is a walk-in: listed, attended, never emailed a "we missed you".
 */
export async function sessionPeople(
  session: LiveSession,
  audience: "registered" | "members"
): Promise<SessionPerson[]> {
  return session.source === "community"
    ? communityPeople(session, audience)
    : siteEventPeople(session);
}

async function communityPeople(
  session: LiveSession,
  audience: "registered" | "members"
): Promise<SessionPerson[]> {
  const windowStart = new Date(session.startsAt.getTime() - ATTENDANCE_EARLY_MINUTES * 60_000);

  const [invited, visits] = await Promise.all([
    pool.query<{
      member_id: number;
      contact_id: number | null;
      email: string;
      name: string;
      invited_as: "going" | "maybe" | "member";
      rsvp_attended: boolean;
    }>(
      `WITH rsvps AS (
         SELECT r.member_id, r.status AS invited_as, r.attended AS rsvp_attended
           FROM community_event_rsvps r
          WHERE r.event_id = $1 AND r.status IN ('going', 'maybe')
            AND r.created_at <= $3
       ),
       room AS (
         SELECT cm.member_id, 'member'::text AS invited_as, false AS rsvp_attended
           FROM community_memberships cm
          WHERE $5::bool
            AND cm.community_id = $2
            AND cm.banned_at IS NULL
            -- The hosts are the room's moderators; nobody emails Yvette "we
            -- missed you" about her own call.
            AND cm.role <> 'moderator'
            AND cm.joined_at <= $3
            AND ($4::int IS NULL OR EXISTS (
                  SELECT 1 FROM community_access_group_members g
                   WHERE g.group_id = $4 AND g.member_id = cm.member_id))
            AND cm.member_id NOT IN (SELECT member_id FROM rsvps)
       ),
       everyone AS (SELECT * FROM rsvps UNION ALL SELECT * FROM room)
       SELECT e.member_id, m.contact_id, m.email::text AS email,
              COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), m.name, '') AS name,
              e.invited_as, e.rsvp_attended
         FROM everyone e
         JOIN members m ON m.id = e.member_id
        WHERE m.status = 'active'`,
      [
        session.eventId,
        session.communityId,
        session.endsAt,
        session.accessGroupId,
        audience === "members",
      ]
    ),
    session.attendanceTracked
      ? pool.query<{ member_id: number; minutes: number }>(
          `SELECT v.member_id,
                  COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(COALESCE(v.left_at, v.joined_at), $3) - GREATEST(v.joined_at, $2)
                  )))) / 60, 0)::int AS minutes
             FROM community_live_visits v
            WHERE v.community_id = $1
              AND v.joined_at <= $3
              AND COALESCE(v.left_at, v.joined_at) >= $2
            GROUP BY v.member_id`,
          [session.communityId, windowStart, session.endsAt]
        )
      : Promise.resolve({ rows: [] as { member_id: number; minutes: number }[] }),
  ]);

  const minutesBy = new Map(visits.rows.map((row) => [row.member_id, row.minutes]));
  const people: SessionPerson[] = invited.rows.map((row) => {
    // A ticked RSVP is the host saying "she was there"; for a single session
    // it counts. A series has one RSVP for every month, so it cannot.
    const ticked = row.rsvp_attended && !session.recurring;
    const inRoom = minutesBy.has(row.member_id);
    return {
      memberId: row.member_id,
      contactId: row.contact_id,
      email: row.email,
      name: row.name,
      invitedAs: row.invited_as,
      invited: true,
      attended: session.attendanceTracked ? inRoom || ticked : ticked ? true : null,
      minutesAttended: minutesBy.get(row.member_id) ?? 0,
    };
  });

  const listed = new Set(people.map((person) => person.memberId));
  const walkInIds = [...minutesBy.keys()].filter((id) => !listed.has(id));
  if (walkInIds.length > 0) {
    const walkIns = await pool.query<{ id: number; contact_id: number | null; email: string; name: string }>(
      `SELECT id, contact_id, email::text AS email,
              COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), name, '') AS name
         FROM members WHERE id = ANY($1::int[])`,
      [walkInIds]
    );
    for (const row of walkIns.rows) {
      people.push({
        memberId: row.id,
        contactId: row.contact_id,
        email: row.email,
        name: row.name,
        invitedAs: "walk_in",
        invited: false,
        attended: true,
        minutesAttended: minutesBy.get(row.id) ?? 0,
      });
    }
  }

  return people.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

async function siteEventPeople(session: LiveSession): Promise<SessionPerson[]> {
  const rows = await pool.query<{
    member_id: number | null;
    contact_id: number | null;
    email: string;
    name: string;
    attended: boolean;
    watch_seconds: number;
  }>(
    `SELECT member_id, contact_id, email::text AS email, name, attended, watch_seconds
       FROM event_registrations
      -- To the millisecond: the session's start came back through JavaScript,
      -- which keeps no microseconds.
      WHERE event_id = $1
        AND date_trunc('milliseconds', session_at) = date_trunc('milliseconds', $2::timestamptz)
      ORDER BY name, email`,
    [session.eventId, session.startsAt]
  );
  return rows.rows.map((row) => ({
    memberId: row.member_id,
    contactId: row.contact_id,
    email: row.email,
    name: row.name,
    invitedAs: "registered" as const,
    invited: true,
    attended: row.attended,
    minutesAttended: Math.round((row.watch_seconds ?? 0) / 60),
  }));
}
