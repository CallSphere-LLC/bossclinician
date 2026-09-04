import { Router, type Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, conflict, notFound, payloadTooLarge } from "../../utils/httpError";
import { toMediaJson } from "../../services/mediaAssets";
import { VISIBILITIES, maxUploadBytes, unsupportedTypeMessage } from "../../services/mediaStorage";
import {
  ChunkInterrupted,
  DuplicateNameError,
  RECOMMENDED_CHUNK_BYTES,
  UnsupportedUploadError,
  UploadTooLargeError,
  abortUploadSession,
  appendChunk,
  completeUploadSession,
  findUploadSession,
  listOpenUploadSessions,
  lockUploadSession,
  openUploadSession,
  unlockUploadSession,
  type UploadSession,
} from "../../services/resumableUploads";

/**
 * The resumable half of the media library.
 *
 * Mounted under /api/admin/media/uploads, behind the same authentication and
 * `website` permission as everything else in that router. Four verbs and one
 * rule: the server always says where the file ends, and the client's job is to
 * send what comes after that. Nothing here trusts the client's own idea of how
 * far it got, because the interesting cases -- a dropped connection, a killed
 * tab, a redeploy -- are exactly the ones where the two disagree.
 */
export const adminMediaUploadsRouter = Router();

/** The signed-in administrator. Non-null: the parent router is behind requireAuth. */
function adminId(req: Request): number {
  return Number(req.user?.sub);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(0),
  mime: z.string().max(255).default(""),
  /**
   * The file's own modified time, as the browser reports it. Part of the
   * fingerprint, so re-choosing the same file resumes and choosing a newer
   * export of it (same name, same size, different mtime) does not silently
   * append to the older one's bytes.
   */
  lastModified: z.number().int().min(0).default(0),
  visibility: z.enum(VISIBILITIES),
});

/** The shape the client polls and resumes from. */
function sessionJson(session: UploadSession): Record<string, unknown> {
  return {
    uploadId: session.id,
    fileName: session.originalName,
    mime: session.mime,
    visibility: session.visibility,
    sizeBytes: session.sizeBytes,
    offset: session.receivedBytes,
    status: session.status,
    chunkSize: RECOMMENDED_CHUNK_BYTES,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
  };
}

/**
 * POST /admin/media/uploads
 *
 * Start, or pick up, an upload. Answers with the offset to send from, which is
 * 0 for a new upload and wherever the last attempt got to for one being
 * resumed -- from another tab, another day, or another device.
 */
adminMediaUploadsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest("Tell us the file's name and size before sending it.", parsed.error.flatten());
    }
    const input = parsed.data;

    try {
      const result = await openUploadSession({
        adminUserId: adminId(req),
        originalName: input.fileName,
        declaredMime: input.mime,
        sizeBytes: input.sizeBytes,
        lastModified: input.lastModified,
        visibility: input.visibility,
      });

      if (result.kind === "duplicate") {
        // Not an error, and not an upload either. She asked for this file to be
        // in her library and it already is.
        res.status(200).json({
          duplicate: true,
          asset: toMediaJson(result.asset, adminId(req)),
        });
        return;
      }

      res.status(result.resumed ? 200 : 201).json({
        ...sessionJson(result.session),
        resumed: result.resumed,
      });
    } catch (err) {
      if (err instanceof UnsupportedUploadError) {
        throw badRequest(unsupportedTypeMessage(err.message));
      }
      if (err instanceof UploadTooLargeError) {
        throw payloadTooLarge(
          `That file is bigger than ${Math.floor(maxUploadBytes() / (1024 * 1024))}MB, which is the most we can store.`,
        );
      }
      if (err instanceof DuplicateNameError) {
        throw conflict(
          `You already have a different file called "${err.originalName}". Rename this one and try again.`,
          { duplicateName: err.originalName },
        );
      }
      throw err;
    }
  }),
);

/**
 * GET /admin/media/uploads
 *
 * Everything this administrator started and never finished. This is what makes
 * "close the tab and come back tomorrow" work: the list is on the server, so it
 * survives the browser being closed, the session expiring, and the upload
 * having been started on a different machine altogether.
 */
adminMediaUploadsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const sessions = await listOpenUploadSessions(adminId(req));
    res.json(sessions.map(sessionJson));
  }),
);

