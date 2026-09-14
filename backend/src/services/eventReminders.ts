import { pool } from "../db/pool";
import { env } from "../config/env";
import { PRIORITY, enqueue } from "../jobs/queue";
import { renderMarkdown, renderTokens, sendEmail } from "../email/provider";
import {
  DEFAULT_EVENT_REMINDERS,
  DOORS_OPEN_MINUTES,
  describeRecurrence,
  describeReminderOffset,
  describeSession,
  occurrenceAt,
  occurrencesFor,
  reminderFireTime,
  reminderVerdict,
  signRegistration,
  type RecurrenceFreq,
  type RecurrenceRule,
  type ReminderKind,
  type ReminderSpec,
} from "./events";

/**
 * Event reminders: scheduling them, sending them, and saying honestly what
 * happened to each one.
 *
 * The platform's copy has promised these for a long time. What existed was
 * three hard-coded steps in `jobs/eventJobs.ts` that stamped a timestamp column
 * on the registration and mailed it — no configuration anywhere in the editor,
 * no confirmation on registration at all despite the page saying there would be
 * one, and no way to distinguish a reminder that reached somebody from one the
 * provider refused. That last part is not academic: the sending account is on
 * probation as this is written, so *everything* is being refused, and a design
 * that records a send as done the moment it is attempted would report a hundred
 * percent delivery of nothing.
 *
 * Three phases per tick, in this order, and the order is the safety property:
 *
 *  1. `sweepUnsendable` retires rows whose moment has passed. A worker that was
 *     down for a day comes back to a queue full of reminders for webinars that
 *     have already happened; they are marked skipped, with a reason, and are
 *     never sent. This is the failure the tester flagged on the campaign side —
 *     "'upon registration' would have blasted the backlog" — and it is
 *     structurally impossible here because nothing past-due is ever eligible.
 *  2. `materializeReminderSends` writes the plan for registrations that do not
 *     have one yet, asking the same pure verdict function whether each row is
 *     genuinely still ahead. A reminder configured after its own moment is
 *     written as skipped, not queued.
 *  3. `deliverDueReminders` claims, re-checks the verdict against the clock as
 *     it is *now*, sends, and stamps the outcome.
 *
 * Idempotency is a unique index — (reminder, registration, session) — plus a
 * claim that moves a row to 'sending' in the same statement that selects it, so
 * two workers ticking in the same second cannot both hold the same reminder.
 */

/* ------------------------------------------------------------------ tuning */

/** Rows planned per tick. Plenty: a launch-day webinar is a few hundred people. */
const MATERIALIZE_BATCH = 2000;

/** Reminders sent per tick. */
const SEND_BATCH = 200;

/**
 * How many times one reminder is attempted before it is left alone.
 *
 * A provider outage should not cost somebody their reminder, so a failure is
 * retried. Three attempts is where retrying stops being useful: at that point
 * the address, the identity or the account is wrong, and the row is more useful
 * sitting on 'failed' with the provider's sentence on it than being tried for a
 * fourth time.
 */
const MAX_ATTEMPTS = 3;

/**
 * When a 'sending' row is assumed abandoned.
 *
 * The alternative — putting it back on 'queued' — risks a second copy of an
 * email that may well have gone out before the process died. Given the choice
 * between a duplicate reminder and a visibly failed one, this fails closed:
 * the row is marked failed with its attempts spent, so nothing retries it
 * automatically and the admin can see it and press retry if they want to.
 */
const SENDING_STALE_MINUTES = 15;

/** How far ahead the plan is written. Beyond this, the next tick will do it. */
const HORIZON_DAYS = 400;

/* ------------------------------------------------------------ configuration */

export interface EventReminder {
  id: number;
  eventId: number;
  kind: ReminderKind;
  offsetMinutes: number;
  subject: string;
  bodyMd: string;
  enabled: boolean;
  /** The offset in words, so every surface says the same sentence. */
  label: string;
}

interface ReminderRow {
  id: number;
  event_id: number;
  kind: ReminderKind;
  offset_minutes: number;
  subject: string;
  body_md: string;
  enabled: boolean;
}

function shapeReminder(row: ReminderRow): EventReminder {
  return {
    id: row.id,
    eventId: row.event_id,
    kind: row.kind,
    offsetMinutes: row.offset_minutes,
    subject: row.subject,
    bodyMd: row.body_md,
    enabled: row.enabled,
    label: describeReminderOffset({ kind: row.kind, offsetMinutes: row.offset_minutes }),
  };
}

/** Sorted the way they fire: the confirmation, then furthest out to nearest. */
const REMINDER_ORDER = `ORDER BY (kind = 'registration') DESC, offset_minutes DESC`;

export async function listReminders(eventId: number): Promise<EventReminder[]> {
  const res = await pool.query<ReminderRow>(
    `SELECT id, event_id, kind, offset_minutes, subject, body_md, enabled
       FROM event_reminders WHERE event_id = $1 ${REMINDER_ORDER}`,
    [eventId]
  );
  return res.rows.map(shapeReminder);
}

