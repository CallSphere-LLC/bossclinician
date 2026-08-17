import { pool } from "../db/pool";
import { renderMarkdown, renderTokens, sendEmail } from "../email/provider";
import { PRIORITY, enqueueMany } from "../jobs/queue";
import { zonedWallClockToUtc } from "./drip";
import { applyTags, recordActivity } from "./contacts";

/**
 * Email sequences: enrolment, the due-work tick, and the arithmetic behind
 * "when does email 4 actually go out".
 *
 * The scheduling half is pure and exported, because it is the half that is easy
 * to get wrong in a way nobody notices for six weeks. Three rules compose here —
 * a delay measured from the previous email, a weekday-only rule, and a
 * send-window — and every one of them can push a send across a day boundary, a
 * weekend, or a daylight-saving transition in the reader's own zone.
 *
 * The DST-critical conversion is `zonedWallClockToUtc` from the drip engine,
 * reused rather than rewritten. "9am in the contact's timezone" is the same
 * problem as "this lesson unlocks at 6am", and a second implementation would be
 * a second thing to get wrong twice a year.
 */

/* -------------------------------------------------------------- scheduling */

export interface SequenceSendRules {
  skipWeekends: boolean;
  /** Minutes past midnight in `timezone`. null on either end disables the window. */
  windowStartMinute: number | null;
  windowEndMinute: number | null;
  timezone: string;
}

