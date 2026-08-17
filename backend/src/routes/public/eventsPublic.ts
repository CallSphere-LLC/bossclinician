import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { leadsLimiter } from "../../middleware/rateLimit";
import { applyTags, recordActivity, upsertContact } from "../../services/contacts";
import {
  buildIcs,
  describeSession,
  isRoomOpen,
  replayExpiryFor,
  sessionTimeFor,
  signRegistration,
  verifyRegistration,
  type EventKind,
  type EventSchedule,
} from "../../services/events";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError, badRequest, forbidden, notFound } from "../../utils/httpError";

/**
 * Public events: the registration page, the room, and the calendar file.
 *
 * The room is the part worth being careful about. A registration is a link that
 * has to work in a browser that has never signed in, so it carries a signed
 * token rather than a session — and the token proves only which registration is
 * asking. Whether that registration may see anything is decided by the clock,
 * every time, in `isRoomOpen`.
 */

export const eventsPublicRouter = Router();

/** Faster than this and nobody read the page, let alone filled the form in. */
const MIN_FILL_MS = 2000;

/** How many upcoming evergreen sessions the page previews. */
const EVERGREEN_PREVIEW = 4;

interface EventRow {
  id: number;
  slug: string;
  title: string;
  description_md: string;
  cover_image: string;
  kind: EventKind;
  starts_at: Date | null;
  duration_minutes: number;
  timezone: string;
  evergreen_interval_minutes: number | null;
  room_url: string;
  replay_url: string;
  replay_expires_after_hours: number | null;
  registration_form_id: number | null;
  apply_tag_ids: number[];
}

const EVENT_COLUMNS = `id, slug::text AS slug, title, description_md, cover_image, kind,
  starts_at, duration_minutes, timezone, evergreen_interval_minutes,
  room_url, replay_url, replay_expires_after_hours, registration_form_id, apply_tag_ids`;

function scheduleOf(event: EventRow): EventSchedule {
  return {
    kind: event.kind,
    startsAt: event.starts_at,
    durationMinutes: event.duration_minutes,
    timezone: event.timezone,
    evergreenIntervalMinutes: event.evergreen_interval_minutes,
    replayExpiresAfterHours: event.replay_expires_after_hours,
  };
}