/**
 * Gives a new event the reminder set the copy already promises.
 *
 * `ON CONFLICT DO NOTHING` rather than a check-then-insert: two admins creating
 * from two tabs is not a race worth a transaction, and the unique index already
 * says what "the same reminder twice" means.
 */
export async function seedDefaultReminders(eventId: number): Promise<void> {
  for (const spec of DEFAULT_EVENT_REMINDERS) {
    await pool.query(
      `INSERT INTO event_reminders (event_id, kind, offset_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, kind, offset_minutes) DO NOTHING`,
      [eventId, spec.kind, spec.offsetMinutes]
    );
  }
}

export async function createReminder(
  eventId: number,
  input: { kind: ReminderKind; offsetMinutes: number; subject?: string; bodyMd?: string }
): Promise<EventReminder | null> {
  const res = await pool.query<ReminderRow>(
    `INSERT INTO event_reminders (event_id, kind, offset_minutes, subject, body_md)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id, kind, offset_minutes) DO NOTHING
     RETURNING id, event_id, kind, offset_minutes, subject, body_md, enabled`,
    [
      eventId,
      input.kind,
      input.kind === "registration" ? 0 : input.offsetMinutes,
      input.subject ?? "",
      input.bodyMd ?? "",
    ]
  );
  const row = res.rows[0];
  return row ? shapeReminder(row) : null;
}

export async function updateReminder(
  eventId: number,
  reminderId: number,
  input: { subject?: string; bodyMd?: string; enabled?: boolean }
): Promise<EventReminder | null> {
  const res = await pool.query<ReminderRow>(
    `UPDATE event_reminders
        SET subject = COALESCE($3, subject),
            body_md = COALESCE($4, body_md),
            enabled = COALESCE($5, enabled),
            updated_at = now()
      WHERE event_id = $1 AND id = $2
      RETURNING id, event_id, kind, offset_minutes, subject, body_md, enabled`,
    [
      eventId,
      reminderId,
      input.subject ?? null,
      input.bodyMd ?? null,
      input.enabled === undefined ? null : input.enabled,
    ]
  );
  const row = res.rows[0];
  return row ? shapeReminder(row) : null;
}

/**
 * Removes a reminder.
 *
 * Its send rows go with it, by cascade. That loses the record of reminders
 * already sent for this step, which is the right trade: the alternative is
 * orphaned history nothing can name, and the delivery log keeps the messages
 * themselves either way.
 */
