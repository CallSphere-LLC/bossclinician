import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { sendMail } from "../../email/mailer";
import { escapeHtml } from "../../email/templates";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { hashInvitationToken, loadOfferRequirements, parseAcknowledgments } from "../../services/checkoutRequirements";
import { loadSignature, renderSigningRecord } from "../../services/checkoutAgreementRecords";

/**
 * Admin for what an offer requires before payment (QA rows 202 and 203), mounted
 * under /admin/contracts. Each offer's settings are saved by their own button
 * and nothing here is live until the owner saves it switched on.
 */
export const adminCheckoutRequirementsRouter = Router();

const MAX_INT4 = 2_147_483_647;
const offerIdOf = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_INT4) throw badRequest("Invalid offer ID");
  return id;
};

/** A site path or an https address: never javascript:, data: or a protocol-relative host. */
const SAFE_LINK = /^(https:\/\/[^\s]+|\/(?!\/)[^\s]*)$/;

const requirementsSchema = z.object({
  acknowledgments: z
    .array(
      z.object({
        key: z.string().max(64).optional(),
        text: z.string().trim().min(3, "Write the wording for each box.").max(2000),
        linkLabel: z.string().trim().max(120).default(""),
        linkUrl: z.string().trim().max(2000).refine((value) => value === "" || SAFE_LINK.test(value), "A link must start with https:// or /").default(""),
        active: z.boolean(),
      })
    )
    .max(20),
  requiredContractIds: z.array(z.number().int().positive()).max(10),
  invitationRequired: z.boolean(),
  programTerm: z.string().trim().max(500),
  termMonths: z.number().int().min(1).max(120).nullable(),
  includedBenefits: z.string().trim().max(5000),
  refundTerms: z.string().trim().max(5000),
  refundWindowDays: z.number().int().min(0).max(365).nullable(),
  obligationsNote: z.string().trim().max(5000),
});

async function requireOffer(offerId: number): Promise<{ id: number; slug: string; title: string; status: string }> {
  const found = await pool.query<{ id: number; slug: string; title: string; status: string }>(
    `SELECT id, slug, title, status FROM offers WHERE id = $1`,
    [offerId]
  );
  if (!found.rows[0]) throw notFound("Offer not found");
  return found.rows[0];
}

async function invitationsFor(offerId: number) {
  const rows = await pool.query(
    `SELECT id, email, full_name, created_at, expires_at, revoked_at, completed_order_id, completed_at
       FROM offer_enrollment_invitations WHERE offer_id = $1 ORDER BY id DESC LIMIT 200`,
    [offerId]
  );
  return rows.rows.map((row) => ({ ...row, id: Number(row.id) }));
}

