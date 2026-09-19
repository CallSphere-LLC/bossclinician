import express, { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, conflict, forbidden, notFound, payloadTooLarge } from "../../utils/httpError";
import { resolveMime } from "../../services/mediaStorage";
import { SURFACE_LIMITS } from "../../services/voice/contract";
import {
  MAX_RECORDING_CHUNKS,
  MAX_RECORDING_CHUNK_BYTES,
  recordingStore,
} from "../../services/voice/recordingStore";
import {
  ensureVoiceVisitorId,
  loadSessionForCaller,
  noteRecordingChunk,
  type VoiceCaller,
} from "../../services/voice/sessionStore";
import { identityFromRequest } from "./session";

/**
 * PUT /api/voice/recording?sessionId=…&seq=N — the audio, while it happens.
 *
 * Not one upload at the end. `MediaRecorder.stop()` followed by a single PUT
 * only works for the person who waits politely for the call to finish, and the
 * common case is a tab closed mid-sentence — which is exactly how a recording
 * feature ends up holding nothing at all. So three seconds of audio arrive at a
 * time, numbered from zero, and the store keeps every slice that got here.
 *
 * The body is raw audio rather than a form upload: there is one blob, the
 * browser already holds it, and multipart would only wrap it in a boundary for
 * both sides to pay to parse. The parser is scoped to this route and to audio
 * types, so nothing else in the app grows a raw body handler.
 *
 * Where the bytes land is the `RecordingStore`'s business, and this route asks
 * the factory rather than choosing: today that is the protected volume, and on
 * the day a bucket exists it is S3, with no change here.
 *
 * Nothing here closes the recording. The last slice of a clean goodbye and the
 * `pagehide` slice of a closed tab look identical from the server — the latter
 * is capped at 64KB by the browser and may arrive after everything else — so
 * "the highest sequence number so far" is never evidence that a call is over.
 * The slices are joined when the owner first opens the conversation, which
 * works the same for a call that ended properly and one that was abandoned.
 *
 * Three refusals worth naming:
 *
 *  - Ownership, re-checked on **every** slice. A session id in a query string
 *    is not a right to append to somebody else's recording, and a check made
 *    only on the first slice is a check made on the wrong request.
 *  - A surface whose limits say `recordAudio: false`, even if a browser tries
 *    anyway: the disclosure the visitor was shown before the mic opened is the
 *    promise being kept here.
 *  - A slice for a recording that has already been joined, because appending to
 *    a finished object would silently do nothing.
 *
 * A repeated `seq` is not an error — it is a retry, and it overwrites itself
 * with identical bytes. A missing one is not an error either: the conversation
 * loses the three seconds that never arrived and keeps everything else.
 */
export const voiceRecordingRouter = Router();

const querySchema = z.object({
  sessionId: z.string().trim().min(1).max(64),
  seq: z.coerce.number().int().min(0).max(MAX_RECORDING_CHUNKS - 1),
});

/**
 * The body parser, deliberately narrow.
 *
 * `express.raw` only claims requests whose Content-Type it matches, so a
 * declaration of `application/octet-stream` never reaches a Buffer here — and
 * the store needs a real type to name the finished file, and to serve it as
 * what it is. The limit is one slice's worth: three seconds of browser audio is
 * tens of kilobytes, so a megabyte is thirty times generous and still bounds
 * what one conversation can be made to store.
 */
const rawAudio = express.raw({ type: "audio/*", limit: MAX_RECORDING_CHUNK_BYTES });

voiceRecordingRouter.put(
  "/recording",
  rawAudio,
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest("Which part of which conversation is this?");

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw badRequest("Send the audio as the request body, with its audio type.");
    }
    if (req.body.length > MAX_RECORDING_CHUNK_BYTES) {
      throw payloadTooLarge("That piece of audio is too large.");
    }

    const declared = (req.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const contentType = resolveMime(declared, "");
    // The media library's own whitelist, so an audio type this app will not
    // store as an upload is not stored here either.
    if (contentType === null || !contentType.startsWith("audio/")) {
      throw badRequest("That is not an audio recording this app can store.");
    }

    const caller: VoiceCaller = {
      identity: await identityFromRequest(req, res),
      visitorId: ensureVoiceVisitorId(req, res),
    };
    const session = await loadSessionForCaller(parsed.data.sessionId, caller);
    if (session === null) throw notFound("That conversation could not be found.");

    if (!SURFACE_LIMITS[session.surface].recordAudio) {
      throw forbidden("Conversations on this part of the site are not recorded.");
    }
    if (session.recordingFinalizedAt !== null) {
      throw conflict("This conversation's recording is already closed.");
    }

    await recordingStore().putChunk({
      sessionId: session.id,
      seq: parsed.data.seq,
      body: req.body,
      contentType,
    });
    await noteRecordingChunk(session.id, { seq: parsed.data.seq, contentType });

    // 202: the audio is safely stored, and the recording it belongs to is not
    // finished. A `keepalive` flush from a closing tab gets the same answer as
    // any other slice, which is the point — by then nobody is reading it.
    res.setHeader("Cache-Control", "no-store");
    res.status(202).json({ stored: true, seq: parsed.data.seq });
  })
);
