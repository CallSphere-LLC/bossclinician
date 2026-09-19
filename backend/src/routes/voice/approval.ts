import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import {
  ensureVoiceVisitorId,
  loadSessionForCaller,
  markApprovalExecuted,
  recordApproval,
  type VoiceCaller,
  type VoiceSessionRow,
} from "../../services/voice/sessionStore";
import { identityFromRequest } from "./session";

/**
 * POST /api/voice/approval — the record that she was asked, and what she said.
 *
 * The assistant may run a real action in this admin only after the owner
 * approves it, out loud or in the chat. That rule is enforced in the browser,
 * where the approval card and the voice answer live — and a rule enforced only
 * where nobody can see it afterwards is a rule nobody can prove was followed.
 * This route is the proof: one row per thing the agent proposed, holding what
 * she was shown, what she answered and how she answered it.
 *
 * Written for a "no" exactly as readily as for a "yes". A declined proposal is
 * the more valuable of the two records — it is the evidence the assistant asked
 * and was told not to — and a trail holding only the approvals cannot answer
 * the question it exists for.
 *
 * Two calls, because approval and execution are two moments:
 *
 *  1. `POST /api/voice/approval` when she answers. Returns `approvalId`.
 *  2. `POST /api/voice/approval/executed` once the action has actually run,
 *     with that id. An action that failed in between simply never gets this
 *     call, and the owner's page then reads "you said yes · it did not run",
 *     which is the truth. A row written optimistically at step 1 would claim
 *     her instruction was carried out when the only thing that happened was
 *     that she agreed to it.
 *
 * Both calls verify the caller owns the conversation they name, so an approval
 * id is no more a capability than a session id is, and both refuse any surface
 * but the admin one: a visitor on the marketing site has no business writing
 * into the record of what the owner authorised.
 */
export const voiceApprovalRouter = Router();

const approvalSchema = z.object({
  sessionId: z.string().trim().min(1).max(64),
  /** The stable id of the action, as the browser's own registry names it. */
  actionId: z.string().trim().min(1).max(200),
  title: z.string().trim().max(300).default(""),
  summary: z.string().trim().max(2000).default(""),
  details: z
    .array(
      z.object({
        label: z.string().trim().max(200),
        value: z.string().trim().max(2000),
      })
    )
    .max(50)
    .default([]),
  risk: z.enum(["normal", "destructive"]).default("normal"),
  approved: z.boolean(),
  answeredVia: z.enum(["voice", "chat", "click", "timeout", "cancelled"]),
  note: z.string().trim().max(2000).optional(),
  /**
   * Accepted for completeness and normally false. The second call is what says
   * an action ran; see the note at the top of this file.
   */
  executed: z.boolean().default(false),
});

const executedSchema = z.object({
  sessionId: z.string().trim().min(1).max(64),
  approvalId: z.string().trim().regex(/^[0-9]+$/, "Unknown approval"),
  executed: z.boolean(),
  /** What went wrong, when something did. It is the part she will want to read. */
  note: z.string().trim().max(2000).optional(),
});

/**
 * The conversation this request names, if the caller owns it and it is one that
 * could have proposed an action at all.
 *
 * The surface check is the second half of the same rule the browser follows:
 * only the admin concierge is given the propose-and-run pair of tools, and only
 * an admin session can have been opened on the admin surface. Refusing here as
 * well means a tampered bundle cannot write a row implying the owner approved
 * something on a public visitor's session.
 */
async function adminSessionFor(
  req: Request,
  res: Response,
  sessionId: string
): Promise<VoiceSessionRow> {
  const caller: VoiceCaller = {
    identity: await identityFromRequest(req, res),
    visitorId: ensureVoiceVisitorId(req, res),
  };
  const session = await loadSessionForCaller(sessionId, caller);
  if (session === null) throw notFound("That conversation could not be found.");
  if (session.surface !== "admin" || caller.identity.audience !== "admin") {
    throw forbidden("Only an administrator's conversation can approve an action.");
  }
  return session;
}

voiceApprovalRouter.post(
  "/approval",
  asyncHandler(async (req, res) => {
    const parsed = approvalSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid approval", parsed.error.flatten());

    const session = await adminSessionFor(req, res, parsed.data.sessionId);
    const { approvalId } = await recordApproval({
      sessionId: session.id,
      actionId: parsed.data.actionId,
      title: parsed.data.title,
      summary: parsed.data.summary,
      details: parsed.data.details,
      risk: parsed.data.risk,
      approved: parsed.data.approved,
      answeredVia: parsed.data.answeredVia,
      note: parsed.data.note,
      executed: parsed.data.executed,
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ approvalId });
  })
);

voiceApprovalRouter.post(
  "/approval/executed",
  asyncHandler(async (req, res) => {
    const parsed = executedSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid approval", parsed.error.flatten());

    const session = await adminSessionFor(req, res, parsed.data.sessionId);
    const closed = await markApprovalExecuted({
      approvalId: parsed.data.approvalId,
      sessionId: session.id,
      executed: parsed.data.executed,
      note: parsed.data.note,
    });
    // An id that names no entry of this conversation's is a miss, not a
    // silently accepted write into somebody else's trail.
    if (!closed) throw notFound("That approval could not be found.");

    res.setHeader("Cache-Control", "no-store");
    res.json({ recorded: true });
  })
);
