import crypto from "crypto";
import type { Request, Response } from "express";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { hashToken } from "./tokens";
import type { AuthedMember } from "../middleware/memberAuth";

/**
 * The member's document cookie: what lets a plain browser GET to
 * /account/purchases/:orderId/receipt.pdf arrive signed in.
 *
 * Member API calls authenticate with a Bearer token held in memory, and the
 * refresh cookie is scoped to /api/auth, so a navigation to an /account URL —
 * a bookmark, a link pasted into an email to a bookkeeper, `curl` — carries no
 * credential at all. This cookie is the one a browser does send there.
 *
 * Why a dedicated cookie rather than widening the refresh cookie's path:
 *
 *  - **Capability.** The refresh cookie mints access tokens for thirty days and
 *    is honoured by exactly one endpoint that rotates it. Sending it on every
 *    /account navigation would expose that credential to far more requests for
 *    no gain. This cookie is honoured by the receipt PDF routes and nothing
 *    else: it cannot mint a token, read the API, or change anything.
 *  - **No new secret to steal.** The value is not a token of its own. It is a
 *    signed pointer to the member's current `member_sessions` row — session id,
 *    member id, expiry, HMAC under a key derived for this purpose alone — so a
 *    copy of it is worth nothing once that row is gone.
 *  - **Lifetime and revocation follow the session exactly.** Every request
 *    re-checks the row in SQL: not revoked, not expired, and the member neither
 *    suspended nor deleted. Logout, "sign out that device", a password reset or
 *    change, an admin revoke, suspension, erasure and refresh-token reuse
 *    detection all revoke the row, and the cookie dies with it — whether or not
 *    the browser still holds it. It is also cleared wherever the refresh cookie
 *    is cleared, and re-minted on every rotation, because rotation revokes the
 *    row the previous value pointed at.
 *  - **CSRF.** The only route that reads it is a GET that changes nothing.
 *    SameSite=Lax keeps it off cross-site subresource requests (an <img> or a
 *    fetch from another site), and a cross-site top-level link — the case that
 *    is wanted, an emailed link — can do no more than save the member's own
 *    receipt into their own downloads folder.
 *  - **Script.** HttpOnly: nothing on the page can read it.
 */

export const DOCUMENT_COOKIE = "bc_member_docs";

/** The one place a browser sends it. Covers purchases and billing invoices both. */
export const DOCUMENT_COOKIE_PATH = "/account/";

const DOCUMENT_COOKIE_INFO = "bossclinician/member-document-cookie/v1";

/** Bumped if the payload layout changes, so old cookies fail closed. */
const VERSION = "d1";

let signingKey: Buffer | null = null;

function key(): Buffer {
  if (signingKey === null) {
    signingKey = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        Buffer.from(env.jwtSecret, "utf8"),
        Buffer.alloc(0),
        Buffer.from(DOCUMENT_COOKIE_INFO, "utf8"),
        32
      )
    );
  }
  return signingKey;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", key()).update(body).digest("base64url");
}

function cookieOptions() {
  return {
    httpOnly: true,
    // Same rule as the refresh cookie: dropped in dev so localhost works over http.
    secure: env.nodeEnv === "production",
    sameSite: "lax" as const,
    path: DOCUMENT_COOKIE_PATH,
  };
}

export interface DocumentCookiePayload {
  sessionId: number;
  memberId: number;
  /** Unix seconds; the session row's own expiry. */
  expiresAt: number;
}

/** The cookie value for one session. Exported for tests. */
export function signDocumentCookie(payload: DocumentCookiePayload): string {
  const body = Buffer.from(
    [VERSION, payload.sessionId, payload.memberId, payload.expiresAt].join("."),
    "utf8"
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** The payload of a value whose signature and expiry both hold, or null. */
export function verifyDocumentCookie(
  value: string,
  now: Date = new Date()
): DocumentCookiePayload | null {
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, provided] = parts;
  if (!body || !provided) return null;

  const expected = sign(body);
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  const fields = Buffer.from(body, "base64url").toString("utf8").split(".");
  if (fields.length !== 4 || fields[0] !== VERSION) return null;
  const [sessionId, memberId, expiresAt] = fields.slice(1).map(Number);
  if (
    !Number.isSafeInteger(sessionId) ||
    !Number.isSafeInteger(memberId) ||
    !Number.isSafeInteger(expiresAt) ||
    sessionId <= 0 ||
    memberId <= 0
  ) {
    return null;
  }
  if (expiresAt * 1000 <= now.getTime()) return null;
  return { sessionId, memberId, expiresAt };
}

/**
 * Sets the document cookie for the session a refresh token belongs to.
 *
 * Called beside `setRefreshCookie` with the same raw token. Looks the row up by
 * hash rather than widening the session functions' return types; a token with
 * no live row (which cannot happen straight after issuing one) sets nothing.
 */
export async function setDocumentCookie(res: Response, rawRefreshToken: string): Promise<void> {
  const found = await pool.query<{ id: string | number; member_id: number; expires_at: Date }>(
    `SELECT id, member_id, expires_at FROM member_sessions
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(rawRefreshToken)]
  );
  const row = found.rows[0];
  if (!row) return;

  const expiresAtMs = new Date(row.expires_at).getTime();
  const value = signDocumentCookie({
    sessionId: Number(row.id),
    memberId: row.member_id,
    expiresAt: Math.floor(expiresAtMs / 1000),
  });
  res.cookie(DOCUMENT_COOKIE, value, {
    ...cookieOptions(),
    maxAge: Math.max(0, expiresAtMs - Date.now()),
  });
}

export function clearDocumentCookie(res: Response): void {
  res.clearCookie(DOCUMENT_COOKIE, cookieOptions());
}

/**
 * The member a request's document cookie proves, or null.
 *
 * Null for no cookie, a forged or expired one, a session that has been revoked
 * for any reason (including rotation), and an account that is suspended or
 * deleted — the same questions `requireMember` asks of a Bearer token, plus the
 * one a Bearer token cannot answer: is the session still alive.
 */
export async function memberFromDocumentCookie(req: Request): Promise<AuthedMember | null> {
  const jar = req.cookies as Record<string, unknown> | undefined;
  const raw = jar?.[DOCUMENT_COOKIE];
  if (typeof raw !== "string" || raw.length === 0) return null;

  const payload = verifyDocumentCookie(raw);
  if (payload === null) return null;

  const found = await pool.query<{
    id: number;
    email: string;
    status: string;
    email_verified_at: string | null;
  }>(
    `SELECT m.id, m.email, m.status, m.email_verified_at
       FROM member_sessions s
       JOIN members m ON m.id = s.member_id
      WHERE s.id = $1
        AND s.member_id = $2
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [payload.sessionId, payload.memberId]
  );
  const row = found.rows[0];
  if (!row || row.status === "suspended" || row.status === "deleted") return null;

  return {
    id: row.id,
    email: row.email,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
  };
}