async function publishedEvent(slug: string): Promise<EventRow | null> {
  const res = await pool.query<EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE slug = $1 AND published`,
    [slug]
  );
  return res.rows[0] ?? null;
}

const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  timezone: z.string().trim().max(80).optional(),
  // The honeypot pair, same shape as the lead form's.
  company: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
});

/* -------------------------------------------------------------- the page */

eventsPublicRouter.get(
  "/events/:slug",
  asyncHandler(async (req, res) => {
    const event = await publishedEvent(req.params.slug);
    if (!event) throw notFound("Event not found");

    const now = new Date();
    const schedule = scheduleOf(event);

    // An evergreen page has no one start to show, so it shows the next few —
    // "the next session starts at 2:15" is the whole reason these convert.
    const upcoming: string[] = [];
    if (event.kind === "evergreen") {
      let cursor = now;
      for (let i = 0; i < EVERGREEN_PREVIEW; i += 1) {
        const next = sessionTimeFor(schedule, cursor);
        upcoming.push(next.toISOString());
        cursor = new Date(next.getTime() + 60_000);
      }
    }

    res.json({
      slug: event.slug,
      title: event.title,
      descriptionMd: event.description_md,
      coverImage: event.cover_image,
      kind: event.kind,
      startsAt: event.starts_at?.toISOString() ?? null,
      durationMinutes: event.duration_minutes,
      timezone: event.timezone,
      registrationFormId: event.registration_form_id,
      upcomingSessions: upcoming,
      // Everything the copy needs to say when the doors open, without the room
      // address itself — that is only ever handed to a registration.
      hasReplay: event.replay_url !== "",
    });
  })
);

/* ------------------------------------------------------------ registering */

eventsPublicRouter.post(
  "/events/:slug/register",
  leadsLimiter,
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid registration", parsed.error.flatten());
    const input = parsed.data;

    const event = await publishedEvent(req.params.slug);
    if (!event) throw notFound("Event not found");

    // A filled honeypot, or a form returned faster than anyone can read it, is
    // a script. It gets the same shape of answer a person gets, minus a
    // registration nobody made: an error is only feedback a bot can tune
    // against.
    if (input.company?.trim() || (input.elapsedMs !== undefined && input.elapsedMs < MIN_FILL_MS)) {
      const pretend = sessionTimeFor(scheduleOf(event), new Date());
      res.status(201).json({
        sessionAt: pretend.toISOString(),
        sessionLabel: describeSession(pretend, event.timezone),
        timezone: event.timezone,
        token: "",
        icsUrl: "",
      });
      return;
    }

    const now = new Date();
    const schedule = scheduleOf(event);
    const sessionAt = sessionTimeFor(schedule, now);
    const replayExpiresAt = replayExpiryFor(schedule, sessionAt);
    const email = input.email.trim().toLowerCase();

    const registration = await pool.query<{ id: string; session_at: Date }>(
      `INSERT INTO event_registrations
         (event_id, email, name, timezone, session_at, replay_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id, email) DO UPDATE
          SET name     = COALESCE(NULLIF(EXCLUDED.name, ''), event_registrations.name),
              timezone = COALESCE(NULLIF(EXCLUDED.timezone, ''), event_registrations.timezone),
              -- Somebody registering twice keeps the session they were already
              -- promised, unless it has been and gone — then they get the next
              -- one, which is what registering again plainly means.
              session_at = CASE
                             WHEN event_registrations.session_at > now()
                               THEN event_registrations.session_at
                             ELSE EXCLUDED.session_at
                           END,
              replay_expires_at = CASE
                             WHEN event_registrations.session_at > now()
                               THEN event_registrations.replay_expires_at
                             ELSE EXCLUDED.replay_expires_at
                           END,
              -- Reminders already sent belong to the old session. Leaving them
              -- stamped means the new one goes out with no warning at all.
              reminder_24h_sent_at = CASE
                             WHEN event_registrations.session_at > now()
                               THEN event_registrations.reminder_24h_sent_at
                             ELSE NULL
                           END,
              reminder_1h_sent_at = CASE
                             WHEN event_registrations.session_at > now()
                               THEN event_registrations.reminder_1h_sent_at
                             ELSE NULL
                           END,
              reminder_start_sent_at = CASE
                             WHEN event_registrations.session_at > now()
                               THEN event_registrations.reminder_start_sent_at
                             ELSE NULL
                           END
       RETURNING id, session_at`,
      [
        event.id,
        email,
        input.name ?? "",
        input.timezone ?? "",
        sessionAt,
        replayExpiresAt,
      ]
    );

    const row = registration.rows[0];
    const registrationId = Number(row.id);
    const confirmedAt = row.session_at;

    const contactId = await upsertContact({
      email,
      name: input.name ?? "",
      timezone: input.timezone ?? "",
      source: `event: ${event.slug}`,
      consentSource: `event: ${event.slug}`,
      consentIp: req.ip ?? "",
    });

    await pool.query(
      `UPDATE event_registrations SET contact_id = $2 WHERE id = $1 AND contact_id IS NULL`,
      [registrationId, contactId]
    );

    await recordActivity({
      contactId,
      kind: "event.registered",
      title: `Registered for ${event.title}`,
      body: describeSession(confirmedAt, event.timezone),
      subjectType: "event",
      subjectId: event.id,
    });

    if (event.apply_tag_ids.length > 0) {
      const tags = await pool.query<{ slug: string }>(
        `SELECT slug::text AS slug FROM tags WHERE id = ANY($1::int[])`,
        [event.apply_tag_ids]
      );
      await applyTags(
        contactId,
        tags.rows.map((tag) => tag.slug),
        `event:${event.slug}`
      );
    }

    const token = signRegistration(registrationId);
    res.status(201).json({
      token,
      sessionAt: confirmedAt.toISOString(),
      sessionLabel: describeSession(confirmedAt, event.timezone),
      timezone: event.timezone,
      durationMinutes: event.duration_minutes,
      roomUrl: `${env.publicSiteUrl}/events/${event.slug}/room?ticket=${token}`,
      icsUrl: `${env.publicSiteUrl}/api/events/registrations/${token}/ics`,
    });
  })
);

/* ------------------------------------------------------------------- room */

interface RegistrationRow {
  id: string;
  event_id: number;
  contact_id: number | null;
  session_at: Date;
  replay_expires_at: Date | null;
  attended: boolean;
  email: string;
  name: string;
}

async function registrationFor(token: string): Promise<RegistrationRow | null> {
  const id = verifyRegistration(token);
  if (id === null) return null;
  const res = await pool.query<RegistrationRow>(
    `SELECT id, event_id, contact_id, session_at, replay_expires_at, attended,
            email::text AS email, name
       FROM event_registrations WHERE id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

eventsPublicRouter.get(
  "/events/:slug/room",
  asyncHandler(async (req, res) => {
    const token = typeof req.query.ticket === "string" ? req.query.ticket : "";
    const registration = await registrationFor(token);
    if (!registration) throw forbidden("Register for this event to join the room");

    const event = await publishedEvent(req.params.slug);
    if (!event || event.id !== registration.event_id) throw notFound("Event not found");

    const now = new Date();
    const access = isRoomOpen(
      {
        sessionAt: registration.session_at,
        durationMinutes: event.duration_minutes,
        replayExpiresAt: registration.replay_expires_at,
        hasReplay: event.replay_url !== "",
      },
      now
    );

    if (!access.open) {
      // The three refusals are not interchangeable, so the reason and its date
      // travel with the 403: "come back at 2:05" and "the replay closed on the
      // 17th" are the difference between a page somebody trusts and one they
      // email about.
      throw new HttpError(403, "This room is not open", {
        state: access.state,
        opensAt: access.opensAt?.toISOString() ?? null,
        closedAt: access.state === "expired" ? access.closesAt?.toISOString() ?? null : null,
        sessionAt: registration.session_at.toISOString(),
        sessionLabel: describeSession(registration.session_at, event.timezone),
        // The zone travels with the refusal so the door time and the session
        // time are read in the same one. Two clocks side by side in different
        // zones is how somebody arrives three hours late.
        timezone: event.timezone,
      });
    }

    const url = access.state === "replay" ? event.replay_url : event.room_url || event.replay_url;
    // An event published without a link is a configuration mistake, and the
    // registrant is standing at the door while it is made. Saying so is better
    // than rendering an empty frame they will assume is their own connection —
    // and it is checked before attendance is stamped, because somebody who was
    // shown a door that did not open did not attend anything.
    if (!url) {
      throw new HttpError(503, "This room does not have a link on it yet", {
        state: access.state,
        sessionAt: registration.session_at.toISOString(),
        sessionLabel: describeSession(registration.session_at, event.timezone),
        timezone: event.timezone,
      });
    }

    // Turning up is what "attended" means, and it is what the post-event split
    // reads. Stamped once; a second visit does not move the first arrival.
    if (!registration.attended) {
      await pool.query(
        `UPDATE event_registrations SET attended = true, attended_at = now()
          WHERE id = $1 AND attended = false`,
        [registration.id]
      );
      if (registration.contact_id !== null) {
        await recordActivity({
          contactId: registration.contact_id,
          kind: "event.attended",
          title: `Joined ${event.title}`,
          subjectType: "event",
          subjectId: event.id,
        });
      }
    }

    res.json({
      state: access.state,
      title: event.title,
      url,
      sessionAt: registration.session_at.toISOString(),
      sessionLabel: describeSession(registration.session_at, event.timezone),
      timezone: event.timezone,
      durationMinutes: event.duration_minutes,
      closesAt: access.closesAt?.toISOString() ?? null,
    });
  })
);

/* --------------------------------------------------------------- calendar */

eventsPublicRouter.get(
  "/events/registrations/:token/ics",
  asyncHandler(async (req, res) => {
    const registration = await registrationFor(req.params.token);
    if (!registration) throw notFound("Registration not found");

    const eventRes = await pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`,
      [registration.event_id]
    );
    const event = eventRes.rows[0];
    if (!event) throw notFound("Event not found");

    const ics = buildIcs({
      uid: `event-${event.id}-registration-${registration.id}@bossclinician`,
      title: event.title,
      description: event.description_md,
      url: `${env.publicSiteUrl}/events/${event.slug}/room?ticket=${req.params.token}`,
      startsAt: registration.session_at,
      durationMinutes: event.duration_minutes,
      generatedAt: new Date(),
    });

    res
      .type("text/calendar; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${event.slug}.ics"`)
      .send(ics);
  })
);
