import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { renderMarkdown, sendEmail } from "../email/provider";
import { upsertContact } from "../services/contacts";
import { notificationRecipients } from "../services/notificationRecipients";

/**
 * Automation engine: trigger -> "only if" conditions -> ordered actions.
 *
 * Deliberately fire-and-forget. An automation failing must never fail the
 * request that triggered it — a broken welcome email should not stop a lead
 * from being saved — so `fireTrigger` swallows everything and records the
 * outcome in automation_runs instead.
 */

export type TriggerType =
  | "lead_created"
  | "subscriber_created"
  | "order_paid"
  | "member_created"
  | "community_joined"
  | "challenge_approved";

/** Flat bag of facts about what happened, used for conditions and templating. */
export interface TriggerPayload {
  email?: string;
  name?: string;
  source?: string;
  status?: string;
  courseSlug?: string;
  courseTitle?: string;
  amountCents?: number;
  [key: string]: unknown;
}

interface AutomationRow {
  id: number;
  name: string;
  conditions: Record<string, unknown>;
}

interface ActionRow {
  action_type: string;
  config: Record<string, unknown>;
}

/**
 * Conditions are an AND-ed map of payload key -> expected value.
 * An empty object always matches. Comparison is string-based and
 * case-insensitive so `{"source":"Apply"}` matches `source: "apply"`.
 */
function matches(conditions: Record<string, unknown>, payload: TriggerPayload): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    if (expected === "" || expected === null || expected === undefined) continue;
    const actual = payload[key];
    if (String(actual ?? "").toLowerCase() !== String(expected).toLowerCase()) return false;
  }
  return true;
}

/** Replaces {{name}} / {{email}} style tokens from the payload. */
function render(template: string, payload: TriggerPayload): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) =>
    String(payload[key] ?? ""),
  );
}

