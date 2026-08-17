import { Request, Response, Router } from "express";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";
import { hashToken } from "../../auth/tokens";
import { checkPasswordStrength, hashPassword, verifyPassword } from "../../auth/password";
import { clearRefreshCookie } from "../../auth/memberSession";
import { denyImpersonation, requireMember, type AuthedMember } from "../../middleware/memberAuth";
import { memberAvatarLimiter } from "../../middleware/rateLimit";
import { sendMail } from "../../email/mailer";
import * as emails from "../../email/memberTemplates";
import {
  MEMBER_PROFILE_COLUMNS,
  loadMemberProfile,
  toMemberProfile,
  type MemberProfileRow,
} from "../../services/memberProfile";
import {
  changePasswordSchema,
  sessionIdParamSchema,
  updateProfileSchema,
} from "../../validation/memberSchemas";
import { readRefreshCookie } from "./memberAuth";

/**
 * `/api/auth/me*` — the signed-in half of member identity.
 *
 * Authentication is mounted on the `/me` path rather than on the router, so an
 * unknown `/api/auth/*` URL still falls through to the 404 handler instead of
 * being answered with a misleading 401. Every route below is under `/me` and is
 * therefore covered by construction; anything added outside it would not be,
 * which is why nothing should be.
 */
export const memberAccountRoutes = Router();

memberAccountRoutes.use("/me", requireMember);

/**
 * Every route below that writes carries `denyImpersonation` alongside its
 * handler. It is spelled out per route rather than mounted once, because the
 * reads under `/me` are exactly what impersonation exists to serve — a blanket
 * guard here would turn "view as member" into "view nothing".
 */

/** requireMember has already run; this keeps the guarantee in the type system too. */
function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

/** GET /api/auth/me */
memberAccountRoutes.get(
  "/me",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const profile = await loadMemberProfile(member.id, member.impersonatedBy);
    if (!profile) throw unauthorized("Please sign in to continue");
    res.json(profile);
  })
);

/**
 * PATCH /api/auth/me
 *
 * Absent fields are left alone rather than blanked — the account screen sends
 * only what changed, and a timezone edit must not wipe the member's name.
 */
memberAccountRoutes.patch(
  "/me",
  denyImpersonation,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Please check the details and try again.", parsed.error.flatten());
    }
    const { firstName = null, lastName = null, timezone = null, locale = null } = parsed.data;

    const result = await pool.query<MemberProfileRow>(
      `UPDATE members
          SET first_name = COALESCE($2, first_name),
              last_name  = COALESCE($3, last_name),
              timezone   = COALESCE($4, timezone),
              locale     = COALESCE($5, locale),
              -- Keep the legacy display name in step with the split fields, but
              -- never let it become empty: the admin list reads this column and
              -- a blank row there is worse than a stale one.
              name       = COALESCE(
                             NULLIF(btrim(COALESCE($2, first_name) || ' ' || COALESCE($3, last_name)), ''),
                             name
                           ),
              updated_at = now()
        WHERE id = $1
        RETURNING ${MEMBER_PROFILE_COLUMNS}`,
      [member.id, firstName, lastName, timezone, locale]
    );

    const row = result.rows[0];
    if (!row) throw unauthorized("Please sign in to continue");
    res.json(toMemberProfile(row, member.impersonatedBy));
  })
);

/**
 * POST /api/auth/me/password
 *
 * Every other session is revoked, because "change my password" is what someone
 * does when they think another person is in their account. The tab making the
 * request keeps its session: signing people out of the screen they are looking
 * at teaches them to be afraid of the security feature.
 */
