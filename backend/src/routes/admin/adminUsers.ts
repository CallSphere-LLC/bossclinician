import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound, unauthorized } from "../../utils/httpError";
import { rowsToCamel } from "../../utils/case";
import { expiresIn, generateToken, hashToken } from "../../auth/tokens";
import { checkPasswordStrength, hashPassword } from "../../auth/password";
import { signToken } from "../../utils/jwt";
import { sendMail } from "../../email/mailer";
import { escapeHtml } from "../../email/templates";
import { recordAdminAction } from "../../services/adminAudit";
import { ROLES, ROLE_DESCRIPTORS, requirePermission } from "../../services/permissions";
import {
  countUnusedRecoveryCodes,
  generateSecret,
  issueRecoveryCodes,
  otpauthUrl,
  verifyCode,
  verifySecondFactor,
} from "../../services/mfa";

/**
 * The people who can get into this admin, what they can do, and how they prove
 * who they are.
 *
 * Two rules are enforced everywhere below and are worth stating once:
 *
 *  - An owner can only be changed or removed by another owner. Anything else
 *    means a manager can demote the person who owns the business.
 *  - The last owner cannot be removed, demoted or suspended by anyone,
 *    including themselves. There is no support desk behind this admin; an
 *    account list with no owner in it is recoverable only by someone with a
 *    psql prompt, and that is not a state a button should be able to produce.
 */
export const adminUsersRouter = Router();

/** Invites are accepted by someone who is not signed in yet — see the mount notes. */
export const adminInviteRouter = Router();

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

/* ------------------------------------------------------------------ helpers */

interface AdminRow {
  id: number;
  email: string;
  name: string;
  role: string;
  status: string;
  mfa_enabled: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

const ADMIN_COLUMNS = `id, email, name, role, status, mfa_enabled, last_login_at, created_at`;

async function loadAdmin(id: number): Promise<AdminRow | null> {
  const res = await pool.query<AdminRow>(
    `SELECT ${ADMIN_COLUMNS} FROM admin_users WHERE id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

async function ownerCount(): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM admin_users WHERE role = 'owner' AND status <> 'suspended'`
  );
  return Number(res.rows[0]?.count ?? 0);
}

/** The actor, straight from the token — never from the body. */
function actorId(req: { user?: { sub: number } }): number {
  return req.user?.sub ?? 0;
}

function actorIsOwner(req: { user?: { role: string } }): boolean {
  return req.user?.role === "owner";
}

/**
 * Refuses an action against an owner by anyone who is not one, and any action
 * that would leave the business with no owner at all.
 */
async function assertMayChange(
  req: { user?: { sub: number; role: string } },
  target: AdminRow,
  options: { removesOwner: boolean }
): Promise<void> {
  if (target.role === "owner" && !actorIsOwner(req)) {
    throw forbidden("Only an owner can change another owner's account.");
  }

  if (options.removesOwner && target.role === "owner" && (await ownerCount()) <= 1) {
    throw badRequest(
      "This is the only owner account. Make someone else an owner first, or you'll lock everyone out."
    );
  }

  if (options.removesOwner && target.id === actorId(req) && target.role === "owner") {
    throw badRequest("You can't remove your own owner access.");
  }
}

/* --------------------------------------------------------------------- list */

adminUsersRouter.get(
  "/",
  requirePermission("admins.view"),
  asyncHandler(async (_req, res) => {
    const people = await pool.query(
      `SELECT ${ADMIN_COLUMNS} FROM admin_users ORDER BY
         -- Owners first, then by name: this list is read to answer "who has
         -- access", and the answer starts with the people who have all of it.
         CASE role WHEN 'owner' THEN 0 ELSE 1 END, lower(name), lower(email)`
    );

    const invites = await pool.query(
      `SELECT i.id, i.email, i.role, i.expires_at, i.created_at, u.name AS invited_by_name
         FROM admin_invites i
         LEFT JOIN admin_users u ON u.id = i.invited_by
        WHERE i.accepted_at IS NULL AND i.expires_at > now()
        ORDER BY i.created_at DESC`
    );

    res.json({ people: rowsToCamel(people.rows), invites: rowsToCamel(invites.rows) });
  })
);

/** The roles as sentences, for the picker. Never a permission matrix on screen. */
adminUsersRouter.get(
  "/roles",
  requirePermission("admins.view"),
  asyncHandler(async (_req, res) => {
    res.json({ roles: ROLE_DESCRIPTORS });
  })
);

/* ------------------------------------------------------------------ invites */

const inviteSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().max(200).default(""),
  // An owner is never created by invitation: promoting somebody to owner is a
  // separate, deliberate act by an existing owner on an account that already
  // exists.
  role: z.enum(["admin", "marketing", "support", "coach"]),
});

