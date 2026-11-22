import { pool } from "../db/pool";
import { buildMergeValues } from "../email/mergeValues";
import { mergeLinks, renderMarkdown, renderTokens, sendEmail } from "../email/provider";
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
  /**
   * Minutes past midnight in `timezone` that every delayed email goes out at
   * ("9 a.m. Pacific"). null leaves the delay as an exact duration. A zero
   * delay is never moved: "immediately" stays immediately. When set, it takes
   * the place of the send window.
   */
  sendAtMinute?: number | null;
}

/**
 * How far before `from + delay` a fixed send time may land (rows 243/244/246).
 *
 * "Day 1 at 9 a.m." for somebody who registered at 2 p.m. is 9 a.m. tomorrow,
 * 19 hours on, not 9 a.m. the day after: the send time is the nearest one to
 * the exact delay, never more than half a day early and never more than half
 * the delay early. Once a sequence is on its 9 a.m. rhythm every gap is a whole
 * number of days, so the "24 hours between promotional emails" rule holds from
 * the second delayed email on.
 */
const SEND_AT_MAX_EARLY_MINUTES = 12 * 60;

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

/** The fixed send minute when it is a real time of day, otherwise null. */
function fixedSendMinute(rules: SequenceSendRules): number | null {
  const minute = rules.sendAtMinute;
  return typeof minute === "number" && Number.isInteger(minute) && minute >= 0 && minute < 1440
    ? minute
    : null;
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
  const delay = Math.max(0, delayMinutes);
  let candidate = new Date(from.getTime() + delay * 60_000);

  const sendAt = fixedSendMinute(rules);
  if (sendAt !== null && delay > 0) {
    const earliest = new Date(
      candidate.getTime() - Math.min(SEND_AT_MAX_EARLY_MINUTES, delay / 2) * 60_000
    );
    const reading = readInZone(earliest, rules.timezone);
    candidate = atZonedDay(reading, 0, sendAt, rules.timezone);
    if (candidate.getTime() < earliest.getTime()) {
      candidate = atZonedDay(reading, 1, sendAt, rules.timezone);
    }
  }

  const start = rules.windowStartMinute;
  const end = rules.windowEndMinute;
  // A fixed send time replaces the window; the weekend rule still applies and,
  // with no window, keeps the local hour — which is the send time.
  const windowed = sendAt === null && hasWindow(rules) && start !== null && end !== null;

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
  /** Emails only for people who still hold this offer (migration 182). */
  requires_offer_id: number | null;
  /** Every delayed email goes at this local minute (migration 202). */
  send_at_minute?: number | null;
}

const SEQUENCE_COLUMNS = `id, name, status, topic, skip_weekends,
  send_window_start_minute, send_window_end_minute, use_contact_timezone, timezone,
  exit_on_purchase, exit_tag_id, completion_tag_id, allow_reentry, requires_offer_id,
  send_at_minute`;

function rulesFor(sequence: SequenceRow, contactTimezone: string): SequenceSendRules {
  return {
    skipWeekends: sequence.skip_weekends,
    windowStartMinute: sequence.send_window_start_minute,
    windowEndMinute: sequence.send_window_end_minute,
    timezone:
      sequence.use_contact_timezone && contactTimezone ? contactTimezone : sequence.timezone,
    sendAtMinute: sequence.send_at_minute ?? null,
  };
}

/* ------------------------------------------------------------ skip rules */

/**
 * Per-email "skip this one if…" (rows 243, 244, 246; migration 202).
 *
 * Stored on `sequence_emails.skip_rules` as
 * `{ "ownsOfferIds": [..], "submittedFormIds": [..], "hasTagIds": [..] }`.
 * Any one match skips the email: nothing is sent, and the run moves on to the
 * next email on that email's own delay, measured from the skip. A downsell is
 * not sent to somebody who already bought the downsell; a "register for the
 * training" invitation is not sent to somebody who already registered.
 *
 * Unlike an exit, a skip leaves the rest of the sequence in place: a Starter
 * Suite buyer still gets the Club emails, just not the Starter Suite ones.
 */
export interface EmailSkipRules {
  ownsOfferIds: number[];
  submittedFormIds: number[];
  hasTagIds: number[];
}

function positiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v))
    .filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0);
  return [...new Set(ids)];
}