memberAccountRoutes.post(
  "/me/password",
  denyImpersonation,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Please check the details and try again.", parsed.error.flatten());
    }
    const { currentPassword, newPassword } = parsed.data;

    const found = await pool.query<{ password_hash: string | null; email: string; first_name: string }>(
      `SELECT password_hash, email, first_name FROM members WHERE id = $1`,
      [member.id]
    );
    const row = found.rows[0];
    if (!row) throw unauthorized("Please sign in to continue");

    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      throw badRequest("That current password isn't right.");
    }

    const strength = checkPasswordStrength(newPassword);
    if (!strength.ok) throw badRequest(strength.reason ?? "Please choose a stronger password.");

    await pool.query(
      `UPDATE members SET password_hash = $2, updated_at = now() WHERE id = $1`,
      [member.id, await hashPassword(newPassword)]
    );

    const raw = readRefreshCookie(req);
    const keep = raw ? hashToken(raw) : null;
    // The reason matters as much as the revocation: a session ended without one
    // looks like a rotated token when the signed-out device next refreshes, and
    // that is read as theft — which would burn the very session this endpoint
    // went out of its way to keep alive.
    await pool.query(
      `UPDATE member_sessions
          SET revoked_at = now(), revoked_reason = 'password_change'
        WHERE member_id = $1
          AND revoked_at IS NULL
          AND ($2::text IS NULL OR token_hash <> $2)`,
      [member.id, keep]
    );

    void sendMail({
      to: row.email,
      ...emails.passwordChanged({ firstName: row.first_name }),
    });

    res.json({ ok: true });
  })
);

/**
 * Avatars are the one upload a member can make, so the allowlist is narrower
 * than the media library's: images only, and SVG stays out because /uploads is
 * served from the site's own origin and an SVG can carry script.
 */
const AVATAR_MIME_EXTENSIONS = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
]);

/** A profile photo, not a course video — env.maxUploadMb is far too generous here. */
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