interface ZonedReading {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday. */
  weekday: number;
  minuteOfDay: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The wall-clock reading, and which day of the week it is, in `timeZone`. */
function readInZone(date: Date, timeZone: string): ZonedReading {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 1,
    minuteOfDay: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** A wall-clock instant `dayOffset` days on from a reading, in the same zone. */
function atZonedDay(
  reading: ZonedReading,
  dayOffset: number,
  minuteOfDay: number,
  timeZone: string
): Date {
  // Day overflow is normalised by Date.UTC inside zonedWallClockToUtc, so
  // "the 31st plus two days" needs no calendar arithmetic here.
  return zonedWallClockToUtc(
    reading.year,
    reading.month,
    reading.day + dayOffset,
    minuteOfDay,
    timeZone
  );
}

function hasWindow(rules: SequenceSendRules): boolean {
  return rules.windowStartMinute !== null && rules.windowEndMinute !== null;
}

/** Whether a local time-of-day falls inside the window, wrapping past midnight if asked. */
function insideWindow(minuteOfDay: number, start: number, end: number): boolean {
  return start <= end
    ? minuteOfDay >= start && minuteOfDay <= end
    : minuteOfDay >= start || minuteOfDay <= end;
}

/**
 * When the next email in a sequence should go out.
 *
 * The delay runs from `from` — the moment the previous email was sent, or
 * enrolment for the first one — and the result is then nudged forward until it
 * lands on a day and an hour the sequence is allowed to send on. Nudged
 * forward, never back: an email that was due at 8am with a 9am-to-5pm window
 * goes at 9am the same day, and one due at 7pm goes at 9am tomorrow. Sending
 * early is the one direction that surprises the reader.
 */
export function nextSendAt(
  from: Date,
  delayMinutes: number,
  rules: SequenceSendRules
): Date {
  let candidate = new Date(from.getTime() + Math.max(0, delayMinutes) * 60_000);

  const start = rules.windowStartMinute;
  const end = rules.windowEndMinute;
  const windowed = hasWindow(rules) && start !== null && end !== null;

  // Each pass moves the candidate strictly forward by at least a few hours, so
  // the bound is never reached; it exists so a zone or a rule this code has not
  // imagined cannot spin a worker forever.
  for (let pass = 0; pass < 32; pass += 1) {
    const reading = readInZone(candidate, rules.timezone);

    if (rules.skipWeekends && (reading.weekday === 0 || reading.weekday === 6)) {
      const daysToMonday = reading.weekday === 6 ? 2 : 1;
      // Monday at the window's opening minute, or at the same local hour when
      // the sequence has no window of its own.
      const minute = windowed && start !== null ? start : reading.minuteOfDay;
      candidate = atZonedDay(reading, daysToMonday, minute, rules.timezone);
      continue;
    }

    if (windowed && start !== null && end !== null && !insideWindow(reading.minuteOfDay, start, end)) {
      // Being outside a wrapping window (22:00–06:00) can only mean the gap in
      // the middle of the day, so the next opening is always this evening. An
      // ordinary window is missed either before it opens or after it shuts.
      const sameDay = start <= end ? reading.minuteOfDay < start : true;
      candidate = atZonedDay(reading, sameDay ? 0 : 1, start, rules.timezone);
      continue;
    }

    return candidate;
  }

  return candidate;
}

/* --------------------------------------------------------------- data types */

interface SequenceRow {
  id: number;
  name: string;
  status: string;
  topic: string;
  skip_weekends: boolean;
  send_window_start_minute: number | null;
  send_window_end_minute: number | null;
  use_contact_timezone: boolean;
  timezone: string;
  exit_on_purchase: boolean;
  exit_tag_id: number | null;
  completion_tag_id: number | null;
  allow_reentry: boolean;
}

const SEQUENCE_COLUMNS = `id, name, status, topic, skip_weekends,
  send_window_start_minute, send_window_end_minute, use_contact_timezone, timezone,
  exit_on_purchase, exit_tag_id, completion_tag_id, allow_reentry`;

function rulesFor(sequence: SequenceRow, contactTimezone: string): SequenceSendRules {
  return {
    skipWeekends: sequence.skip_weekends,
    windowStartMinute: sequence.send_window_start_minute,
    windowEndMinute: sequence.send_window_end_minute,
    timezone:
      sequence.use_contact_timezone && contactTimezone ? contactTimezone : sequence.timezone,
  };
}

/* -------------------------------------------------------------- enrolment */

export type EnrollOutcome = "enrolled" | "already_enrolled" | "blocked";

export interface EnrollResult {
  subscriptionId: number | null;
  outcome: EnrollOutcome;
  reason: string;
}

/**
 * Puts a contact into a sequence and schedules the first email.
 *
 * `allow_reentry` is enforced here rather than by the UNIQUE index alone: the
 * index stops two live runs, but "may this person go through the welcome
 * sequence a second time" is a decision about a run that has already ended, and
 * the answer is usually no.
 */
export async function enrollContact(
  sequenceId: number,
  contactId: number,
  options: { reason?: string; now?: Date } = {}
): Promise<EnrollResult> {
  const now = options.now ?? new Date();

  const sequenceRes = await pool.query<SequenceRow>(
    `SELECT ${SEQUENCE_COLUMNS} FROM email_sequences WHERE id = $1`,
    [sequenceId]
  );
  const sequence = sequenceRes.rows[0];
  if (!sequence) return { subscriptionId: null, outcome: "blocked", reason: "no such sequence" };
  if (sequence.status !== "active") {
    return { subscriptionId: null, outcome: "blocked", reason: "sequence is not active" };
  }

  const contactRes = await pool.query<{ timezone: string }>(
    `SELECT timezone FROM contacts WHERE id = $1`,
    [contactId]
  );
  const contact = contactRes.rows[0];
  if (!contact) return { subscriptionId: null, outcome: "blocked", reason: "no such contact" };

  const firstRes = await pool.query<{ position: number; delay_minutes: number }>(
    `SELECT position, delay_minutes FROM sequence_emails
      WHERE sequence_id = $1 AND enabled
      ORDER BY position LIMIT 1`,
    [sequenceId]
  );
  const first = firstRes.rows[0];
  if (!first) return { subscriptionId: null, outcome: "blocked", reason: "sequence has no emails" };

  const existingRes = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM sequence_subscriptions WHERE sequence_id = $1 AND contact_id = $2`,
    [sequenceId, contactId]
  );
  const existing = existingRes.rows[0];
  if (existing) {
    if (existing.status === "active" || existing.status === "paused") {
      return { subscriptionId: Number(existing.id), outcome: "already_enrolled", reason: "" };
    }
    if (!sequence.allow_reentry) {
      return {
        subscriptionId: Number(existing.id),
        outcome: "blocked",
        reason: "already been through this sequence",
      };
    }
  }

  const sendAt = nextSendAt(now, first.delay_minutes, rulesFor(sequence, contact.timezone));

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO sequence_subscriptions
       (sequence_id, contact_id, status, position, next_send_at, entered_at)
     VALUES ($1, $2, 'active', $3, $4, now())
     ON CONFLICT (sequence_id, contact_id) DO UPDATE
       SET status = 'active', position = EXCLUDED.position,
           next_send_at = EXCLUDED.next_send_at, exit_reason = '',
           entered_at = now(), completed_at = NULL, updated_at = now()
     RETURNING id`,
    [sequenceId, contactId, first.position, sendAt]
  );

  await recordActivity({
    contactId,
    kind: "sequence_started",
    title: `Started the ${sequence.name} sequence`,
    body: options.reason ?? "",
    subjectType: "sequence",
    subjectId: String(sequenceId),
  });

  return { subscriptionId: Number(inserted.rows[0].id), outcome: "enrolled", reason: "" };
}

/** Ends a contact's run through one sequence. Silent when they were not in it. */
export async function exitContact(
  sequenceId: number,
  contactId: number,
  options: { reason?: string; status?: "exited" | "cancelled" | "completed" } = {}
): Promise<boolean> {
  const res = await pool.query<{ id: string }>(
    `UPDATE sequence_subscriptions
        SET status = $3, exit_reason = $4, next_send_at = NULL,
            completed_at = now(), updated_at = now()
      WHERE sequence_id = $1 AND contact_id = $2 AND status IN ('active', 'paused')
      RETURNING id`,
    [sequenceId, contactId, options.status ?? "exited", (options.reason ?? "").slice(0, 200)]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Takes a buyer out of every sequence that was still selling to them.
 *
 * Called from the purchase path. Continuing to send "here is why you should
 * buy this" to somebody who bought it an hour ago is the single fastest way to
 * earn an unsubscribe, which is why `exit_on_purchase` defaults to true.
 */
export async function exitContactOnPurchase(
  contactId: number,
  reason = "bought something"
): Promise<number> {
  const res = await pool.query(
    `UPDATE sequence_subscriptions s
        SET status = 'exited', exit_reason = $2, next_send_at = NULL,
            completed_at = now(), updated_at = now()
       FROM email_sequences q
      WHERE q.id = s.sequence_id
        AND s.contact_id = $1
        AND s.status = 'active'
        AND q.exit_on_purchase`,
    [contactId, reason.slice(0, 200)]
  );
  return res.rowCount ?? 0;
}

/* ------------------------------------------------------------------- tick */

/** How many due subscriptions one tick will pick up. */
const TICK_BATCH = 500;

/**
 * Queues a send for every subscription that has come due.
 *
 * The tick queues rather than sends: a thousand due emails inside one job would
 * hold a lease for minutes and lose everything if the process died halfway. The
 * dedupe key carries the position, so a tick overlapping the previous one
 * cannot queue the same email twice, while the same subscription's *next*
 * email is free to be queued later.
 */
export async function tickDueSubscriptions(now: Date = new Date()): Promise<{ queued: number }> {
  const due = await pool.query<{ id: string; position: number }>(
    `SELECT s.id, s.position
       FROM sequence_subscriptions s
       JOIN email_sequences q ON q.id = s.sequence_id
      WHERE s.status = 'active'
        AND s.next_send_at IS NOT NULL
        AND s.next_send_at <= $1
        AND q.status = 'active'
      ORDER BY s.next_send_at
      LIMIT $2`,
    [now, TICK_BATCH]
  );

  const queued = await enqueueMany(
    due.rows.map((row) => ({
      kind: "sequence.sendEmail",
      payload: { subscriptionId: Number(row.id) },
      priority: PRIORITY.bulk,
      dedupeKey: `sequence-send:${row.id}:${row.position}`,
    }))
  );

  return { queued };
}

/* -------------------------------------------------------------- sending */

export type SendStepOutcome =
  | "sent"
  | "suppressed"
  | "completed"
  | "exited"
  | "not_due"
  | "skipped";

export interface SendStepResult {
  outcome: SendStepOutcome;
  detail: string;
  /** Set on every outcome that touched a real subscription, for the caller's trigger fan-out. */
  sequenceId: number | null;
  contactId: number | null;
}

function greetingName(name: string, firstName: string): string {
  if (firstName.trim()) return firstName.trim();
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}

/**
 * Sends the email a subscription is currently sitting on, then advances it.
 *
 * The whole step runs inside one transaction with the subscription row locked,
 * and the send happens while that lock is held. That is deliberate: the lock is
 * the only thing standing between two workers and the same email arriving
 * twice, and a failed send rolls the position back so the job's own retry does
 * the right thing rather than skipping an email nobody ever received.
 */
export async function sendDueEmail(
  subscriptionId: number,
  now: Date = new Date()
): Promise<SendStepResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const subRes = await client.query<{
      id: string;
      sequence_id: number;
      contact_id: number;
      status: string;
      position: number;
      next_send_at: Date | null;
    }>(
      `SELECT id, sequence_id, contact_id, status, position, next_send_at
         FROM sequence_subscriptions WHERE id = $1 FOR UPDATE`,
      [subscriptionId]
    );
    const subscription = subRes.rows[0];
    if (!subscription || subscription.status !== "active") {
      await client.query("COMMIT");
      return { outcome: "not_due", detail: "no longer active", sequenceId: null, contactId: null };
    }
    if (subscription.next_send_at === null || subscription.next_send_at.getTime() > now.getTime()) {
      await client.query("COMMIT");
      return {
        outcome: "not_due",
        detail: "not due yet",
        sequenceId: subscription.sequence_id,
        contactId: subscription.contact_id,
      };
    }

    const sequenceRes = await client.query<SequenceRow>(
      `SELECT ${SEQUENCE_COLUMNS} FROM email_sequences WHERE id = $1`,
      [subscription.sequence_id]
    );
    const sequence = sequenceRes.rows[0];
    if (!sequence || sequence.status !== "active") {
      await client.query("COMMIT");
      return {
        outcome: "not_due",
        detail: "sequence is not active",
        sequenceId: subscription.sequence_id,
        contactId: subscription.contact_id,
      };
    }

    const contactRes = await client.query<{
      email: string;
      name: string;
      first_name: string;
      timezone: string;
      email_marketing_status: string;
    }>(
      `SELECT email, name, first_name, timezone, email_marketing_status
         FROM contacts WHERE id = $1`,
      [subscription.contact_id]
    );
    const contact = contactRes.rows[0];
    if (!contact) {
      await client.query(
        `UPDATE sequence_subscriptions
            SET status = 'cancelled', exit_reason = 'contact removed',
                next_send_at = NULL, updated_at = now()
          WHERE id = $1`,
        [subscription.id]
      );
      await client.query("COMMIT");
      return {
        outcome: "exited",
        detail: "contact removed",
        sequenceId: subscription.sequence_id,
        contactId: subscription.contact_id,
      };
    }

    // The exit tag is checked at send time rather than when it is applied, so a
    // tag added by any route at all — import, automation, Yvette by hand — takes
    // the contact out before the next email rather than after it.
    if (sequence.exit_tag_id !== null) {
      const tagged = await client.query(
        `SELECT 1 FROM contact_tags WHERE contact_id = $1 AND tag_id = $2`,
        [subscription.contact_id, sequence.exit_tag_id]
      );
      if ((tagged.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE sequence_subscriptions
              SET status = 'exited', exit_reason = 'exit tag applied',
                  next_send_at = NULL, completed_at = now(), updated_at = now()
            WHERE id = $1`,
          [subscription.id]
        );
        await client.query("COMMIT");
        return {
          outcome: "exited",
          detail: "exit tag applied",
          sequenceId: subscription.sequence_id,
          contactId: subscription.contact_id,
        };
      }
    }

    const emailRes = await client.query<{
      id: number;
      position: number;
      subject: string;
      body_md: string;
      from_name: string;
      from_email: string;
    }>(
      `SELECT id, position, subject, body_md, from_name, from_email
         FROM sequence_emails
        WHERE sequence_id = $1 AND enabled AND position >= $2
        ORDER BY position LIMIT 1`,
      [subscription.sequence_id, subscription.position]
    );
    const email = emailRes.rows[0];

    if (!email) {
      await finishSubscription(client, subscription.id, subscription.contact_id, sequence);
      await client.query("COMMIT");
      return {
        outcome: "completed",
        detail: "no further emails",
        sequenceId: subscription.sequence_id,
        contactId: subscription.contact_id,
      };
    }

    const values = {
      firstName: greetingName(contact.name, contact.first_name),
      name: contact.name || contact.email,
      email: contact.email,
    };

    const result = await sendEmail({
      to: contact.email,
      subject: renderTokens(email.subject, values),
      text: renderTokens(email.body_md, values),
      html: renderMarkdown(renderTokens(email.body_md, values)),
      contactId: subscription.contact_id,
      sourceType: "sequence",
      sourceId: subscription.sequence_id,
      topic: sequence.topic,
      fromName: email.from_name,
      fromEmail: email.from_email,
    });

    // Advance regardless of a suppression: a contact who has opted out is not
    // going to become eligible for email 4 by being left stuck on email 3, and
    // leaving them due forever makes every tick re-queue them.
    const nextRes = await client.query<{ position: number; delay_minutes: number }>(
      `SELECT position, delay_minutes FROM sequence_emails
        WHERE sequence_id = $1 AND enabled AND position > $2
        ORDER BY position LIMIT 1`,
      [subscription.sequence_id, email.position]
    );
    const next = nextRes.rows[0];

    if (!next) {
      await finishSubscription(client, subscription.id, subscription.contact_id, sequence);
      await client.query("COMMIT");
      return {
        outcome: result.outcome === "suppressed" ? "suppressed" : "completed",
        detail: result.suppressedReason,
        sequenceId: subscription.sequence_id,
        contactId: subscription.contact_id,
      };
    }

    await client.query(
      `UPDATE sequence_subscriptions
          SET position = $2, next_send_at = $3, updated_at = now()
        WHERE id = $1`,
      [
        subscription.id,
        next.position,
        nextSendAt(now, next.delay_minutes, rulesFor(sequence, contact.timezone)),
      ]
    );

    await client.query("COMMIT");
    return {
      outcome: result.outcome === "suppressed" ? "suppressed" : "sent",
      detail: result.suppressedReason,
      sequenceId: subscription.sequence_id,
      contactId: subscription.contact_id,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

type Queryable = { query: typeof pool.query };

/** Marks a run finished and applies the sequence's completion tag. */
async function finishSubscription(
  client: Queryable,
  subscriptionId: string,
  contactId: number,
  sequence: SequenceRow
): Promise<void> {
  await client.query(
    `UPDATE sequence_subscriptions
        SET status = 'completed', next_send_at = NULL, completed_at = now(), updated_at = now()
      WHERE id = $1`,
    [subscriptionId]
  );

  if (sequence.completion_tag_id !== null) {
    const tag = await client.query<{ slug: string }>(`SELECT slug FROM tags WHERE id = $1`, [
      sequence.completion_tag_id,
    ]);
    const slug = tag.rows[0]?.slug;
    if (slug) await applyTags(contactId, [slug], `sequence:${sequence.id}`);
  }

  await recordActivity({
    contactId,
    kind: "sequence_completed",
    title: `Finished the ${sequence.name} sequence`,
    subjectType: "sequence",
    subjectId: String(sequence.id),
  });
}

/** The completion trigger's fan-out point, so the engine does not import the tick. */
export async function completedSequenceIds(contactId: number): Promise<number[]> {
  const res = await pool.query<{ sequence_id: number }>(
    `SELECT sequence_id FROM sequence_subscriptions
      WHERE contact_id = $1 AND status = 'completed'`,
    [contactId]
  );
  return res.rows.map((r) => r.sequence_id);
}
