import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import {
  endSession,
  ensureVoiceVisitorId,
  loadSessionForCaller,
} from "../../services/voice/sessionStore";
import { identityFromRequest } from "./session";

export const voiceEndRouter = Router();
const endSchema = z.object({
  sessionId: z.string().trim().min(1).max(64),
  reason: z.enum(["hung up", "connection ended"]).default("hung up"),
});

// A graceful provider close also needs a durable application end timestamp.
// Ownership is checked exactly as for transcript and recording uploads.
voiceEndRouter.post(
  "/end",
  asyncHandler(async (req, res) => {
    const parsed = endSchema.safeParse(req.body);
    if (!parsed.success)
      throw badRequest("Invalid conversation ending", parsed.error.flatten());
    const caller = {
      identity: await identityFromRequest(req, res),
      visitorId: ensureVoiceVisitorId(req, res),
    };
    const session = await loadSessionForCaller(parsed.data.sessionId, caller);
    if (!session) throw notFound("That conversation could not be found.");
    await endSession(session.id, parsed.data.reason);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ended: true });
  }),
);
