import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { PRIORITY, enqueue } from "../../jobs/queue";
import {
  describeRecurrence,
  describeSession,
  occurrencesFor,
  recurrenceProblem,
  signRegistration,
  type RecurrenceFreq,
  type RecurrenceRule,
} from "../../services/events";
import {
  createReminder,
  deleteReminder,
  listReminders,
  reminderStats,
  retryFailedReminders,
  seedDefaultReminders,
  updateReminder,
} from "../../services/eventReminders";
import { asyncHandler } from "../../utils/asyncHandler";
import { publishDomainEvent } from "../../services/domainEvents";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { badRequest, notFound } from "../../utils/httpError";
import { buildUpdate } from "../../utils/sqlUpdate";

/**
 * Event administration — mounted at /api/admin/events.
 *
 * The shape a live event, an evergreen one and a replay each need is different,
 * and the table enforces that with a CHECK constraint. A constraint violation
 * reaches the browser as a 500 with a Postgres sentence in it, so the same rule
 * is stated here first, in words about the event rather than about the row.
 */

export const adminEventsRouter = Router();

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

async function freeSlug(base: string): Promise<string> {
  const wanted = base || "event";
  const taken = await pool.query<{ slug: string }>(
    `SELECT slug::text AS slug FROM events WHERE slug = $1 OR slug LIKE $2`,
    [wanted, `${wanted}-%`]
  );
  const used = new Set(taken.rows.map((row) => row.slug));
  if (!used.has(wanted)) return wanted;

  let suffix = 2;
  while (used.has(`${wanted}-${suffix}`)) suffix += 1;
  return `${wanted}-${suffix}`;
}

export const eventSchema = z.object({
  title: z.string().trim().min(1, "Give this event a name").max(200),
  descriptionMd: z.string().max(50_000).optional(),
  coverImage: z.string().max(500).optional(),
  kind: z.enum(["live", "evergreen", "replay"]).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  timezone: z.string().trim().max(80).optional(),
  evergreenIntervalMinutes: z.number().int().min(5).max(10_080).nullable().optional(),
  roomUrl: z.string().max(1000).optional(),
  replayUrl: z.string().max(1000).optional(),
  replayExpiresAfterHours: z.number().int().min(1).max(8760).nullable().optional(),
  registrationFormId: z.number().int().positive().nullable().optional(),
  applyTagIds: z.array(z.number().int().positive()).max(50).optional(),
  attendedTagId: z.number().int().positive().nullable().optional(),
  noShowTagId: z.number().int().positive().nullable().optional(),
  published: z.boolean().optional(),
  // The repeat rule. Numbers are only checked for being whole here; the ranges
  // are explained in words by `recurrenceProblem`, not as a schema error.
  recurrenceFreq: z.enum(["daily", "weekly", "monthly"]).nullable().optional(),
  recurrenceInterval: z.number().int().optional(),
  recurrenceUntil: z.string().trim().max(10).nullable().optional(),
  recurrenceCount: z.number().int().nullable().optional(),
  locationType: z.enum(["online", "in_person"]).optional(),
  locationAddress: z.string().max(1000).optional(),
});

type EventInput = z.infer<typeof eventSchema>;

/**
 * The repeat rule and the location as the row will be after this save, checked
 * in words. A 400 with a sentence beats the table's CHECK constraint arriving
 * as a 500.
 */
function seriesAndPlaceError(effective: {
  kind: string;
  startsAt: string | null;
  timezone: string;
  freq: RecurrenceFreq | null;
  interval: number;
  until: string | null;
  count: number | null;
  locationType: string;
  locationAddress: string;
}): string | null {
  if (effective.locationType === "in_person" && !effective.locationAddress.trim()) {
    return "An in-person event needs its address, so people know where to go.";
  }
  const rule: RecurrenceRule | null = effective.freq
    ? {
        freq: effective.freq,
        interval: effective.interval,
        until: effective.until || null,
        count: effective.count,
      }
    : null;
  return recurrenceProblem({
    kind: effective.kind,
    startsAt: effective.startsAt ? new Date(effective.startsAt) : null,
    timezone: effective.timezone,
    rule,
  });
}

