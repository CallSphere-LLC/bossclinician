import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { computeSlots, describeInstant, isValidTimeZone } from "../../services/availability";
import {
  loadAvailabilityOverrides,
  loadAvailabilityRules,
  loadBusySessions,
  loadCoachingPolicy,
} from "../../services/coachingCalendar";

/**
 * `/api/admin/availability` — the coach's weekly hours and one-off exceptions.
 *
 * Availability is site-wide rather than per-coach (see coachingCalendar.ts), so
 * `admin_user_id` records who set a rule rather than whose calendar it belongs
 * to. Nothing reads it back when slots are computed; it is there for the audit
 * trail if a second practitioner is ever added.
 *
 * The preview is the point of this screen. Weekly minutes in one timezone,
 * exceptions in another, and a booking policy on top do not add up to anything
 * a person can picture — so the same function that answers the member is asked
 * the question here, and the answer is shown as real dates and times.
 */
export const adminAvailabilityRouter = Router();

const MAX_INT4 = 2_147_483_647;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PREVIEW_DAYS = 62;

const idParamSchema = z.object({ id: z.coerce.number().int().positive().max(MAX_INT4) });

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Not a timezone we recognise" });

const dateSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Not a date" });

const ruleBodySchema = z
  .object({
    timezone: timezoneSchema,
    weekday: z.coerce.number().int().min(0).max(6),
    startMinute: z.coerce.number().int().min(0).max(1439),
    endMinute: z.coerce.number().int().min(1).max(1440),
    active: z.boolean().optional(),
  })
  .refine((body) => body.endMinute > body.startMinute, {
    message: "A window has to end after it starts",
    path: ["endMinute"],
  });

const overrideBodySchema = z
  .object({
    startsAt: dateSchema,
    endsAt: dateSchema,
    available: z.boolean().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((body) => Date.parse(body.endsAt) > Date.parse(body.startsAt), {
    message: "An exception has to end after it starts",
    path: ["endsAt"],
  });

const previewSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  durationMinutes: z.coerce.number().int().min(5).max(8 * 60).optional(),
  timezone: z.string().trim().max(64).optional(),
});

const listWindowSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

/* --------------------------------------------------------------------- rules */

interface RuleRow {
  id: number;
  admin_user_id: number | null;
  timezone: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  active: boolean;
  created_at: Date;
}

const RULE_COLUMNS = `id, admin_user_id, timezone, weekday, start_minute, end_minute, active, created_at`;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "9:00 AM" from minutes past midnight, without pretending to know the date. */
function clockLabel(minutesPastMidnight: number): string {
  const hours = Math.floor(minutesPastMidnight / 60);
  const minutes = minutesPastMidnight % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function toRuleJson(row: RuleRow) {
  return {
    id: row.id,
    timezone: row.timezone,
    weekday: row.weekday,
    weekdayLabel: WEEKDAYS[row.weekday] ?? "",
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    // Rendered here so the admin screen never has to do time maths of its own.
    label: `${WEEKDAYS[row.weekday] ?? ""} ${clockLabel(row.start_minute)} – ${clockLabel(
      row.end_minute
    )}`,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

adminAvailabilityRouter.get(
  "/rules",
  asyncHandler(async (_req, res) => {
    const found = await pool.query<RuleRow>(
      `SELECT ${RULE_COLUMNS} FROM coach_availability ORDER BY weekday, start_minute, id`
    );
    res.json({ rules: found.rows.map(toRuleJson) });
  })
);

adminAvailabilityRouter.post(
  "/rules",
  asyncHandler(async (req, res) => {
    const parsed = ruleBodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid availability", parsed.error.flatten());

    const created = await pool.query<RuleRow>(
      `INSERT INTO coach_availability
         (admin_user_id, timezone, weekday, start_minute, end_minute, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${RULE_COLUMNS}`,
      [
        req.user?.sub ?? null,
        parsed.data.timezone,
        parsed.data.weekday,
        parsed.data.startMinute,
        parsed.data.endMinute,
        parsed.data.active ?? true,
      ]
    );

    const row = created.rows[0];
    await recordAdminAction({
      req,
      action: "availability.rule.create",
      entityType: "coach_availability",
      entityId: row.id,
      after: toRuleJson(row),
    });

    res.status(201).json({ rule: toRuleJson(row) });
  })
);

adminAvailabilityRouter.put(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) throw notFound("Not found");

    const parsed = ruleBodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid availability", parsed.error.flatten());

    const existing = await pool.query<RuleRow>(
      `SELECT ${RULE_COLUMNS} FROM coach_availability WHERE id = $1`,
      [params.data.id]
    );
    if (!existing.rows[0]) throw notFound("Not found");

    const updated = await pool.query<RuleRow>(
      `UPDATE coach_availability
          SET timezone = $2, weekday = $3, start_minute = $4, end_minute = $5, active = $6
        WHERE id = $1
        RETURNING ${RULE_COLUMNS}`,
      [
        params.data.id,
        parsed.data.timezone,
        parsed.data.weekday,
        parsed.data.startMinute,
        parsed.data.endMinute,
        parsed.data.active ?? existing.rows[0].active,
      ]
    );

    await recordAdminAction({
      req,
      action: "availability.rule.update",
      entityType: "coach_availability",
      entityId: params.data.id,
      before: toRuleJson(existing.rows[0]),
      after: toRuleJson(updated.rows[0]),
    });

    res.json({ rule: toRuleJson(updated.rows[0]) });
  })
);

