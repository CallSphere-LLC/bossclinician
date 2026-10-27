import { Router, type Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, conflict, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation } from "../../middleware/memberAuth";
import { createLivingPlanPdf, livingPlanReportSchema } from "../../services/livingPlanPdf";
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

const saveSchema = z.object({
  state: z.unknown(),
  revision: z.number().int().nonnegative().optional(),
  // A pending browser autosave must not follow a different member's new token.
  expectedMemberId: z.number().int().positive().optional(),
});

const pdfLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: "Please wait a minute before downloading another PDF." },
  keyGenerator: (req: Request) => req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? ""),
});

memberToolStateRouter.post(
  "/tool-state/living-business-plan/pdf",
  pdfLimiter,
  asyncHandler(async (req, res) => {
    const memberId = currentMemberId(req);
    if (!(await mayUseTool(memberId, "living-business-plan"))) throw notFound(TOOL_MISSING);
    const problem = toolStateProblem(req.body);
    if (problem) throw badRequest(problem);
    const parsed = z.object({ expectedMemberId: z.number().int().positive(), report: livingPlanReportSchema }).strict().safeParse(req.body);
    if (!parsed.success) throw badRequest("That plan could not be exported. Reload the plan and try again.");
    if (parsed.data.expectedMemberId !== memberId) throw conflict("The signed-in account changed. Reload this page before exporting.");
    const pdf = await createLivingPlanPdf(parsed.data.report);
    res.setHeader("Cache-Control", "private, no-store");
    res.attachment(`annual-business-plan-${parsed.data.report.year}.pdf`);
    res.type("application/pdf").send(pdf);
  }),
);

memberToolStateRouter.put(
  "/tool-state/:toolKey",
  denyImpersonation,
  saveLimiter,
  asyncHandler(async (req, res) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Nothing to save.");
    if (parsed.data.expectedMemberId !== undefined && parsed.data.expectedMemberId !== currentMemberId(req)) {
      throw conflict("The signed-in account changed. Reload this page before saving.");
    }
    const problem = toolStateProblem(parsed.data.state);
    if (problem) throw badRequest(problem);

    const toolKey = await allowedToolKey(req);
    if (toolKey === "practice-elevation-dashboard" && parsed.data.revision === undefined) throw conflict("Please reload this dashboard to update its editor.");
    if (toolKey === "boardroom-ceo-assessment") {
      if (parsed.data.revision === undefined || parsed.data.expectedMemberId === undefined) {
        throw conflict("Please reload this assessment to update its editor before saving.");
      }
      if (!saveSchema.strict().safeParse(req.body).success) throw badRequest("Nothing to save.");
    }
    const saved = await saveToolState(
      currentMemberId(req),
      toolKey,
      parsed.data.state as Record<string, unknown>,
      parsed.data.revision,
    );
    res.json({ ok: true, updatedAt: saved.updatedAt, revision: saved.revision });
  }),
);