adminUsersRouter.post(
  "/invite",
  requirePermission("admins.manage"),
  asyncHandler(async (req, res) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());

    // The column is plain TEXT with a UNIQUE index, so case is significant and
    // "Sam@" and "sam@" would be two accounts. Folded here so it cannot happen.
    const email = parsed.data.email.trim().toLowerCase();

    const existing = await pool.query<{ id: number; status: string }>(
      `SELECT id, status FROM admin_users WHERE lower(email) = $1`,
      [email]
    );
    if (existing.rows[0]) {
      throw badRequest("Someone with that email already has access.");
    }

    const token = generateToken();
    const client = await pool.connect();
    let invitedId = 0;

    try {
      await client.query("BEGIN");

      // The account exists from the moment the invitation is sent, so the list
      // shows the person as pending and their email is reserved. It carries a
      // password nobody knows — a hash of a value that is thrown away — rather
      // than a nullable column that a login path could one day treat as "no
      // password required".
      const created = await client.query<{ id: number }>(
        `INSERT INTO admin_users (email, password_hash, name, role, status)
         VALUES ($1, $2, $3, $4, 'invited')
         RETURNING id`,
        [email, await hashPassword(generateToken()), parsed.data.name, parsed.data.role]
      );
      invitedId = created.rows[0]?.id ?? 0;

      await client.query(
        `INSERT INTO admin_invites (email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [email, parsed.data.role, hashToken(token), actorId(req), expiresIn(INVITE_TTL_SECONDS)]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const link = `${env.publicSiteUrl}/admin/invite/${token}`;
    await sendMail({
      to: email,
      subject: "You've been given access to Boss Clinician",
      text: `You've been invited to help run Boss Clinician.\n\nSet your password here:\n${link}\n\nThis link works for 7 days.`,
      html: `<p>You've been invited to help run Boss Clinician.</p><p><a href="${escapeHtml(link)}">Set your password</a></p><p>This link works for 7 days.</p>`,
    });

    await recordAdminAction({
      req,
      action: "admin.invite",
      entityType: "admin_user",
      entityId: invitedId,
      after: { email, role: parsed.data.role },
    });

    res.status(201).json({ email, role: parsed.data.role });
  })
);

adminUsersRouter.delete(
  "/invites/:id",
  requirePermission("admins.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const invite = await pool.query<{ email: string }>(
      `DELETE FROM admin_invites WHERE id = $1 AND accepted_at IS NULL RETURNING email`,
      [id]
    );
    const email = invite.rows[0]?.email;
    if (!email) throw notFound("That invitation has already been used or withdrawn.");

    // The placeholder account goes with it, or the email stays reserved by a
    // person who never joined.
    await pool.query(`DELETE FROM admin_users WHERE lower(email) = $1 AND status = 'invited'`, [
      email.toLowerCase(),
    ]);

    await recordAdminAction({
      req,
      action: "admin.inviteWithdrawn",
      entityType: "admin_invite",
      entityId: id,
      before: { email },
    });

    res.status(204).end();
  })
);

/* ---------------------------------------------------- accepting an invite */

