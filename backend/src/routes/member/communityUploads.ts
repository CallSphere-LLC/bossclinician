import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import {
  denyImpersonation,
  requireVerifiedEmail,
  type AuthedMember,
} from "../../middleware/memberAuth";
import { mayEnterCommunity } from "../../services/access";
import { resolveMime, storageDir, storedExtension } from "../../services/mediaStorage";

/**
 * `/api/member/community/:slug/uploads` — a member attaching a file to a post.
 *
 * The composer could only take a URL before, which meant members could post a
 * picture only if they already hosted it somewhere. The brief asks the composer
 * for image, video, FILE and poll; this is what makes the first three possible
 * for somebody who is not an administrator.
 *
 * Deliberately NOT the admin media library. Those assets are Yvette's, listed
 * in her library, reusable across offers and lessons; a member's snapshot of
 * their new office belongs to their post and nowhere else. Mixing them would
 * fill her library with other people's files and give members a route into a
 * screen that is hers.
 *
 * The limits are the interesting part of this file, and they are deliberately
 * tighter than the admin's: a smaller ceiling, a much shorter list of accepted
 * types, a rate limit per member, and an on-disk name that owes nothing to what
 * the uploader called the file.
 */
export const memberCommunityUploadsRouter = Router();

/**
 * 8MB. A phone photograph is 2–5MB and this has to accept one, but a member
 * has no business uploading the 500MB course video the admin ceiling allows.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * What a member may attach.
 *
 * Images and PDFs only, and no SVG. An SVG is a script container — it renders
 * in an <img> and executes when opened directly — so accepting one from an
 * unauthenticated-adjacent surface and serving it from our own origin would be
 * stored XSS with extra steps. The admin list is wider because the admin is
 * trusted and their uploads are not another member's content.
 */
const MEMBER_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

memberCommunityUploadsRouter.post(
  "/:slug/uploads",
  denyImpersonation,
  requireVerifiedEmail,
  uploadLimiter,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const member = req.member as AuthedMember;

    const found = await pool.query<{ id: number; banned_at: Date | null }>(
      `SELECT c.id, cm.banned_at
         FROM communities c
         LEFT JOIN community_memberships cm
                ON cm.community_id = c.id AND cm.member_id = $1
        WHERE c.slug = $2 AND c.published = true`,
      [member.id, req.params.slug]
    );
    const room = found.rows[0];
    if (!room) throw notFound("We couldn't find that community.");
    if (room.banned_at !== null) throw forbidden("You no longer have access to this community.");
    if (!(await mayEnterCommunity(member.id, room.id))) {
      throw notFound("We couldn't find that community.");
    }

    const file = req.file;
    if (!file) throw badRequest("Choose a file to attach.");
    if (file.size === 0) throw badRequest("That file is empty.");

    /*
     * The mime is resolved from the declared type AND the filename, then
     * checked against our own list — the browser's Content-Type is a claim by
     * the uploader, not a fact. `storedExtension` then derives the extension
     * from the RESOLVED type rather than from the original name, so a file
     * called `photo.jpg.html` cannot land on disk as HTML.
     */
    const mime = resolveMime(file.mimetype, file.originalname);
    if (mime === null || !MEMBER_ALLOWED_MIME.has(mime)) {
      throw badRequest("You can attach a photo (JPEG, PNG, GIF or WebP) or a PDF.");
    }

    /*
     * And now the bytes, which are the only part of an upload the uploader
     * cannot lie about.
     *
     * The check above reads the declared type and the filename — both are
     * claims. An SVG renamed `photo.png` and posted as `image/png` passes them
     * both. Serving it as image/png behind `X-Content-Type-Options: nosniff`
     * does stop it executing, so this is not the only thing standing between a
     * member and stored XSS; but it is the difference between a file that is
     * what it says and one that merely gets away with it, and relying on a
     * response header to neutralise content we chose to store is a thin place
     * to be standing.
     */
    if (!signatureMatches(mime, file.buffer)) {
      throw badRequest("That file isn't the kind of file it says it is.");
    }

    const extension = storedExtension(mime, file.originalname);
    // Random, not derived from the upload: two members uploading `photo.jpg`
    // must not collide, and a name a member chose must never decide a path.
    const stored = `${crypto.randomBytes(12).toString("hex")}${extension}`;
    const directory = storageDir("public");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, stored), file.buffer);

    res.status(201).json({
      url: `/uploads/${stored}`,
      // The original name, kept for the attachment's label — it is what the
      // member will recognise, and it is only ever rendered as text.
      label: file.originalname.slice(0, 200),
      contentType: mime,
      sizeBytes: file.size,
    });
  })
);

/**
 * Whether the first bytes are what the declared type requires.
 *
 * Deliberately a short list rather than a library: these five types are all a
 * member may upload, every one of them has a fixed magic number, and a
 * dependency that parses untrusted files is a larger attack surface than the
 * thing it is checking.
 */
export function signatureMatches(mime: string, buffer: Buffer): boolean {
  const starts = (...bytes: number[]): boolean =>
    buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

  switch (mime) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/gif":
      // "GIF87a" or "GIF89a"; the shared prefix is enough to reject anything else.
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      // RIFF....WEBP — the size sits between the two markers.
      return starts(0x52, 0x49, 0x46, 0x46) && buffer.subarray(8, 12).toString() === "WEBP";
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46);
    default:
      return false;
  }
}