/** Reads whatever is in the column; anything it cannot read is "no rule". */
export function parseSkipRules(raw: unknown): EmailSkipRules {
  const source: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    ownsOfferIds: positiveIds(source.ownsOfferIds),
    submittedFormIds: positiveIds(source.submittedFormIds),
    hasTagIds: positiveIds(source.hasTagIds),
  };
}

export function hasSkipRules(rules: EmailSkipRules): boolean {
  return rules.ownsOfferIds.length + rules.submittedFormIds.length + rules.hasTagIds.length > 0;
}

/**
 * Why this contact should not get the email, or '' when they should.
 *
 * Offers are matched on the contact link or the address, as `requires_offer_id`
 * is: a buyer whose member row is not linked to this contact still owns the
 * offer. Ownership is an active, unexpired grant. Forms are matched on the
 * contact or the address the submission was made with.
 */
async function skipReason(
  client: Queryable,
  rules: EmailSkipRules,
  contactId: number,
  email: string
): Promise<string> {
  if (rules.ownsOfferIds.length > 0) {
    const owns = await client.query<{ offer_id: number }>(
      `SELECT g.offer_id FROM access_grants g
         JOIN members m ON m.id = g.member_id
        WHERE g.offer_id = ANY($1::int[]) AND g.status = 'active'
          AND (g.expires_at IS NULL OR g.expires_at > now())
          AND (m.contact_id = $2 OR lower(m.email::text) = lower($3))
        LIMIT 1`,
      [rules.ownsOfferIds, contactId, email]
    );
    if (owns.rows[0]) return `owns offer ${owns.rows[0].offer_id}`;
  }
  if (rules.submittedFormIds.length > 0) {
    const submitted = await client.query<{ form_id: number }>(
      `SELECT form_id FROM form_submissions
        WHERE form_id = ANY($1::int[])
          AND (contact_id = $2 OR lower(email::text) = lower($3))
        LIMIT 1`,
      [rules.submittedFormIds, contactId, email]
    );
    if (submitted.rows[0]) return `submitted form ${submitted.rows[0].form_id}`;
  }
  if (rules.hasTagIds.length > 0) {
    const tagged = await client.query<{ tag_id: number }>(
      `SELECT tag_id FROM contact_tags WHERE contact_id = $1 AND tag_id = ANY($2::int[]) LIMIT 1`,
      [contactId, rules.hasTagIds]
    );
    if (tagged.rows[0]) return `has tag ${tagged.rows[0].tag_id}`;
  }
  return "";
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
  options: {
    reason?: string;
    now?: Date;
    /** Join at this email rather than the first; earlier ones are never sent. */
    startAtPosition?: number;
    /**
     * The purchase that started this run (QA row 230). Given, the run ends when
     * that purchase does — refund, revoked access, a defaulted plan, a
     * subscription whose access has ended — and holds while its renewal is
     * failing. Omitted, the run is not tied to any purchase.
     */
    source?: { offerId: number | null; orderId: number | null };
  } = {}
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
      WHERE sequence_id = $1 AND enabled AND position >= $2
      ORDER BY position LIMIT 1`,
    [sequenceId, options.startAtPosition ?? 0]
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

  // A re-entry replaces the purchase stamp too, cleared when this run has none:
  // a second run must never inherit the refund of the purchase that started the
  // first.
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO sequence_subscriptions
       (sequence_id, contact_id, status, position, next_send_at, entered_at,
        source_offer_id, source_order_id)
     VALUES ($1, $2, 'active', $3, $4, now(), $5, $6)
     ON CONFLICT (sequence_id, contact_id) DO UPDATE
       SET status = 'active', position = EXCLUDED.position,
           next_send_at = EXCLUDED.next_send_at, exit_reason = '',
           entered_at = now(), completed_at = NULL, updated_at = now(),
           source_offer_id = EXCLUDED.source_offer_id,
           source_order_id = EXCLUDED.source_order_id
     RETURNING id`,
    [
      sequenceId,
      contactId,
      first.position,
      sendAt,
      positiveIdOrNull(options.source?.offerId),
      positiveIdOrNull(options.source?.orderId),
    ]
  );

  // An email due now (delay 0, no send window in the way) is queued straight
  // away rather than left for the 5-minute sequence tick. A quiz result or a
  // welcome email is expected the moment the page says "on its way" (QA row
  // 228). Same dedupe key as the tick, so the tick cannot queue it a second
  // time, and sendDueEmail re-checks next_send_at under the row lock. Never
  // fails the enrolment: the tick still picks it up if this cannot be queued.
  if (sendAt.getTime() <= now.getTime()) {
    const subscriptionId = inserted.rows[0].id;
    await enqueueMany([
      {
        kind: "sequence.sendEmail",
        payload: { subscriptionId: Number(subscriptionId) },
        priority: PRIORITY.normal,
        dedupeKey: `sequence-send:${subscriptionId}:${first.position}`,
      },
    ]).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`[sequences] immediate send for subscription ${subscriptionId} not queued:`, err);
    });
  }

  await recordActivity({
    contactId,
    kind: "sequence_started",
    title: `Started the ${sequence.name} sequence`,
    body: options.reason ?? "",
    subjectType: "sequence",
    subjectId: String(sequenceId),
  });

  await publishSequenceEvent("sequence_subscribed", {
    subscriptionId: inserted.rows[0].id,
    sequenceId,
    contactId,
    reason: options.reason ?? "",
  });

  return { subscriptionId: Number(inserted.rows[0].id), outcome: "enrolled", reason: "" };
}

