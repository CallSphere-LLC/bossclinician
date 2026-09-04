import { Router } from "express";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { type AuthedMember } from "../../middleware/memberAuth";
import { describeSession, signRegistration } from "../../services/events";

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
 */
export const memberEventsRouter = Router();

interface RegistrationRow {
  registration_id: number;
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
              r.attended, r.created_at AS registered_at
         FROM event_registrations r
         JOIN events e ON e.id = r.event_id
        WHERE (r.member_id = $1 OR lower(r.email) = lower($2))
          AND e.published = true
        ORDER BY r.session_at DESC
        LIMIT 200`,
      [member.id, member.email]
    );

    const now = Date.now();

    const shaped = rows.rows.map((row) => {
      const startsAt = row.session_at;
      const endsAt = new Date(startsAt.getTime() + row.duration_minutes * 60_000);
      const token = signRegistration(row.registration_id);

      // The room opens a little early, because arriving to a locked door two
      // minutes before a webinar is how people miss the start.
      const opensAt = new Date(startsAt.getTime() - 15 * 60_000);
      const live = now >= opensAt.getTime() && now <= endsAt.getTime();

      const replayLive =
        row.replay_url !== "" &&
        now > endsAt.getTime() &&
        (row.replay_expires_at === null || row.replay_expires_at.getTime() > now);

      return {
        registrationId: row.registration_id,
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
        upcoming: endsAt.getTime() >= now,
        live,
        attended: row.attended,
        // The room link is only handed out while it is usable; a dead link is
        // worse than none, because a member will sit on it waiting.
        roomUrl: live ? `${env.publicSiteUrl}/events/${row.slug}/room?ticket=${token}` : "",
        icsUrl: `${env.publicSiteUrl}/api/events/registrations/${token}/ics`,
        replayUrl: replayLive ? row.replay_url : "",
        replayExpiresAt: row.replay_expires_at ? row.replay_expires_at.toISOString() : null,
        registeredAt: row.registered_at.toISOString(),
      };
    });

    res.json({
      upcoming: shaped.filter((e) => e.upcoming).reverse(),
      past: shaped.filter((e) => !e.upcoming),
    });
  })
);