export async function deleteReminder(eventId: number, reminderId: number): Promise<boolean> {
  const res = await pool.query(`DELETE FROM event_reminders WHERE event_id = $1 AND id = $2`, [
    eventId,
    reminderId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * The reminders this event actually sends, in words.
 *
 * Read by the public registration page and by the confirmation that follows it.
 * The copy on that page has promised a reminder since it was written; it can now
 * name the ones that exist, and say nothing when none are configured, rather
 * than making a promise no code was keeping.
 */
export async function reminderPromise(eventId: number): Promise<string[]> {
  const res = await pool.query<{ kind: ReminderKind; offset_minutes: number }>(
    `SELECT kind, offset_minutes
       FROM event_reminders
      WHERE event_id = $1 AND enabled AND kind = 'before'
      ORDER BY offset_minutes DESC`,
    [eventId]
  );
  return res.rows.map((row) =>
    describeReminderOffset({ kind: row.kind, offsetMinutes: row.offset_minutes })
  );
}

/* ------------------------------------------------------------------- status */

export type ReminderSendStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export interface ReminderStats {
  reminderId: number;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  /** What the provider or the scheduler last said, when something went wrong. */
  lastProblem: string;
  nextAt: string | null;
  /** The delivery log's own verdict, once the provider's webhooks have spoken. */
  delivered: number;
  bounced: number;
}

/**
 * Per-reminder counts, and the delivery log's verdict beside them.
 *
 * Two different truths, and both are needed: 'sent' means the provider accepted
 * the message, 'delivered' means it arrived. While the sending account is on
 * probation those numbers will disagree loudly, which is the point — a screen
 * that showed only 'sent' would look healthy while nothing reached anybody.
 */
export async function reminderStats(eventId: number): Promise<ReminderStats[]> {
  const res = await pool.query<{
    reminder_id: number;
    queued: string;
    sent: string;
    failed: string;
    skipped: string;
    last_problem: string | null;
    next_at: Date | null;
    delivered: string;
    bounced: string;
  }>(
    `SELECT s.reminder_id,
            count(*) FILTER (WHERE s.status IN ('queued', 'sending'))::text AS queued,
            count(*) FILTER (WHERE s.status = 'sent')::text                 AS sent,
            count(*) FILTER (WHERE s.status = 'failed')::text               AS failed,
            count(*) FILTER (WHERE s.status = 'skipped')::text              AS skipped,
            (ARRAY_AGG(s.detail ORDER BY s.updated_at DESC)
               FILTER (WHERE s.detail <> ''))[1]                            AS last_problem,
            min(s.scheduled_for) FILTER (WHERE s.status = 'queued')         AS next_at,
            count(*) FILTER (WHERE m.status IN ('delivered', 'opened', 'clicked'))::text AS delivered,
            count(*) FILTER (WHERE m.status IN ('bounced', 'complained'))::text          AS bounced
       FROM event_reminder_sends s
       LEFT JOIN email_messages m ON m.id = s.email_message_id
      WHERE s.event_id = $1
      GROUP BY s.reminder_id`,
    [eventId]
  );

  return res.rows.map((row) => ({
    reminderId: row.reminder_id,
    queued: Number(row.queued),
    sent: Number(row.sent),
    failed: Number(row.failed),
    skipped: Number(row.skipped),
    lastProblem: row.last_problem ?? "",
    nextAt: row.next_at ? row.next_at.toISOString() : null,
    delivered: Number(row.delivered),
    bounced: Number(row.bounced),
  }));
}

/**
 * What this one registrant is still due, and what they have already had.
 *
 * Read by the member's own events page, which promises "the room link when it
 * opens and the replay while it lasts" and should be able to say when the next
 * email is coming too.
 */
export interface RegistrationReminder {
  label: string;
  at: string;
  status: ReminderSendStatus;
}

export async function remindersForRegistrations(
  registrationIds: number[]
): Promise<Map<number, RegistrationReminder[]>> {
  const byRegistration = new Map<number, RegistrationReminder[]>();
  if (registrationIds.length === 0) return byRegistration;

  const res = await pool.query<{
    registration_id: string;
    kind: ReminderKind;
    offset_minutes: number;
    scheduled_for: Date;
    status: ReminderSendStatus;
  }>(
    `SELECT s.registration_id, r.kind, r.offset_minutes, s.scheduled_for, s.status
       FROM event_reminder_sends s
       JOIN event_reminders r ON r.id = s.reminder_id
      WHERE s.registration_id = ANY($1::bigint[])
        AND s.status IN ('queued', 'sending', 'sent')
      ORDER BY s.scheduled_for`,
    [registrationIds]
  );

  for (const row of res.rows) {
    const id = Number(row.registration_id);
    const list = byRegistration.get(id) ?? [];
    list.push({
      label: describeReminderOffset({ kind: row.kind, offsetMinutes: row.offset_minutes }),
      at: row.scheduled_for.toISOString(),
      status: row.status === "sending" ? "queued" : row.status,
    });
    byRegistration.set(id, list);
  }

  return byRegistration;
}

/** Puts failed reminders back, for the admin's "try again" button. */
export async function retryFailedReminders(
  eventId: number,
  reminderId: number
): Promise<number> {
  const res = await pool.query(
    `UPDATE event_reminder_sends
        SET status = 'queued', attempts = 0, detail = '', updated_at = now()
      WHERE event_id = $1 AND reminder_id = $2 AND status = 'failed'`,
    [eventId, reminderId]
  );
  return res.rowCount ?? 0;
}

/* -------------------------------------------------------------- the sweeps */

/**
 * Retires rows that can no longer honestly be sent.
 *
 * This runs first, every tick, and it is what makes a restart safe. The
 * predicate is the SQL half of `reminderVerdict`'s "skip" arm, kept alongside
 * it deliberately: doing it in one statement means a backlog of ten thousand
 * rows is retired in one round trip rather than read into memory first, and the
 * per-row re-check before sending catches anything this misses.
 */
export async function sweepUnsendable(): Promise<number> {
  const res = await pool.query(
    `UPDATE event_reminder_sends s
        SET status = 'skipped',
            detail = CASE
                       WHEN now() >= s.session_at + make_interval(mins => e.duration_minutes)
                         THEN 'the session was already over'
                       WHEN r.kind = 'before' AND r.offset_minutes > 0 AND now() >= s.session_at
                         THEN 'the session had already started'
                       ELSE 'too late to be worth sending'
                     END,
            updated_at = now()
       FROM event_reminders r, events e
      WHERE s.reminder_id = r.id
        AND e.id = s.event_id
        AND s.status IN ('queued', 'failed')
        AND s.scheduled_for <= now()
        AND (
              now() >= s.session_at + make_interval(mins => e.duration_minutes)
           OR (r.kind = 'before' AND r.offset_minutes > 0 AND now() >= s.session_at)
           OR now() - s.scheduled_for >
                make_interval(mins => (CASE WHEN r.kind = 'registration' THEN $1 ELSE $2 END)::int)
        )`,
    [360, 60]
  );
  return res.rowCount ?? 0;
}

/**
 * Frees rows a dead worker left mid-send.
 *
 * Marked failed with their attempts spent rather than re-queued: see
 * SENDING_STALE_MINUTES.
 */
export async function reclaimStuckSends(): Promise<number> {
  const res = await pool.query(
    `UPDATE event_reminder_sends
        SET status = 'failed',
            attempts = GREATEST(attempts, $2),
            detail = 'the worker stopped part way through sending this; not retried automatically',
            updated_at = now()
      WHERE status = 'sending'
        AND updated_at < now() - make_interval(mins => $1::int)`,
    [SENDING_STALE_MINUTES, MAX_ATTEMPTS]
  );
  return res.rowCount ?? 0;
}

/* -------------------------------------------------------- writing the plan */

interface PlanCandidate {
  reminder_id: number;
  kind: ReminderKind;
  offset_minutes: number;
  registration_id: string;
  event_id: number;
  session_at: Date;
  registered_at: Date;
  timezone: string;
  duration_minutes: number;
}

/**
 * Writes send rows for registrations that do not have one yet.
 *
 * The `created_at` comparison on the 'registration' arm is load-bearing rather
 * than tidy: a confirmation is only ever scheduled for somebody who registered
 * at or after the reminder was configured. Without it, switching the
 * confirmation on — or shipping the migration that adds it as a default — would
 * mail every past registrant in the table at once. That exact mistake was made
 * elsewhere in this platform's history and the tester quoted it back.
 *
 * The fire time is computed here rather than in SQL so that one pure function,
 * covered by unit tests including both DST transitions, decides it for the
 * scheduler, the member's page and the editor's preview alike.
 */
export async function materializeReminderSends(now = new Date()): Promise<{
  queued: number;
  skipped: number;
}> {
  const candidates = await pool.query<PlanCandidate>(
    `SELECT rem.id  AS reminder_id, rem.kind, rem.offset_minutes,
            r.id    AS registration_id, r.event_id, r.session_at, r.created_at AS registered_at,
            COALESCE(NULLIF(e.timezone, ''), 'America/New_York') AS timezone,
            e.duration_minutes
       FROM event_reminders rem
       JOIN events e              ON e.id = rem.event_id
       JOIN event_registrations r ON r.event_id = rem.event_id
      WHERE rem.enabled
        AND e.published
        -- A repeating event's before-the-session reminders follow each session
        -- in turn, which this statement cannot see; materializeSeriesSends
        -- plans those. Its confirmation is still planned here, once.
        AND (rem.kind = 'registration' OR e.recurrence_freq IS NULL
             OR e.kind <> 'live' OR e.starts_at IS NULL)
        -- Nothing is planned for a session that is already over.
        AND r.session_at + make_interval(mins => e.duration_minutes) > now()
        AND r.session_at < now() + make_interval(days => $2::int)
        AND (rem.kind = 'before' OR r.created_at >= rem.created_at)
        AND NOT EXISTS (
              SELECT 1 FROM event_reminder_sends s
               WHERE s.reminder_id = rem.id
                 AND s.registration_id = r.id
                 AND s.session_at = r.session_at
            )
      ORDER BY r.session_at
      LIMIT $1`,
    [MATERIALIZE_BATCH, HORIZON_DAYS]
  );

  let queued = 0;
  let skipped = 0;

  for (const row of candidates.rows) {
    const spec: ReminderSpec = { kind: row.kind, offsetMinutes: row.offset_minutes };
    const scheduledFor = reminderFireTime(spec, {
      sessionAt: row.session_at,
      registeredAt: row.registered_at,
      timezone: row.timezone,
    });

    const verdict = reminderVerdict({
      kind: row.kind,
      offsetMinutes: row.offset_minutes,
      scheduledFor,
      sessionAt: row.session_at,
      durationMinutes: row.duration_minutes,
      now,
    });

    // "skip" at planning time means this reminder was configured after its own
    // moment had gone — a "one week before" added three days out, or a
    // confirmation for somebody who registered before the scheduler ran. The
    // row is written so it is visible, and it is never sent.
    const status = verdict === "skip" ? "skipped" : "queued";
    const detail =
      verdict === "skip" ? "its moment had already passed when it was scheduled" : "";

    const inserted = await pool.query(
      `INSERT INTO event_reminder_sends
         (reminder_id, registration_id, event_id, session_at, scheduled_for, status, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (reminder_id, registration_id, session_at) DO NOTHING`,
      [
        row.reminder_id,
        row.registration_id,
        row.event_id,
        row.session_at,
        scheduledFor,
        status,
        detail,
      ]
    );
    if ((inserted.rowCount ?? 0) === 0) continue;
    if (status === "queued") queued += 1;
    else skipped += 1;
  }

  const series = await materializeSeriesSends(now);
  return { queued: queued + series.queued, skipped: skipped + series.skipped };
}

interface SeriesCandidate {
  reminder_id: number;
  kind: ReminderKind;
  offset_minutes: number;
  registration_id: string;
  event_id: number;
  session_at: Date;
  registered_at: Date;
  timezone: string;
  duration_minutes: number;
  starts_at: Date;
  recurrence_freq: RecurrenceFreq;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_count: number | null;
}

/**
 * Plans the before-the-session reminders for repeating events, one session at
 * a time.
 *
 * A place in a series is one registration with one `session_at` — the first
 * session they booked — so the statement above cannot see weeks two to six.
 * Here each registration's current session is worked out with `occurrenceAt`,
 * the same function the room and the member's page use (the next session that
 * has not finished, never before their own first), and planned exactly like a
 * single session. When it finishes, the next tick plans the one after.
 *
 * The idempotency key already includes the session, so every session gets its
 * own set of reminders and none gets two: the in-memory check below only saves
 * the round trips, and `ON CONFLICT` is what decides.
 */
async function materializeSeriesSends(now: Date): Promise<{ queued: number; skipped: number }> {
  const candidates = await pool.query<SeriesCandidate>(
    `SELECT rem.id AS reminder_id, rem.kind, rem.offset_minutes,
            r.id AS registration_id, r.event_id, r.session_at, r.created_at AS registered_at,
            COALESCE(NULLIF(e.timezone, ''), 'America/New_York') AS timezone,
            e.duration_minutes, e.starts_at, e.recurrence_freq, e.recurrence_interval,
            e.recurrence_until::text AS recurrence_until, e.recurrence_count
       FROM event_reminders rem
       JOIN events e              ON e.id = rem.event_id
       JOIN event_registrations r ON r.event_id = rem.event_id
      WHERE rem.enabled
        AND e.published
        AND rem.kind = 'before'
        AND e.kind = 'live'
        AND e.recurrence_freq IS NOT NULL
        AND e.starts_at IS NOT NULL
      ORDER BY r.id, rem.id`
  );
  if (candidates.rows.length === 0) return { queued: 0, skipped: 0 };

  const eventIds = [...new Set(candidates.rows.map((row) => row.event_id))];
  const existing = await pool.query<{
    reminder_id: number;
    registration_id: string;
    session_at: Date;
  }>(
    `SELECT reminder_id, registration_id, session_at
       FROM event_reminder_sends
      WHERE event_id = ANY($1::int[]) AND session_at > now() - interval '2 days'`,
    [eventIds]
  );
  const key = (reminderId: number, registrationId: string | number, sessionAt: Date) =>
    `${reminderId}:${registrationId}:${sessionAt.getTime()}`;
  const planned = new Set(
    existing.rows.map((row) => key(row.reminder_id, row.registration_id, row.session_at))
  );

  const sessionsByEvent = new Map<number, Date[]>();
  const horizon = now.getTime() + HORIZON_DAYS * 86_400_000;
  let queued = 0;
  let skipped = 0;

  for (const row of candidates.rows) {
    const rule: RecurrenceRule = {
      freq: row.recurrence_freq,
      interval: row.recurrence_interval,
      until: row.recurrence_until,
      count: row.recurrence_count,
    };
    let sessions = sessionsByEvent.get(row.event_id);
    if (!sessions) {
      sessions = occurrencesFor(row.starts_at, row.timezone, rule);
      sessionsByEvent.set(row.event_id, sessions);
    }

    const sessionAt = occurrenceAt(sessions, row.duration_minutes, now, row.session_at);
    if (!sessionAt) continue;
    // The whole series is over for this registrant, or the session is beyond
    // the planning horizon.
    if (sessionAt.getTime() + row.duration_minutes * 60_000 <= now.getTime()) continue;
    if (sessionAt.getTime() >= horizon) continue;
    if (planned.has(key(row.reminder_id, row.registration_id, sessionAt))) continue;

    const spec: ReminderSpec = { kind: row.kind, offsetMinutes: row.offset_minutes };
    const scheduledFor = reminderFireTime(spec, {
      sessionAt,
      registeredAt: row.registered_at,
      timezone: row.timezone,
    });
    const verdict = reminderVerdict({
      kind: row.kind,
      offsetMinutes: row.offset_minutes,
      scheduledFor,
      sessionAt,
      durationMinutes: row.duration_minutes,
      now,
    });
    const status = verdict === "skip" ? "skipped" : "queued";
    const detail =
      verdict === "skip" ? "its moment had already passed when it was scheduled" : "";

    const inserted = await pool.query(
      `INSERT INTO event_reminder_sends
         (reminder_id, registration_id, event_id, session_at, scheduled_for, status, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (reminder_id, registration_id, session_at) DO NOTHING`,
      [row.reminder_id, row.registration_id, row.event_id, sessionAt, scheduledFor, status, detail]
    );
    planned.add(key(row.reminder_id, row.registration_id, sessionAt));
    if ((inserted.rowCount ?? 0) === 0) continue;
    if (status === "queued") queued += 1;
    else skipped += 1;
  }

  return { queued, skipped };
}

/* ------------------------------------------------------------------ sending */

interface DueSend {
  id: string;
  reminder_id: number;
  kind: ReminderKind;
  offset_minutes: number;
  subject: string;
  body_md: string;
  scheduled_for: Date;
  session_at: Date;
  registration_id: string;
  email: string;
  name: string;
  contact_id: number | null;
  member_id: number | null;
  event_id: number;
  slug: string;
  title: string;
  timezone: string;
  duration_minutes: number;
  room_url: string;
  suppressed: boolean;
  /** Offsets of the enabled before-the-session reminders, furthest out first. */
  before_offsets: number[];
  event_kind: string;
  starts_at: Date | null;
  location_type: string;
  location_address: string;
  recurrence_freq: RecurrenceFreq | null;
  recurrence_interval: number;
  recurrence_until: string | null;
  recurrence_count: number | null;
}

/**
 * Claims due reminders for this worker.
 *
 * Select and stamp in one statement, `SKIP LOCKED` so a second worker takes its
 * own batch rather than queueing behind this one. A row returned here is a row
 * nothing else is holding — which, with the unique index, is what makes "a
 * reminder must not fire twice" true rather than hoped for.
 */
async function claimDue(): Promise<DueSend[]> {
  const claimed = await pool.query<{ id: string }>(
    `WITH due AS (
       SELECT s.id
         FROM event_reminder_sends s
        WHERE s.status IN ('queued', 'failed')
          AND s.attempts < $2
          AND s.scheduled_for <= now()
        ORDER BY s.scheduled_for
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE event_reminder_sends s
        SET status = 'sending', attempts = s.attempts + 1, updated_at = now()
       FROM due
      WHERE s.id = due.id
      RETURNING s.id`,
    [SEND_BATCH, MAX_ATTEMPTS]
  );

  const ids = claimed.rows.map((row) => row.id);
  if (ids.length === 0) return [];

  // A second read for the detail: RETURNING cannot reach tables the UPDATE did
  // not touch, and the registrant's address, the event and the copy all live
  // elsewhere. (Naming them in the RETURNING clause is not a slow query, it is
  // a "missing FROM-clause entry" that fails the whole job.)
  const detail = await pool.query<DueSend>(
    `SELECT s.id, s.reminder_id, rem.kind, rem.offset_minutes, rem.subject, rem.body_md,
            s.scheduled_for, s.session_at, s.registration_id,
            r.email::text AS email, r.name, r.contact_id, r.member_id,
            e.id AS event_id, e.slug::text AS slug, e.title,
            COALESCE(NULLIF(e.timezone, ''), 'America/New_York') AS timezone,
            e.duration_minutes, e.room_url,
            EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email = r.email) AS suppressed,
            COALESCE((SELECT array_agg(b.offset_minutes ORDER BY b.offset_minutes DESC)
                        FROM event_reminders b
                       WHERE b.event_id = e.id AND b.enabled AND b.kind = 'before'),
                     '{}'::int[]) AS before_offsets,
            e.kind AS event_kind, e.starts_at, e.location_type, e.location_address,
            e.recurrence_freq, e.recurrence_interval,
            e.recurrence_until::text AS recurrence_until, e.recurrence_count
       FROM event_reminder_sends s
       JOIN event_reminders rem     ON rem.id = s.reminder_id
       JOIN event_registrations r   ON r.id = s.registration_id
       JOIN events e                ON e.id = s.event_id
      WHERE s.id = ANY($1::bigint[])`,
    [ids]
  );
  return detail.rows;
}

async function markSent(id: string, emailMessageId: number): Promise<void> {
  await pool.query(
    `UPDATE event_reminder_sends
        SET status = 'sent', email_message_id = $2, sent_at = now(), detail = '', updated_at = now()
      WHERE id = $1`,
    [id, emailMessageId]
  );
}

async function markFailed(id: string, detail: string): Promise<void> {
  await pool.query(
    `UPDATE event_reminder_sends
        SET status = 'failed', detail = $2, updated_at = now()
      WHERE id = $1`,
    [id, detail.slice(0, 1000)]
  );
}

async function markSkipped(id: string, detail: string): Promise<void> {
  await pool.query(
    `UPDATE event_reminder_sends
        SET status = 'skipped', detail = $2, updated_at = now()
      WHERE id = $1`,
    [id, detail.slice(0, 1000)]
  );
}

/** Puts a claim back without spending an attempt, for a row that is not due after all. */
async function releaseClaim(id: string): Promise<void> {
  await pool.query(
    `UPDATE event_reminder_sends
        SET status = 'queued', attempts = GREATEST(attempts - 1, 0), updated_at = now()
      WHERE id = $1 AND status = 'sending'`,
    [id]
  );
}

/* ---------------------------------------------------------------- the copy */

/**
 * The default wording for each step.
 *
 * Written out per step rather than generated from the offset, because the four
 * of them are doing four different jobs: confirming, giving somebody a day's
 * notice, giving them an hour's, and telling them the door is open. One
 * template with the time swapped in would say the same slightly-wrong thing
 * four times.
 */
/** "a", "a and b", "a, b and c". */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function defaultCopy(
  spec: ReminderSpec,
  ctx: {
    title: string;
    when: string;
    /** The before-the-session reminders this event really sends, in words. */
    reminderLabels?: string[];
    /** The address of an in-person event; empty or absent for an online one. */
    address?: string;
    /** "Every week, 6 sessions" for a series. */
    seriesLabel?: string;
  }
): { subject: string; body: string } {
  const address = ctx.address?.trim() ?? "";

  if (spec.kind === "registration") {
    // The promise names the reminders that are actually switched on. It used to
    // say "the day before and again an hour before" whatever the editor said,
    // which was true only until somebody turned one of them off.
    const labels = ctx.reminderLabels ?? [];
    const series = ctx.seriesLabel?.trim() ?? "";
    return {
      subject: `You're in: ${ctx.title}`,
      body: [
        `Hi {{firstName}},`,
        ``,
        series
          ? `You have a place at **${ctx.title}**. It repeats (${series.charAt(0).toLowerCase()}${series.slice(1)}), your place covers every session, and the first one is **${ctx.when}**.`
          : `You have a place at **${ctx.title}**, on **${ctx.when}**.`,
        ...(address ? [``, `It's in person, at **${address}**.`] : []),
        ...(labels.length > 0
          ? [``, `I'll email you ${joinWords(labels)}, so there is nothing to remember.`]
          : []),
        ...(address
          ? []
          : [`The doors open ${DOORS_OPEN_MINUTES} minutes early if you would like to settle in.`]),
        ``,
        address
          ? `[Add it to your calendar]({{calendarLink}})`
          : `[Your seat and joining link]({{joinLink}})`,
      ].join("\n"),
    };
  }

  if (spec.offsetMinutes === 0) {
    return {
      subject: `We're live: ${ctx.title}`,
      body: address
        ? [`Hi {{firstName}},`, ``, `We are starting now, at **${address}**. Come on in.`].join("\n")
        : [
            `Hi {{firstName}},`,
            ``,
            `We are starting now. Come on in.`,
            ``,
            `[Join ${ctx.title}]({{joinLink}})`,
          ].join("\n"),
    };
  }

  if (spec.offsetMinutes <= 120) {
    return {
      subject: `Starting soon: ${ctx.title}`,
      body: address
        ? [`Hi {{firstName}},`, ``, `We start at **${ctx.when}**, at **${address}**.`].join("\n")
        : [
            `Hi {{firstName}},`,
            ``,
            `We start at **${ctx.when}**. Here is your link — it opens ${DOORS_OPEN_MINUTES} minutes early.`,
            ``,
            `[Join ${ctx.title}]({{joinLink}})`,
          ].join("\n"),
    };
  }

  return {
    subject: `${describeReminderOffset(spec) === "1 day before" ? "Tomorrow" : "Coming up"}: ${ctx.title}`,
    body: [
      `Hi {{firstName}},`,
      ``,
      `Your seat is booked for **${ctx.when}**.${address ? ` It's in person, at **${address}**.` : ""} Nothing to prepare — bring a notebook and whatever is on your mind about your practice.`,
      ``,
      address ? `[Add it to your calendar]({{calendarLink}})` : `[Your joining link]({{joinLink}})`,
    ].join("\n"),
  };
}

/** One reminder, rendered. Exported so the editor can preview it. */
export function renderReminder(
  reminder: { kind: ReminderKind; offsetMinutes: number; subject: string; bodyMd: string },
  ctx: {
    title: string;
    sessionAt: Date;
    timezone: string;
    name: string;
    joinLink: string;
    /** The calendar file for this registration. */
    calendarLink?: string;
    /** The before-the-session reminders switched on for this event, in words. */
    reminderLabels?: string[];
    /** The address of an in-person event. */
    locationAddress?: string;
    /** "Every week, 6 sessions" for a series. */
    recurrenceLabel?: string;
  }
): { subject: string; text: string; html: string } {
  const spec: ReminderSpec = { kind: reminder.kind, offsetMinutes: reminder.offsetMinutes };
  const when = describeSession(ctx.sessionAt, ctx.timezone);
  const fallback = defaultCopy(spec, {
    title: ctx.title,
    when,
    reminderLabels: ctx.reminderLabels,
    address: ctx.locationAddress,
    seriesLabel: ctx.recurrenceLabel,
  });

  const tokens = {
    firstName: ctx.name.trim().split(/\s+/)[0] || "there",
    name: ctx.name.trim(),
    eventTitle: ctx.title,
    sessionLabel: when,
    joinLink: ctx.joinLink,
    calendarLink: ctx.calendarLink ?? "",
    location: ctx.locationAddress?.trim() ?? "",
    timezone: ctx.timezone,
    whenRelative: describeReminderOffset(spec),
  };

  const subject = renderTokens(reminder.subject.trim() || fallback.subject, tokens);
  const text = renderTokens(reminder.bodyMd.trim() || fallback.body, tokens);
  return { subject, text, html: renderMarkdown(text) };
}

/**
 * Sends every reminder that has come due.
 *
 * The verdict is asked again here, against the clock as it is at the moment of
 * sending rather than at the moment of planning. That second check is what
 * covers the gap the first one cannot: a row queued yesterday for a webinar
 * that has since happened, or a tick that took long enough for the session to
 * start while the batch was being worked through.
 */
export async function deliverDueReminders(now = new Date()): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const due = await claimDue();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of due) {
    const verdict = reminderVerdict({
      kind: row.kind,
      offsetMinutes: row.offset_minutes,
      scheduledFor: row.scheduled_for,
      sessionAt: row.session_at,
      durationMinutes: row.duration_minutes,
      now: new Date(),
    });

    if (verdict === "wait") {
      // Only reachable if the clock moved backwards under us. Put the claim
      // back rather than retiring a reminder that is still genuinely ahead.
      await releaseClaim(row.id);
      continue;
    }

    if (verdict === "skip") {
      await markSkipped(row.id, "its moment passed before the scheduler reached it");
      skipped += 1;
      continue;
    }

    if (!row.email) {
      await markSkipped(row.id, "the registration has no email address on it");
      skipped += 1;
      continue;
    }

    // A hard-bounced or complained address stays unmailed even on the
    // transactional path. The sending reputation is shared with every other
    // email the platform sends, and it is the reason nothing is being delivered
    // at all as this is written.
    if (row.suppressed) {
      await markSkipped(row.id, "this address is on the suppression list");
      skipped += 1;
      continue;
    }

    const ticket = signRegistration(Number(row.registration_id));
    const joinLink = `${env.publicSiteUrl}/events/${row.slug}/room?ticket=${ticket}`;
    const calendarLink = `${env.publicSiteUrl}/api/events/registrations/${ticket}/ics`;
    const rule: RecurrenceRule | null =
      row.event_kind === "live" && row.recurrence_freq && row.starts_at
        ? {
            freq: row.recurrence_freq,
            interval: row.recurrence_interval,
            until: row.recurrence_until,
            count: row.recurrence_count,
          }
        : null;

    const message = renderReminder(
      {
        kind: row.kind,
        offsetMinutes: row.offset_minutes,
        subject: row.subject,
        bodyMd: row.body_md,
      },
      {
        title: row.title,
        sessionAt: row.session_at,
        timezone: row.timezone,
        name: row.name,
        joinLink,
        calendarLink,
        reminderLabels: (row.before_offsets ?? []).map((offsetMinutes) =>
          describeReminderOffset({ kind: "before", offsetMinutes })
        ),
        locationAddress: row.location_type === "in_person" ? row.location_address : "",
        recurrenceLabel: describeRecurrence(rule),
      }
    );

    try {
      const result = await sendEmail({
        to: row.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        contactId: row.contact_id,
        memberId: row.member_id,
        // Transactional: they asked for this session, and a reminder somebody
        // opted out of is a seat they booked and were never told about. The
        // topic is still recorded, so the delivery log can be read by kind.
        sourceType: "transactional",
        sourceId: row.event_id,
        topic: "events",
      });

      if (result.outcome === "sent") {
        await markSent(row.id, result.messageId);
        sent += 1;
      } else {
        // The mail path declined it. Reporting this as sent is exactly the lie
        // this table exists to prevent.
        await markSkipped(row.id, result.suppressedReason || "the mail path declined it");
        skipped += 1;
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await markFailed(row.id, detail);
      failed += 1;
      // One rejected address must not cost the rest of the batch its reminders.
      console.error(
        `[events] reminder ${row.id} to ${row.email} failed:`,
        detail
      );
    }
  }

  return { sent, failed, skipped };
}

/**
 * One tick: retire, plan, send.
 *
 * The order matters and is asserted by a test. Retiring first means a backlog
 * that built up while nothing was running is marked skipped *before* anything
 * tries to send it, so a scheduler restart cannot blast past-due reminders.
 */
export async function runReminderTick(now = new Date()): Promise<Record<string, number>> {
  const reclaimed = await reclaimStuckSends();
  const retired = await sweepUnsendable();
  const planned = await materializeReminderSends(now);
  const delivered = await deliverDueReminders(now);

  return {
    reclaimed,
    retired,
    planned: planned.queued,
    plannedSkipped: planned.skipped,
    sent: delivered.sent,
    failed: delivered.failed,
    skipped: delivered.skipped,
  };
}

/**
 * Asks for this registrant's reminders to be planned and their confirmation
 * sent now, rather than on the next five-minute tick.
 *
 * A queued job rather than inline work: a registration must not wait on SMTP to
 * answer, and a provider that is timing out must not turn a successful signup
 * into a 500 the visitor retries. Transactional priority, so it runs ahead of
 * any bulk sending, and dedupe-keyed on the registration so a double-submitted
 * form asks once.
 *
 * The job it queues is the ordinary tick, and the tick is idempotent: doing
 * this and then the schedule doing it again sends one email, not two, because
 * the unique index and the claim decide, not the caller.
 */
export async function requestReminderTick(registrationId: number): Promise<void> {
  try {
    await enqueue({
      kind: "events.reminders",
      priority: PRIORITY.transactional,
      dedupeKey: `event-reminder-tick:${registrationId}`,
    });
  } catch (err) {
    // The five-minute schedule is the backstop, so a queue hiccup costs a
    // prompt confirmation rather than the registration itself.
    console.error(
      "[events] could not queue the reminder tick:",
      err instanceof Error ? err.message : err
    );
  }
}
