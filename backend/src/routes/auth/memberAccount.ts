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
import { requireMember, type AuthedMember } from "../../middleware/memberAuth";
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
    await pool.query(
      `UPDATE member_sessions
          SET revoked_at = now()
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

/** POST /api/auth/me/avatar — multipart, field name `file`. */
memberAccountRoutes.post(
  "/me/avatar",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    await receiveAvatar(req, res);

    const file = req.file;
    if (!file) throw badRequest("No image uploaded (the field name must be 'file').");

    const url = `/uploads/${file.filename}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
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
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      // The bytes are already on disk; don't leave an orphan behind a failed row.
      await fs.promises.unlink(path.join(env.uploadDir, file.filename)).catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    // The previous file is left in place on purpose: it may still be referenced
    // by the media library row that recorded it.
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
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const parsed = sessionIdParamSchema.safeParse(req.params);
    if (!parsed.success) throw notFound("We couldn't find that session.");

    const result = await pool.query<{ token_hash: string }>(
      `UPDATE member_sessions
          SET revoked_at = now()
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
