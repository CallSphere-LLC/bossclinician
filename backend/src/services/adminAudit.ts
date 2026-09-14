import type { Request } from "express";
import { pool } from "../db/pool";

/**
 * The admin audit trail — who did what, to which record, and what the record
 * looked like on either side of the change.
 *
 * The identity comes from `req.user` (the admin JWT), never from the request
 * body: an audit row an admin could address to somebody else is worse than no
 * audit row at all.
 */

export interface AdminActionInput {
  req: Request;
  action: string;
  entityType: string;
  entityId: string | number;
  /** Row state before the mutation. Omit for creates and for pure reads. */
  before?: unknown;
  /** Row state after the mutation. Omit for deletes. */
  after?: unknown;
}

/** `undefined` and `null` both mean "no state captured", and JSONB wants NULL. */
function serialiseState(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

async function writeAuditRow(input: AdminActionInput): Promise<void> {
  const admin = input.req.user;
  await pool.query(
    `INSERT INTO admin_audit_log
       (admin_user_id, admin_email, action, entity_type, entity_id,
        before_state, after_state, ip)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      admin?.sub ?? null,
      (admin?.email ?? "").slice(0, 320),
      input.action,
      input.entityType,
      String(input.entityId),
      serialiseState(input.before),
      serialiseState(input.after),
      (input.req.ip ?? "").slice(0, 64),
    ]
  );
}

/**
 * Records an admin action, best-effort.
 *
 * The audit write happens *after* the mutation it describes, and a failure to
 * log must not undo or 500 a change that already committed: the admin would see
 * an error, retry, and the second attempt would either duplicate the work or
 * fail confusingly against the new state. A missing log line is a smaller
 * problem than a half-applied edit, so this swallows and logs.
 *
 * `recordAdminActionStrict` exists for the one case where that trade-off
 * inverts.
 */
export async function recordAdminAction(input: AdminActionInput): Promise<void> {
  try {
    await writeAuditRow(input);
  } catch (err) {
    // The entity id is often a route parameter. Arguments rather than the format
    // string, and JSON-quoted, so a `%s` or a newline in it cannot rewrite the
    // line that says an audit record went missing.
    // eslint-disable-next-line no-console
    console.error(
      "[audit] failed to record %s on %s:%s (continuing):",
      JSON.stringify(input.action),
      JSON.stringify(input.entityType),
      JSON.stringify(String(input.entityId)),
      err
    );
  }
}

/**
 * Records an admin action and rethrows if the write fails.
 *
 * Impersonation is the case that inverts the rule above. The audit row is not a
 * record of impersonation, it is the *precondition* for it: minting a token that
 * lets an admin act as a customer, with no durable trace of who did it or when,
 * turns the feature into a way to reach a member's account unobserved. Call this
 * before the token is issued, and let the failure surface — an unusable "view as
 * member" button is an acceptable outage; a silent one is not.
 *
 * It also fails closed on a stale admin JWT: `admin_user_id` is a foreign key,
 * so a token belonging to a deleted admin cannot log, and therefore cannot
 * impersonate.
 */
export async function recordAdminActionStrict(input: AdminActionInput): Promise<void> {
  await writeAuditRow(input);
}
