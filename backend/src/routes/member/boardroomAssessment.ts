import { Router, type Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { denyImpersonation } from "../../middleware/memberAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, conflict, notFound, unauthorized } from "../../utils/httpError";
import { mayUseTool } from "../../services/toolState";
import {
  BOARDROOM_ASSESSMENT_KEY, boardroomResponsesSchema,
  listBoardroomReports, loadBoardroomLinks, loadBoardroomTimezone, submitBoardroomAssessment,
} from "../../services/boardroomAssessment";

export const memberBoardroomAssessmentRouter = Router();
const byMember = (req: Request) => req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");
const readLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, keyGenerator: byMember, message: { error: "Too many requests. Please wait a moment and try again." } });
const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: byMember, message: { error: "Too many requests. Please wait a moment and try again." } });
const submitSchema = z.object({
  responses: boardroomResponsesSchema,
  requestId: z.string().uuid(),
  expectedMemberId: z.number().int().positive(),
}).strict();
const noQuery = z.object({}).strict();

async function allowedMember(req: Request): Promise<number> {
  if (!req.member) throw unauthorized("Please sign in to continue");
  if (!(await mayUseTool(req.member.id, BOARDROOM_ASSESSMENT_KEY))) throw notFound("We couldn't find that tool.");
  return req.member.id;
}

// requireMember is applied by the parent router. Like tool-state GET, reads
// allow the existing authorized, audited "view as member" token, scoped to its
// member and that member's entitlement. POST remains read-only for impersonation.
memberBoardroomAssessmentRouter.get("/boardroom-assessment", readLimiter,
  asyncHandler(async (req, res) => {
    if (!noQuery.safeParse(req.query).success) throw badRequest("This assessment does not accept query parameters.");
    const memberId = await allowedMember(req);
    const [reports, links, timezone] = await Promise.all([
      listBoardroomReports(memberId), loadBoardroomLinks(memberId), loadBoardroomTimezone(memberId),
    ]);
    res.set("Cache-Control", "private, no-store").json({ reports, links, timezone });
  }),
);

memberBoardroomAssessmentRouter.post("/boardroom-assessment", denyImpersonation, submitLimiter,
  asyncHandler(async (req, res) => {
    if (!noQuery.safeParse(req.query).success) throw badRequest("This assessment does not accept query parameters.");
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Please answer all 12 questions with a whole number from 1 to 4 and a valid submission ID.");
    if (parsed.data.expectedMemberId !== req.member?.id) {
      throw conflict("The signed-in account changed. Reload this page before saving.");
    }
    const memberId = await allowedMember(req);
    const report = await submitBoardroomAssessment(memberId, parsed.data.responses, parsed.data.requestId);
    res.set("Cache-Control", "private, no-store").json({ report });
  }),
);
