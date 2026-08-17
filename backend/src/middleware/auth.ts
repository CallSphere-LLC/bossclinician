import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../utils/jwt";
import { unauthorized } from "../utils/httpError";
import { pool } from "../db/pool";
import { hashToken } from "../auth/tokens";

/**
 * How often a session's `last_used_at` is worth writing.
 *
 * It exists so the sessions list can say "last used an hour ago", not so it can
 * say "0 seconds ago". Updating it on every request would turn every admin read
 * into a write on a row every request also reads.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Requires a valid `Authorization: Bearer <token>` header. Attaches req.user.
 *
 * The signature check alone is not enough. An admin JWT lives for seven days
 * and cannot be withdrawn, so "sign this laptop out" and "suspend this person"
 * would both be advisory until it expired. The session row is what makes them
 * real, and it is checked here rather than per-router because a route that
 * forgot to ask is a route where revocation silently does not apply.
 *
 * One indexed equality on `admin_sessions.token_hash` (UNIQUE, so already
 * indexed) plus a cheap SHA-256. This runs on every admin request, so the
 * freshness of `last_used_at` is decided in the same read rather than costing a
 * second round trip.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(unauthorized("Missing bearer token"));
    return;
  }
  const token = header.slice("Bearer ".length).trim();

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    next(unauthorized("Invalid or expired token"));
    return;
  }

  pool
    .query<{ id: string; stale: boolean; role: string; status: string }>(
      `SELECT s.id,
              (s.last_used_at IS NULL OR s.last_used_at < now() - make_interval(secs => $2)) AS stale,
              u.role, u.status
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.admin_user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [hashToken(token), TOUCH_INTERVAL_MS / 1000]
    )
    .then((result) => {
      const session = result.rows[0];
      if (!session || session.status !== "active") {
        next(unauthorized("Invalid or expired token"));
        return;
      }

      // The role comes from the row, not from the claim. A JWT lives for seven
      // days, so trusting the claim would leave a demoted manager with a
      // manager's permissions for a week after the demotion — and the person
      // who demoted them would have every reason to believe otherwise.
      payload.role = session.role;

      if (session.stale) {
        // Fire and forget: a failed bookkeeping write must not fail the request
        // it was only recording.
        void pool
          .query(`UPDATE admin_sessions SET last_used_at = now() WHERE id = $1`, [session.id])
          .catch(() => undefined);
      }

      req.user = payload;
      next();
    })
    .catch(next);
}
