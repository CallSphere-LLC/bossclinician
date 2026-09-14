import type { Request, Response, NextFunction } from "express";
import { pool } from "../db/pool";
import { expiresIn, generateToken, hashToken } from "./tokens";
import { signToken, verifyToken } from "../utils/jwt";
import { forbidden, unauthorized } from "../utils/httpError";
import { env } from "../config/env";

export const ADMIN_ACCESS_COOKIE = "__Host-bc_admin_session";
export const ADMIN_REFRESH_COOKIE = "__Host-bc_admin_refresh";
export const ADMIN_ACCESS_SECONDS = 5 * 60;
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

/** The admin API does not exist on the public/member virtual host. */
export function requireAdminHost(req: Request, _res: Response, next: NextFunction): void {
  if (env.adminOrigin && req.get("host")?.toLowerCase() !== new URL(env.adminOrigin).host.toLowerCase()) {
    next(unauthorized("Admin access is only available on the admin site."));
    return;
  }
  next();
}

export function adminAccessToken(req: Request): string | null {
  // Explicit bearer credentials retain their existing API semantics; browser
  // clients never receive or store one. A member bearer cannot borrow a cookie.
  const header = req.headers.authorization;
  if (header) return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  return req.cookies?.[ADMIN_ACCESS_COOKIE] ?? null;
}

/** Reject cross-origin browser writes before any admin handler can mutate data. */
export function adminCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  const expected = env.adminOrigin || (env.frontendOrigin !== "*" ? env.frontendOrigin : `${req.protocol}://${req.get("host")}`);
  if (origin && origin !== expected) return next(forbidden("This request must come from the admin site."));
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return next(forbidden("This request must come from the admin site."));
  }
  // Non-browser bearer clients are not subject to ambient-cookie CSRF. Browser
  // requests and all login/refresh/logout requests must prove the origin.
  if (!origin && fetchSite !== "same-origin" && !req.headers.authorization?.startsWith("Bearer ")) {
    return next(forbidden("The request origin could not be verified."));
  }
  next();
}

export function clearAdminCookies(res: Response): void {
  res.clearCookie(ADMIN_ACCESS_COOKIE, cookieOptions);
  res.clearCookie(ADMIN_REFRESH_COOKIE, cookieOptions);
  res.setHeader("Cache-Control", "no-store");
}

export function setAdminCookies(res: Response, session: { accessToken: string; refreshToken: string; expiresAt: Date }): void {
  res.cookie(ADMIN_ACCESS_COOKIE, session.accessToken, { ...cookieOptions, maxAge: ADMIN_ACCESS_SECONDS * 1000 });
  res.cookie(ADMIN_REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, expires: session.expiresAt });
  res.setHeader("Cache-Control", "no-store");
}

export interface AdminSessionInput {
  adminUserId: number; email: string; role: string; userAgent: string; ip: string; ttlSeconds: number;
}

/** Revocable short-lived bearer sessions for internal API clients and tests. */
export async function issueAdminSession(input: AdminSessionInput): Promise<string> {
  return (await createSession(input, false)).accessToken;
}

/** Login-only opaque refresh credential; it never enters a JSON response. */
export async function issueAdminCookieSession(input: Omit<AdminSessionInput, "ttlSeconds">) {
  return createSession({ ...input, ttlSeconds: ADMIN_SESSION_SECONDS }, true);
}

async function createSession(input: AdminSessionInput, refreshable: boolean) {
  const refreshToken = refreshable ? generateToken() : "";
  const placeholder = generateToken();
  const userAgent = input.userAgent.slice(0, 400);
  const ip = input.ip.slice(0, 64);
  const interactive = !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip) && !/^(node|curl|wget|codex)/i.test(userAgent.trim());
  const expiresAt = expiresIn(refreshable ? ADMIN_SESSION_SECONDS : Math.min(input.ttlSeconds, ADMIN_ACCESS_SECONDS));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (interactive) await client.query(
      `UPDATE admin_sessions SET revoked_at = now() WHERE admin_user_id = $1 AND user_agent = $2 AND ip = $3 AND interactive = true AND revoked_at IS NULL`,
      [input.adminUserId, userAgent, ip],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO admin_sessions (admin_user_id,token_hash,user_agent,ip,expires_at,last_used_at,interactive,refresh_hash)
       VALUES ($1,$2,$3,$4,$5,now(),$6,$7) RETURNING id`,
      [input.adminUserId, hashToken(placeholder), userAgent, ip, expiresAt, interactive, refreshable ? hashToken(refreshToken) : null],
    );
    const accessToken = signToken({ sub: input.adminUserId, email: input.email, role: input.role, sessionId: inserted.rows[0]!.id });
    await client.query(`UPDATE admin_sessions SET token_hash = $1 WHERE id = $2`, [hashToken(accessToken), inserted.rows[0]!.id]);
    await client.query("COMMIT");
    return { accessToken, refreshToken, expiresAt };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Refresh keeps the absolute eight-hour session deadline and revocation row. */
export async function refreshAdminCookieSession(refreshToken: string) {
  const found = await pool.query<{ id: string; admin_user_id: number; email: string; role: string; expires_at: Date }>(
    `SELECT s.id,s.admin_user_id,u.email,u.role,s.expires_at FROM admin_sessions s JOIN admin_users u ON u.id=s.admin_user_id
     WHERE s.refresh_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'`, [hashToken(refreshToken)],
  );
  const row = found.rows[0];
  if (!row) throw unauthorized("Your session has ended. Please sign in again.");
  // Each access token references the same revocable session. Concurrent tabs
  // may refresh together without invalidating each other's in-flight requests.
  const accessToken = signToken({ sub: row.admin_user_id, email: row.email, role: row.role, sessionId: row.id });
  return { accessToken, refreshToken, expiresAt: row.expires_at };
}

export async function revokeAdminSessionByToken(token: string): Promise<void> {
  let sessionId: string | null = null;
  let adminId: number | null = null;
  try {
    const payload = verifyToken(token, true);
    sessionId = payload.sessionId ?? null;
    adminId = payload.sub;
  } catch { /* A legacy invalid token can only match its exact stored hash. */ }
  await pool.query(`UPDATE admin_sessions SET revoked_at=now()
    WHERE (token_hash=$1 OR (id=$2::bigint AND admin_user_id=$3)) AND revoked_at IS NULL`, [hashToken(token), sessionId, adminId]);
}

export async function revokeAdminCookieSession(req: Request): Promise<void> {
  const refresh = req.cookies?.[ADMIN_REFRESH_COOKIE];
  if (typeof refresh === "string") await pool.query(`UPDATE admin_sessions SET revoked_at=now() WHERE refresh_hash=$1 AND revoked_at IS NULL`, [hashToken(refresh)]);
  const access = adminAccessToken(req);
  if (access) await revokeAdminSessionByToken(access);
}