/**
 * Tells the automation engine somebody joined, or left, a sequence.
 *
 * The import is lazy on purpose. `domainEvents` imports the engine and the
 * engine imports this file (it enrols people), so a static import here closes a
 * cycle — the same one the completion trigger avoids by firing from the job
 * instead. Enrolment and exit have too many callers for that, so the module is
 * loaded at the moment of the call, by which time all three are initialised.
 *
 * Never throws: the subscription row is already written, and a trigger that
 * could not be queued is not a reason to tell the caller the enrolment failed.
 */
async function publishSequenceEvent(
  trigger: "sequence_subscribed" | "sequence_unsubscribed",
  input: { subscriptionId: string | number; sequenceId: number; contactId: number; reason: string }
): Promise<void> {
  try {
    const { publishDomainEvent } = await import("./domainEvents");
    await publishDomainEvent(trigger, {
      // One subscription row is reused when somebody re-enters, so the row id
      // alone would collapse their second run into their first.
      eventKey: `${trigger.replace("_", "-")}:subscription:${input.subscriptionId}:${Date.now()}`,
      contactId: input.contactId,
      subjectId: input.sequenceId,
      source: "sequence",
      facts: { reason: input.reason.slice(0, 200) },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[sequences] ${trigger} for subscription ${input.subscriptionId} not published:`, err);
  }
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
  const row = res.rows[0];
  // Finishing is its own trigger; only a run that was cut short is "left".
  if (row && (options.status ?? "exited") !== "completed") {
    await publishSequenceEvent("sequence_unsubscribed", {
      subscriptionId: row.id,
      sequenceId,
      contactId,
      reason: options.reason ?? "",
    });
  }
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
  reason = "bought something",
  /**
   * Which offer was bought. Given, the specific rules apply too; omitted, only
   * the global switch does — which is what a legacy caller gets, unchanged.
   */
  offerId: number | null = null
): Promise<number> {
  const res = await pool.query<{ id: string; sequence_id: number }>(
    `UPDATE sequence_subscriptions s
        SET status = 'exited', exit_reason = $2, next_send_at = NULL,
            completed_at = now(), updated_at = now()
       FROM email_sequences q
      WHERE q.id = s.sequence_id
        AND s.contact_id = $1
        AND s.status = 'active'
        AND (
          -- The blunt global switch, still the right answer for a welcome
          -- sequence that should stop the moment somebody becomes a customer.
          q.exit_on_purchase
          -- Or a rule naming this offer specifically (3.7). A sequence selling
          -- the toolkit should stop when somebody buys the toolkit, and keep
          -- going when they buy a $7 bump.
          OR ($3::int IS NOT NULL AND EXISTS (
                SELECT 1 FROM sequence_exclude_offers x
                 WHERE x.sequence_id = q.id AND x.offer_id = $3
              ))
        )
      RETURNING s.id, s.sequence_id`,
    [contactId, reason.slice(0, 200), offerId]
  );
  for (const row of res.rows) {
    await publishSequenceEvent("sequence_unsubscribed", {
      subscriptionId: row.id,
      sequenceId: row.sequence_id,
      contactId,
      reason,
    });
  }
  return res.rowCount ?? 0;
}

/**
 * Takes somebody out of the sequences that named the form they just submitted.
 *
 * The mirror of the offer rule and the reason 3.7 asks for both: a sequence
 * whose whole job is to get somebody to book a call has nothing left to say
 * once they have booked it, and the global purchase switch never fires because
 * no money moved.
 */
export async function exitContactOnFormSubmission(
  contactId: number,
  formId: number,
  reason = "filled in a form"
): Promise<number> {
  const res = await pool.query<{ id: string; sequence_id: number }>(
    `UPDATE sequence_subscriptions s
        SET status = 'exited', exit_reason = $3, next_send_at = NULL,
            completed_at = now(), updated_at = now()
       FROM email_sequences q
      WHERE q.id = s.sequence_id
        AND s.contact_id = $1
        AND s.status = 'active'
        AND EXISTS (
          SELECT 1 FROM sequence_exclude_forms x
           WHERE x.sequence_id = q.id AND x.form_id = $2
        )
      RETURNING s.id, s.sequence_id`,
    [contactId, formId, reason.slice(0, 200)]
  );
  for (const row of res.rows) {
    await publishSequenceEvent("sequence_unsubscribed", {
      subscriptionId: row.id,
      sequenceId: row.sequence_id,
      contactId,
      reason,
    });
  }
  return res.rowCount ?? 0;
}

/* ------------------------------------------------ purchase-started runs */

/**
 * QA row 230: a sequence a purchase started ends when that purchase does.
 *
 * "Ends" needs positive evidence, never the mere absence of an active grant:
 * access that simply ran its course, or an offer that grants nothing tied to
 * the offer, is not a cancellation, and reading it as one would cut real
 * buyers off. The evidence is a refunded order, or a grant for the offer that
 * was taken away (refund, revoke, a defaulted plan, a subscription whose access
 * ended, retries exhausted) — and in either case no other live access to the
 * same offer, so somebody who bought it twice keeps their emails.
 *
 * A failing renewal is not an ending. Stripe and PayPal retry, and with
 * re-entry off a customer who pays two days later would lose the sequence for
 * good, so the run is held and picks up where it was once the payment clears.
 *
 * Mirrors `dunning.FAILED_PAYMENT_REVOKE_REASON`, the revoke reason the
 * "stop access on the first failed payment" pause writes and `invoice.paid`
 * restores from. Copied rather than imported so this module does not pull in
 * the Stripe client; sequences.test.ts pins the two together.
 */
export const PAYMENT_PAUSE_REVOKE_REASON = "recurring payment failed";

/** How long a held run waits before it looks again. */
export const PAYMENT_HOLD_MINUTES = 24 * 60;

/** A past-due row older than this no longer holds anything (see the SQL). */
const PAYMENT_HOLD_MAX_DAYS = 60;

export interface PurchaseStandingFacts {
  /** Live access to the offer that does not come from a refunded source order. */
  hasLiveAccess: boolean;
  /** The order that started the run has been refunded in full. */
  orderRefunded: boolean;
  /** Why access to the offer was taken away, when it was; '' when it never was. */
  endedReason: string;
  /** A renewal or installment for the offer is failing right now. */
  paymentFailing: boolean;
}

export type PurchaseStanding =
  | { action: "continue" }
  | { action: "hold"; reason: string }
  | { action: "exit"; reason: string };

/** The decision, pure, so the cases can be pinned down without a database. */
export function purchaseStanding(facts: PurchaseStandingFacts): PurchaseStanding {
  if (facts.hasLiveAccess && !facts.paymentFailing) return { action: "continue" };
  if (facts.orderRefunded && !facts.hasLiveAccess) {
    return { action: "exit", reason: "purchase refunded" };
  }
  if (facts.endedReason && !facts.hasLiveAccess) {
    return { action: "exit", reason: `purchase ended: ${facts.endedReason}`.slice(0, 200) };
  }
  if (facts.paymentFailing) return { action: "hold", reason: "payment failing" };
  return { action: "continue" };
}

interface PurchaseStandingRow {
  id: string;
  sequence_id: number;
  contact_id: number;
  has_live_access: boolean;
  order_refunded: boolean;
  ended_reason: string;
  payment_failing: boolean;
}

/**
 * The facts for runs stamped with a source offer, as one query.
 *
 * Members are matched on the contact link or the address, as the
 * `requires_offer_id` check does: a contact is not always linked to the member
 * holding the access (a gift, a guest checkout claimed later), and a missed
 * match would read as "no access" — which on its own never ends a run here, but
 * would hide the evidence that should.
 *
 * `$1` is the payment-pause revoke reason; `extraWhere` narrows the runs and
 * may use `$2` onwards.
 */
function purchaseStandingSql(extraWhere: string): string {
  const sameBuyer = `(m.contact_id = s.contact_id OR lower(m.email::text) = lower(c.email::text))`;
  // Live access counts through ANY offer whose purchase starts this sequence,
  // not just the one stamped. The Lounge sequence is started by The Lounge and
  // by The Lounge | VIP: a member who upgrades is "already enrolled", keeps the
  // Lounge stamp, and must not lose the emails when the Lounge plan they
  // upgraded from is cancelled while they still hold VIP.
  return `
    SELECT s.id, s.sequence_id, s.contact_id,
           EXISTS (
             SELECT 1 FROM access_grants g JOIN members m ON m.id = g.member_id
              WHERE g.status = 'active'
                AND (g.expires_at IS NULL OR g.expires_at > now())
                AND ${sameBuyer}
                AND NOT (COALESCE(src.refunded, false)
                         AND g.order_id IS NOT DISTINCT FROM s.source_order_id)
                AND (g.offer_id = s.source_offer_id
                     OR g.offer_id IN (
                       SELECT CASE WHEN (a.trigger_config ->> 'offerId') ~ '^[0-9]+$'
                                   THEN (a.trigger_config ->> 'offerId')::int END
                         FROM automations a
                         JOIN automation_actions x ON x.automation_id = a.id
                        WHERE a.trigger_type = 'offer_purchased'
                          AND x.action_type = 'subscribe_sequence'
                          AND x.config ->> 'sequenceId' = s.sequence_id::text
                     ))
           ) AS has_live_access,
           COALESCE(src.refunded, false) AS order_refunded,
           COALESCE((
             SELECT CASE WHEN g.revoke_reason = '' THEN 'access removed' ELSE g.revoke_reason END
               FROM access_grants g JOIN members m ON m.id = g.member_id
              WHERE g.offer_id = s.source_offer_id
                AND ${sameBuyer}
                AND g.revoke_reason <> $1
                AND (g.status = 'revoked'
                     OR (g.revoke_reason <> '' AND g.expires_at IS NOT NULL AND g.expires_at <= now()))
              ORDER BY COALESCE(g.revoked_at, g.expires_at, g.updated_at) DESC
              LIMIT 1
           ), '') AS ended_reason,
           (
             EXISTS (
               SELECT 1 FROM access_grants g JOIN members m ON m.id = g.member_id
                WHERE g.offer_id = s.source_offer_id AND g.status = 'revoked'
                  AND g.revoke_reason = $1 AND ${sameBuyer}
             )
             -- Past due and still being retried. 'unpaid' is not here: that is
             -- an ending, and endSubscriptionAccess revokes for it. The window
             -- keeps a row somebody abandoned in past_due from holding a run
             -- for ever; real retries finish well inside it.
             OR EXISTS (
               SELECT 1 FROM subscriptions sb JOIN members m ON m.id = sb.member_id
                WHERE sb.offer_id = s.source_offer_id AND sb.status = 'past_due'
                  AND sb.updated_at > now() - interval '${PAYMENT_HOLD_MAX_DAYS} days'
                  AND ${sameBuyer}
             )
             OR EXISTS (
               SELECT 1 FROM payment_plans pp JOIN members m ON m.id = pp.member_id
                WHERE pp.offer_id = s.source_offer_id AND pp.status = 'past_due'
                  AND pp.updated_at > now() - interval '${PAYMENT_HOLD_MAX_DAYS} days'
                  AND ${sameBuyer}
             )
           ) AS payment_failing
      FROM sequence_subscriptions s
      JOIN contacts c ON c.id = s.contact_id
      LEFT JOIN LATERAL (
        SELECT (o.status = 'refunded'
                OR (o.refunded_cents > 0
                    AND o.refunded_cents >= GREATEST(o.total_cents, o.amount_cents))) AS refunded
          FROM orders o WHERE o.id = s.source_order_id
      ) src ON true
     WHERE s.source_offer_id IS NOT NULL
       AND ${extraWhere}`;
}

function standingOf(row: PurchaseStandingRow): PurchaseStanding {
  return purchaseStanding({
    hasLiveAccess: row.has_live_access,
    orderRefunded: row.order_refunded,
    endedReason: row.ended_reason,
    paymentFailing: row.payment_failing,
  });
}

/**
 * Ends every live run whose purchase has ended (QA row 230).
 *
 * Runs at the top of each sequence tick, so a refund, a revoke or a defaulted
 * plan shows on the contact as "exited — purchase refunded" within minutes,
 * by whichever route the access went — Stripe, PayPal, the admin, an
 * automation — without each of those having to know about email. `sendDueEmail`
 * checks the same thing again before every send, so nothing goes out in the
 * minutes between.
 */
export async function stopEndedPurchaseRuns(): Promise<number> {
  const res = await pool.query<PurchaseStandingRow>(
    `${purchaseStandingSql(`s.status = 'active'`)} ORDER BY s.id LIMIT ${TICK_BATCH_FOR_PURCHASE_SWEEP}`,
    [PAYMENT_PAUSE_REVOKE_REASON]
  );

  let stopped = 0;
  for (const row of res.rows) {
    const standing = standingOf(row);
    if (standing.action !== "exit") continue;
    const ended = await pool.query<{ id: string }>(
      `UPDATE sequence_subscriptions
          SET status = 'exited', exit_reason = $2, next_send_at = NULL,
              completed_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'active'
        RETURNING id`,
      [row.id, standing.reason]
    );
    if (!ended.rows[0]) continue;
    stopped += 1;
    await publishSequenceEvent("sequence_unsubscribed", {
      subscriptionId: row.id,
      sequenceId: row.sequence_id,
      contactId: row.contact_id,
      reason: standing.reason,
    });
  }
  return stopped;
}

/** Live stamped runs one sweep looks at; there are a handful, not thousands. */
const TICK_BATCH_FOR_PURCHASE_SWEEP = 2000;

function positiveIdOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
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
  // Housekeeping first, and never at the cost of the sends: sendDueEmail makes
  // the same check before every email, so a sweep that fails costs only how
  // soon the contact page shows the exit.
  await stopEndedPurchaseRuns().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[sequences] purchase sweep failed:", err);
  });

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
      source_offer_id: number | null;
    }>(
      `SELECT id, sequence_id, contact_id, status, position, next_send_at, source_offer_id
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
      last_name: string;
      timezone: string;
      email_marketing_status: string;
      custom_fields: unknown;
    }>(
      `SELECT email, name, first_name, last_name, timezone, email_marketing_status, custom_fields
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
        await publishSequenceEvent("sequence_unsubscribed", {
          subscriptionId: subscription.id,
          sequenceId: subscription.sequence_id,
          contactId: subscription.contact_id,
          reason: "exit tag applied",
        });
        return {
          outcome: "exited",
          detail: "exit tag applied",
          sequenceId: subscription.sequence_id,
          contactId: subscription.contact_id,
        };
      }
    }

    // A sequence about a benefit stops when the benefit does: refund, revocation
    // or expiry, by whichever route, without each one having to know about email.
    // Matched on the address as well, because a contact is not always linked to
    // the member holding the access, and a missed match would cost a real member
    // their emails.
    if (sequence.requires_offer_id) {
      const holds = await client.query(
        `SELECT 1 FROM access_grants g
           JOIN members m ON m.id = g.member_id
          WHERE g.offer_id = $1 AND g.status = 'active'
            AND (g.expires_at IS NULL OR g.expires_at > now())
            AND (m.contact_id = $2 OR lower(m.email::text) = lower($3))
          LIMIT 1`,
        [sequence.requires_offer_id, subscription.contact_id, contact.email]
      );
      if ((holds.rowCount ?? 0) === 0) {
        await client.query(
          `UPDATE sequence_subscriptions
              SET status = 'exited', exit_reason = 'access ended',
                  next_send_at = NULL, completed_at = now(), updated_at = now()
            WHERE id = $1`,
          [subscription.id]
        );
        await client.query("COMMIT");
        await publishSequenceEvent("sequence_unsubscribed", {
          subscriptionId: subscription.id,
          sequenceId: subscription.sequence_id,
          contactId: subscription.contact_id,
          reason: "access ended",
        });
        return {
          outcome: "exited",
          detail: "access ended",
          sequenceId: subscription.sequence_id,
          contactId: subscription.contact_id,
        };
      }
    }

    // QA row 230: a run a purchase started stops when the purchase does, and
    // waits while its renewal is failing. The tick's sweep usually gets there
    // first; this is the guarantee that no email slips out in between.
    if (subscription.source_offer_id !== null) {
      const standingRes = await client.query<PurchaseStandingRow>(
        purchaseStandingSql(`s.id = $2`),
        [PAYMENT_PAUSE_REVOKE_REASON, subscription.id]
      );
      const row = standingRes.rows[0];
      const standing: PurchaseStanding = row ? standingOf(row) : { action: "continue" };
      if (standing.action === "exit") {
        await client.query(
          `UPDATE sequence_subscriptions
              SET status = 'exited', exit_reason = $2,
                  next_send_at = NULL, completed_at = now(), updated_at = now()
            WHERE id = $1`,
          [subscription.id, standing.reason]
        );
        await client.query("COMMIT");
        await publishSequenceEvent("sequence_unsubscribed", {
          subscriptionId: subscription.id,
          sequenceId: subscription.sequence_id,
          contactId: subscription.contact_id,
          reason: standing.reason,
        });
        return {
          outcome: "exited",
          detail: standing.reason,
          sequenceId: subscription.sequence_id,
          contactId: subscription.contact_id,
        };
      }
      if (standing.action === "hold") {
        // Same position, later date: once the payment clears, the email they
        // were due is the one they get, not the one after it.
        await client.query(
          `UPDATE sequence_subscriptions
              SET next_send_at = $2, updated_at = now()
            WHERE id = $1`,
          [subscription.id, new Date(now.getTime() + PAYMENT_HOLD_MINUTES * 60_000)]
        );
        await client.query("COMMIT");
        return {
          outcome: "skipped",
          detail: `on hold — ${standing.reason}`,
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
      preview_text: string | null;
      skip_rules: unknown;
    }>(
      `SELECT id, position, subject, body_md, from_name, from_email, preview_text, skip_rules
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

    // Per-email skip rules: nothing is sent and the run moves on, the next email
    // timed from now on its own delay — never "due at once" because one was
    // skipped. Only queried when the email has a rule.
    const skipRules = parseSkipRules(email.skip_rules);
    const skipped = hasSkipRules(skipRules)
      ? await skipReason(client, skipRules, subscription.contact_id, contact.email)
      : "";
    if (skipped) {
      const afterRes = await client.query<{ position: number; delay_minutes: number }>(
        `SELECT position, delay_minutes FROM sequence_emails
          WHERE sequence_id = $1 AND enabled AND position > $2
          ORDER BY position LIMIT 1`,
        [subscription.sequence_id, email.position]
      );
      const after = afterRes.rows[0];
      if (!after) {
        await finishSubscription(client, subscription.id, subscription.contact_id, sequence);
        await client.query("COMMIT");
        return {
          outcome: "completed",
          detail: `last email skipped: ${skipped}`,
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
          after.position,
          nextSendAt(now, after.delay_minutes, rulesFor(sequence, contact.timezone)),
        ]
      );
      await client.query("COMMIT");
      return {
        outcome: "skipped",
        detail: `email ${email.position} skipped: ${skipped}`,
        sequenceId: subscription.sequence_id,
        contactId: subscription.contact_id,
      };
    }

    // Every token the composer's picker offers for a sequence. `renderTokens`
    // blanks what it is not given, so a token missing here goes out as nothing.
    const values = buildMergeValues(
      {
        email: contact.email,
        name: contact.name,
        firstName: contact.first_name,
        lastName: contact.last_name,
        timezone: contact.timezone,
        customFields: contact.custom_fields,
      },
      mergeLinks(subscription.contact_id),
      now
    );

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
      preheader: renderTokens(email.preview_text ?? "", values),
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
