import { Router, type Request } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { notFound } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";
import { findRetreatById, type RetreatRow } from "../../services/retreats";
import {
  cancelBalancePlan,
  closeBalancePlan,
  listAdminBalancePlans,
  openBalancePlan,
  previewRequestEmail,
  sendRequestEmail,
  upsertBalancePlan,
  type AdminBalancePlan,
} from "../../services/retreatBalancePlans";

/**
 * `/api/admin/retreats/:id/balance-plans*` — the organizer's side of retreat
 * balance plans (migration 230). Mounted inside adminRetreatsRouter AFTER its
 * owner/admin check, so every route here is owner/admin only.
 *
 *   GET   /:id/balance-plans                          every plan on the retreat
 *   PUT   /:id/balance-plans/:memberId                create / change the numbers (draft or open only)
 *   POST  /:id/balance-plans/:memberId/open           draft -> open (the guest can now add her card)
 *   POST  /:id/balance-plans/:memberId/close          open -> draft
 *   POST  /:id/balance-plans/:memberId/cancel         cancel (stops the Stripe subscription when billing)
 *   GET   /:id/balance-plans/:memberId/request-email  preview of the "add your card" email
 *   POST  /:id/balance-plans/:memberId/request-email  send it (only while open)
 *
 * Nothing here charges a card. A charge happens only after the GUEST saves a
 * card and agrees to the schedule on her own dashboard. Every change is written
 * to the admin audit log.
 */
export const adminRetreatBalancePlansRouter = Router();

async function retreatOf(req: Request): Promise<RetreatRow> {
  const retreat = await findRetreatById(Number(req.params.id));
  if (!retreat) throw notFound("We couldn't find that retreat.");
  return retreat;
}

function memberIdParam(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) throw notFound("We couldn't find that guest.");
  return id;
}

/** What the audit log keeps of a plan: the numbers and the state, never card details. */
function auditState(plan: AdminBalancePlan) {
  return {
    status: plan.status,
    agreedTotalCents: plan.agreedTotalCents,
    discountCents: plan.discountCents,
    priorPaidCents: plan.priorPaidCents,
    installmentCents: plan.installmentCents,
    installmentCount: plan.installmentCount,
    firstChargeOn: plan.firstChargeOn,
    finalDueOn: plan.finalDueOn,
    isTest: plan.isTest,
  };
}

adminRetreatBalancePlansRouter.get(
  "/:id/balance-plans",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    res.json({ plans: await listAdminBalancePlans(retreat) });
  }),
);

adminRetreatBalancePlansRouter.put(
  "/:id/balance-plans/:memberId",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const memberId = memberIdParam(req.params.memberId);
    const plan = await upsertBalancePlan(retreat, memberId, req.body);
    await recordAdminAction({ req, action: "retreat.balance_plan.save", entityType: "retreat_balance_plan", entityId: plan.id, after: auditState(plan) });
    res.json({ plan, plans: await listAdminBalancePlans(retreat) });
  }),
);

const TRANSITIONS: [string, (retreat: RetreatRow, memberId: number) => Promise<AdminBalancePlan>][] = [
  ["open", openBalancePlan],
  ["close", closeBalancePlan],
  ["cancel", cancelBalancePlan],
];

for (const [verb, run] of TRANSITIONS) {
  adminRetreatBalancePlansRouter.post(
    `/:id/balance-plans/:memberId/${verb}`,
    asyncHandler(async (req, res) => {
      const retreat = await retreatOf(req);
      const memberId = memberIdParam(req.params.memberId);
      const plan = await run(retreat, memberId);
      await recordAdminAction({ req, action: `retreat.balance_plan.${verb}`, entityType: "retreat_balance_plan", entityId: plan.id, after: auditState(plan) });
      res.json({ plan, plans: await listAdminBalancePlans(retreat) });
    }),
  );
}

adminRetreatBalancePlansRouter.get(
  "/:id/balance-plans/:memberId/request-email",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    res.json(await previewRequestEmail(retreat, memberIdParam(req.params.memberId)));
  }),
);

adminRetreatBalancePlansRouter.post(
  "/:id/balance-plans/:memberId/request-email",
  asyncHandler(async (req, res) => {
    const retreat = await retreatOf(req);
    const memberId = memberIdParam(req.params.memberId);
    const result = await sendRequestEmail(retreat, memberId);
    await recordAdminAction({
      req,
      action: "retreat.balance_plan.request_email",
      entityType: "retreat_balance_plan",
      entityId: result.plan.id,
      after: { sent: result.sent },
    });
    res.json(result);
  }),
);
