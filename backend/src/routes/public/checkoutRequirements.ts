import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { forbidden, notFound } from "../../utils/httpError";
import { serveContractPdf } from "../../services/contractStorage";
import { findUsableInvitation, loadOfferRequirements } from "../../services/checkoutRequirements";
import { loadPublishedOffer } from "./offers";

/**
 * The two reads a buyer needs for an agreement before payment (QA row 202). They
 * have no session to authenticate against, so each answers only for what the
 * buyer is already being asked to sign: a contract the owner made required on a
 * published offer, or the invitation whose secret link they are holding.
 */
export const checkoutRequirementsRouter = Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

function queryToken(raw: unknown): string {
  return typeof raw === "string" && raw.length >= 20 && raw.length <= 200 ? raw : "";
}

/** GET /api/checkout/invitations/:token: who the link is for, to fill in their email. */
checkoutRequirementsRouter.get(
  "/checkout/invitations/:token",
  limiter,
  asyncHandler(async (req, res) => {
    const invitation = queryToken(req.params.token) ? await findUsableInvitation(req.params.token) : null;
    if (!invitation) throw notFound("This invitation link is no longer available. Please contact support@bossclinician.com.");
    res.setHeader("Cache-Control", "no-store");
    res.json({ email: invitation.email, fullName: invitation.full_name, offerSlug: invitation.offer_slug });
  })
);

/** GET /api/checkout/offer/:slug/agreements/:contractId/file: the PDF to read before signing. */
checkoutRequirementsRouter.get(
  "/checkout/offer/:slug/agreements/:contractId/file",
  limiter,
  asyncHandler(async (req, res) => {
    const contractId = Number(req.params.contractId);
    if (!Number.isSafeInteger(contractId) || contractId <= 0) throw notFound("Agreement not found");
    const offer = await loadPublishedOffer(req.params.slug);
    if (!offer) throw notFound("Agreement not found");
    const requirements = await loadOfferRequirements(offer.id);
    if (!requirements.contracts.some((contract) => contract.id === contractId)) throw notFound("Agreement not found");
    if (requirements.settings.invitationRequired) {
      const token = queryToken(req.query.invite);
      const invitation = token ? await findUsableInvitation(token) : null;
      if (!invitation || invitation.offer_id !== offer.id) throw forbidden("Enrollment is by invitation.");
    }
    const found = await pool.query<{ storage_ref: string }>(`SELECT storage_ref FROM participant_contracts WHERE id = $1`, [contractId]);
    if (!found.rows[0]) throw notFound("Agreement not found");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="agreement.pdf"');
    await serveContractPdf(req, res, found.rows[0].storage_ref);
  })
);
