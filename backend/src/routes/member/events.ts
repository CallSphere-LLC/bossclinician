import { Router } from "express";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { type AuthedMember } from "../../middleware/memberAuth";
import {
  DOORS_OPEN_MINUTES,
  describeRecurrence,
  describeSession,
  isRoomOpen,
  occurrenceAt,
  occurrencesFor,
  signRegistration,
  type RecurrenceRule,
} from "../../services/events";
import {
  remindersForRegistrations,
  type RegistrationReminder,
} from "../../services/eventReminders";

/**
 * `/api/member/events` — the events this member signed up for.
 *
 * The public side already had everything for one registration at a time: a
 * confirmation carrying a signed token, a room the token opens, a calendar
 * file, a replay. What it had no answer for was "what am I signed up for" —
 * that lived only in the confirmation email, so a member who lost the email
 * lost the room link with it.
 *
 * Registrations are matched on member_id OR the member's email address, because
 * most of them are made before anybody signs in: someone registers as a
 * visitor, buys later, and their history should not be split by the moment they
 * happened to create a password.
 *
 * The page above this promises "the room link when it opens and the replay
 * while it lasts". Two things were needed for that to be true rather than
 * aspirational. The first is `isRoomOpen`, the same function the room itself
 * uses: this route had its own copy of the rule with the doors opening fifteen
 * minutes early against the room's ten, so a member who arrived twelve minutes
 * out was handed a link and then refused by it — the worst possible version of
 * a promise about a link. The second is saying *when* the link appears, because
 * "nothing here yet" and "the link shows up at 5:50" are different experiences
 * of the same empty space.
 */
export const memberEventsRouter = Router();

interface RegistrationRow {
  registration_id: string;
  event_id: number;
  slug: string;
  title: string;
  cover_image: string;
  kind: string;
  session_at: Date;
  duration_minutes: number;
  timezone: string;
  room_url: string;
  replay_url: string;
  replay_expires_at: Date | null;
  attended: boolean;
  registered_at: Date;
  event_timezone: string;
  starts_at: Date | null;
  replay_expires_after_hours: number | null;
  recurrence_freq: RecurrenceRule["freq"] | null;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_count: number | null;
  location_type: "online" | "in_person";
  location_address: string;
}

/** How many sessions of a series the card lists. */
const SERIES_PREVIEW = 12;

function ruleOf(row: RegistrationRow): RecurrenceRule | null {
  if (row.kind !== "live" || !row.recurrence_freq || !row.starts_at) return null;
  return {
    freq: row.recurrence_freq,
    interval: row.recurrence_interval,
    until: row.recurrence_until,
    count: row.recurrence_count,
  };
}

/**
 * GET /api/member/events
 *
 * Upcoming first, then past. Both in one response: a member wants to see what
 * is coming and what they can still re-watch, and two requests for one screen
 * is two spinners for one answer.
 */
memberEventsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const member = req.member as AuthedMember;

    const rows = await pool.query<RegistrationRow>(
      `SELECT r.id AS registration_id, r.event_id, e.slug::text AS slug, e.title,
              e.cover_image, e.kind, r.session_at, e.duration_minutes,
              COALESCE(NULLIF(r.timezone, ''), e.timezone) AS timezone,
              e.room_url, e.replay_url, r.replay_expires_at,
              r.attended, r.created_at AS registered_at,
              e.timezone AS event_timezone, e.starts_at, e.replay_expires_after_hours,
              e.recurrence_freq, e.recurrence_interval,
              e.recurrence_until::text AS recurrence_until, e.recurrence_count,
              e.location_type, e.location_address
         FROM event_registrations r
         JOIN events e ON e.id = r.event_id
        WHERE (r.member_id = $1 OR lower(r.email) = lower($2))
          AND e.published = true
        ORDER BY r.session_at DESC
        LIMIT 200`,
      [member.id, member.email]
    );

    // What each registration is still due, in one query rather than one per
    // row. A member with twenty bookings is otherwise twenty round trips for a
    // line of text.
    const reminders = await remindersForRegistrations(
      rows.rows.map((row) => Number(row.registration_id))
    );

    const now = new Date();

    const shaped = rows.rows.map((row) => {
      const registrationId = Number(row.registration_id);
      const token = signRegistration(registrationId);
      const length = row.duration_minutes * 60_000;

      // A series is generated on the event's own clock (so 6:00 PM Eastern stays
      // 6:00 PM through a DST change), then shown in the member's. The card is
      // about the next session that has not finished — the same one the room
      // opens for — and lists the rest of theirs beneath it.
      const rule = ruleOf(row);
      const sessions =
        rule && row.starts_at ? occurrencesFor(row.starts_at, row.event_timezone, rule) : [];
      const startsAt = rule
        ? occurrenceAt(sessions, row.duration_minutes, now, row.session_at) ?? row.session_at
        : row.session_at;
      const endsAt = new Date(startsAt.getTime() + length);
      const replayExpiresAt =
        rule && row.replay_expires_after_hours !== null
          ? new Date(endsAt.getTime() + row.replay_expires_after_hours * 3_600_000)
          : rule
            ? null
            : row.replay_expires_at;
      const seriesAhead = sessions
        .filter((at) => at.getTime() >= row.session_at.getTime())
        .filter((at) => at.getTime() + length >= now.getTime())
        .slice(0, SERIES_PREVIEW)
        .map((at) => ({ startsAt: at.toISOString(), label: describeSession(at, row.timezone) }));
      const inPerson = row.location_type === "in_person";

      // The same decision the room makes, from the same function. Anything else
      // and this page and the door it points at disagree about the clock.
      const access = isRoomOpen(
        {
          sessionAt: startsAt,
          durationMinutes: row.duration_minutes,
          replayExpiresAt,
          hasReplay: row.replay_url !== "",
        },
        now
      );

      const roomLink = `${env.publicSiteUrl}/events/${row.slug}/room?ticket=${token}`;
      const doorsAt = new Date(startsAt.getTime() - DOORS_OPEN_MINUTES * 60_000);

      // Only what is still to come. A reminder already sent is a fact about the
      // past, and this line of the card is answering "will anyone tell me?".
      const upcomingReminders: RegistrationReminder[] = (
        reminders.get(registrationId) ?? []
      ).filter((reminder) => reminder.status === "queued");

      return {
        registrationId,
        eventId: row.event_id,
        slug: row.slug,
        title: row.title,
        coverImage: row.cover_image,
        kind: row.kind,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        durationMinutes: row.duration_minutes,
        timezone: row.timezone,
        // Rendered in the zone the registration was taken in, which is the one
        // the member was told at signup.
        sessionLabel: describeSession(startsAt, row.timezone),
        upcoming: endsAt.getTime() >= now.getTime(),
        live: access.open && access.state === "live",
        attended: row.attended,
        /**
         * "early", "live", "replay", "ended" or "expired" — the room's own
         * word for where this registration stands, so the page can say the
         * right sentence rather than inferring one from an empty link.
         */
        state: access.state,
        // The room link is only handed out while it is usable; a dead link is
        // worse than none, because a member will sit on it waiting. An
        // in-person event with no online link has no room at all.
        roomUrl:
          access.open && access.state === "live" && (!inPerson || row.room_url !== "")
            ? roomLink
            : "",
        /** When the link appears here. The other half of not handing it over early. */
        roomOpensAt: doorsAt.toISOString(),
        roomOpensLabel: describeSession(doorsAt, row.timezone),
        icsUrl: `${env.publicSiteUrl}/api/events/registrations/${token}/ics`,
        replayUrl: access.open && access.state === "replay" ? row.replay_url : "",
        /** Whether a recording exists at all, which is not the same as being able to watch it now. */
        hasReplay: row.replay_url !== "",
        replayExpiresAt: replayExpiresAt ? replayExpiresAt.toISOString() : null,
        /** The emails still to come, so the promise of a reminder is checkable. */
        reminders: upcomingReminders,
        registeredAt: row.registered_at.toISOString(),
        /** "Every week, 6 sessions", or empty for a single session. */
        recurrenceLabel: describeRecurrence(rule),
        /** Their sessions still to come in a series, in their own zone. Empty for a single session. */
        occurrences: seriesAhead,
        locationType: row.location_type,
        /** The address, for an in-person event. */
        locationAddress: inPerson ? row.location_address.trim() : "",
      };
    });

    // Sorted on the session each card is about, which for a series is not the
    // one stored on the registration.
    const byStart = (a: { startsAt: string }, b: { startsAt: string }) =>
      a.startsAt.localeCompare(b.startsAt);
    res.json({
      upcoming: shaped.filter((e) => e.upcoming).sort(byStart),
      past: shaped.filter((e) => !e.upcoming).sort((a, b) => byStart(b, a)),
    });
  })
);
