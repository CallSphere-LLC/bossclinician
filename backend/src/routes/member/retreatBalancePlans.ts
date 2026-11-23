import { Router, type Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation } from "../../middleware/memberAuth";
import { loadGuestRetreat } from "../../services/retreats";
import {
  asHttpError,
  confirmBalancePlanCard,
  createBalancePlanSetupIntent,
} from "../../services/retreatBalancePlans";

/**
 * `/api/member/retreats/:slug/balance-plan/*` (mounted inside
 * memberRetreatsRouter, so requireMember already ran).
 *
 * A guest saving the card her retreat balance is charged to. Same rules as the
 * rest of the retreat dashboard: every handler starts with loadGuestRetreat
 * (published retreat + active grant, or the same 404), the plan is always
 * looked up by (retreat, req.member.id) and never by an id from the client,
 * and both routes carry denyImpersonation, so an admin "viewing as" a guest
 * can never save a card or start a charge in her name.
 *
 * The plan itself is read with the dashboard (`balancePlan` on
 * GET /retreats/:slug).
 */
export const memberRetreatBalancePlansRouter = Router();

function memberIdOf(req: Request): number {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member.id;
}

/** Card set-up is a handful of requests per guest, ever. */
const cardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
  keyGenerator: (req: Request) => (req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "")),
});

function noStore(res: import("express").Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}

/**
 * POST /retreats/:slug/balance-plan/setup-intent -> { clientSecret, balancePlan }
 * Only while the plan is open. Creates a Stripe SetupIntent for an off-session
 * card, tied to this member and this plan. `balancePlan` is the plan as it
 * stands now: the page shows the card form, the schedule and the consent
 * sentence from it, so the guest agrees to what the server will store.
 */
memberRetreatBalancePlansRouter.post(
  "/retreats/:slug/balance-plan/setup-intent",
  denyImpersonation,
  cardLimiter,
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    const session = await createBalancePlanSetupIntent(retreat, memberId);
    noStore(res);
    res.json({ clientSecret: session.clientSecret, balancePlan: session.balancePlan });
  }),
);

const confirmSchema = z.object({
  setupIntentId: z.string().trim().max(255).regex(/^seti_[A-Za-z0-9_]+$/),
  agreed: z.literal(true),
});

/**
 * POST /retreats/:slug/balance-plan/confirm { setupIntentId, agreed: true, authorizationText }
 *   -> { balancePlan, charged }
 * Saves the card and records the guest's agreement to the schedule. When the
 * first charge date has already arrived the first payment is taken now
 * (`charged`). A declined card answers 402 with a sentence for the guest.
 *
 * `authorizationText` is the consent sentence exactly as her page displayed
 * it. When it is not the sentence the server would store (the owner changed
 * the numbers, the date rolled over, or an old page sent none), the answer is
 * 409 with details `{ code: "schedule_changed" }` and nothing is saved. A card
 * the bank has not finished confirming answers 409 `{ code: "setup_pending" }`:
 * the same SetupIntent can be sent again.
 */
memberRetreatBalancePlansRouter.post(
  "/retreats/:slug/balance-plan/confirm",
  denyImpersonation,
  cardLimiter,
  asyncHandler(async (req, res) => {
    const memberId = memberIdOf(req);
    const retreat = await loadGuestRetreat(memberId, String(req.params.slug));
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.agreed !== true) throw badRequest("Please tick the box to agree to the payment schedule.");
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) throw notFound("We couldn't find that card. Please add your card again.");
    try {
      const result = await confirmBalancePlanCard({
        retreat,
        memberId,
        setupIntentId: parsed.data.setupIntentId,
        // Compared with the server's own sentence, never stored. Anything
        // that is not a string cannot match and is answered as "changed".
        authorizationText: typeof body.authorizationText === "string" ? body.authorizationText : "",
        ip: req.ip ?? "",
      });
      noStore(res);
      res.json(result);
    } catch (err) {
      throw asHttpError(err);
    }
  }),
);
