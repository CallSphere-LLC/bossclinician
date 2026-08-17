import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { loginSchema } from "../../validation/schemas";
import { badRequest, unauthorized } from "../../utils/httpError";
import { signToken } from "../../utils/jwt";
import { requireAuth } from "../../middleware/auth";
import { loginIpLimiter, loginEmailLimiter } from "../../middleware/rateLimit";
import { rowToCamel } from "../../utils/case";
import { AdminUser } from "../../types";

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

    const result = await pool.query(
      "SELECT id, email, password_hash, name, role, created_at FROM admin_users WHERE email = $1",
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

    const token = signToken({ sub: row.id, email: row.email, role: row.role });
    const user = rowToCamel<AdminUser>({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      created_at: row.created_at,
    });

    res.json({ token, user });
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