fs.mkdirSync(env.uploadDir, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.uploadDir),
    // The stored name is ours end to end: random stem, extension derived from
    // the declared type. Nothing the client typed reaches the filesystem, so
    // there is no "../" and no double extension to reason about.
    filename: (_req, file, cb) => {
      const ext = AVATAR_MIME_EXTENSIONS.get(file.mimetype) ?? "";
      cb(null, `${crypto.randomBytes(8).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!AVATAR_MIME_EXTENSIONS.has(file.mimetype)) {
      cb(new Error("Please upload a PNG, JPEG, WebP, GIF or AVIF image."));
      return;
    }
    cb(null, true);
  },
});

/** The public prefix every file this endpoint stores is served under. */
const UPLOAD_URL_PREFIX = "/uploads/";

/**
 * Deletes a stored upload, if the name is one this endpoint could have written.
 *
 * Names are generated here and never taken from the client, so a value that is
 * not a plain filename means the column it came from was tampered with — and
 * joining that to the upload directory is how a delete escapes it. Such a name
 * is ignored rather than followed. A file that has already gone is the outcome
 * this function wanted anyway, so ENOENT is not an error.
 */
async function unlinkUpload(filename: string): Promise<void> {
  if (filename !== path.basename(filename)) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) return;
  await fs.promises.unlink(path.join(env.uploadDir, filename)).catch(() => undefined);
}

/** Bridges multer's callback style into the async handler so one error path serves both. */
function receiveAvatar(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    avatarUpload.single("file")(req, res, (err: unknown) => {
      if (!err) {
        resolve();
        return;
      }
      // MulterError carries the size/count code the central handler maps to 413.
      reject(
        err instanceof multer.MulterError
          ? err
          : badRequest(err instanceof Error ? err.message : "Upload failed")
      );
    });
  });
}

/**
 * POST /api/auth/me/avatar — multipart, field name `file`.
 *
 * A member holds one avatar at a time, on disk as well as in the row: the file
 * the new one replaces is deleted along with the library entry that recorded
 * it. Without that, a profile photo is an append-only write into the volume the
 * course video lives on, and every re-crop a member tries leaves another row in
 * Yvette's media library for her to wonder about.
 */
memberAccountRoutes.post(
  "/me/avatar",
  denyImpersonation,
  memberAvatarLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    await receiveAvatar(req, res);

    const file = req.file;
    if (!file) throw badRequest("No image uploaded (the field name must be 'file').");

    const url = `${UPLOAD_URL_PREFIX}${file.filename}`;
    let replaced: string | null = null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Locked before it is read, so two uploads racing cannot both see the same
      // previous avatar: the loser would delete a file the winner had already
      // accounted for and leave its own behind with nothing pointing at it.
      const current = await client.query<{ avatar_url: string }>(
        `SELECT avatar_url FROM members WHERE id = $1 FOR UPDATE`,
        [member.id]
      );
      const previous = current.rows[0]?.avatar_url ?? "";

      // The library row exists so Yvette can see (and delete) what members have
      // uploaded; the members row is what the site actually renders.
      await client.query(
        `INSERT INTO media_assets (filename, original_name, url, mime, kind, size_bytes, title)
         VALUES ($1, $2, $3, $4, 'image', $5, $6)`,
        [file.filename, file.originalname, url, file.mimetype, file.size, `Profile photo — ${member.email}`]
      );
      await client.query(
        `UPDATE members SET avatar_url = $2, updated_at = now() WHERE id = $1`,
        [member.id, url]
      );

      // Only what this endpoint stored is reclaimed. An avatar_url pointing
      // somewhere else — a URL Yvette pasted in, an asset from the library —
      // belongs to whoever put it there and is not ours to delete.
      if (previous.startsWith(UPLOAD_URL_PREFIX) && previous !== url) {
        await client.query(`DELETE FROM media_assets WHERE url = $1`, [previous]);
        replaced = previous.slice(UPLOAD_URL_PREFIX.length);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      // The bytes are already on disk; don't leave an orphan behind a failed row.
      await unlinkUpload(file.filename);
      throw err;
    } finally {
      client.release();
    }

    // Deliberately after the commit. A filesystem delete cannot be rolled back,
    // so doing it inside the transaction would mean a later failure left the
    // member's row pointing at a file that no longer exists.
    if (replaced !== null) await unlinkUpload(replaced);

    res.json({ avatarUrl: url });
  })
);

interface SessionRow {
  id: string;
  user_agent: string;
  ip: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  token_hash: string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** GET /api/auth/me/sessions — "where am I signed in?", newest first. */
memberAccountRoutes.get(
  "/me/sessions",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const raw = readRefreshCookie(req);
    const currentHash = raw ? hashToken(raw) : null;

    const result = await pool.query<SessionRow>(
      `SELECT id, user_agent, ip, created_at, last_used_at, token_hash
         FROM member_sessions
        WHERE member_id = $1
          AND revoked_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC`,
      [member.id]
    );

    // Mapped by hand rather than with rowsToCamel: token_hash is selected only
    // to find the current row and must not travel back to the browser.
    res.json(
      result.rows.map((row) => ({
        // BIGSERIAL arrives as a string from pg; the client's contract is a number.
        id: Number(row.id),
        userAgent: row.user_agent,
        ip: row.ip,
        createdAt: iso(row.created_at) ?? "",
        lastUsedAt: iso(row.last_used_at),
        current: currentHash !== null && row.token_hash === currentHash,
      }))
    );
  })
);

/**
 * DELETE /api/auth/me/sessions/:id
 *
 * `member_id` is in the WHERE clause, not in an `if` after the read: someone
 * else's session id is indistinguishable from one that never existed, and a 403
 * would confirm it exists.
 */
memberAccountRoutes.delete(
  "/me/sessions/:id",
  denyImpersonation,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const parsed = sessionIdParamSchema.safeParse(req.params);
    if (!parsed.success) throw notFound("We couldn't find that session.");

    // Recorded as a logout, because that is what it is from the other device's
    // point of view: without the reason, that device's next silent refresh
    // presents a revoked token, which is read as theft and signs out every
    // other device the member has — including this one.
    const result = await pool.query<{ token_hash: string }>(
      `UPDATE member_sessions
          SET revoked_at = now(), revoked_reason = 'logout'
        WHERE id = $1
          AND member_id = $2
          AND revoked_at IS NULL
        RETURNING token_hash`,
      [parsed.data.id, member.id]
    );

    const revoked = result.rows[0];
    if (!revoked) throw notFound("We couldn't find that session.");

    const raw = readRefreshCookie(req);
    if (raw && hashToken(raw) === revoked.token_hash) clearRefreshCookie(res);

    res.status(204).end();
  })
);
