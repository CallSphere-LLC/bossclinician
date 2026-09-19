import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { requirePermission } from "../../services/permissions";
import { recordAdminAction } from "../../services/adminAudit";
import {
  LocalDiskRecordingStore,
  MissingRecordingError,
  RECORDING_URL_TTL_SECONDS,
  recordingContentType,
  recordingObjectKey,
  recordingStore,
  recordingStoreFor,
  verifyRecordingToken,
} from "../../services/voice/recordingStore";
import {
  deleteSession,
  listSessions,
  sessionDetail,
  setSessionRecording,
  type SessionListFilters,
} from "../../services/voice/sessionStore";

/**
 * What people asked the assistant, and what it did about it.
 *
 * Mounted at /admin/voice-sessions. This is the page Yvette reads: every
 * conversation the concierge has had — spoken or typed, on the public site, in
 * a member's portal or in her own admin — with what was said, the audio where
 * there is any, and the record of anything she approved it to do.
 *
 * Gated on `admins.view`, the same permission the activity log carries, and for
 * the same reason: these rows hold what customers said in their own words and
 * the audit of actions taken inside the admin. A Marketing or Support login has
 * no business reading them.
 */
export const adminVoiceSessionsRouter = Router();

const listQuerySchema = z.object({
  surface: z.enum(["public", "member", "admin"]).optional(),
  mode: z.enum(["voice", "text"]).optional(),
  withRecording: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

adminVoiceSessionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Invalid filters", parsed.error.flatten());

    const filters: SessionListFilters = {
      surface: parsed.data.surface,
      mode: parsed.data.mode,
      withRecording: parsed.data.withRecording,
      from: parsed.data.from,
      to: parsed.data.to,
    };
    const { items, total } = await listSessions(filters, parsed.data.page, parsed.data.limit);

    res.json({ items, total, page: parsed.data.page, pageSize: parsed.data.limit });
  })
);

adminVoiceSessionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const detail = await sessionDetail(String(req.params.id));
    if (detail === null) throw notFound("That conversation could not be found.");
    res.json(detail);
  })
);

/**
 * GET /admin/voice-sessions/:id/recording — a link to play the audio with.
 *
 * Minted, never stored: the link lives fifteen minutes whichever store holds
 * the recording, so a URL that ends up in a screenshot or a browser history is
 * already dead. The page asks again when it expires.
 *
 * This is also where the slices get joined. A conversation whose tab was closed
 * never reached a clean stop, so nothing has ever asked the store to close its
 * recording — and the first person who wants to hear it is the owner, right
 * now. Joining here means "the recording exists" and "somebody wanted it" are
 * the same event, and a call nobody closed is still a call she can listen to.
 */
adminVoiceSessionsRouter.get(
  "/:id/recording",
  asyncHandler(async (req, res) => {
    const sessionId = String(req.params.id);
    const detail = await sessionDetail(sessionId);
    if (detail === null) throw notFound("That conversation could not be found.");

    let key = detail.recordingKey;
    if (detail.recordingFinalizedAt === null) {
      try {
        // The store that would have been written to while the call was running,
        // which is the environment's — the slices of an unjoined recording are
        // not named by a key anybody has yet.
        const stored = await recordingStore().finalize(sessionId);
        await setSessionRecording(sessionId, stored);
        key = stored.key;
      } catch (err) {
        if (err instanceof MissingRecordingError) {
          throw notFound("There is no audio saved for this conversation.");
        }
        throw err;
      }
    }

    if (key === null) throw notFound("There is no audio saved for this conversation.");

    const url = await recordingStoreFor(key).url(key);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      url,
      expiresAt: new Date(Date.now() + RECORDING_URL_TTL_SECONDS * 1000).toISOString(),
      contentType: detail.recordingContentType ?? recordingContentType(key),
    });
  })
);

/**
 * DELETE /admin/voice-sessions/:id — and the audio with it.
 *
 * The transcript and the approval trail go with the row, because the database
 * cascades them. The bytes are not the database's to forget, so they are
 * removed first: a conversation whose row is gone and whose recording is still
 * on the volume is a promise the page made and did not keep.
 *
 * A conversation that was never closed has slices and no key at all, so the
 * name is worked out from the session id instead — otherwise audio would be
 * left behind precisely for the calls that ended badly.
 */
adminVoiceSessionsRouter.delete(
  "/:id",
  requirePermission("admins.manage"),
  asyncHandler(async (req, res) => {
    const sessionId = String(req.params.id);
    const detail = await sessionDetail(sessionId);
    if (detail === null) throw notFound("That conversation could not be found.");

    if (detail.recordingKey !== null) {
      await recordingStoreFor(detail.recordingKey).remove(detail.recordingKey);
    } else if (detail.recordingChunks > 0) {
      // Never joined, so no key exists — the name is derived instead of joining
      // megabytes of audio we are about to throw away, and `remove` takes the
      // slices with it. The store is the environment's, because that is the one
      // the slices were written to while the call was running.
      const store = recordingStore();
      const bare = recordingObjectKey(sessionId, detail.recordingContentType ?? "audio/webm");
      await store.remove(store instanceof LocalDiskRecordingStore ? `protected:${bare}` : bare);
    }

    const removed = await deleteSession(sessionId);
    if (removed === null) throw notFound("That conversation could not be found.");

    await recordAdminAction({
      req,
      action: "voice_session.delete",
      entityType: "voice_session",
      entityId: sessionId,
      before: {
        startedAt: detail.startedAt,
        surface: detail.surface,
        mode: detail.mode,
        person: detail.personEmail || "a visitor",
        lines: detail.lineCount,
      },
    });

    res.status(204).end();
  })
);

/**
 * GET /admin/voice-recording/:token — the bytes, for the local store only.
 *
 * Mounted outside `requireAuth`, beside the invite router, for the same stated
 * reason: its own token is the credential. It has to be. The admin access
 * cookie lives five minutes and the admin client silently refreshes it on a
 * 401 — an `<audio>` element does not, so a player holding a cookie-gated URL
 * goes silent mid-conversation and looks broken. The token names exactly one
 * recording, is signed with a key derived for this purpose alone, and expires
 * in fifteen minutes; it can only have come from the authenticated endpoint
 * above, and `requireAdminHost` still keeps this route off the public site.
 *
 * S3 never reaches here: a presigned GET goes straight to the bucket.
 */
export const adminVoiceRecordingRouter = Router();

adminVoiceRecordingRouter.get(
  "/voice-recording/:token",
  asyncHandler(async (req, res) => {
    const key = verifyRecordingToken(String(req.params.token));
    if (key === null) throw notFound("That link has expired. Open the conversation again.");

    const file = new LocalDiskRecordingStore().resolve(key);
    if (file === null) throw notFound("That recording could not be found.");

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", recordingContentType(file));
    // `sendFile` answers the Range requests an audio element makes when
    // somebody scrubs. The path is already absolute and already proved to be
    // inside the recordings directory by `resolve` above.
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  })
);
