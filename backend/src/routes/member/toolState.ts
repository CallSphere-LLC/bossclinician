import { Router, type Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation } from "../../middleware/memberAuth";
import {
  cleanToolKey,
  loadToolState,
  mayUseTool,
  saveToolState,
  toolStateProblem,
} from "../../services/toolState";

/**
 * A member's saved entries in an interactive lesson tool (migration 119) —
 * mounted on the member surface (requireMember is applied by
 * routes/member/index.ts).
 *
 *   GET /tool-state/:toolKey   what they last saved ({ state: null } before the first save)
 *   PUT /tool-state/:toolKey   replace it ({ state: {...} }, at most 256 KB of JSON)
 *
 * Both answer 404 unless the member may open a published lesson carrying the
 * tool: tool keys are guessable, and a 403 would confirm which exist. The
 * write carries denyImpersonation — "view as member" can read a student's
 * planner but must not autosave over it.
 */
export const memberToolStateRouter = Router();

const TOOL_MISSING = "We couldn't find that tool.";
const TOO_MANY = { error: "Too many saves. Please wait a moment and try again." };

/**
 * Autosave is debounced in the client (one write per pause in typing), so a
 * busy session is a few writes a minute. The ceiling stops a loop, not a
 * member filling in a long worksheet.
 */
const saveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: (req: Request) => (req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "")),
});

function currentMemberId(req: Request): number {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member.id;
}

async function allowedToolKey(req: Request): Promise<string> {
  const toolKey = cleanToolKey(req.params.toolKey);
  if (!toolKey || !(await mayUseTool(currentMemberId(req), toolKey))) throw notFound(TOOL_MISSING);
  return toolKey;
}

memberToolStateRouter.get(
  "/tool-state/:toolKey",
  asyncHandler(async (req, res) => {
    const toolKey = await allowedToolKey(req);
    res.json(await loadToolState(currentMemberId(req), toolKey));
  }),
);

const saveSchema = z.object({ state: z.unknown() });

memberToolStateRouter.put(
  "/tool-state/:toolKey",
  denyImpersonation,
  saveLimiter,
  asyncHandler(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Nothing to save.");
    const problem = toolStateProblem(parsed.data.state);
    if (problem) throw badRequest(problem);

    const toolKey = await allowedToolKey(req);
    const saved = await saveToolState(
      currentMemberId(req),
      toolKey,
      parsed.data.state as Record<string, unknown>,
    );
    res.json({ ok: true, updatedAt: saved.updatedAt });
  }),
);
