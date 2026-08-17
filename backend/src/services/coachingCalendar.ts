import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import {
  parseCoachingPolicy,
  type AvailabilityOverride,
  type AvailabilityRule,
  type BookedSession,
  type CoachingPolicy,
} from "./availability";

/**
 * The database side of coaching availability.
 *
 * Kept apart from services/availability.ts so that file stays pure and its
 * tests need neither a connection nor an environment. Everything here is a
 * read; the arithmetic lives next door.
 *
 * Availability is deliberately site-wide rather than per-coach. `coaching_offers`
 * carries no coach column, so there is no honest way to say which admin a given
 * package is with — this is one practitioner's business, and pretending
 * otherwise would produce a calendar that silently drops rules whose
 * `admin_user_id` happened not to match.
 */

type Queryable = Pick<PoolClient, "query"> | typeof pool;

export async function loadCoachingPolicy(db: Queryable = pool): Promise<CoachingPolicy> {
  const res = await db.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = 'coaching'`
  );
  return parseCoachingPolicy(res.rows[0]?.value);
}

interface RuleRow {
  id: number;
  timezone: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  active: boolean;
}

export async function loadAvailabilityRules(db: Queryable = pool): Promise<AvailabilityRule[]> {
  const res = await db.query<RuleRow>(
    `SELECT id, timezone, weekday, start_minute, end_minute, active
       FROM coach_availability
      WHERE active = true
      ORDER BY weekday, start_minute, id`
  );
  return res.rows.map((row) => ({
    id: row.id,
    timezone: row.timezone,
    weekday: row.weekday,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    active: row.active,
  }));
}

interface OverrideRow {
  id: number;
  starts_at: Date;
  ends_at: Date;
  available: boolean;
  note: string;
}

/** Overlap, not containment: a holiday spanning the whole window still applies. */
export async function loadAvailabilityOverrides(
  from: Date,
  to: Date,
  db: Queryable = pool
): Promise<AvailabilityOverride[]> {
  const res = await db.query<OverrideRow>(
    `SELECT id, starts_at, ends_at, available, note
       FROM coach_availability_overrides
      WHERE starts_at < $2 AND ends_at > $1
      ORDER BY starts_at, id`,
    [from, to]
  );
  return res.rows.map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    available: row.available,
  }));
}

/**
 * Appointments already on the calendar, whoever booked them.
 *
 * Every member's bookings block every other member's, which is why this is not
 * scoped to a member id — one coach cannot be in two places, and a slot list
 * built from only your own sessions is a double-booking waiting to happen.
 * `excludeSessionId` exists for rescheduling, where the session being moved
 * must not block its own new time.
 */
export async function loadBusySessions(
  from: Date,
  to: Date,
  options: { excludeSessionId?: number; db?: Queryable } = {}
): Promise<BookedSession[]> {
  const db = options.db ?? pool;
  const res = await db.query<{ id: number; scheduled_at: Date; duration_minutes: number }>(
    `SELECT id, scheduled_at, duration_minutes
       FROM coaching_sessions
      WHERE scheduled_at IS NOT NULL
        AND status <> 'cancelled'
        AND ($3::int IS NULL OR id <> $3)
        AND scheduled_at < $2
        AND scheduled_at + make_interval(mins => duration_minutes) > $1
      ORDER BY scheduled_at`,
    [from, to, options.excludeSessionId ?? null]
  );
  return res.rows.map((row) => ({
    id: row.id,
    startsAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
  }));
}
