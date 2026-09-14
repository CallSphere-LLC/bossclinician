import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { leadsLimiter } from "../../middleware/rateLimit";
import { applyTags, recordActivity, upsertContactWithStatus } from "../../services/contacts";
import {
  buildIcs,
  describeRecurrence,
  describeSession,
  isRoomOpen,
  occurrenceAt,
  occurrencesFor,
  replayExpiryFor,
  sessionTimeFor,
  signRegistration,
  verifyRegistration,
  type EventKind,
  type EventSchedule,
  type RecurrenceRule,
} from "../../services/events";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError, badRequest, forbidden, notFound } from "../../utils/httpError";
import { publishDomainEvent } from "../../services/domainEvents";
import { reminderPromise, requestReminderTick } from "../../services/eventReminders";

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
  recurrence_freq: RecurrenceRule["freq"] | null;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_count: number | null;
  location_type: "online" | "in_person";
  location_address: string;
}

// `recurrence_until` is a DATE, read as text: node-postgres would otherwise turn
// it into midnight in the server's zone, which is a different calendar day for
// half the world.
const EVENT_COLUMNS = `id, slug::text AS slug, title, description_md, cover_image, kind,
  starts_at, duration_minutes, timezone, evergreen_interval_minutes,
  room_url, replay_url, replay_expires_after_hours, registration_form_id, apply_tag_ids,
  recurrence_freq, recurrence_interval, recurrence_until::text AS recurrence_until,
  recurrence_count, location_type, location_address`;

/** How many upcoming sessions of a series the page and the confirmation list. */
const SERIES_PREVIEW = 24;

/** The repeat rule on an event, or null for a single session. */
function ruleOf(event: EventRow): RecurrenceRule | null {
  if (event.kind !== "live" || !event.recurrence_freq || !event.starts_at) return null;
  return {
    freq: event.recurrence_freq,
    interval: event.recurrence_interval,
    until: event.recurrence_until,
    count: event.recurrence_count,
  };
}

/** Every session of a live event: one, or the whole series. Empty for the other kinds. */
function sessionsOf(event: EventRow): Date[] {
  if (event.kind !== "live" || !event.starts_at) return [];
  return occurrencesFor(event.starts_at, event.timezone, ruleOf(event));
}

/** The sessions of a series from `from` on that have not finished, as ISO strings. */
function sessionsAhead(event: EventRow, now: Date, from?: Date): string[] {
  if (!ruleOf(event)) return [];
  const length = event.duration_minutes * 60_000;
  return sessionsOf(event)
    .filter((at) => at.getTime() + length >= now.getTime())
    .filter((at) => !from || at.getTime() >= from.getTime())
    .slice(0, SERIES_PREVIEW)
    .map((at) => at.toISOString());
}

/** The address, and only for an in-person event. */
function addressOf(event: EventRow): string {
  return event.location_type === "in_person" ? event.location_address.trim() : "";
}

/**
 * The session a registration is about right now.
 *
 * A single session is the one they were given. A series moves on to the next
 * session as each one finishes — never back before the registrant's own first
 * — using the same `occurrenceAt` the member page and the reminders use, so the
 * room, the page and the email all mean the same Tuesday.
 */
function currentSessionFor(event: EventRow, registeredSession: Date, now: Date): Date {
  if (!ruleOf(event)) return registeredSession;
  return (
    occurrenceAt(sessionsOf(event), event.duration_minutes, now, registeredSession) ??
    registeredSession
  );
}

