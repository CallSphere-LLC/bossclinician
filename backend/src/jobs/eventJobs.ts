import { z } from "zod";
import { pool } from "../db/pool";
import { applyTags } from "../services/contacts";
import { runReminderTick } from "../services/eventReminders";
import { PRIORITY, enqueue } from "./queue";
import { registerHandler } from "./worker";

/**
 * Event reminders and the post-event split.
 *
 * `events.reminders` is already named by a row in `job_schedules`, so the kind
 * is not free to change: a rename shows up as a job failing rather than as
 * reminders quietly never going out again.
 *
 * The reminders themselves used to live here as three hard-coded steps — 24
 * hours, 1 hour, and the start — with their state held in three timestamp
 * columns on the registration. That worked, but it was invisible: nothing in
 * the event editor mentioned reminders, nothing recorded what went to whom, and
 * a stamped column could not tell a reminder that reached somebody from one the
 * provider refused. They now live in `services/eventReminders.ts`, configured
 * per event and recorded per registrant, and the same three steps ship as
 * defaults so no event loses the reminders it was already getting.
 *
 * What stays here is the post-event split, which is about tags rather than mail.
 */

/**
 * Sends every reminder that has come due, and queues the split for sessions
 * that have finished.
 */
export async function sweepEventReminders(): Promise<Record<string, number>> {
  const reminders = await runReminderTick();
  return { ...reminders, splitsQueued: await queueFinishedEvents() };
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
