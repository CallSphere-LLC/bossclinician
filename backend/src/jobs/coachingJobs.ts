import { pool } from "../db/pool";
import { renderMarkdown, sendEmail } from "../email/provider";
import { registerHandler } from "./worker";

/**
 * Reminders for booked coaching sessions, at 24 hours and 1 hour.
 *
 * `coaching.reminders` is named by a row in `job_schedules` (every 15 minutes),
 * so the kind is not free to change: a rename shows up as a job failing rather
 * than as reminders quietly never going out again. That is exactly how this
 * handler came to be written — the schedule shipped before anything answered
 * it, and the queue said so on the first tick instead of the gap going unnoticed
 * until somebody missed a call.
 *
 * The claim-then-send ordering matches events.reminders, and for the same
 * reason: the stamp goes down in its own statement, and only a row this worker
 * actually stamped is mailed. Two workers ticking in the same second, or a
 * redelivered job, then produce one email rather than two. A failed send puts
 * the stamp back so the next tick retries — losing a reminder silently is worse
 * than sending it a few minutes late.
 */

const BATCH = 200;

type ReminderStep = "24h" | "1h";

interface ReminderCopy {
  column: string;
  /**
   * The window has a floor as well as a ceiling. Without one, a session booked
   * ninety minutes out would collect both reminders inside the hour — two
   * emails saying different things about the same appointment.
   */
  due: string;
  subject: (offer: string) => string;
  lead: (when: string) => string;
}

const REMINDERS: Record<ReminderStep, ReminderCopy> = {
  "24h": {
    column: "reminder_24h_sent_at",
    due: "s.scheduled_at > now() + interval '12 hours' AND s.scheduled_at <= now() + interval '24 hours'",
    subject: (offer) => `Tomorrow: your ${offer} session`,
    lead: (when) =>
      `We're speaking at **${when}**. Have a think about the one thing you most want to move forward — that is usually where the hour goes.`,
  },
  "1h": {
    column: "reminder_1h_sent_at",
    due: "s.scheduled_at > now() + interval '25 minutes' AND s.scheduled_at <= now() + interval '1 hour'",
    subject: (offer) => `Starting in an hour: your ${offer} session`,
    lead: (when) => `We start at **${when}**. Here is your link.`,
  },
};

interface DueSession {
  id: number;
  member_id: number | null;
  email: string;
  first_name: string;
  scheduled_at: Date;
  duration_minutes: number;
  timezone: string;
  meeting_url: string;
  agenda: string;
  offer_title: string;
}

/**
 * Claims one step's due sessions.
 *
 * `RETURNING` on the UPDATE is what makes the claim atomic: the rows this
 * worker gets back are exactly the rows it moved from unstamped to stamped, so
 * no second worker can be holding the same one.
 */
async function claimDue(step: ReminderStep): Promise<DueSession[]> {
  const copy = REMINDERS[step];
  const res = await pool.query<DueSession>(
    `WITH due AS (
       SELECT s.id
         FROM coaching_sessions s
        WHERE s.status = 'scheduled'
          AND s.scheduled_at IS NOT NULL
          AND s.${copy.column} IS NULL
          AND ${copy.due}
        ORDER BY s.scheduled_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE coaching_sessions s
        SET ${copy.column} = now(), updated_at = now()
       FROM due
      WHERE s.id = due.id
      RETURNING s.id, s.member_id, s.scheduled_at, s.duration_minutes, s.timezone,
                s.meeting_url, s.agenda,
                COALESCE(m.email::text, '')      AS email,
                COALESCE(m.first_name, '')       AS first_name,
                COALESCE(o.title, 'coaching')    AS offer_title`,
    [BATCH]
  );

  // The join has to be a second read: RETURNING cannot reach tables the UPDATE
  // did not touch, and the member's address lives on `members`.
  const ids = res.rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const detail = await pool.query<DueSession>(
    `SELECT s.id, s.member_id, s.scheduled_at, s.duration_minutes, s.timezone,
            s.meeting_url, s.agenda,
            COALESCE(m.email::text, '')   AS email,
            COALESCE(m.first_name, '')    AS first_name,
            COALESCE(o.title, 'coaching') AS offer_title
       FROM coaching_sessions s
       LEFT JOIN members m         ON m.id = s.member_id
       LEFT JOIN coaching_offers o ON o.id = s.offer_id
      WHERE s.id = ANY($1::int[])`,
    [ids]
  );
  return detail.rows;
}

/** Puts a claim back when the send failed, so the next tick tries again. */
async function releaseClaim(step: ReminderStep, sessionId: number): Promise<void> {
  await pool.query(
    `UPDATE coaching_sessions SET ${REMINDERS[step].column} = NULL WHERE id = $1`,
    [sessionId]
  );
}

/** The appointment time, written in the member's own timezone. */
function describeWhen(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(at);
  } catch {
    // A bad timezone on a row must not stop the reminder going out; UTC is
    // wrong-but-legible, and a missed coaching call is the worse outcome.
    return `${at.toUTCString()} (UTC)`;
  }
}

async function sendReminders(step: ReminderStep): Promise<number> {
  const copy = REMINDERS[step];
  const due = await claimDue(step);
  let sent = 0;

  for (const session of due) {
    if (!session.email) continue;

    const when = describeWhen(new Date(session.scheduled_at), session.timezone);
    const body = [
      `Hi ${session.first_name || "there"},`,
      "",
      copy.lead(when),
      "",
      session.meeting_url ? `[Join the session](${session.meeting_url})` : "",
      session.agenda ? `\n**What we said we'd cover:**\n\n${session.agenda}` : "",
      "",
      "If something has come up and you need to move it, you can reschedule from your account.",
      "",
      "— Yvette",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await sendEmail({
        to: session.email,
        memberId: session.member_id,
        sourceType: "transactional",
        sourceId: session.id,
        topic: "coaching",
        subject: copy.subject(session.offer_title),
        html: renderMarkdown(body),
        text: body,
      });
      sent += 1;
    } catch (err) {
      await releaseClaim(step, session.id);
      console.error(
        `[jobs] coaching reminder ${step} for session ${session.id} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return sent;
}

export function registerCoachingJobs(): void {
  registerHandler("coaching.reminders", async () => ({
    sent24h: await sendReminders("24h"),
    sent1h: await sendReminders("1h"),
  }));
}
