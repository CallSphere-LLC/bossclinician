import fs from "fs";
import path from "path";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { optionalMember } from "../../middleware/memberAuth";
import { loadEntitledFile, loadEntitledLessonMedia } from "../member/downloads";
import { loadOwnedSessionFile } from "../member/coaching";
import { loadEntitledPostMedia } from "../member/community";
import { loadEntitledEpisodeAudio } from "../member/publishing";
import { formatCreditHours, normalizeVerificationCode } from "../../services/certificates";
import {
  isStreamKind,
  resolveStoredFile,
  verifyAdminPreview,
  verifyDownload,
} from "../../services/signedUrls";

/**
 * The two endpoints that are public because the credential is in the URL.
 *
 * `/api/files/:token` carries a signed token that names one file and one member
 * and dies on its own clock. It has to work without a session, because the
 * things that fetch it are a browser following a download link and a <video>
 * element loading its source, and neither can carry a Bearer header. Where a
 * session does happen to be present it is honoured: a member signed in as
 * somebody else is refused, which is the one case a forwarded link can actually
 * be caught in. `/api/verify/:code` is public because the person checking a
 * certificate is a licensing board with no account and no reason to have one.
 *
 * Neither is unguarded. The token is verified and the entitlement behind it is
 * re-checked against services/access.ts on every hit, and the verification code
 * is 80 random bits.
 */
export const verifyRouter = Router();

const TOO_MANY = { error: "Too many requests. Please try again later." };

/**
 * Keyed on IP, because a download link is redeemed by a browser that has not
 * signed in. Generous on purpose, and for two reasons: a member who bought a
 * toolkit of thirty worksheets clicks thirty times in a row, and a lesson video
 * comes back here for every seek the viewer makes. A clinic shares one address
 * between all of them. The token is unguessable, so this ceiling is about what a
 * flood would cost us rather than about what it could reach.
 */
const fileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
});

/**
 * The verification endpoint is the one place an unauthenticated stranger can ask
 * the database about a certificate. The code is unguessable, so this is not what
 * stops enumeration — it stops the attempt from costing us anything.
 */
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
});

/* ------------------------------------------------------------ file delivery */

const LINK_DEAD = "This download link has expired. Open it again from your library.";

/** A MIME type safe to echo into a response header. */
function safeMime(value: string): string {
  return /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(value)
    ? value
    : "application/octet-stream";
}

/**
 * basename, because `filename` is admin-entered free text.
 *
 * Express encodes the header correctly, but the value still becomes the name the
 * file lands under on the member's disk, and "../../.bashrc" is not a filename.
 */