async function findInvite(token: string): Promise<{
  id: number;
  email: string;
  role: string;
  expires_at: Date;
} | null> {
  const res = await pool.query<{ id: number; email: string; role: string; expires_at: Date }>(
    `SELECT id, email, role, expires_at
       FROM admin_invites
      WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [hashToken(token)]
  );
  return res.rows[0] ?? null;
}

adminInviteRouter.get(
  "/invite/:token",
  asyncHandler(async (req, res) => {
    const invite = await findInvite(req.params.token);
    if (!invite) throw notFound("That invitation has expired or has already been used.");
    res.json({ email: invite.email, role: invite.role, expiresAt: invite.expires_at });
  })
);

const acceptSchema = z.object({
  name: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

adminInviteRouter.post(
  "/invite/:token",
  asyncHandler(async (req, res) => {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());

    const strength = checkPasswordStrength(parsed.data.password);
    if (!strength.ok) throw badRequest(strength.reason ?? "Please pick a stronger password.");

    const invite = await findInvite(req.params.token);
    if (!invite) throw notFound("That invitation has expired or has already been used.");

    const passwordHash = await hashPassword(parsed.data.password);
    const client = await pool.connect();
    let admin: AdminRow | null = null;

    try {
      await client.query("BEGIN");

      // Consumed under the same transaction as the account change, and only if
      // it is still unaccepted — two people opening the same link cannot both
      // set a password.
      const claimed = await client.query(
        `UPDATE admin_invites SET accepted_at = now()
          WHERE id = $1 AND accepted_at IS NULL`,
        [invite.id]
      );
      if ((claimed.rowCount ?? 0) === 0) {
        throw notFound("That invitation has already been used.");
      }

      const updated = await client.query<AdminRow>(
        `UPDATE admin_users
            SET password_hash = $2, name = $3, role = $4, status = 'active', updated_at = now()
          WHERE lower(email) = $1
          RETURNING ${ADMIN_COLUMNS}`,
        [invite.email.toLowerCase(), passwordHash, parsed.data.name, invite.role]
      );
      admin = updated.rows[0] ?? null;

      if (!admin) {
        // The placeholder was deleted out from under the invitation.
        const created = await client.query<AdminRow>(
          `INSERT INTO admin_users (email, password_hash, name, role, status)
           VALUES ($1, $2, $3, $4, 'active')
           RETURNING ${ADMIN_COLUMNS}`,
          [invite.email.toLowerCase(), passwordHash, parsed.data.name, invite.role]
        );
        admin = created.rows[0] ?? null;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    if (!admin) throw badRequest("We couldn't set that account up. Please ask for a new invite.");

    res.status(201).json({
      ok: true,
      email: admin.email,
      // No token: accepting an invitation lands on the sign-in screen, so the
      // new password is used once immediately and second-factor enrolment goes
      // through the same path as everybody else's.
    });
  })
);

/* -------------------------------------------------------- changing people */

const updateSchema = z.object({
  name: z.string().max(200).optional(),
  role: z.enum(ROLES).optional(),
});

adminUsersRouter.patch(
  "/:id",
  requirePermission("admins.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please check the details.", parsed.error.flatten());

    const target = await loadAdmin(id);
    if (!target) throw notFound("We couldn't find that person.");

    const newRole = parsed.data.role;
    const demotesAnOwner = newRole !== undefined && target.role === "owner" && newRole !== "owner";

    if (newRole === "owner" && !actorIsOwner(req)) {
      throw forbidden("Only an owner can make someone else an owner.");
    }
    await assertMayChange(req, target, { removesOwner: demotesAnOwner });

    const updated = await pool.query(
      `UPDATE admin_users
          SET name = COALESCE($2, name), role = COALESCE($3, role), updated_at = now()
        WHERE id = $1
        RETURNING ${ADMIN_COLUMNS}`,
      [id, parsed.data.name ?? null, newRole ?? null]
    );

    await recordAdminAction({
      req,
      action: "admin.update",
      entityType: "admin_user",
      entityId: id,
      before: { name: target.name, role: target.role },
      after: { name: updated.rows[0]?.name, role: updated.rows[0]?.role },
    });

    res.json(rowsToCamel(updated.rows)[0]);
  })
);

adminUsersRouter.post(
  "/:id/suspend",
  requirePermission("admins.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const target = await loadAdmin(id);
    if (!target) throw notFound("We couldn't find that person.");
    if (target.id === actorId(req)) throw badRequest("You can't suspend your own account.");

    await assertMayChange(req, target, { removesOwner: true });

    await pool.query(
      `UPDATE admin_users SET status = 'suspended', updated_at = now() WHERE id = $1`,
      [id]
    );
    // Suspension that leaves a live session open is not suspension.
    await pool.query(
      `UPDATE admin_sessions SET revoked_at = now()
        WHERE admin_user_id = $1 AND revoked_at IS NULL`,
      [id]
    );

    await recordAdminAction({
      req,
      action: "admin.suspend",
      entityType: "admin_user",
      entityId: id,
      before: { status: target.status },
      after: { status: "suspended" },
    });

    res.json({ ok: true });
  })
);

adminUsersRouter.post(
  "/:id/restore",
  requirePermission("admins.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const target = await loadAdmin(id);
    if (!target) throw notFound("We couldn't find that person.");
    if (target.role === "owner" && !actorIsOwner(req)) {
      throw forbidden("Only an owner can change another owner's account.");
    }

    await pool.query(
      `UPDATE admin_users SET status = 'active', updated_at = now() WHERE id = $1`,
      [id]
    );

    await recordAdminAction({
      req,
      action: "admin.restore",
      entityType: "admin_user",
      entityId: id,
      before: { status: target.status },
      after: { status: "active" },
    });

    res.json({ ok: true });
  })
);

adminUsersRouter.delete(
  "/:id",
  requirePermission("admins.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const target = await loadAdmin(id);
    if (!target) throw notFound("We couldn't find that person.");
    if (target.id === actorId(req)) throw badRequest("You can't remove your own account.");

    await assertMayChange(req, target, { removesOwner: true });

    await pool.query(`DELETE FROM admin_users WHERE id = $1`, [id]);
    await pool.query(`DELETE FROM admin_invites WHERE lower(email) = $1 AND accepted_at IS NULL`, [
      target.email.toLowerCase(),
    ]);

    await recordAdminAction({
      req,
      action: "admin.delete",
      entityType: "admin_user",
      entityId: id,
      before: { email: target.email, role: target.role },
    });

    res.status(204).end();
  })
);

/* ----------------------------------------------------- my own security */

adminUsersRouter.get(
  "/me/security",
  asyncHandler(async (req, res) => {
    const me = await loadAdmin(actorId(req));
    if (!me) throw unauthorized("User not found");

    const sessions = await pool.query(
      `SELECT id, user_agent, ip, created_at, last_used_at, expires_at
         FROM admin_sessions
        WHERE admin_user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_used_at DESC NULLS LAST, created_at DESC`,
      [me.id]
    );

    res.json({
      email: me.email,
      name: me.name,
      role: me.role,
      mfaEnabled: me.mfa_enabled,
      recoveryCodesLeft: me.mfa_enabled ? await countUnusedRecoveryCodes(me.id) : 0,
      sessions: rowsToCamel(sessions.rows),
    });
  })
);

/**
 * Starts enrolment.
 *
 * The secret is written now but `mfa_enabled` stays false until a code proves
 * the app has it. Switching it on at this point would lock the account out of
 * itself if the QR code was never actually scanned.
 */
adminUsersRouter.post(
  "/me/mfa/start",
  asyncHandler(async (req, res) => {
    const me = await loadAdmin(actorId(req));
    if (!me) throw unauthorized("User not found");
    if (me.mfa_enabled) throw badRequest("Two-step sign-in is already switched on.");

    const secret = generateSecret();
    await pool.query(
      `UPDATE admin_users SET mfa_secret = $2, mfa_confirmed_at = NULL, updated_at = now()
        WHERE id = $1`,
      [me.id, secret]
    );

    res.json({ secret, otpauthUrl: otpauthUrl(secret, me.email) });
  })
);

const codeSchema = z.object({ code: z.string().min(4).max(40) });

adminUsersRouter.post(
  "/me/mfa/confirm",
  asyncHandler(async (req, res) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Type the six-digit code from your app.");

    const found = await pool.query<{ mfa_secret: string | null; mfa_enabled: boolean }>(
      `SELECT mfa_secret, mfa_enabled FROM admin_users WHERE id = $1`,
      [actorId(req)]
    );
    const row = found.rows[0];
    if (!row) throw unauthorized("User not found");
    if (row.mfa_enabled) throw badRequest("Two-step sign-in is already switched on.");
    if (!row.mfa_secret) throw badRequest("Start again — we don't have a code to check against.");

    // A recovery code cannot be what confirms enrolment: none exist yet, and
    // accepting anything but a live code would let somebody switch this on
    // without ever having scanned the QR.
    if (!verifyCode(row.mfa_secret, parsed.data.code)) {
      throw badRequest("That code didn't match. Check your app and try the next one.");
    }

    await pool.query(
      `UPDATE admin_users
          SET mfa_enabled = true, mfa_confirmed_at = now(), updated_at = now()
        WHERE id = $1`,
      [actorId(req)]
    );

    const recoveryCodes = await issueRecoveryCodes(actorId(req));

    await recordAdminAction({
      req,
      action: "admin.mfaEnabled",
      entityType: "admin_user",
      entityId: actorId(req),
      after: { mfaEnabled: true },
    });

    res.json({ ok: true, recoveryCodes });
  })
);

adminUsersRouter.post(
  "/me/mfa/disable",
  asyncHandler(async (req, res) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Type a code from your app to confirm.");

    const found = await pool.query<{ mfa_secret: string | null; mfa_enabled: boolean }>(
      `SELECT mfa_secret, mfa_enabled FROM admin_users WHERE id = $1`,
      [actorId(req)]
    );
    const row = found.rows[0];
    if (!row?.mfa_enabled || !row.mfa_secret) {
      throw badRequest("Two-step sign-in isn't switched on.");
    }

    // Turning the second factor off is exactly what somebody sitting at an
    // unlocked laptop would want to do first, so it costs a code like
    // everything else.
    if (!(await verifySecondFactor(actorId(req), row.mfa_secret, parsed.data.code))) {
      throw badRequest("That code didn't match.");
    }

    await pool.query(
      `UPDATE admin_users
          SET mfa_enabled = false, mfa_secret = NULL, mfa_confirmed_at = NULL, updated_at = now()
        WHERE id = $1`,
      [actorId(req)]
    );
    await pool.query(`DELETE FROM admin_mfa_recovery_codes WHERE admin_user_id = $1`, [
      actorId(req),
    ]);

    await recordAdminAction({
      req,
      action: "admin.mfaDisabled",
      entityType: "admin_user",
      entityId: actorId(req),
      after: { mfaEnabled: false },
    });

    res.json({ ok: true });
  })
);

adminUsersRouter.post(
  "/me/mfa/recovery-codes",
  asyncHandler(async (req, res) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Type the six-digit code from your app.");

    const found = await pool.query<{ mfa_secret: string | null; mfa_enabled: boolean }>(
      `SELECT mfa_secret, mfa_enabled FROM admin_users WHERE id = $1`,
      [actorId(req)]
    );
    const row = found.rows[0];
    if (!row?.mfa_enabled || !row.mfa_secret) {
      throw badRequest("Two-step sign-in isn't switched on.");
    }
    // A live code only: spending a recovery code to mint ten more would let
    // one leaked code renew itself forever.
    if (!verifyCode(row.mfa_secret, parsed.data.code)) {
      throw badRequest("That code didn't match.");
    }

    res.json({ recoveryCodes: await issueRecoveryCodes(actorId(req)) });
  })
);

/* ------------------------------------------------------------- sessions */

adminUsersRouter.delete(
  "/me/sessions/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const revoked = await pool.query(
      `UPDATE admin_sessions SET revoked_at = now()
        WHERE id = $1 AND admin_user_id = $2 AND revoked_at IS NULL`,
      [id, actorId(req)]
    );
    if ((revoked.rowCount ?? 0) === 0) throw notFound("That sign-in has already ended.");

    res.status(204).end();
  })
);

/** Signs somebody out of everywhere — the button for a lost laptop. */
adminUsersRouter.post(
  "/:id/sessions/revoke",
  requirePermission("admins.manage"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw badRequest("Invalid id");

    const target = await loadAdmin(id);
    if (!target) throw notFound("We couldn't find that person.");
    if (target.role === "owner" && !actorIsOwner(req)) {
      throw forbidden("Only an owner can sign another owner out.");
    }

    const revoked = await pool.query(
      `UPDATE admin_sessions SET revoked_at = now()
        WHERE admin_user_id = $1 AND revoked_at IS NULL`,
      [id]
    );

    await recordAdminAction({
      req,
      action: "admin.sessionsRevoked",
      entityType: "admin_user",
      entityId: id,
      after: { revoked: revoked.rowCount ?? 0 },
    });

    res.json({ signedOut: revoked.rowCount ?? 0 });
  })
);

/**
 * Issued at sign-in so that a session exists to revoke.
 *
 * Lives here rather than in the login route because it is the same record the
 * list and the revoke buttons above read, and the shape of it should change in
 * one place. Returns the JWT that the browser holds.
 */
export async function issueAdminSession(input: {
  adminUserId: number;
  email: string;
  role: string;
  userAgent: string;
  ip: string;
  ttlSeconds: number;
}): Promise<string> {
  const token = signToken({ sub: input.adminUserId, email: input.email, role: input.role });

  await pool.query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, user_agent, ip, expires_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [
      input.adminUserId,
      hashToken(token),
      input.userAgent.slice(0, 400),
      input.ip.slice(0, 64),
      expiresIn(input.ttlSeconds),
    ]
  );

  return token;
}

/** Ends the session a token belongs to. Used by sign-out. */
export async function revokeAdminSessionByToken(token: string): Promise<void> {
  await pool.query(
    `UPDATE admin_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)]
  );
}
