import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import {
  appendTranscript,
  ensureVoiceVisitorId,
  loadSessionForCaller,
  type VoiceCaller,
} from "../../services/voice/sessionStore";
import { identityFromRequest } from "./session";

/**
 * POST /api/voice/transcript — what was said, as it finalises.
 *
 * The browser is the only place that knows: the audio flows peer to peer
 * between the visitor and OpenAI, so the server never hears a word of it and
 * the transcript can only arrive this way. Lines come in batches while the call
 * is still live, which is what makes the two properties below necessary rather
 * than nice.
 *
 * **Ownership.** The body names a session, and a name proves nothing — so the
 * row is loaded through `loadSessionForCaller`, which compares it against the
 * credentials this request carries. Without that, a leaked or guessed session
 * id would be a licence to write words into somebody else's conversation, and
 * the owner would read them as if that person had said them.
 *
 * **Idempotence.** A flush whose response was lost is retried with the same
 * batch, so the store keys each line on its own contents and a repeat becomes a
 * no-op. The response says how many lines were new, which is `0` for a retry
 * and is the honest answer rather than a second copy of the conversation.
 *
 * Appending to a call that has already ended is allowed on purpose: the last
 * batch usually lands during teardown, and dropping it would lose the end of
 * every conversation — including the part where somebody says what they
 * actually wanted.
 */
export const voiceTranscriptRouter = Router();

const appendSchema = z.object({
  sessionId: z.string().trim().min(1).max(64),
  lines: z
    .array(
      z.object({
        role: z.enum(["user", "agent"]),
        text: z.string().trim().min(1).max(4000),
        /** Milliseconds from the start of the call; a day is far past any cap. */
        atMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
      })
    )
    .min(1)
    .max(200),
});

/*
 * No per-IP limiter on this one, deliberately.
 *
 * The browser posts a batch every time a line finalises, so a normal
 * fifteen-minute conversation is dozens of requests and a busy afternoon is
 * hundreds — and every per-IP bucket in middleware/rateLimit.ts is sized for a
 * form, with the note that req.ip is not the visitor's own address behind this
 * host's proxy chain. A refused append is not an error anybody sees: the
 * caller drops it and the owner reads a conversation with holes in it. What
 * bounds this route instead is ownership (you may only write into a
 * conversation you are having), the 200-line cap on one batch, the
 * same-origin check on the whole /api/voice router, and the site-wide
 * apiLimiter in app.ts.
 */
voiceTranscriptRouter.post(
  "/transcript",
  asyncHandler(async (req, res) => {
    const parsed = appendSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid transcript", parsed.error.flatten());

    const caller: VoiceCaller = {
      identity: await identityFromRequest(req, res),
      visitorId: ensureVoiceVisitorId(req, res),
    };

    const session = await loadSessionForCaller(parsed.data.sessionId, caller);
    // "No such conversation" and "not yours" answer the same way. Telling them
    // apart would confirm the existence of other people's conversations to
    // anyone willing to guess at ids.
    if (session === null) throw notFound("That conversation could not be found.");

    const added = await appendTranscript(session.id, parsed.data.lines);

    res.setHeader("Cache-Control", "no-store");
    res.json({ added });
  })
);