async function requireSession(req: Request): Promise<UploadSession> {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw notFound("That isn't an upload we know about.");
  const session = await findUploadSession(id, adminId(req));
  if (!session) throw notFound("That upload has expired. Choose the file again to start over.");
  return session;
}

/** GET /admin/media/uploads/:id - where to resume from, and whether it is still open. */
adminMediaUploadsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(sessionJson(await requireSession(req)));
  }),
);

/**
 * PUT /admin/media/uploads/:id?offset=N
 *
 * One chunk of the file, as raw bytes. The offset is stated rather than assumed
 * so a chunk that arrives twice -- the classic "response lost, client retried"
 * -- is refused with the real offset instead of being appended a second time.
 */
adminMediaUploadsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw notFound("That isn't an upload we know about.");

    const offset = Number(req.query.offset);
    if (!Number.isInteger(offset) || offset < 0) throw badRequest("Say where this chunk starts.");

    // Anything else would have been eaten by express.json() upstream and
    // arrived here as an empty stream, which looks exactly like a zero-byte
    // chunk and would quietly stall the upload forever.
    const contentType = (req.headers["content-type"] ?? "").toString().toLowerCase();
    if (contentType && !contentType.startsWith("application/octet-stream")) {
      throw badRequest("Upload chunks must be sent as application/octet-stream.");
    }

    const known = await findUploadSession(id, adminId(req));
    if (!known) throw notFound("That upload has expired. Choose the file again to start over.");

    // A retry of the final chunk after the response was lost. The file is
    // already whole; say so rather than refusing, so the client moves on to
    // finishing instead of treating it as a failure.
    if (known.status !== "open") {
      res.json({ ...sessionJson(known), complete: known.receivedBytes >= known.sizeBytes });
      return;
    }

    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && offset + declared > known.sizeBytes) {
      throw payloadTooLarge("That chunk carried more of the file than there is left.");
    }

    const session = await lockUploadSession(id, adminId(req));
    if (!session) {
      throw conflict("This file is already being uploaded somewhere else. Let that one finish.", {
        offset: known.receivedBytes,
        sizeBytes: known.sizeBytes,
      });
    }

    try {
      const updated = await appendChunk(session, offset, req);
      res.json({
        ...sessionJson(updated),
        complete: updated.receivedBytes >= updated.sizeBytes,
      });
    } catch (err) {
      await unlockUploadSession(id);
      // The client is gone. Its bytes stopped at the acknowledged offset and it
      // will ask again; there is no socket left to write a status onto.
      if (err instanceof ChunkInterrupted) return;
      throw err;
    }
  }),
);

/**
 * POST /admin/media/uploads/:id/complete
 *
 * Turns the finished part file into a library asset. Refuses with the current
 * offset if bytes are still missing, so a client that thought it was done can
 * simply carry on from there.
 */
adminMediaUploadsRouter.post(
  "/:id/complete",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw notFound("That isn't an upload we know about.");

    const known = await findUploadSession(id, adminId(req));
    if (!known) throw notFound("That upload has expired. Choose the file again to start over.");

    // Already finished, and this is a retry of a call whose answer never
    // arrived. Hand back the same asset rather than a second copy of it.
    if (known.status === "completed") {
      const asset = await completeUploadSession(known);
      res.status(200).json(toMediaJson(asset, adminId(req)));
      return;
    }

    const session = await lockUploadSession(id, adminId(req));
    if (!session) {
      throw conflict("This file is still being uploaded somewhere else.", {
        offset: known.receivedBytes,
        sizeBytes: known.sizeBytes,
      });
    }

    try {
      const asset = await completeUploadSession(session);
      res.status(201).json(toMediaJson(asset, adminId(req)));
    } catch (err) {
      await unlockUploadSession(id);
      if (err instanceof DuplicateNameError) {
        throw conflict(
          `You already have a different file called "${err.originalName}". Rename this one and try again.`,
          { duplicateName: err.originalName },
        );
      }
      throw err;
    }
  }),
);

/** DELETE /admin/media/uploads/:id - she does not want this one after all. */
adminMediaUploadsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw notFound("That isn't an upload we know about.");
    const session = await findUploadSession(id, adminId(req));
    // Already gone is the outcome the caller wanted.
    if (session) await abortUploadSession(session);
    res.status(204).end();
  }),
);