adminCheckoutRequirementsRouter.get(
  "/offers/:offerId/requirements",
  asyncHandler(async (req, res) => {
    const offerId = offerIdOf(req.params.offerId);
    const offer = await requireOffer(offerId);
    const [requirements, contracts, links] = await Promise.all([
      loadOfferRequirements(offerId),
      pool.query<{ id: string; title: string }>(`SELECT id, title FROM participant_contracts ORDER BY title, id`),
      pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM offer_payment_links WHERE offer_id = $1 AND active`, [offerId]),
    ]);
    res.json({
      offer,
      ...requirements.settings,
      requiredContractIds: requirements.contracts.map((contract) => contract.id),
      contracts: contracts.rows.map((row) => ({ id: Number(row.id), title: row.title })),
      livePaymentLinks: links.rows[0]?.n ?? 0,
      invitations: await invitationsFor(offerId),
    });
  })
);

adminCheckoutRequirementsRouter.put(
  "/offers/:offerId/requirements",
  asyncHandler(async (req, res) => {
    const offerId = offerIdOf(req.params.offerId);
    const parsed = requirementsSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
      throw badRequest(first ?? "Check the checkout requirements and try again.", parsed.error.flatten());
    }
    const body = parsed.data;
    await requireOffer(offerId);

    const requiredIds = [...new Set(body.requiredContractIds)];
    if (requiredIds.length > 0) {
      const found = await pool.query<{ id: string; title: string }>(`SELECT id, title FROM participant_contracts WHERE id = ANY($1::bigint[])`, [requiredIds]);
      if (found.rows.length !== requiredIds.length) throw badRequest("One of those contracts no longer exists. Reload and try again.");
      // A last guard against the mistake that matters most: buyers signing a draft.
      const draft = found.rows.find((row) => /draft/i.test(row.title));
      if (draft) throw badRequest(`"${draft.title}" is labelled a draft, so it can't be required at checkout. Upload the approved version under a final title first.`);
      if (!body.programTerm || !body.refundTerms) throw badRequest("Before requiring an agreement, fill in the program term and the refund terms for the enrollment record.");
    }

    const switchedOn = requiredIds.length > 0 || body.invitationRequired || body.acknowledgments.some((item) => item.active);
    if (switchedOn) {
      const links = await pool.query(`SELECT 1 FROM offer_payment_links WHERE offer_id = $1 AND active LIMIT 1`, [offerId]);
      if (links.rows.length > 0) throw badRequest("This offer has a live Stripe payment link, which would skip these steps. Deactivate the link on the offer's Price tab first.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ acknowledgments: unknown }>(
        `SELECT acknowledgments FROM offer_checkout_requirements WHERE offer_id = $1 FOR UPDATE`,
        [offerId]
      );
      const previous = new Map(parseAcknowledgments(current.rows[0]?.acknowledgments).map((item) => [item.key, item]));
      // The version moves only when what the buyer reads moves.
      const acknowledgments = body.acknowledgments.map((item) => {
        const before = item.key ? previous.get(item.key) : undefined;
        const changed = !before || before.text !== item.text || before.linkLabel !== item.linkLabel || before.linkUrl !== item.linkUrl;
        return {
          key: before?.key ?? crypto.randomBytes(8).toString("hex"),
          version: before ? before.version + (changed ? 1 : 0) : 1,
          text: item.text,
          linkLabel: item.linkLabel,
          linkUrl: item.linkUrl,
          active: item.active,
        };
      });
      const adminId = Number(req.user?.sub) || null;
      await client.query(
        `INSERT INTO offer_checkout_requirements
           (offer_id, acknowledgments, invitation_required, program_term, term_months, included_benefits,
            refund_terms, refund_window_days, obligations_note, updated_by, updated_at)
         VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,now())
         ON CONFLICT (offer_id) DO UPDATE SET
           acknowledgments = EXCLUDED.acknowledgments,
           invitation_required = EXCLUDED.invitation_required,
           program_term = EXCLUDED.program_term,
           term_months = EXCLUDED.term_months,
           included_benefits = EXCLUDED.included_benefits,
           refund_terms = EXCLUDED.refund_terms,
           refund_window_days = EXCLUDED.refund_window_days,
           obligations_note = EXCLUDED.obligations_note,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [offerId, JSON.stringify(acknowledgments), body.invitationRequired, body.programTerm, body.termMonths, body.includedBenefits, body.refundTerms, body.refundWindowDays, body.obligationsNote, adminId]
      );
      await client.query(
        `DELETE FROM offer_contracts WHERE offer_id = $1 AND required_before_payment AND NOT (contract_id = ANY($2::bigint[]))`,
        [offerId, requiredIds]
      );
      if (requiredIds.length > 0) {
        await client.query(
          `INSERT INTO offer_contracts (offer_id, contract_id, created_by, required_before_payment)
           SELECT $1::int, c.id, $3::int, true FROM participant_contracts c WHERE c.id = ANY($2::bigint[])
           ON CONFLICT (offer_id, contract_id) DO UPDATE SET required_before_payment = true`,
          [offerId, requiredIds, adminId]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const requirements = await loadOfferRequirements(offerId);
    res.json({ ...requirements.settings, requiredContractIds: requirements.contracts.map((contract) => contract.id) });
  })
);

/* Invitations: the owner approves an applicant, and only then does anything go out. */

const invitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  fullName: z.string().trim().max(200).default(""),
});
const INVITATION_DAYS = 30;

adminCheckoutRequirementsRouter.post(
  "/offers/:offerId/invitations",
  asyncHandler(async (req, res) => {
    const offerId = offerIdOf(req.params.offerId);
    const parsed = invitationSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Enter the applicant's email address.", parsed.error.flatten());
    const offer = await requireOffer(offerId);
    if (offer.status !== "published") throw badRequest("Publish this offer before inviting anyone to it.");

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
    // One open link per person: a re-send replaces the earlier link.
    await pool.query(
      `UPDATE offer_enrollment_invitations SET revoked_at = now()
        WHERE offer_id = $1 AND email = $2 AND revoked_at IS NULL AND completed_order_id IS NULL`,
      [offerId, parsed.data.email]
    );
    const created = await pool.query<{ id: string }>(
      `INSERT INTO offer_enrollment_invitations (offer_id, email, full_name, token_hash, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [offerId, parsed.data.email, parsed.data.fullName, hashInvitationToken(token), expiresAt, Number(req.user?.sub) || null]
    );

    const link = `${env.publicSiteUrl}/checkout/${encodeURIComponent(offer.slug)}?invite=${encodeURIComponent(token)}`;
    const first = parsed.data.fullName.split(/\s+/)[0] || "there";
    const intro = `You have been approved to enroll in ${offer.title}. Please use your personal link below to review and sign your agreement and complete your enrollment. It is valid for ${INVITATION_DAYS} days.`;
    const outcome = await sendMail({
      topic: "enrollment_invitation",
      sourceId: Number(created.rows[0].id),
      to: parsed.data.email,
      subject: `Your enrollment in ${offer.title}`,
      text: [`Hi ${first},`, "", intro, "", link, "", "If you have any questions, just reply to this email."].join("\n"),
      html: [
        `<p>Hi ${escapeHtml(first)},</p>`,
        `<p>${escapeHtml(intro)}</p>`,
        `<p><a href="${escapeHtml(link)}">Review, sign and enroll</a></p>`,
        `<p>If you have any questions, just reply to this email.</p>`,
      ].join("\n"),
    });
    res.status(201).json({ id: Number(created.rows[0].id), link, emailed: outcome.sent, invitations: await invitationsFor(offerId) });
  })
);

adminCheckoutRequirementsRouter.post(
  "/offers/:offerId/invitations/:invitationId/revoke",
  asyncHandler(async (req, res) => {
    const offerId = offerIdOf(req.params.offerId);
    const invitationId = Number(req.params.invitationId);
    if (!Number.isSafeInteger(invitationId) || invitationId <= 0) throw badRequest("Invalid invitation");
    await pool.query(
      `UPDATE offer_enrollment_invitations SET revoked_at = now()
        WHERE id = $1 AND offer_id = $2 AND revoked_at IS NULL AND completed_order_id IS NULL`,
      [invitationId, offerId]
    );
    res.json({ invitations: await invitationsFor(offerId) });
  })
);

/* Signed agreements: every enrollment's own record, whatever became of the order. */

adminCheckoutRequirementsRouter.get(
  "/signatures",
  asyncHandler(async (_req, res) => {
    const rows = await pool.query(
      `SELECT s.id, s.order_id, s.offer_title, s.contract_id, s.contract_title, s.signed_name, s.signed_email,
              s.signed_at, s.copy_emailed_at, o.status AS order_status,
              s.enrollment_terms->>'totalInvestment' AS total_investment,
              s.enrollment_terms->>'paymentArrangement' AS payment_arrangement
         FROM order_agreement_signatures s LEFT JOIN orders o ON o.id = s.order_id
        ORDER BY s.id DESC LIMIT 500`
    );
    res.json({ signatures: rows.rows.map((row) => ({ ...row, id: Number(row.id), contract_id: Number(row.contract_id) })) });
  })
);

adminCheckoutRequirementsRouter.get(
  "/signatures/:id/record",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound("Signing record not found");
    const signature = await loadSignature(id);
    if (!signature) throw notFound("Signing record not found");
    const pdf = await renderSigningRecord(signature);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="signing-record-${id}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  })
);