function scheduleOf(event: EventRow): EventSchedule {
  return {
    kind: event.kind,
    startsAt: event.starts_at,
    durationMinutes: event.duration_minutes,
    timezone: event.timezone,
    evergreenIntervalMinutes: event.evergreen_interval_minutes,
    replayExpiresAfterHours: event.replay_expires_after_hours,
    recurrence: ruleOf(event),
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

    const reminderSchedule = await reminderPromise(event.id);

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
      // The reminders this event really sends, so the page can promise those
      // and nothing else. Empty means the page says nothing about reminders,
      // which is the honest answer when none are configured.
      reminderSchedule,
      // A series says what it is and lists what is still to come, so a visitor
      // knows they are signing up for "every Tuesday, six of them" rather than
      // discovering it in the calendar file afterwards.
      recurrenceLabel: describeRecurrence(ruleOf(event)),
      occurrences: sessionsAhead(event, now),
      locationType: event.location_type,
      locationAddress: addressOf(event),
      // Whether there is an online link at all. An in-person event usually has
      // none, and the confirmation should not offer a room that is not there.
      hasJoinLink: event.room_url !== "",
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
        reminderSchedule: [],
        recurrenceLabel: "",
        occurrences: [],
        locationType: event.location_type,
        locationAddress: "",
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
                           END
              -- The three reminder_*_sent_at columns are no longer read by
              -- anything, and are deliberately not touched here. Reminder state
              -- lives in event_reminder_sends, keyed by (reminder,
              -- registration, session_at) -- so a registrant who books a later
              -- session gets a fresh set of reminders because the key changed,
              -- rather than because three timestamps were blanked. Same intent,
              -- expressed somewhere that can also record what happened to each.
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

    const contact = await upsertContactWithStatus({
      email,
      name: input.name ?? "",
      timezone: input.timezone ?? "",
      source: `event: ${event.slug}`,
      consentSource: `event: ${event.slug}`,
      consentIp: req.ip ?? "",
    });
    const contactId = contact.id;

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

    if (contact.created) {
      await publishDomainEvent("contact_created", {
        eventKey: `contact-created:${contactId}`,
        contactId,
        email,
        name: input.name ?? "",
        source: `event:${event.slug}`,
      });
    }

    await publishDomainEvent("event_registered", {
      eventKey: `event-registered:${registrationId}:${confirmedAt.toISOString()}`,
      contactId,
      email,
      name: input.name ?? "",
      subjectId: event.id,
      source: `event:${event.slug}`,
      facts: { registrationId, sessionAt: confirmedAt.toISOString(), eventTitle: event.title },
    });

    // Plans this registrant's reminders and sends the confirmation, on the
    // queue rather than inline: a signup must not wait on SMTP to answer, and a
    // provider timing out must not turn a successful registration into a 500
    // the visitor retries. The five-minute schedule is the backstop, and the
    // tick is idempotent, so doing both sends one email rather than two.
    await requestReminderTick(registrationId);

    const token = signRegistration(registrationId);
    res.status(201).json({
      token,
      sessionAt: confirmedAt.toISOString(),
      sessionLabel: describeSession(confirmedAt, event.timezone),
      timezone: event.timezone,
      durationMinutes: event.duration_minutes,
      roomUrl: `${env.publicSiteUrl}/events/${event.slug}/room?ticket=${token}`,
      icsUrl: `${env.publicSiteUrl}/api/events/registrations/${token}/ics`,
      // What the confirmation screen may truthfully say happens next.
      reminderSchedule: await reminderPromise(event.id),
      // A place in a series covers every session from this one on.
      recurrenceLabel: describeRecurrence(ruleOf(event)),
      occurrences: sessionsAhead(event, now, confirmedAt),
      locationType: event.location_type,
      locationAddress: addressOf(event),
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
    // For a series this is this week's session, not the first one they booked.
    const sessionAt = currentSessionFor(event, registration.session_at, now);
    const access = isRoomOpen(
      {
        sessionAt,
        durationMinutes: event.duration_minutes,
        // A series' replay window runs from the end of each session in turn.
        replayExpiresAt: ruleOf(event)
          ? replayExpiryFor(scheduleOf(event), sessionAt)
          : registration.replay_expires_at,
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
        sessionAt: sessionAt.toISOString(),
        sessionLabel: describeSession(sessionAt, event.timezone),
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
        sessionAt: sessionAt.toISOString(),
        sessionLabel: describeSession(sessionAt, event.timezone),
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
        await publishDomainEvent("event_attended", {
          eventKey: `event-attended:${registration.id}:${sessionAt.toISOString()}`,
          contactId: registration.contact_id,
          email: registration.email,
          name: registration.name,
          subjectId: event.id,
          source: `event:${event.slug}`,
          facts: { registrationId: Number(registration.id), eventTitle: event.title },
        });
      }
    }

    res.json({
      state: access.state,
      title: event.title,
      url,
      sessionAt: sessionAt.toISOString(),
      sessionLabel: describeSession(sessionAt, event.timezone),
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

    // A series goes into the calendar as every session from the registrant's
    // own first one on. If the series has since been moved earlier than that,
    // the whole series is better than an empty file.
    let occurrences: Date[] | undefined;
    if (ruleOf(event)) {
      const all = sessionsOf(event);
      const theirs = all.filter((at) => at.getTime() >= registration.session_at.getTime());
      occurrences = theirs.length > 0 ? theirs : all;
    }

    const ics = buildIcs({
      uid: `event-${event.id}-registration-${registration.id}@bossclinician`,
      title: event.title,
      description: event.description_md,
      url: `${env.publicSiteUrl}/events/${event.slug}/room?ticket=${req.params.token}`,
      startsAt: registration.session_at,
      occurrences,
      durationMinutes: event.duration_minutes,
      location: addressOf(event),
      generatedAt: new Date(),
    });

    res
      .type("text/calendar; charset=utf-8")
      .set("Content-Disposition", `attachment; filename="${event.slug}.ics"`)
      .send(ics);
  })
);
