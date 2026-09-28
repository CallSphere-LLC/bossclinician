import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { getPurchaseDetail, listContactPurchases } from "../../services/purchases";

/**
 * Purchases as Kajabi shows them. Mounted at /admin/purchases.
 *
 *   GET /contact/:contactId        a person's Purchases tab, newest first
 *   GET /contact/:contactId/count  just the number ("Total purchases" on the drawer)
 *   GET /:key                      one purchase's View Details page
 *
 * A separate router rather than more routes on /admin/contacts: the contacts
 * router already has `POST /:id/purchases` (recording a manual payment), and a
 * GET beside it meaning something else would be a trap. The contact-scoped
 * routes come before `/:key` so "contact" is never read as a purchase key.
 *
 * Read-only, and mounted behind the contacts permission because this is a tab
 * of the contact profile: whoever can open a person's page could already see
 * every payment on it. Refunds, cancellations and grants stay where they are
 * (sales, offers), with their own guards.
 */
export const adminPurchasesRouter = Router();

function parseContactId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) throw badRequest("Invalid id");
  return id;
}

adminPurchasesRouter.get(
  "/contact/:contactId",
  asyncHandler(async (req, res) => {
    res.json(await listContactPurchases(parseContactId(req.params.contactId)));
  }),
);

adminPurchasesRouter.get(
  "/contact/:contactId/count",
  asyncHandler(async (req, res) => {
    const { purchaseCount } = await listContactPurchases(parseContactId(req.params.contactId));
    res.json({ purchaseCount });
  }),
);

/** `12` (a purchase), `order-45` (a payment that is its own purchase), `grant-7` (an offer granted here). */
adminPurchasesRouter.get(
  "/:key",
  asyncHandler(async (req, res) => {
    res.json(await getPurchaseDetail(req.params.key));
  }),
);
