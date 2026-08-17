import { z } from "zod";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { renderMarkdown, sendEmail } from "../email/provider";
import { applyTags } from "../services/contacts";
import { describeSession, signRegistration } from "../services/events";
import { PRIORITY, enqueue } from "./queue";
import { registerHandler } from "./worker";

/**
 * Event reminders and the post-event split.
 *
 * `events.reminders` is already named by a row in `job_schedules` (every 15
 * minutes), so the kind is not free to change: a rename shows up as a job
 * failing rather than as reminders quietly never going out again.
 *
 * Every reminder is claimed before it is sent — the stamp goes down in its own
 * statement, and only a row this worker actually stamped is mailed. Two workers
 * ticking at the same second, or a redelivered job, then produce one email
 * rather than two. A send that fails puts the stamp back, so the next tick
 * retries instead of the reminder being silently lost, which is the failure
 * mode the other ordering has.
 */

/** How many of each reminder one tick will send. */
const BATCH = 200;

type ReminderStep = "24h" | "1h" | "start";

interface ReminderCopy {
  column: string;
  /** SQL predicate selecting the sessions this step is due for. */
  due: string;
  subject: (title: string) => string;
  lead: (when: string) => string;
}

/**
 * The three reminders, and the windows that make them mean what they say.
 *
 * The windows have a floor as well as a ceiling. Without one, somebody
 * registering for an evergreen session fifteen minutes out would be sent the
 * day-before reminder, the hour-before reminder and the it-is-starting one
 * inside a quarter of an hour — three emails saying three different things
 * about the same session.
 */
const REMINDERS: Record<ReminderStep, ReminderCopy> = {
  "24h": {
    column: "reminder_24h_sent_at",
    due: "r.session_at > now() + interval '12 hours' AND r.session_at <= now() + interval '24 hours'",
    subject: (title) => `Tomorrow: ${title}`,
    lead: (when) =>
      `Your seat is booked for **${when}**. Nothing to prepare — bring a notebook and whatever is on your mind about your practice.`,
  },
  "1h": {
    column: "reminder_1h_sent_at",
    due: "r.session_at > now() + interval '25 minutes' AND r.session_at <= now() + interval '1 hour'",
    subject: (title) => `Starting in an hour: ${title}`,
    lead: (when) => `We start at **${when}**. Here is your link — it opens ten minutes early.`,
  },
  start: {
    column: "reminder_start_sent_at",
    due: "r.session_at <= now() + interval '5 minutes' AND r.session_at > now() - interval '15 minutes'",
    subject: (title) => `We're live: ${title}`,
    lead: () => `We are starting now. Come on in.`,
  },
};

interface DueRow {
  id: string;
  email: string;
  name: string;
  contact_id: number | null;
  session_at: Date;
  event_id: number;
  slug: string;
  title: string;
  timezone: string;
}

/**
 * Claims the reminders of one step that have come due.
 *
 * The stamp and the selection are one statement: a row this returns is a row
 * nothing else can also claim. `SKIP LOCKED` keeps two workers from queueing
 * behind each other on the same batch rather than each taking their own.
 */
async function claimDue(step: ReminderStep): Promise<DueRow[]> {
  const copy = REMINDERS[step];
  // The column and predicate come from the fixed record above, keyed by a union
  // type, so nothing a caller passes can reach the statement.
  const res = await pool.query<DueRow>(
    `WITH due AS (
       SELECT r.id
         FROM event_registrations r
         JOIN events e ON e.id = r.event_id
        WHERE r.${copy.column} IS NULL
          AND e.published
          AND ${copy.due}
        ORDER BY r.session_at
        LIMIT $1
        FOR UPDATE OF r SKIP LOCKED
     )
     UPDATE event_registrations r
        SET ${copy.column} = now()
       FROM due, events e
      WHERE r.id = due.id AND e.id = r.event_id
      RETURNING r.id, r.email::text AS email, r.name, r.contact_id, r.session_at,
                e.id AS event_id, e.slug::text AS slug, e.title, e.timezone`,
    [BATCH]
  );
  return res.rows;
}

/** Puts a claimed reminder back, so the next tick retries it. */
async function releaseClaim(step: ReminderStep, registrationId: string): Promise<void> {
  await pool.query(
    `UPDATE event_registrations SET ${REMINDERS[step].column} = NULL WHERE id = $1`,
    [registrationId]
  );
}

async function sendReminder(step: ReminderStep, row: DueRow): Promise<void> {
  const copy = REMINDERS[step];
  const when = describeSession(row.session_at, row.timezone);
  const link = `${env.publicSiteUrl}/events/${row.slug}/room?ticket=${signRegistration(Number(row.id))}`;
  const greeting = row.name.trim().split(/\s+/)[0] || "there";

  const body = [
    `Hi ${greeting},`,
    ``,
    copy.lead(when),
    ``,
    `[Join ${row.title}](${link})`,
  ].join("\n");

  await sendEmail({
    to: row.email,
    subject: copy.subject(row.title),
    text: body,
    html: renderMarkdown(body),
    contactId: row.contact_id,
    // Transactional: they asked for this session, and a reminder they opted
    // out of receiving is a seat they booked and were never told about.
    sourceType: "transactional",
    sourceId: row.event_id,
  });
}

