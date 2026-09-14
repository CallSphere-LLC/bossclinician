import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { loginSchema } from "../../validation/schemas";
import { badRequest, unauthorized } from "../../utils/httpError";
import { requireAuth } from "../../middleware/auth";
import { loginIpLimiter, loginEmailLimiter } from "../../middleware/rateLimit";
import { rowToCamel } from "../../utils/case";
import { AdminUser } from "../../types";
import { ADMIN_REFRESH_COOKIE, issueAdminCookieSession, refreshAdminCookieSession, setAdminCookies, clearAdminCookies, revokeAdminCookieSession } from "../../auth/adminSession";
import { verifySecondFactor } from "../../services/mfa";

export const authRouter = Router();

// Precomputed bcrypt hash (cost 12) of a value nobody will ever type. Used to
// keep the "email not found" path's timing indistinguishable from the
// "email found, password wrong" path, so responses don't leak which is which.
const DUMMY_PASSWORD_HASH =
  "$2b$12$NA4go6EuMN5fPAkc7SUIbOwRRackOhFAPs0bc.2qhYsWdayZ/vdeC";


authRouter.post(
  "/login",
  loginIpLimiter,
  loginEmailLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid login payload", parsed.error.flatten());
    const { email, password } = parsed.data;
    const submittedCode = typeof req.body?.code === "string" ? req.body.code : "";

    const result = await pool.query(
      `SELECT id, email, password_hash, name, role, created_at, status, mfa_enabled, mfa_secret
         FROM admin_users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      // No such user: still run a bcrypt compare against a dummy hash so this
      // path takes about as long as the "wrong password" path below, and
      // don't reveal (via timing or message) that the email doesn't exist.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw unauthorized("Invalid email or password");
    }

    const row = result.rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) throw unauthorized("Invalid email or password");

    // A suspended account has the right password and no business being here;
    // an invited one has not set a password yet, so it cannot reach this line
    // legitimately at all. Both answer the same as a wrong password, because
    // "your account was suspended" is information an attacker can use.
    if (row.status !== "active") throw unauthorized("Invalid email or password");

    if (row.mfa_enabled) {
      if (!submittedCode) {
        // Deliberately after the password check: asking for a second factor
        // before the first one is right would confirm that the email exists.
        res.status(401).json({ error: "Enter the code from your app.", mfaRequired: true });
        return;
      }
      const secondFactorOk = await verifySecondFactor(
        row.id,
        row.mfa_secret ?? "",
        submittedCode
      );
      if (!secondFactorOk) {
        res.status(401).json({ error: "That code didn't match.", mfaRequired: true });
        return;
      }
    }

    // The token is minted alongside the row that makes it revocable — a JWT on
    // its own cannot be withdrawn before it expires, which is the whole reason
    // admin_sessions exists.
    const session = await issueAdminCookieSession({
      adminUserId: row.id,
      email: row.email,
      role: row.role,
      userAgent: String(req.headers["user-agent"] ?? ""),
      ip: req.ip ?? "",
    });

    await pool.query(`UPDATE admin_users SET last_login_at = now() WHERE id = $1`, [row.id]);

    const user = rowToCamel<AdminUser>({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      created_at: row.created_at,
    });

    setAdminCookies(res, session);
    res.json({ user });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT id, email, name, role, created_at FROM admin_users WHERE id = $1",
      [req.user!.sub]
    );
    if (result.rows.length === 0) throw unauthorized("User not found");
    res.json(rowToCamel<AdminUser>(result.rows[0]));
  })
);

/**
 * Signing out.
 *
 * Ends the session server-side rather than trusting the browser to forget the
 * token. Unauthenticated on purpose: a token that has already been rejected as
 * expired should still be revocable, and there is nothing to gain from
 * presenting somebody else's token here — the only effect is ending it.
 */
authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    await revokeAdminCookieSession(req);
    clearAdminCookies(res);
    res.status(204).end();
  })
);

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[ADMIN_REFRESH_COOKIE];
  if (typeof refreshToken !== "string" || !refreshToken) throw unauthorized("Missing admin session");
  try {
    setAdminCookies(res, await refreshAdminCookieSession(refreshToken));
    res.status(204).end();
  } catch (error) {
    clearAdminCookies(res);
    throw error;
  }
}));