/** The rule on a stored row, or null for a single session. */
function ruleOfRow(row: {
  kind: string;
  starts_at: Date | null;
  recurrence_freq: RecurrenceFreq | null;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_count: number | null;
}): RecurrenceRule | null {
  if (row.kind !== "live" || !row.recurrence_freq || !row.starts_at) return null;
  return {
    freq: row.recurrence_freq,
    interval: row.recurrence_interval,
    until: row.recurrence_until,
    count: row.recurrence_count,
  };
}

/**
 * The one rule each kind has, said in her words.
 *
 * A live event needs a date, an evergreen one needs a cadence, and a replay
 * needs neither because there is nothing to be late for.
 */
function shapeError(kind: string, input: Partial<EventInput>): string | null {
  if (kind === "live" && !input.startsAt) {
    return "A live event needs the date and time it happens.";
  }
  if (kind === "evergreen" && !input.evergreenIntervalMinutes) {
    return "An always-on event needs to know how often a session starts.";
  }
  return null;
}

/* ------------------------------------------------------------------ events */

adminEventsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT e.id, e.slug::text AS slug, e.title, e.kind, e.starts_at, e.duration_minutes,
              e.timezone, e.published, e.evergreen_interval_minutes, e.updated_at,
              e.recurrence_freq, e.recurrence_interval,
              e.recurrence_until::text AS recurrence_until, e.recurrence_count,
              e.location_type,
              (SELECT count(*)::int FROM event_registrations r WHERE r.event_id = e.id) AS registration_count,
              (SELECT count(*)::int FROM event_registrations r
                WHERE r.event_id = e.id AND r.attended)                                 AS attended_count,
              (SELECT count(*)::int FROM event_registrations r
                WHERE r.event_id = e.id AND r.session_at > now())                       AS upcoming_count
         FROM events e
        ORDER BY COALESCE(e.starts_at, e.created_at) DESC`
    );
    res.json(rowsToCamel(result.rows));
  })
);

adminEventsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = eventSchema.parse(req.body);
    const kind = input.kind ?? "live";
    const problem = shapeError(kind, input);
    if (problem) throw badRequest(problem);

    // Only a live event repeats; a rule sent with any other kind is dropped
    // rather than refused, because the editor hides the rule for those kinds.
    const freq = kind === "live" ? input.recurrenceFreq ?? null : null;
    const interval = freq ? input.recurrenceInterval ?? 1 : 1;
    const until = freq ? input.recurrenceUntil || null : null;
    const count = freq ? input.recurrenceCount ?? null : null;
    const locationType = input.locationType ?? "online";
    const locationAddress = input.locationAddress ?? "";
    const placeProblem = seriesAndPlaceError({
      kind,
      startsAt: input.startsAt ?? null,
      timezone: input.timezone ?? "America/New_York",
      freq,
      interval,
      until,
      count,
      locationType,
      locationAddress,
    });
    if (placeProblem) throw badRequest(placeProblem);

    const slug = await freeSlug(slugify(input.title));

    const result = await pool.query(
      `INSERT INTO events
         (slug, title, description_md, cover_image, kind, starts_at, duration_minutes, timezone,
          evergreen_interval_minutes, room_url, replay_url, replay_expires_after_hours,
          registration_form_id, apply_tag_ids, attended_tag_id, no_show_tag_id, published,
          recurrence_freq, recurrence_interval, recurrence_until, recurrence_count,
          location_type, location_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
               $18, $19, $20, $21, $22, $23)
       RETURNING *, slug::text AS slug, recurrence_until::text AS recurrence_until`,
      [
        slug,
        input.title,
        input.descriptionMd ?? "",
        input.coverImage ?? "",
        kind,
        input.startsAt ?? null,
        input.durationMinutes ?? 60,
        input.timezone ?? "America/New_York",
        input.evergreenIntervalMinutes ?? null,
        input.roomUrl ?? "",
        input.replayUrl ?? "",
        input.replayExpiresAfterHours ?? null,
        input.registrationFormId ?? null,
        input.applyTagIds ?? [],
        input.attendedTagId ?? null,
        input.noShowTagId ?? null,
        input.published ?? false,
        freq,
        interval,
        until,
        count,
        locationType,
        locationAddress,
      ]
    );
    // A new event starts with the reminder set the public copy promises —
    // the confirmation, the day before, the hour before, the start. Defaults,
    // not requirements: every one of them is visible in the editor and can be
    // switched off there.
    await seedDefaultReminders(result.rows[0].id);

    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

adminEventsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT e.*, e.slug::text AS slug, e.recurrence_until::text AS recurrence_until,
              a.name AS attended_tag_name, n.name AS no_show_tag_name, f.name AS form_name
         FROM events e
         LEFT JOIN tags a ON a.id = e.attended_tag_id
         LEFT JOIN tags n ON n.id = e.no_show_tag_id
         LEFT JOIN forms f ON f.id = e.registration_form_id
        WHERE e.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) throw notFound("Event not found");

    // The tags applied on registration are an array of ids on the row; the
    // screen shows names, so they are resolved here rather than by a second
    // request the editor would have to make on every open.
    const tags = await pool.query(
      `SELECT id, name FROM tags WHERE id = ANY($1::int[]) ORDER BY name`,
      [result.rows[0].apply_tag_ids]
    );

    const eventId = Number(result.rows[0].id);
    const [reminders, stats] = await Promise.all([
      listReminders(eventId),
      reminderStats(eventId),
    ]);
    const statsById = new Map(stats.map((row) => [row.reminderId, row]));

    // Every session of the event, worked out by the same function the public
    // page, the room and the calendar file use — so what the editor lists is
    // what registrants are given.
    const row = result.rows[0];
    const rule = ruleOfRow(row);
    const occurrences =
      row.kind === "live" && row.starts_at
        ? occurrencesFor(row.starts_at, row.timezone, rule).map((at) => at.toISOString())
        : [];

    res.json({
      ...rowToCamel(result.rows[0]),
      applyTags: rowsToCamel(tags.rows),
      occurrences,
      recurrenceLabel: describeRecurrence(rule),
      // The reminders and what has happened to them, in the same payload as
      // the rest of the event: a screen that has to make a second request to
      // find out whether its reminders are working is a screen nobody looks at.
      reminders: reminders.map((reminder) => ({
        ...reminder,
        stats:
          statsById.get(reminder.id) ??
          {
            reminderId: reminder.id,
            queued: 0,
            sent: 0,
            failed: 0,
            skipped: 0,
            lastProblem: "",
            nextAt: null,
            delivered: 0,
            bounced: 0,
          },
      })),
    });
  })
);

const EVENT_COLUMNS = [
  "title",
  "description_md",
  "cover_image",
  "kind",
  "starts_at",
  "duration_minutes",
  "timezone",
  "evergreen_interval_minutes",
  "room_url",
  "replay_url",
  "replay_expires_after_hours",
  "registration_form_id",
  "apply_tag_ids",
  "attended_tag_id",
  "no_show_tag_id",
  "published",
  "recurrence_freq",
  "recurrence_interval",
  "recurrence_until",
  "recurrence_count",
  "location_type",
  "location_address",
] as const;

adminEventsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = eventSchema.partial().parse(req.body);

    const existing = await pool.query<{
      kind: string;
      starts_at: Date | null;
      evergreen_interval_minutes: number | null;
      timezone: string;
      recurrence_freq: RecurrenceFreq | null;
      recurrence_interval: number;
      recurrence_until: string | null;
      recurrence_count: number | null;
      location_type: string;
      location_address: string;
    }>(
      `SELECT kind, starts_at, evergreen_interval_minutes, timezone,
              recurrence_freq, recurrence_interval, recurrence_until::text AS recurrence_until,
              recurrence_count, location_type, location_address
         FROM events WHERE id = $1`,
      [req.params.id]
    );
    const current = existing.rows[0];
    if (!current) throw notFound("Event not found");

    // Checked against the row as it will be, not as it was: switching a replay
    // to a live event in the same save has to bring a date with it.
    const kind = input.kind ?? current.kind;
    const startsAt = input.startsAt ?? current.starts_at?.toISOString() ?? null;
    const problem = shapeError(kind, {
      startsAt,
      evergreenIntervalMinutes:
        input.evergreenIntervalMinutes ?? current.evergreen_interval_minutes,
    });
    if (problem) throw badRequest(problem);

    // The repeat rule, normalised before it is checked. A blank end date is no
    // end date; a rule on anything but a live event is dropped, since the
    // editor stops showing it the moment the kind changes; and switching the
    // rule off clears its end with it, so the constraint never sees half a rule.
    if (input.recurrenceUntil === "") input.recurrenceUntil = null;
    if (kind !== "live" && (input.recurrenceFreq || current.recurrence_freq)) {
      input.recurrenceFreq = null;
    }
    if (input.recurrenceFreq === null) {
      input.recurrenceUntil = null;
      input.recurrenceCount = null;
      input.recurrenceInterval = 1;
    }
    const placeProblem = seriesAndPlaceError({
      kind,
      startsAt,
      timezone: input.timezone ?? current.timezone,
      freq: input.recurrenceFreq !== undefined ? input.recurrenceFreq : current.recurrence_freq,
      interval: input.recurrenceInterval ?? current.recurrence_interval,
      until: input.recurrenceUntil !== undefined ? input.recurrenceUntil : current.recurrence_until,
      count: input.recurrenceCount !== undefined ? input.recurrenceCount : current.recurrence_count,
      locationType: input.locationType ?? current.location_type,
      locationAddress: input.locationAddress ?? current.location_address,
    });
    if (placeProblem) throw badRequest(placeProblem);

    const update = buildUpdate(input, EVENT_COLUMNS);
    if (!update) throw badRequest("Nothing to update");

    const result = await pool.query(
      `UPDATE events SET ${update.clause}, updated_at = now()
        WHERE id = $${update.values.length + 1}
        RETURNING *, slug::text AS slug, recurrence_until::text AS recurrence_until`,
      [...update.values, req.params.id]
    );
    res.json(rowToCamel(result.rows[0]));
  })
);

adminEventsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`DELETE FROM events WHERE id = $1`, [req.params.id]);
    if (result.rowCount === 0) throw notFound("Event not found");
    res.status(204).end();
  })
);

/* ----------------------------------------------------------- registrations */

adminEventsRouter.get(
  "/:id/registrations",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const result = await pool.query<{
      id: string;
      email: string;
      name: string;
      session_at: Date;
      attended: boolean;
      attended_at: Date | null;
      watch_seconds: number;
      contact_id: number | null;
      created_at: Date;
      order_total_cents: number | null;
      timezone: string;
    }>(
      `SELECT r.id, r.email::text AS email, r.name, r.session_at, r.attended, r.attended_at,
              r.watch_seconds, r.contact_id, r.created_at, o.total_cents AS order_total_cents,
              e.timezone
         FROM event_registrations r
         JOIN events e ON e.id = r.event_id
         LEFT JOIN orders o ON o.id = r.converted_order_id
        WHERE r.event_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2`,
      [req.params.id, limit]
    );

    res.json(
      result.rows.map((row) => ({
        ...rowToCamel(row as unknown as Record<string, unknown>),
        // A BIGSERIAL arrives from node-postgres as a string, because a bigint
        // does not fit a JS number in the general case. These ids are row
        // counts on one event and are nowhere near that, so they are sent as
        // numbers — otherwise every client has to remember to coerce, and the
        // one that forgets builds a URL out of the right value and a payload
        // out of the wrong type.
        id: Number(row.id),
        // Written out here so every screen reads a session time the same way,
        // in the event's own zone rather than the browser's.
        sessionLabel: describeSession(row.session_at, row.timezone),
      }))
    );
  })
);

const attendanceSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(1000),
  attended: z.boolean(),
});

/**
 * Marks who turned up.
 *
 * Bulk by design: attendance arrives as a list exported from whatever ran the
 * webinar, and ticking two hundred rows one at a time is not a thing anyone
 * does twice.
 */
adminEventsRouter.post(
  "/:id/attendance",
  asyncHandler(async (req, res) => {
    const input = attendanceSchema.parse(req.body);
    const result = await pool.query<{ id: string; contact_id: number | null; email: string; name: string; session_at: Date }>(
      `UPDATE event_registrations
          SET attended = $3,
              attended_at = CASE WHEN $3 THEN COALESCE(attended_at, now()) ELSE NULL END
        WHERE event_id = $1 AND id = ANY($2::bigint[])
        RETURNING id, contact_id, email::text AS email, name, session_at`,
      [req.params.id, input.ids, input.attended]
    );
    if (input.attended) {
      for (const row of result.rows) {
        if (row.contact_id === null) continue;
        await publishDomainEvent("event_attended", {
          eventKey: `event-attended:${row.id}:${row.session_at.toISOString()}`,
          contactId: row.contact_id,
          email: row.email,
          name: row.name,
          subjectId: Number(req.params.id),
          source: "admin-attendance",
          facts: { registrationId: Number(row.id) },
        });
      }
    }
    res.json({ updated: result.rowCount ?? 0 });
  })
);

/** The join link for one registrant, for when somebody says they never got it. */
adminEventsRouter.get(
  "/:id/registrations/:registrationId/link",
  asyncHandler(async (req, res) => {
    const result = await pool.query<{ id: string; slug: string }>(
      `SELECT r.id, e.slug::text AS slug
         FROM event_registrations r
         JOIN events e ON e.id = r.event_id
        WHERE r.event_id = $1 AND r.id = $2`,
      [req.params.id, req.params.registrationId]
    );
    const row = result.rows[0];
    if (!row) throw notFound("Registration not found");

    res.json({
      path: `/events/${row.slug}/room?ticket=${signRegistration(Number(row.id))}`,
    });
  })
);

/** Runs the attended/no-show split now rather than waiting for the sweep. */
adminEventsRouter.post(
  "/:id/split",
  asyncHandler(async (req, res) => {
    const eventId = Number(req.params.id);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) throw badRequest("Unknown event");

    const exists = await pool.query(`SELECT 1 FROM events WHERE id = $1`, [eventId]);
    if (exists.rowCount === 0) throw notFound("Event not found");

    const jobId = await enqueue({
      kind: "events.postEventSplit",
      payload: { eventId },
      priority: PRIORITY.normal,
      dedupeKey: `event-split:manual:${eventId}`,
    });
    // A null id means the same split is already queued, which is a success:
    // the work is going to happen.
    res.status(202).json({ queued: jobId !== null });
  })
);

/* -------------------------------------------------------------- reminders */

/**
 * Reminder configuration on one event.
 *
 * A separate resource rather than a field on the event, because there are
 * several of them and they are edited one at a time: "add an hour-before
 * reminder" should not be a PATCH that resends the whole event, and a save that
 * silently reordered somebody's reminders would be worse than no editor at all.
 */

const reminderSchema = z.object({
  kind: z.enum(["registration", "before"]),
  /**
   * Minutes before the session. Zero is meaningful on a 'before' reminder — it
   * is the "we're live, come on in" one — so it is not treated as absent.
   */
  offsetMinutes: z.number().int().min(0).max(40_320).optional(),
  subject: z.string().trim().max(500).optional(),
  bodyMd: z.string().max(20_000).optional(),
});

async function eventOr404(id: string): Promise<number> {
  const eventId = Number(id);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) throw badRequest("Unknown event");
  const exists = await pool.query(`SELECT 1 FROM events WHERE id = $1`, [eventId]);
  if (exists.rowCount === 0) throw notFound("Event not found");
  return eventId;
}

adminEventsRouter.get(
  "/:id/reminders",
  asyncHandler(async (req, res) => {
    const eventId = await eventOr404(req.params.id);
    const [reminders, stats] = await Promise.all([
      listReminders(eventId),
      reminderStats(eventId),
    ]);
    res.json({ reminders, stats });
  })
);

adminEventsRouter.post(
  "/:id/reminders",
  asyncHandler(async (req, res) => {
    const eventId = await eventOr404(req.params.id);
    const input = reminderSchema.parse(req.body);

    const created = await createReminder(eventId, {
      kind: input.kind,
      offsetMinutes: input.offsetMinutes ?? 0,
      subject: input.subject,
      bodyMd: input.bodyMd,
    });
    // Null means the unique index refused it: this event already reminds people
    // at exactly this moment. Said in words, because "duplicate key value
    // violates unique constraint" is not a sentence about an event.
    if (!created) {
      throw badRequest("This event already sends a reminder at that moment.");
    }
    res.status(201).json(created);
  })
);

adminEventsRouter.patch(
  "/:id/reminders/:reminderId",
  asyncHandler(async (req, res) => {
    const eventId = await eventOr404(req.params.id);
    const input = reminderSchema.partial().pick({ subject: true, bodyMd: true }).extend({
      enabled: z.boolean().optional(),
    }).parse(req.body);

    const updated = await updateReminder(eventId, Number(req.params.reminderId), input);
    if (!updated) throw notFound("Reminder not found");
    res.json(updated);
  })
);

adminEventsRouter.delete(
  "/:id/reminders/:reminderId",
  asyncHandler(async (req, res) => {
    const eventId = await eventOr404(req.params.id);
    const removed = await deleteReminder(eventId, Number(req.params.reminderId));
    if (!removed) throw notFound("Reminder not found");
    res.status(204).end();
  })
);

/**
 * Tries the failed ones again.
 *
 * The button that matters while the sending account is on probation: every
 * reminder attempted in that window is sitting on 'failed' with the provider's
 * refusal on it, and once sending works again those are the people who were
 * promised an email and did not get one.
 */
adminEventsRouter.post(
  "/:id/reminders/:reminderId/retry",
  asyncHandler(async (req, res) => {
    const eventId = await eventOr404(req.params.id);
    const requeued = await retryFailedReminders(eventId, Number(req.params.reminderId));
    res.json({ requeued });
  })
);

/* ----------------------------------------------------------------- report */

/**
 * Registered → turned up → bought.
 *
 * The three numbers the event exists to move, and the only reason
 * `converted_order_id` is on the registration row: "attended but didn't buy" is
 * a segment, and it cannot be built from an order table that has never heard of
 * the webinar.
 */
adminEventsRouter.get(
  "/:id/report",
  asyncHandler(async (req, res) => {
    const totals = await pool.query<{
      registered: string;
      attended: string;
      converted: string;
      revenue_cents: string;
      upcoming: string;
    }>(
      `SELECT count(*)::text                                                AS registered,
              count(*) FILTER (WHERE attended)::text                        AS attended,
              count(*) FILTER (WHERE converted_order_id IS NOT NULL)::text  AS converted,
              COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid'), 0)::text AS revenue_cents,
              count(*) FILTER (WHERE session_at > now())::text              AS upcoming
         FROM event_registrations r
         LEFT JOIN orders o ON o.id = r.converted_order_id
        WHERE r.event_id = $1`,
      [req.params.id]
    );

    const row = totals.rows[0];
    const registered = Number(row?.registered ?? 0);
    const attended = Number(row?.attended ?? 0);

    res.json({
      registered,
      attended,
      noShow: Math.max(0, registered - attended - Number(row?.upcoming ?? 0)),
      upcoming: Number(row?.upcoming ?? 0),
      converted: Number(row?.converted ?? 0),
      revenueCents: Number(row?.revenue_cents ?? 0),
      // Percentages are computed here so the screen never has to divide by a
      // zero it forgot could happen.
      attendanceRate: registered > 0 ? Math.round((attended / registered) * 100) : 0,
      conversionRate: attended > 0 ? Math.round((Number(row?.converted ?? 0) / attended) * 100) : 0,
    });
  })
);
