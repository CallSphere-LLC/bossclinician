import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { resolveStoredFile, safeMime } from "../../services/signedUrls";
import { serveStoredMedia, usesS3Media } from "../../services/objectStorage";
import {
  findRetreatById,
  guestMayView,
  isOpen,
  isRetreatGuest,
  normaliseSettings,
  todayIn,
  verifyMediaToken,
} from "../../services/retreats";

/**
 * GET /api/retreat-media/:token — one photo or video from a retreat's private
 * Memories gallery.
 *
 * Public by necessity (an <img> or <video> cannot send the member's Bearer
 * token, and the admin cookie may be older than its five minutes), so the
 * token is the credential: HMAC-signed under its own derived key, naming one
 * item and one guest (or one admin), dead after two hours. And it is never
 * trusted alone — every request re-proves, from the database:
 *
 *   guest  → the account is in good standing, she is STILL a guest of that
 *            retreat (published + active dashboard grant), the gallery is
 *            open, and the item is approved or her own pending upload;
 *   admin  → the admin account is still active.
 *
 * So an attendee of a different retreat, a refunded guest, or anybody holding
 * a forwarded link after the guest lost access gets the same 404.
 */
export const retreatMediaRouter = Router();
/**
 * The same handler for admin-audience links, mounted under /api/admin (the admin
 * host proxies only /api/admin/ and /api/admin-files/). Outside requireAuth like
 * the voice-recording player: an <img>/<video> outlives the 5-minute admin
 * cookie, so the signed token is the credential and the admin account is
 * re-checked on every request.
 */
export const adminRetreatMediaRouter = Router();

const LINK_DEAD = "This link has expired. Reload the gallery to see it again.";

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req): string => {
    const payload = verifyMediaToken(String(req.params.token ?? ""));
    return payload ? `${payload.audience}:${payload.principalId}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
});

function serveMedia(audience: "m" | "a") {
  return asyncHandler(async (req, res, next) => {
    const payload = verifyMediaToken(String(req.params.token ?? ""));
    if (!payload || payload.audience !== audience) throw notFound(LINK_DEAD);

    const found = await pool.query<{ retreat_id: number; member_id: number | null; status: "pending" | "approved" | "hidden" | "removed"; storage_ref: string; mime: string; original_name: string }>(
      `SELECT retreat_id, member_id, status, storage_ref, mime, original_name FROM retreat_media WHERE id = $1`,
      [payload.mediaId],
    );
    const media = found.rows[0];
    if (!media || media.status === "removed") throw notFound(LINK_DEAD);

    if (payload.audience === "a") {
      const admin = await pool.query<{ status: string }>(`SELECT status FROM admin_users WHERE id = $1`, [payload.principalId]);
      if (admin.rows[0]?.status !== "active") throw notFound(LINK_DEAD);
    } else {
      const account = await pool.query<{ status: string }>(`SELECT status FROM members WHERE id = $1`, [payload.principalId]);
      const status = account.rows[0]?.status;
      if (status === undefined || status === "suspended" || status === "deleted") throw notFound(LINK_DEAD);
      const retreat = await findRetreatById(media.retreat_id);
      if (!retreat || !(await isRetreatGuest(payload.principalId, retreat))) throw notFound(LINK_DEAD);
      const settings = normaliseSettings(retreat.settings);
      if (!isOpen(settings.gallery.mode, retreat.end_date, todayIn(retreat.timezone))) throw notFound(LINK_DEAD);
      if (!guestMayView(media, payload.principalId)) throw notFound(LINK_DEAD);
    }

    res.setHeader("Content-Type", safeMime(media.mime));
    const extension = media.storage_ref.split(".").pop() ?? "";
    res.setHeader(
      "Content-Disposition",
      req.query.download === "1" ? `attachment; filename="retreat-memory-${payload.mediaId}.${extension}"` : "inline",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");

    if (usesS3Media()) {
      await serveStoredMedia(req, res, media.storage_ref);
      return;
    }
    const file = await resolveStoredFile(media.storage_ref);
    if (!file) throw notFound("That file isn't available at the moment.");
    // sendFile answers Range requests, so a video can seek.
    res.sendFile(file, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });
}

retreatMediaRouter.get("/retreat-media/:token", limiter, serveMedia("m"));
adminRetreatMediaRouter.get("/retreat-media/:token", limiter, serveMedia("a"));
