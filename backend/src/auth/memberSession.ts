import type { Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { generateToken, hashToken, expiresIn } from "./tokens";
import { memberTokenSecret } from "./secrets";
import { clearDocumentCookie } from "./memberDocumentCookie";

/**
 * Member session handling: a short-lived access JWT the browser holds in
 * memory, plus a long-lived opaque refresh token in an HttpOnly cookie.
 *
 * The refresh token rotates on every use. The row it came from is not deleted —
 * it is marked revoked and the new row records it as `previous_id`. That chain
 * is what makes reuse detection work: presenting an already-rotated token is
 * only possible if it was captured, so the entire chain is revoked and the
 * member has to sign in again.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const REFRESH_COOKIE = "bc_member_refresh";

/**
 * A readable companion to the refresh cookie, holding no secret — its only
 * content is "1".
 *
 * The refresh cookie is HttpOnly and path-scoped, so the browser cannot tell
 * whether it exists. Without a hint, the app has to attempt a refresh on every
 * page load just to find out, which spends a round trip on every anonymous
 * visitor to the marketing site. This lets the client skip that call when there
 * is plainly no session to restore.
 *
 * It is a hint and nothing more: forging it buys an attacker one 401.
 */
export const SESSION_HINT_COOKIE = "bc_member_active";

/**
 * Member tokens are signed with a key derived from JWT_SECRET rather than with
 * JWT_SECRET itself (see auth/secrets.ts). The `aud` claim below is belt and
 * braces on top of that — the signature is what actually keeps an admin token
 * and a member token from ever being mistaken for one another, because a
 * verifier can forget to check an audience but cannot forget to check a
 * signature.
 */
const MEMBER_AUDIENCE = "bc:member";

export interface MemberJwtPayload {
  sub: number;
  email: string;
  /** Set when an admin is viewing the site as this member. Audit-logged at issue time. */
  impersonatedBy?: number;
}

export function signMemberAccessToken(payload: MemberJwtPayload, sessionExpiresAt?: string | Date): string {
  return jwt.sign(payload, memberTokenSecret(), {
    algorithm: "HS256",
    audience: MEMBER_AUDIENCE,
    expiresIn: sessionExpiresAt
      ? Math.max(1, Math.min(ACCESS_TOKEN_TTL_SECONDS, Math.floor((new Date(sessionExpiresAt).getTime() - Date.now()) / 1000)))
      : ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyMemberAccessToken(token: string): MemberJwtPayload {
  return jwt.verify(token, memberTokenSecret(), {
    algorithms: ["HS256"],
    audience: MEMBER_AUDIENCE,
  }) as unknown as MemberJwtPayload;
}

/** Cookie attributes. Secure is dropped in dev so localhost still works over http. */
function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax" as const,
    // Scoped to the refresh/logout endpoints: the cookie is never sent on the
    // hundreds of ordinary /api reads, which is both less exposure and less
    // CSRF surface to reason about.
    path: "/api/auth",
    maxAge: maxAgeMs,
  };
}

export function setRefreshCookie(res: Response, rawToken: string, sessionExpiresAt?: string | Date): void {
  const remaining = sessionExpiresAt ? Math.max(0, new Date(sessionExpiresAt).getTime() - Date.now()) : REFRESH_TOKEN_TTL_SECONDS * 1000;
  res.cookie(REFRESH_COOKIE, rawToken, cookieOptions(remaining));
  // Readable by script and site-wide in scope, unlike the token itself, so the
  // app can decide whether a silent refresh is worth attempting.
  res.cookie(SESSION_HINT_COOKIE, "1", {
    httpOnly: false,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: remaining,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(0), maxAge: undefined });
  // The receipt-download cookie lives and dies with the session (see
  // auth/memberDocumentCookie.ts). Clearing it here covers every path that ends
  // one: logout, a failed refresh, a password reset, "sign out this device".
  clearDocumentCookie(res);
  res.clearCookie(SESSION_HINT_COOKIE, {
    httpOnly: false,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
  });
}

export interface IssueSessionInput {
  memberId: number;
  userAgent?: string;
  ip?: string;
  /** Set when this session replaces a rotated one. */
  previousId?: number | null;
}

/** Creates a session row and returns the raw refresh token (the only time it exists). */
export async function issueRefreshToken(input: IssueSessionInput): Promise<string> {
  const raw = generateToken();
  await pool.query(
    `INSERT INTO member_sessions (member_id, token_hash, previous_id, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.memberId,
      hashToken(raw),
      input.previousId ?? null,
      (input.userAgent ?? "").slice(0, 500),
      (input.ip ?? "").slice(0, 64),
      expiresIn(REFRESH_TOKEN_TTL_SECONDS),
    ]
  );
  return raw;
}

interface SessionRow {
  id: number;
  member_id: number;
  revoked_at: string | null;
  revoked_reason: string;
  expires_at: string;
}

/**
 * How long after a rotation a second presentation of the old token is still
 * treated as an honest race rather than theft.
 *
 * Two tabs restored together, or a phone and a laptop waking at the same
 * moment, present the identical cookie within milliseconds of each other. That
 * has to keep working. A stolen token replayed inside the same few seconds also
 * gets through, which is the accepted trade every rotating-refresh
 * implementation makes — the alternative is signing honest people out daily.
 */
const ROTATION_GRACE_MS = 30_000;

/** Revocations that are the member's own doing, and must never look like theft. */
const DELIBERATE_REVOCATIONS = new Set(["logout", "admin", "password_change", "suspended"]);

export type RefreshOutcome =
  | { status: "ok"; memberId: number; refreshToken: string; expiresAt: string }
  | { status: "invalid" }
  /** The token was valid once and has already been rotated — treated as theft. */
  | { status: "reused"; memberId: number };

/**
 * Rotates a refresh token.
 *
 * `SELECT ... FOR UPDATE` serialises two simultaneous refreshes, but on its own
 * that is not enough: the transaction that loses the race then re-reads the row
 * with `revoked_at` already set by the winner, and a naive implementation reads
 * that as a replayed token and signs the member out everywhere. Two tabs
 * restored at once is all it takes.
 *
 * So a revoked row is classified rather than rejected outright:
 *
 *   - revoked deliberately (logout, admin action, password change) — invalid,
 *     but not theft. Burning the chain here would mean signing out of device B
 *     also signs out device A, which asked for it.
 *   - rotated within the grace window, successor still live — an honest
 *     concurrent refresh. Issue a fresh token on the same chain.
 *   - rotated outside the window, or the successor is already gone — a token
 *     that should no longer exist has been presented. Burn every session.
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: { userAgent?: string; ip?: string }
): Promise<RefreshOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const found = await client.query<SessionRow>(
      `SELECT id, member_id, revoked_at, revoked_reason, expires_at
         FROM member_sessions
        WHERE token_hash = $1
        FOR UPDATE`,
      [hashToken(rawToken)]
    );

    const session = found.rows[0];
    if (!session) {
      await client.query("ROLLBACK");
      return { status: "invalid" };
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE member_sessions SET revoked_at = now(), revoked_reason = 'expired' WHERE id = $1`,
        [session.id]
      );
      await client.query("COMMIT");
      return { status: "invalid" };
    }

    if (session.revoked_at) {
      if (DELIBERATE_REVOCATIONS.has(session.revoked_reason)) {
        await client.query("ROLLBACK");
        return { status: "invalid" };
      }

      const age = Date.now() - new Date(session.revoked_at).getTime();
      if (age <= ROTATION_GRACE_MS) {
        // Confirm the chain is genuinely still live before forgiving this. If
        // the successor has itself been revoked, the sequence is not a race —
        // something is replaying an old token from further back.
        const successor = await client.query<{ id: number }>(
          `SELECT id FROM member_sessions
            WHERE previous_id = $1 AND revoked_at IS NULL AND expires_at > now()
            LIMIT 1`,
          [session.id]
        );

        if (successor.rows[0]) {
          const raced = generateToken();
          await client.query(
            `INSERT INTO member_sessions
               (member_id, token_hash, previous_id, user_agent, ip, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              session.member_id,
              hashToken(raced),
              session.id,
              (meta.userAgent ?? "").slice(0, 500),
              (meta.ip ?? "").slice(0, 64),
              new Date(session.expires_at),
            ]
          );
          await client.query("COMMIT");
          return { status: "ok", memberId: session.member_id, refreshToken: raced, expiresAt: new Date(session.expires_at).toISOString() };
        }
      }

      await client.query(
        `UPDATE member_sessions SET revoked_at = now(), revoked_reason = 'reuse'
          WHERE member_id = $1 AND revoked_at IS NULL`,
        [session.member_id]
      );
      await client.query("COMMIT");
      return { status: "reused", memberId: session.member_id };
    }



    const raw = generateToken();
    await client.query(
      `UPDATE member_sessions
          SET revoked_at = now(), revoked_reason = 'rotated', last_used_at = now()
        WHERE id = $1`,
      [session.id]
    );
    await client.query(
      `INSERT INTO member_sessions (member_id, token_hash, previous_id, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.member_id,
        hashToken(raw),
        session.id,
        (meta.userAgent ?? "").slice(0, 500),
        (meta.ip ?? "").slice(0, 64),
        new Date(session.expires_at),
      ]
    );

    await client.query("COMMIT");
    return { status: "ok", memberId: session.member_id, refreshToken: raw, expiresAt: new Date(session.expires_at).toISOString() };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reasons a session ends that are the member's or the admin's own doing.
 *
 * These are recorded so a later presentation of the token is read as "this
 * session is over" rather than as theft — see rotateRefreshToken.
 */
export type DeliberateRevocation = "logout" | "admin" | "password_change" | "suspended";

/** Revokes one session by its raw token (logout on this device). */
export async function revokeRefreshToken(
  rawToken: string,
  reason: DeliberateRevocation = "logout"
): Promise<void> {
  await pool.query(
    `UPDATE member_sessions SET revoked_at = now(), revoked_reason = $2
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(rawToken), reason]
  );
}

/** Revokes every live session for a member (password change, admin suspend, GDPR delete). */
export async function revokeAllMemberSessions(
  memberId: number,
  reason: DeliberateRevocation = "admin"
): Promise<void> {
  await pool.query(
    `UPDATE member_sessions SET revoked_at = now(), revoked_reason = $2
      WHERE member_id = $1 AND revoked_at IS NULL`,
    [memberId, reason]
  );
}