/** Resolves (creating if needed) the member this run is about. */
async function ensureMember(payload: TriggerPayload): Promise<number | null> {
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email) return null;

  const result = await pool.query(
    `INSERT INTO members (email, name, status) VALUES ($1, $2, 'active')
     ON CONFLICT (email) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [email, typeof payload.name === "string" ? payload.name : ""],
  );
  return (result.rows[0]?.id as number) ?? null;
}

async function runAction(action: ActionRow, payload: TriggerPayload): Promise<string> {
  const config = action.config ?? {};

  switch (action.action_type) {
    /**
     * Sends through `email/provider`, not through `sendMail`.
     *
     * This is a marketing email to somebody on the list, so the suppression
     * list, the contact's topic preferences and the CAN-SPAM block all have to
     * apply — and `sendMail` knows about none of them. Going straight to the
     * transport here meant an address that had unsubscribed or hard-bounced was
     * mailed again the next time it came through a form, in a message with no
     * opt-out link at all.
     *
     * `renderMarkdown` also escapes, which the hand-rolled `<p>` wrapper this
     * replaced did not: a submitted name carrying markup was rendered as markup.
     */
    case "send_email": {
      const to = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (!to) return "send_email: skipped (no email in payload)";
      const subject = render(String(config.subject ?? "Hello from Boss Clinician"), payload);
      const body = render(String(config.body ?? ""), payload);

      const contactId = await upsertContact({
        email: to,
        name: typeof payload.name === "string" ? payload.name : undefined,
        source: "automation",
      });

      const result = await sendEmail({
        to,
        subject,
        text: body,
        html: renderMarkdown(body),
        contactId,
        sourceType: "automation",
        topic: "marketing",
      });
      return result.outcome === "suppressed"
        ? `send_email: not sent to ${to} — ${result.suppressedReason}`
        : `send_email: sent to ${to}`;
    }

    case "notify_admin": {
      // The owner built this step herself, so it has no on/off switch to obey —
      // only the address, which comes from settings before NOTIFY_EMAIL.
      const notifyTo = await notificationRecipients("alert");
      if (!notifyTo) return "notify_admin: skipped (no notification address set)";
      const subject = render(String(config.subject ?? "Automation triggered"), payload);
      const body = render(
        String(config.body ?? "An automation fired for {{email}}."),
        payload,
      );
      // Escaped: the body carries a name and a message somebody typed into a
      // public form, and this one lands in the owner's own inbox.
      await sendMail({ to: notifyTo, subject, text: body, html: renderMarkdown(body) });
      return `notify_admin: sent to ${notifyTo}`;
    }

    case "create_member": {
      const memberId = await ensureMember(payload);
      return memberId ? `create_member: member ${memberId}` : "create_member: skipped (no email)";
    }

    case "enroll_course": {
      const courseId = Number(config.courseId);
      if (!courseId) return "enroll_course: skipped (no courseId)";
      const memberId = await ensureMember(payload);
      if (!memberId) return "enroll_course: skipped (no email)";
      await pool.query(
        `INSERT INTO enrollments (member_id, course_id) VALUES ($1, $2)
         ON CONFLICT (member_id, course_id) DO NOTHING`,
        [memberId, courseId],
      );
      return `enroll_course: member ${memberId} -> course ${courseId}`;
    }

    case "join_community": {
      const communityId = Number(config.communityId);
      if (!communityId) return "join_community: skipped (no communityId)";
      const memberId = await ensureMember(payload);
      if (!memberId) return "join_community: skipped (no email)";
      await pool.query(
        `INSERT INTO community_memberships (community_id, member_id, source)
         VALUES ($1, $2, 'automation')
         ON CONFLICT (community_id, member_id) DO NOTHING`,
        [communityId, memberId],
      );
      return `join_community: member ${memberId} -> community ${communityId}`;
    }

    case "award_points": {
      const communityId = Number(config.communityId);
      const points = Number(config.points ?? 0);
      if (!communityId || !points) return "award_points: skipped (missing communityId/points)";
      const memberId = await ensureMember(payload);
      if (!memberId) return "award_points: skipped (no email)";
      await pool.query(
        `UPDATE community_memberships SET points = points + $1
         WHERE community_id = $2 AND member_id = $3`,
        [points, communityId, memberId],
      );
      return `award_points: +${points} to member ${memberId}`;
    }

    case "add_subscriber": {
      const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
      if (!email) return "add_subscriber: skipped (no email)";
      await pool.query(
        `INSERT INTO subscribers (email, source) VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING`,
        [email, String(config.source ?? "automation")],
      );
      return `add_subscriber: ${email}`;
    }

    default:
      return `${action.action_type}: unknown action type`;
  }
}

/**
 * Runs every active automation bound to `trigger`.
 *
 * Callers should NOT await this — it is intentionally detached so automation
 * latency never lands in a user-facing request.
 */
export async function fireTrigger(
  trigger: TriggerType,
  payload: TriggerPayload,
): Promise<void> {
  try {
    const automations = await pool.query(
      `SELECT id, name, conditions FROM automations
        WHERE trigger_type = $1 AND status = 'active'`,
      [trigger],
    );

    for (const row of automations.rows as AutomationRow[]) {
      if (!matches(row.conditions ?? {}, payload)) {
        await pool.query(
          `INSERT INTO automation_runs (automation_id, status, subject_email, log)
           VALUES ($1, 'skipped', $2, $3)`,
          [row.id, payload.email ?? "", JSON.stringify(["conditions not met"])],
        );
        continue;
      }

      const actions = await pool.query(
        "SELECT action_type, config FROM automation_actions WHERE automation_id = $1 ORDER BY sort, id",
        [row.id],
      );

      const log: string[] = [];
      let failures = 0;

      for (const action of actions.rows as ActionRow[]) {
        try {
          log.push(await runAction(action, payload));
        } catch (err) {
          failures += 1;
          log.push(`${action.action_type}: FAILED — ${(err as Error).message}`);
        }
      }

      const status =
        failures === 0 ? "success" : failures === actions.rowCount ? "failed" : "partial";

      await pool.query(
        `INSERT INTO automation_runs (automation_id, status, subject_email, log)
         VALUES ($1, $2, $3, $4)`,
        [row.id, status, payload.email ?? "", JSON.stringify(log)],
      );
      await pool.query(
        "UPDATE automations SET run_count = run_count + 1, last_run_at = now() WHERE id = $1",
        [row.id],
      );
    }
  } catch (err) {
    // Never propagate: the triggering request has already succeeded.
    console.error(`[automations] trigger ${trigger} failed:`, (err as Error).message);
  }
}

/** Convenience wrapper making the fire-and-forget intent explicit at call sites. */
export function fireTriggerAsync(trigger: TriggerType, payload: TriggerPayload): void {
  void fireTrigger(trigger, payload);
}
