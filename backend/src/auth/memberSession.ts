import type { Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { generateToken, hashToken, expiresIn } from "./tokens";
import { memberTokenSecret } from "./secrets";

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

export function signMemberAccessToken(payload: MemberJwtPayload): string {
  return jwt.sign(payload, memberTokenSecret(), {
    algorithm: "HS256",
    audience: MEMBER_AUDIENCE,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
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

export function setRefreshCookie(res: Response, rawToken: string): void {
  res.cookie(REFRESH_COOKIE, rawToken, cookieOptions(REFRESH_TOKEN_TTL_SECONDS * 1000));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(0), maxAge: undefined });
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
  expires_at: string;
}

export type RefreshOutcome =
  | { status: "ok"; memberId: number; refreshToken: string }
  | { status: "invalid" }
  /** The token was valid once and has already been rotated — treated as theft. */
  | { status: "reused"; memberId: number };

/**
 * Rotates a refresh token.
 *
 * Runs in a transaction with `SELECT ... FOR UPDATE` so two tabs refreshing at
 * the same instant cannot both mint a successor from the same row — without the
 * lock, the loser of that race looks exactly like token theft and would log the
 * member out for doing nothing wrong.
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: { userAgent?: string; ip?: string }
): Promise<RefreshOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const found = await client.query<SessionRow>(
      `SELECT id, member_id, revoked_at, expires_at
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

    // Already rotated or explicitly logged out, yet presented again: the only
    // way that happens is a copy of the token surviving somewhere it shouldn't.
    // Burn every session this member has rather than just this one.
    if (session.revoked_at) {
      await client.query(
        `UPDATE member_sessions SET revoked_at = now()
          WHERE member_id = $1 AND revoked_at IS NULL`,
        [session.member_id]
      );
      await client.query("COMMIT");
      return { status: "reused", memberId: session.member_id };
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await client.query(`UPDATE member_sessions SET revoked_at = now() WHERE id = $1`, [
        session.id,
      ]);
      await client.query("COMMIT");
      return { status: "invalid" };
    }

    const raw = generateToken();
    await client.query(
      `UPDATE member_sessions SET revoked_at = now(), last_used_at = now() WHERE id = $1`,
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
        expiresIn(REFRESH_TOKEN_TTL_SECONDS),
      ]
    );

    await client.query("COMMIT");
    return { status: "ok", memberId: session.member_id, refreshToken: raw };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Revokes one session by its raw token (logout on this device). */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await pool.query(
    `UPDATE member_sessions SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(rawToken)]
  );
}

/** Revokes every live session for a member (password change, admin suspend, GDPR delete). */
export async function revokeAllMemberSessions(memberId: number): Promise<void> {
  await pool.query(
    `UPDATE member_sessions SET revoked_at = now()
      WHERE member_id = $1 AND revoked_at IS NULL`,
    [memberId]
  );
}