/**
 * Sends every reminder that has come due, and queues the split for sessions
 * that have finished.
 */
export async function sweepEventReminders(): Promise<Record<string, number>> {
  const sent: Record<string, number> = { "24h": 0, "1h": 0, start: 0, splitsQueued: 0 };

  for (const step of Object.keys(REMINDERS) as ReminderStep[]) {
    for (const row of await claimDue(step)) {
      try {
        await sendReminder(step, row);
        sent[step] += 1;
      } catch (err) {
        await releaseClaim(step, row.id).catch(() => undefined);
        // One bad address must not cost the rest of the batch its reminders.
        console.error(
          `[events] ${step} reminder to ${row.email} failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  sent.splitsQueued = await queueFinishedEvents();
  return sent;
}

/**
 * Queues the attended/no-show split for every event with a session that has
 * just finished.
 *
 * Evergreen events never "finish", so the trigger is per-session rather than
 * per-event: any registration whose own session has ended in the last two days
 * puts its event in the queue. The dedupe key collapses that to one job per
 * event per hour, and the split itself is idempotent, so re-running costs
 * nothing.
 */
async function queueFinishedEvents(): Promise<number> {
  const finished = await pool.query<{ event_id: number }>(
    `SELECT DISTINCT r.event_id
       FROM event_registrations r
       JOIN events e ON e.id = r.event_id
      WHERE r.session_at + make_interval(mins => e.duration_minutes) <= now()
        AND r.session_at > now() - interval '48 hours'`
  );

  const slot = Math.floor(Date.now() / 3_600_000);
  let queued = 0;
  for (const row of finished.rows) {
    const id = await enqueue({
      kind: "events.postEventSplit",
      payload: { eventId: row.event_id },
      priority: PRIORITY.bulk,
      dedupeKey: `event-split:${row.event_id}:${slot}`,
    });
    if (id) queued += 1;
  }
  return queued;
}

/* ------------------------------------------------------------------ split */

const splitPayload = z.object({ eventId: z.coerce.number().int().positive() });

/**
 * Tags everyone who turned up, and everyone who did not.
 *
 * The two tags are the whole point of running an event inside the platform: the
 * follow-up to somebody who watched and the follow-up to somebody who booked
 * and forgot are different emails, and every automation downstream keys off
 * exactly this pair.
 *
 * Idempotent by construction — `applyTags` ignores a tag the contact already
 * has — so a redelivered job, or the hourly re-queue while an evergreen event
 * keeps producing sessions, changes nothing the second time.
 */
export async function splitAfterEvent(payload: Record<string, unknown>): Promise<unknown> {
  const { eventId } = splitPayload.parse(payload);

  const eventRes = await pool.query<{
    slug: string;
    attended_slug: string | null;
    no_show_slug: string | null;
  }>(
    `SELECT e.slug::text AS slug,
            a.slug::text  AS attended_slug,
            n.slug::text  AS no_show_slug
       FROM events e
       LEFT JOIN tags a ON a.id = e.attended_tag_id
       LEFT JOIN tags n ON n.id = e.no_show_tag_id
      WHERE e.id = $1`,
    [eventId]
  );
  const event = eventRes.rows[0];
  if (!event) return { skipped: "no such event" };
  if (!event.attended_slug && !event.no_show_slug) return { skipped: "no tags configured" };

  const registrations = await pool.query<{ contact_id: number; attended: boolean }>(
    `SELECT r.contact_id, r.attended
       FROM event_registrations r
       JOIN events e ON e.id = r.event_id
      WHERE r.event_id = $1
        AND r.contact_id IS NOT NULL
        AND r.session_at + make_interval(mins => e.duration_minutes) <= now()
        AND r.session_at > now() - interval '48 hours'`,
    [eventId]
  );

  let attended = 0;
  let noShow = 0;
  for (const row of registrations.rows) {
    const slug = row.attended ? event.attended_slug : event.no_show_slug;
    if (!slug) continue;
    await applyTags(row.contact_id, [slug], `event:${event.slug}`);
    if (row.attended) attended += 1;
    else noShow += 1;
  }

  return { attended, noShow };
}

/* --------------------------------------------------------------- wiring */

/**
 * Registers this phase's handlers.
 *
 * `events.reminders` is named by a `job_schedules` row shipped in migration
 * 011, so the string here is a contract, not a label.
 */
export function registerEventJobs(): void {
  registerHandler("events.reminders", () => sweepEventReminders());
  registerHandler("events.postEventSplit", (payload) => splitAfterEvent(payload));
}
