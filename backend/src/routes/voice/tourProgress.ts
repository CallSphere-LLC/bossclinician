import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { resolveSurface } from "../../services/voice/contract";
import { readTourProgress, saveTourProgress } from "../../services/voice/tourProgress";
import { ensureVoiceVisitorId, type VoiceCaller } from "../../services/voice/sessionStore";
import { identityFromRequest } from "./session";

/**
 * /api/voice/tour-progress — how far through the walkthrough this person is.
 *
 * Kept on the server, not in the browser, because the promise addendum 1 makes
 * is that the tour follows the person: shown three pages of the portal on a
 * laptop, they are not shown them again on their phone. An anonymous visitor
 * gets the same treatment through a first-party cookie, which is minted here if
 * they do not have one yet — so the walkthrough is offered once to a visitor as
 * well, rather than every time they come back.
 *
 * The surface is re-decided from the request's credentials before anything is
 * stored. It has to be: a signed-out visitor who posts `surface: "admin"` would
 * otherwise write a row that says the owner's walkthrough is finished, and she
 * would never be offered it.
 *
 * No session is involved. Progress belongs to the person, not to one
 * conversation, and asking for a session here would mean a dropped call could
 * not resume — which is the exact thing this exists to survive.
 */
export const voiceTourProgressRouter = Router();

const surfaceSchema = z.enum(["public", "member", "admin"]);

const advanceSchema = z.object({
  surface: surfaceSchema,
  /** Which stop is being narrated now. */
  index: z.number().int().min(0).max(200),
  /** True when the walkthrough is finished — or when it was declined. */
  completed: z.boolean().default(false),
});

async function callerFor(req: Request, res: Response): Promise<VoiceCaller> {
  return {
    identity: await identityFromRequest(req, res),
    visitorId: ensureVoiceVisitorId(req, res),
  };
}

voiceTourProgressRouter.get(
  "/tour-progress",
  asyncHandler(async (req, res) => {
    const requested = surfaceSchema.safeParse(req.query.surface);
    if (!requested.success) throw badRequest("Which part of the site do you mean?");

    const caller = await callerFor(req, res);
    const surface = resolveSurface(requested.data, caller.identity);
    const progress = await readTourProgress(surface, caller);

    res.setHeader("Cache-Control", "no-store");
    // `surface` is echoed because it may be lower than the one asked for, and a
    // browser that asked as an admin and was answered as a visitor needs to
    // know which walkthrough the answer is about.
    res.json({ surface, progress });
  })
);

voiceTourProgressRouter.post(
  "/tour-progress",
  asyncHandler(async (req, res) => {
    const parsed = advanceSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid walkthrough progress", parsed.error.flatten());

    const caller = await callerFor(req, res);
    const surface = resolveSurface(parsed.data.surface, caller.identity);
    const progress = await saveTourProgress(surface, caller, {
      index: parsed.data.index,
      completed: parsed.data.completed,
    });

    res.setHeader("Cache-Control", "no-store");
    // A null progress means the browser refuses cookies and there is nobody to
    // remember: the walkthrough still runs, it just starts again next time.
    res.json({ surface, progress });
  })
);