/**
 * Deleting a rule never touches an appointment already booked under it.
 *
 * Removing Tuesdays from the calendar means "stop offering Tuesdays", not
 * "cancel the eleven people who already hold a Tuesday" — those have to be
 * moved deliberately, with the member told.
 */
adminAvailabilityRouter.delete(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) throw notFound("Not found");

    const existing = await pool.query<RuleRow>(
      `SELECT ${RULE_COLUMNS} FROM coach_availability WHERE id = $1`,
      [params.data.id]
    );
    if (!existing.rows[0]) throw notFound("Not found");

    await pool.query(`DELETE FROM coach_availability WHERE id = $1`, [params.data.id]);

    await recordAdminAction({
      req,
      action: "availability.rule.delete",
      entityType: "coach_availability",
      entityId: params.data.id,
      before: toRuleJson(existing.rows[0]),
    });

    res.json({ deleted: true });
  })
);

/* ----------------------------------------------------------------- overrides */

interface OverrideRow {
  id: number;
  admin_user_id: number | null;
  starts_at: Date;
  ends_at: Date;
  available: boolean;
  note: string;
}

const OVERRIDE_COLUMNS = `id, admin_user_id, starts_at, ends_at, available, note`;

function toOverrideJson(row: OverrideRow, timezone: string) {
  const start = describeInstant(row.starts_at, timezone);
  const end = describeInstant(row.ends_at, timezone);
  return {
    id: row.id,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    available: row.available,
    note: row.note,
    // Repeating the date on a same-day exception reads as a mistake; leaving it
    // off one that spans days reads as a much shorter exception than it is.
    label:
      start.day === end.day ? `${start.label} – ${end.timeLabel}` : `${start.label} – ${end.label}`,
    kind: row.available ? "extra" : "blocked",
  };
}

adminAvailabilityRouter.get(
  "/overrides",
  asyncHandler(async (req, res) => {
    const parsed = listWindowSchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid date range", parsed.error.flatten());

    const policy = await loadCoachingPolicy();
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date(Date.now() - 30 * DAY_MS);
    const to = parsed.data.to ? new Date(parsed.data.to) : new Date(from.getTime() + 180 * DAY_MS);

    const found = await pool.query<OverrideRow>(
      `SELECT ${OVERRIDE_COLUMNS}
         FROM coach_availability_overrides
        WHERE starts_at < $2 AND ends_at > $1
        ORDER BY starts_at, id`,
      [from, to]
    );

    res.json({
      timezone: policy.timezone,
      overrides: found.rows.map((row) => toOverrideJson(row, policy.timezone)),
    });
  })
);

adminAvailabilityRouter.post(
  "/overrides",
  asyncHandler(async (req, res) => {
    const parsed = overrideBodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid exception", parsed.error.flatten());

    const policy = await loadCoachingPolicy();
    const created = await pool.query<OverrideRow>(
      `INSERT INTO coach_availability_overrides
         (admin_user_id, starts_at, ends_at, available, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${OVERRIDE_COLUMNS}`,
      [
        req.user?.sub ?? null,
        new Date(parsed.data.startsAt),
        new Date(parsed.data.endsAt),
        parsed.data.available ?? false,
        parsed.data.note ?? "",
      ]
    );

    const row = created.rows[0];
    await recordAdminAction({
      req,
      action: "availability.override.create",
      entityType: "coach_availability_overrides",
      entityId: row.id,
      after: toOverrideJson(row, policy.timezone),
    });

    res.status(201).json({ override: toOverrideJson(row, policy.timezone) });
  })
);

