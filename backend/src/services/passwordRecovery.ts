import { setTimeout as delay } from "node:timers/promises";
import { randomInt } from "node:crypto";
import { pool } from "../db/pool";
import { generateToken, hashToken, expiresIn } from "../auth/tokens";
import { badRequest } from "../utils/httpError";

export type RecoveryKind = "admin" | "member";
export const RESET_TTL_MINUTES = 60;
export const INVALID_RESET_LINK = "That link has expired or has already been used. Please request a new one.";

// Identifiers are selected only from this fixed map, never from HTTP input.
const tables = {
  admin: { users: "admin_users", resets: "admin_password_resets", owner: "admin_user_id", name: "name" },
  member: { users: "members", resets: "member_password_resets", owner: "member_id", name: "first_name" },
} as const;

/** Shared issuance for both realms. Five emails per account per 15 minutes,
 * durable across replicas. Serialize by normalized address before counting so
 * concurrent requests cannot all pass the cap. Unknown/blocked addresses run
 * the same queries and return the same HTTP response as eligible ones.
 */
export async function issuePasswordReset(kind: RecoveryKind, email: string, ip = "") {
  const t = tables[kind];
  const started = performance.now();
  const responseFloorMs = 250 + randomInt(50);
  const raw = generateToken();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`password-reset:${kind}:${email.toLowerCase()}`]);
    const found = await client.query<{ id: number; email: string; name: string }>(
      `SELECT id, email, ${t.name} AS name FROM ${t.users}
        WHERE lower(email) = lower($1) AND status IN (${kind === "member" ? "'active', 'invited'" : "'active'"})
        ORDER BY (email = $1) DESC LIMIT 1`, [email],
    );
    const account = found.rows[0];
    // SQL NULL produces no insert for unknown accounts. No raw token is stored.
    const inserted = await client.query(
      `INSERT INTO ${t.resets} (${t.owner}, token_hash, expires_at)
       SELECT $1::int, $2, $3 WHERE $1::int IS NOT NULL AND
       (SELECT count(*) FROM ${t.resets} WHERE ${t.owner} = $1
          AND created_at > now() - interval '15 minutes') < 5 RETURNING id`,
      [account?.id ?? null, hashToken(raw), expiresIn(RESET_TTL_MINUTES * 60)],
    );
    if (kind === "admin" && account && inserted.rowCount) {
      // Requester is anonymous. Never attribute an email request to the target
      // admin, and never store the bearer token or password in the audit log.
      await client.query(`INSERT INTO admin_audit_log (action,entity_type,entity_id,ip)
        VALUES ('admin.password_reset_requested','admin_user',$1,$2)`, [String(account.id), ip.slice(0, 64)]);
    }
    await client.query("COMMIT");
    return account && inserted.rowCount ? { ...account, token: raw } : null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    // Bound ordinary DB timing differences; sending is deferred until after
    // the response. This delay is identical for unknown, blocked and capped accounts.
    await delay(Math.max(0, responseFloorMs - (performance.now() - started)));
  }
}

/** Claim, password change, sibling-link invalidation and session revocation
 * commit together. The account lock serializes DIFFERENT tokens too: an older
 * email racing the latest email must not overwrite a just-reset password.
 */
export async function consumePasswordReset(kind: RecoveryKind, token: string, passwordHash: string, ip = "") {
  const t = tables[kind];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ owner_id: number }>(
      `SELECT ${t.owner} AS owner_id FROM ${t.resets} WHERE token_hash = $1`, [hashToken(token)],
    );
    const owner = found.rows[0]?.owner_id;
    if (!owner) throw badRequest(INVALID_RESET_LINK);
    const locked = await client.query<{ id: number; email: string; first_name: string }>(
      `SELECT id, email, ${t.name} AS first_name FROM ${t.users} WHERE id = $1
        AND status IN (${kind === "member" ? "'active', 'invited'" : "'active'"}) FOR UPDATE`, [owner],
    );
    if (!locked.rows[0]) throw badRequest(INVALID_RESET_LINK);
    const claimed = await client.query(
      `UPDATE ${t.resets} SET used_at = now() WHERE token_hash = $1
         AND used_at IS NULL AND expires_at > clock_timestamp() RETURNING id`, [hashToken(token)],
    );
    if (!claimed.rowCount) throw badRequest(INVALID_RESET_LINK);
    if (kind === "member") {
      await client.query(`UPDATE members SET password_hash = $2,
        email_verified_at = COALESCE(email_verified_at, now()),
        status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
        updated_at = now(), password_reset_at = $3 WHERE id = $1`, [owner, passwordHash, new Date()]);
      await client.query(`UPDATE member_sessions SET revoked_at = now(), revoked_reason = 'password_change'
        WHERE member_id = $1 AND revoked_at IS NULL`, [owner]);
      await client.query(`UPDATE member_magic_links SET used_at = now() WHERE member_id = $1 AND used_at IS NULL`, [owner]);
    } else {
      // Never alter role, status or MFA. The next login still requires MFA.
      await client.query("UPDATE admin_users SET password_hash = $2, updated_at = now() WHERE id = $1", [owner, passwordHash]);
      await client.query(`UPDATE admin_sessions SET revoked_at = now()
        WHERE admin_user_id = $1 AND revoked_at IS NULL`, [owner]);
    }
    if (kind === "admin") {
      // The single-use email token has proved the account here. Commit the
      // security event with the password and revocation, or roll all of it back.
      await client.query(`INSERT INTO admin_audit_log
        (admin_user_id,admin_email,action,entity_type,entity_id,after_state,ip)
        VALUES ($1,$2,'admin.password_reset_completed','admin_user',$3,$4::jsonb,$5)`,
        [owner, locked.rows[0].email, String(owner), JSON.stringify({ sessionsRevoked: true, mfaPreserved: true }), ip.slice(0, 64)]);
    }
    await client.query(`UPDATE ${t.resets} SET used_at = now() WHERE ${t.owner} = $1 AND used_at IS NULL`, [owner]);
    await client.query("COMMIT");
    return locked.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