function safeFilename(file: { filename: string; title?: string }): string {
  const candidate = path.basename((file.filename || file.title || "download").trim());
  // Control characters, quotes and backslashes out: the first would let a
  // filename inject a second header line, and a backslash is a path separator on
  // the member's machine even though it is not one on ours.
  const cleaned = candidate
    .replace(/[\u0000-\u001f\u007f"\\/]/g, "")
    .trim()
    .slice(0, 180);
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "download" : cleaned;
}

/**
 * Records the download.
 *
 * Two jobs, per the schema: the count Yvette sees against each file, and the
 * audit trail for the day a paid PDF turns up somewhere it should not have. It
 * runs before a byte is sent, and a failure is logged rather than raised — losing
 * a statistic must not cost a customer the file they paid for.
 */
async function recordDownload(input: {
  kind: "product" | "lesson";
  fileId: number;
  memberId: number;
  ip: string;
  userAgent: string;
}): Promise<void> {
  try {
    if (input.kind === "product") {
      await pool.query(
        `UPDATE product_files SET download_count = download_count + 1, updated_at = now()
          WHERE id = $1`,
        [input.fileId]
      );
    }
    await pool.query(
      `INSERT INTO download_events (member_id, product_file_id, lesson_file_id, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.memberId,
        input.kind === "product" ? input.fileId : null,
        input.kind === "lesson" ? input.fileId : null,
        input.ip.slice(0, 100),
        input.userAgent.slice(0, 500),
      ]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[downloads] failed to record a download event:", err);
  }
}

const FILE_GONE = "That file isn't available at the moment. Please let us know.";

/**
 * GET /api/files/:token — public by design; the token is the credential.
 *
 * The order matters. Signature and expiry first, then the requester if there is
 * one, then the account behind the token, then entitlement re-checked through
 * access.ts — a link outlives the decision that minted it, and a refund
 * processed in between has to take effect on the next request, not the next
 * link. Then the path resolved inside its storage root, and only then a read. A
 * path that escapes that root turns this endpoint into a reader for every file
 * the process can open, which is why resolution happens in one place and returns
 * null rather than a guess.
 *
 * Two kinds of thing come out of here. A purchased file is sent as an
 * attachment and written to download_events, because when a paid PDF turns up in
 * a Facebook group that log is the only record of where it went. A lesson's own
 * video, audio, captions or PDF, and a coaching session's handouts, are sent
 * inline for a player to read — no event row, since a single viewing issues one
 * request per seek and a log of those answers nothing.
 */
verifyRouter.get(
  "/files/:token",
  fileLimiter,
  optionalMember,
  asyncHandler(async (req, res, next) => {
    const payload = verifyDownload(String(req.params.token ?? ""));
    if (payload === null) throw notFound(LINK_DEAD);

    // A link that reached somebody else's browser is refused for them — the
    // extent of what binding the member id can enforce. A signed-out browser
    // holding the link inside its lifetime cannot be told from the member, which
    // is why the lifetime is short and why services/signedUrls.ts says so
    // plainly rather than promising more.
    if (req.member && req.member.id !== payload.memberId) throw notFound(LINK_DEAD);

    // The token stands in for a session on a route requireMember never runs on,
    // so it has to answer the same question that middleware does: an account
    // suspended a minute ago must not keep pulling files for another fourteen.
    const account = await pool.query<{ status: string }>(
      `SELECT status FROM members WHERE id = $1`,
      [payload.memberId]
    );
    const status = account.rows[0]?.status;
    if (status === undefined || status === "suspended" || status === "deleted") {
      throw notFound(LINK_DEAD);
    }

    const kind = payload.kind;

    if (isStreamKind(kind)) {
      // One branch per surface that owns paid media, each re-proving the
      // entitlement its own way: a coaching package, a community room, a private
      // show, or a course lesson's drip schedule.
      const media =
        kind === "coaching-file"
          ? await loadOwnedSessionFile(payload.memberId, payload.fileId)
          : kind === "community-media"
            ? await loadEntitledPostMedia(payload.memberId, payload.fileId)
            : kind === "podcast-episode"
              ? await loadEntitledEpisodeAudio(payload.memberId, payload.fileId)
              : await loadEntitledLessonMedia(payload.memberId, kind, payload.fileId);

      const mediaPath = await resolveStoredFile(media.storagePath);
      if (mediaPath === null) throw notFound(FILE_GONE);

      // Content-Type is left to sendFile unless the row recorded one: it reads
      // the extension of a name we generated ourselves, which is a better answer
      // than a MIME type typed into an admin form.
      if (media.mime !== "") res.setHeader("Content-Type", safeMime(media.mime));
      res.setHeader(
        "Content-Disposition",
        media.filename === "" ? "inline" : `inline; filename="${safeFilename(media)}"`
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Referrer-Policy", "no-referrer");

      // sendFile rather than a bare stream: a <video> seeks by asking for byte
      // ranges, and a response that ignores Range is one the player can only
      // ever play from the beginning.
      res.sendFile(mediaPath, (err) => {
        if (err && !res.headersSent) next(err);
      });
      return;
    }

    const file = await loadEntitledFile(payload.memberId, kind, payload.fileId);

    const absolutePath = await resolveStoredFile(file.storagePath);
    if (absolutePath === null) throw notFound(FILE_GONE);
    const stat = await fs.promises.stat(absolutePath);

    await recordDownload({
      kind,
      fileId: file.id,
      memberId: payload.memberId,
      ip: req.ip ?? "",
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "",
    });

    // attachment() before the Content-Type override: it sets a type from the
    // extension, and the stored MIME is the better answer.
    res.attachment(safeFilename(file));
    res.setHeader("Content-Type", safeMime(file.mime));
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");

    const stream = fs.createReadStream(absolutePath);
    stream.on("error", (err) => {
      // Headers are already out, so there is no status left to send: drop the
      // connection so the client sees a truncated download rather than a file
      // that silently ends early and looks complete.
      if (res.headersSent) res.destroy();
      else next(err);
    });
    stream.pipe(res);
  })
);

/* ------------------------------------------------------- admin file preview */

const PREVIEW_DEAD = "This preview has expired. Close this and open it again.";

/**
 * GET /api/admin-files/:token — the admin's view of a file only buyers can open.
 *
 * Public for the same reason `/api/files` is: the thing fetching it is a <video>
 * element, and a <video> cannot carry a Bearer header. The token is the
 * credential, it is signed under its own key, and it names one row in the media
 * library and the administrator who asked for it.
 *
 * Without this, the admin screens can upload a course video and never play it
 * back — `protected:abc.mp4` is a reference, not an address, and a player handed
 * it draws an empty box. That is how a lesson ships with the wrong file in it.
 *
 * The account is re-checked here rather than trusted from the token, exactly as
 * the member route re-checks entitlement: an administrator suspended or deleted
 * after the link was minted stops being able to pull files immediately.
 */
verifyRouter.get(
  "/admin-files/:token",
  fileLimiter,
  asyncHandler(async (req, res, next) => {
    const payload = verifyAdminPreview(String(req.params.token ?? ""));
    if (payload === null) throw notFound(PREVIEW_DEAD);

    const account = await pool.query<{ status: string }>(
      `SELECT status FROM admin_users WHERE id = $1`,
      [payload.adminUserId]
    );
    if (account.rows[0]?.status !== "active") throw notFound(PREVIEW_DEAD);

    const asset = await pool.query<{ url: string; mime: string; filename: string }>(
      `SELECT url, mime, filename FROM media_assets WHERE id = $1`,
      [payload.assetId]
    );
    const row = asset.rows[0];
    if (row === undefined) throw notFound(FILE_GONE);

    const filePath = await resolveStoredFile(row.url);
    if (filePath === null) throw notFound(FILE_GONE);

    if (row.mime !== "") res.setHeader("Content-Type", safeMime(row.mime));
    res.setHeader("Content-Disposition", `inline; filename="${safeFilename(row)}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");

    // sendFile, not a bare stream: she scrubs through the video to check it, and
    // seeking is Range requests an ordinary stream answers with the whole file.
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) next(err);
    });
  })
);

