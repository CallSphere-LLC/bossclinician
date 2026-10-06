import { Request, Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError, badRequest, notFound } from "../../utils/httpError";
import { pool } from "../../db/pool";
import { assertOfferDeliverable } from "../../services/downloadReadiness";
import { publicView } from "../public/settings";
import {
  buildOfferQuote,
  buildOfferView,
  loadOfferByIdAnyStatus,
  quoteSchema,
} from "../public/offers";

/**
 * `/api/admin/offers/:id/checkout-preview` — "Preview checkout".
 *
 * The offer as `/checkout/:offerSlug` shows it to a buyer, answered to an
 * administrator instead, and for any status: a draft is exactly the offer
 * Yvette most wants to look at before anybody else can. The body is
 * `buildOfferView`'s, the very function the public GET returns, so the admin
 * app feeds the real checkout components from here rather than a lookalike.
 *
 * Why an admin endpoint and not a signed link on the public site: the admin
 * session lives in `__Host-` cookies (auth/adminSession.ts), which are bound to
 * the admin host and never reach the public one, and the public offer routes
 * refuse drafts on purpose (a slug's existence leaks the launch calendar). A
 * preview token would be a second way past that rule; this is not.
 *
 * Nothing here writes. There is no checkout, order, contact, abandoned-cart or
 * PaymentIntent route under this mount (and Stripe.js is never loaded: the
 * admin host's CSP does not allow it, and the preview has no use for it), and the quote's coupon check is the
 * unlocked snapshot the public quote already uses. The preview page answers
 * "Pay" in the browser without a request.
 *
 * Mounted at `/offers/:id/checkout-preview` behind `requireAuth` and
 * `moduleGate("offers", ["/quote"])`: both routes are reads, so both need only
 * `offers.view`.
 */
export const adminOfferPreviewRouter = Router({ mergeParams: true });

/** Postgres int4 ceiling. An id it cannot hold is a 404, not a failed query. */
const MAX_INT4 = 2_147_483_647;
const OFFER_MISSING = "We couldn't find that offer.";
const idSchema = z.coerce.number().int().positive().max(MAX_INT4);

async function loadOffer(req: Request) {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) throw notFound(OFFER_MISSING);
  const offer = await loadOfferByIdAnyStatus(parsed.data);
  if (!offer) throw notFound(OFFER_MISSING);
  return offer;
}

/**
 * Why a buyer could not complete this checkout today, in the words the public
 * page would show them — or null. Reported, not thrown: the point of a preview
 * is to see the page, including the one that is not ready to sell yet.
 */
async function deliverabilityIssue(offerId: number): Promise<string | null> {
  try {
    await assertOfferDeliverable(offerId);
    return null;
  } catch (err) {
    if (err instanceof HttpError) return err.message;
    throw err;
  }
}

/**
 * The checkout settings the public page reads from `/api/settings` (button
 * colours, coupon field, support email), through the same public allow-list.
 * The admin host does not proxy `/api/settings`, so the preview is handed them
 * here instead of drawing the form with the defaults.
 */
async function checkoutSettings(): Promise<Record<string, unknown>> {
  const res = await pool.query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'checkout'`);
  const view = publicView("checkout", res.rows[0]?.value);
  return typeof view === "object" && view !== null ? (view as Record<string, unknown>) : {};
}

/** GET / — the public offer shape plus a `preview` block for the banner. */
adminOfferPreviewRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const offer = await loadOffer(req);
    const [view, issue, settings] = await Promise.all([
      // No member: the admin is not a buyer, so "you already own this" never shows.
      buildOfferView(offer, null),
      deliverabilityIssue(offer.id),
      checkoutSettings(),
    ]);
    res.json({
      ...view,
      alreadyOwned: false,
      preview: {
        status: offer.status,
        publicPath: `/checkout/${encodeURIComponent(offer.slug)}`,
        deliverabilityIssue: issue,
        checkoutSettings: settings,
      },
    });
  })
);

/** POST /quote — the public quote's arithmetic for any status. Writes nothing. */
adminOfferPreviewRouter.post(
  "/quote",
  asyncHandler(async (req, res) => {
    const parsed = quoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest("Invalid quote request", parsed.error.flatten());
    const offer = await loadOffer(req);
    // No email: the once-per-customer coupon rule is answered as for a guest.
    res.json(await buildOfferQuote(offer, parsed.data, null, { skipDeliverability: true }));
  })
);