adminAvailabilityRouter.put(
  "/overrides/:id",
  asyncHandler(async (req, res) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) throw notFound("Not found");

    const parsed = overrideBodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid exception", parsed.error.flatten());

    const policy = await loadCoachingPolicy();
    const existing = await pool.query<OverrideRow>(
      `SELECT ${OVERRIDE_COLUMNS} FROM coach_availability_overrides WHERE id = $1`,
      [params.data.id]
    );
    if (!existing.rows[0]) throw notFound("Not found");

    const updated = await pool.query<OverrideRow>(
      `UPDATE coach_availability_overrides
          SET starts_at = $2, ends_at = $3, available = $4, note = $5
        WHERE id = $1
        RETURNING ${OVERRIDE_COLUMNS}`,
      [
        params.data.id,
        new Date(parsed.data.startsAt),
        new Date(parsed.data.endsAt),
        parsed.data.available ?? existing.rows[0].available,
        parsed.data.note ?? existing.rows[0].note,
      ]
    );

    await recordAdminAction({
      req,
      action: "availability.override.update",
      entityType: "coach_availability_overrides",
      entityId: params.data.id,
      before: toOverrideJson(existing.rows[0], policy.timezone),
      after: toOverrideJson(updated.rows[0], policy.timezone),
    });

    res.json({ override: toOverrideJson(updated.rows[0], policy.timezone) });
  })
);

adminAvailabilityRouter.delete(
  "/overrides/:id",
  asyncHandler(async (req, res) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) throw notFound("Not found");

    const policy = await loadCoachingPolicy();
    const existing = await pool.query<OverrideRow>(
      `SELECT ${OVERRIDE_COLUMNS} FROM coach_availability_overrides WHERE id = $1`,
      [params.data.id]
    );
    if (!existing.rows[0]) throw notFound("Not found");

    await pool.query(`DELETE FROM coach_availability_overrides WHERE id = $1`, [params.data.id]);

    await recordAdminAction({
      req,
      action: "availability.override.delete",
      entityType: "coach_availability_overrides",
      entityId: params.data.id,
      before: toOverrideJson(existing.rows[0], policy.timezone),
    });

    res.json({ deleted: true });
  })
);

/* ------------------------------------------------------------------- preview */

/**
 * GET /api/admin/availability/preview
 *
 * Exactly what a member would be offered, computed by the same function, plus
 * the appointments already taking up space — so a missing Thursday reads as
 * "Thursday is booked" rather than as "the rules are broken".
 */
adminAvailabilityRouter.get(
  "/preview",
  asyncHandler(async (req, res) => {
    const parsed = previewSchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid preview range", parsed.error.flatten());

    const policy = await loadCoachingPolicy();
    const timezone =
      parsed.data.timezone && isValidTimeZone(parsed.data.timezone)
        ? parsed.data.timezone
        : policy.timezone;

    const now = new Date();
    const from = parsed.data.from ? new Date(parsed.data.from) : now;
    const requestedTo = parsed.data.to ? new Date(parsed.data.to) : new Date(from.getTime() + 14 * DAY_MS);
    const to = new Date(
      Math.max(
        from.getTime(),
        Math.min(requestedTo.getTime(), from.getTime() + MAX_PREVIEW_DAYS * DAY_MS)
      )
    );

    const durationMinutes = parsed.data.durationMinutes ?? 60;
    const padded = { from: new Date(from.getTime() - DAY_MS), to: new Date(to.getTime() + DAY_MS) };

    const [rules, overrides, existingSessions] = await Promise.all([
      loadAvailabilityRules(),
      loadAvailabilityOverrides(padded.from, padded.to),
      loadBusySessions(from, to),
    ]);

    const slots = computeSlots({
      rules,
      overrides,
      existingSessions,
      durationMinutes,
      slotIntervalMinutes: policy.slotIntervalMinutes,
      from,
      to,
      memberTimezone: timezone,
      now,
      minimumNoticeMinutes: policy.minimumNoticeMinutes,
    });

    res.json({
      timezone,
      from: from.toISOString(),
      to: to.toISOString(),
      durationMinutes,
      policy: {
        minimumNoticeHours: policy.minimumNoticeMinutes / 60,
        cancellationWindowHours: policy.cancellationWindowMinutes / 60,
        slotIntervalMinutes: policy.slotIntervalMinutes,
        bookingHorizonDays: policy.bookingHorizonDays,
      },
      slots: slots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        day: slot.day,
        dayLabel: slot.dayLabel,
        timeLabel: slot.timeLabel,
        label: slot.label,
      })),
      booked: existingSessions.map((session) => ({
        sessionId: session.id,
        startsAt: session.startsAt.toISOString(),
        durationMinutes: session.durationMinutes,
        label: describeInstant(session.startsAt, timezone).label,
      })),
    });
  })
);