/* -------------------------------------------------------- certificate check */

const CERTIFICATE_UNKNOWN = "We couldn't find a certificate with that code.";

/**
 * GET /api/verify/:code — public, no auth.
 *
 * Returns only what is printed on the face of the certificate: who it was issued
 * to, for what, when, and how many CE hours it carries. No member id, no email,
 * no course structure, no file path — a board needs to confirm a document, not to
 * learn anything else about the person holding it.
 *
 * A code that cannot exist and a code that does not exist get the same 404 with
 * the same wording, so this cannot be used to tell well-formed codes from real
 * ones.
 */
verifyRouter.get(
  "/verify/:code",
  verifyLimiter,
  asyncHandler(async (req, res) => {
    const raw = String(req.params.code ?? "");
    const code = raw.length > 64 ? null : normalizeVerificationCode(raw);
    if (code === null) {
      res.status(404).json({ status: "unknown", valid: false, error: CERTIFICATE_UNKNOWN });
      return;
    }

    const found = await pool.query<{
      verification_code: string;
      recipient_name: string;
      course_title: string;
      ceu_credit_quarter_hours: number;
      ceu_provider_number: string;
      provider_name: string | null;
      completed_at: Date;
      issued_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT c.verification_code, c.recipient_name, c.course_title,
              c.ceu_credit_quarter_hours, c.ceu_provider_number,
              t.ceu_provider_name AS provider_name,
              c.completed_at, c.issued_at, c.revoked_at
         FROM certificates c
         LEFT JOIN certificate_templates t ON t.id = c.template_id
        WHERE c.verification_code = $1`,
      [code]
    );

    const row = found.rows[0];
    if (!row) {
      res.status(404).json({ status: "unknown", valid: false, error: CERTIFICATE_UNKNOWN });
      return;
    }

    const revoked = row.revoked_at !== null;

    res.setHeader("Cache-Control", "no-store");
    res.json({
      // A withdrawn certificate is genuine and not valid, and saying only one of
      // those would mislead whoever is checking it.
      status: revoked ? "revoked" : "valid",
      valid: !revoked,
      certificate: {
        verificationCode: row.verification_code,
        recipientName: row.recipient_name,
        courseTitle: row.course_title,
        completedAt: row.completed_at.toISOString(),
        issuedAt: row.issued_at.toISOString(),
        creditQuarterHours: row.ceu_credit_quarter_hours,
        creditHours: formatCreditHours(row.ceu_credit_quarter_hours),
        // Printed on the certificate itself and identifying the CE provider
        // rather than the recipient, which is exactly what a board cross-checks.
        providerNumber: row.ceu_provider_number,
        providerName: row.provider_name ?? "",
        revokedAt: revoked && row.revoked_at ? row.revoked_at.toISOString() : null,
      },
    });
  })
);
