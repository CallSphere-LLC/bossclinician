import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { asyncHandler } from "../../utils/asyncHandler";
import { optionalMember } from "../../middleware/memberAuth";
import { publicBonusStatus } from "../../services/clubBonus";

/**
 * GET /api/club-bonus/status?t=<signed link token>
 *
 * The Ramp-Up Rate Formula bonus as /club and /club/checkout show it to the
 * person looking (migration 215, services/clubBonus.ts):
 *   { state: "open", deadline: "December 6", deadlineAt }  their own window
 *   { state: "expired" }                                    their window closed
 *   { state: "public" }                                     anybody else
 *
 * Identified only by the signed link from their emails or by their own
 * signed-in session. There is deliberately no "look up this email address":
 * that would tell anyone whether an address registered, and when.
 */
export const clubBonusRouter = Router();

const statusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

clubBonusRouter.get(
  "/club-bonus/status",
  statusLimiter,
  optionalMember,
  asyncHandler(async (req, res) => {
    const token = typeof req.query.t === "string" ? req.query.t : null;
    // "View as member" sees the member's own page, so the member's address is used.
    const status = await publicBonusStatus({ token, memberEmail: req.member?.email ?? null });
    res.set("Cache-Control", "private, no-store");
    res.json(status);
  })
);
