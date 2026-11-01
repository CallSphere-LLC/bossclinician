import crypto from "crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";
import { badRequest, forbidden } from "../utils/httpError";
import { DISCLOSURE_VERSION, ELECTRONIC_CONSENT, SIGNING_INTENT } from "./contractAudit";
import { formatMoney, paymentPlanTotalCents, type OrderTotal, type PricedOffer } from "./pricing";
import type { OfferRow } from "../routes/public/offers";

/**
 * What an offer asks of its buyer before payment (QA rows 202 and 203):
 *
 *  - acknowledgment checkboxes the owner writes herself, each with an optional
 *    link. The accepted wording and version are copied onto the order.
 *  - agreements (participant contracts) to sign before paying, beside an
 *    enrollment record showing the term, total, payment arrangement, refund
 *    terms and what remains owed.
 *  - an invitation, for a program the owner approves applicants to (Boardroom).
 *
 * All of it is off until she turns it on for an offer, and an offer with nothing
 * configured costs two small reads and changes nothing. The checks run on the
 * server at `POST /checkout/offer/:slug`, before any order or charge exists, so
 * they hold for card, wallet, PayPal and free checkouts alike. Paths that cannot
 * collect any of this (carts, one-click upsells, Stripe payment links) refuse
 * such an offer instead of skipping the step.
 *
 * Renewals and later installments never pass through checkout, so nobody is
 * re-prompted by a monthly charge. A new purchase is a new enrollment with its
 * own payment terms, so it signs again; an updated agreement is a new contract
 * (a new PDF snapshot) the owner can swap onto the offer and assign to existing
 * members from Products > Contracts.
 */

type Queryable = Pick<PoolClient, "query">;

export interface CheckoutAcknowledgment {
  key: string;
  version: number;
  text: string;
  linkLabel: string;
  linkUrl: string;
  active: boolean;
}

export interface RequirementSettings {
  acknowledgments: CheckoutAcknowledgment[];
  invitationRequired: boolean;
  programTerm: string;
  termMonths: number | null;
  includedBenefits: string;
  refundTerms: string;
  refundWindowDays: number | null;
  obligationsNote: string;
}

export interface RequiredContract {
  id: number;
  title: string;
  pdfSha256: string;
}

export interface OfferRequirements {
  settings: RequirementSettings;
  contracts: RequiredContract[];
}

const EMPTY_SETTINGS: RequirementSettings = {
  acknowledgments: [],
  invitationRequired: false,
  programTerm: "",
  termMonths: null,
  includedBenefits: "",
  refundTerms: "",
  refundWindowDays: null,
  obligationsNote: "",
};

/** The stored list, read item by item: a malformed entry is dropped, not shown. */
export function parseAcknowledgments(raw: unknown): CheckoutAcknowledgment[] {
  if (!Array.isArray(raw)) return [];
  const out: CheckoutAcknowledgment[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const source = item as Record<string, unknown>;
    if (typeof source.key !== "string" || typeof source.text !== "string" || source.text.trim() === "") continue;
    out.push({
      key: source.key,
      version: Number.isSafeInteger(source.version) && Number(source.version) > 0 ? Number(source.version) : 1,
      text: source.text,
      linkLabel: typeof source.linkLabel === "string" ? source.linkLabel : "",
      linkUrl: typeof source.linkUrl === "string" ? source.linkUrl : "",
      active: source.active === true,
    });
  }
  return out;
}

export async function loadOfferRequirements(offerId: number, db: Queryable = pool): Promise<OfferRequirements> {
  const [settings, contracts] = await Promise.all([
    db.query<{
      acknowledgments: unknown;
      invitation_required: boolean;
      program_term: string;
      term_months: number | null;
      included_benefits: string;
      refund_terms: string;
      refund_window_days: number | null;
      obligations_note: string;
    }>(
      `SELECT acknowledgments, invitation_required, program_term, term_months, included_benefits,
              refund_terms, refund_window_days, obligations_note
         FROM offer_checkout_requirements WHERE offer_id = $1`,
      [offerId]
    ),
    db.query<{ id: string | number; title: string; pdf_sha256: string }>(
      `SELECT c.id, c.title, c.pdf_sha256
         FROM offer_contracts oc JOIN participant_contracts c ON c.id = oc.contract_id
        WHERE oc.offer_id = $1 AND oc.required_before_payment
        ORDER BY c.title, c.id`,
      [offerId]
    ),
  ]);
  const row = settings.rows[0];
  return {
    settings: row
      ? {
          acknowledgments: parseAcknowledgments(row.acknowledgments),
          invitationRequired: row.invitation_required,
          programTerm: row.program_term,
          termMonths: row.term_months,
          includedBenefits: row.included_benefits,
          refundTerms: row.refund_terms,
          refundWindowDays: row.refund_window_days,
          obligationsNote: row.obligations_note,
        }
      : EMPTY_SETTINGS,
    contracts: contracts.rows.map((contract) => ({ id: Number(contract.id), title: contract.title, pdfSha256: contract.pdf_sha256 })),
  };
}

function activeAcknowledgments(requirements: OfferRequirements): CheckoutAcknowledgment[] {
  return requirements.settings.acknowledgments.filter((item) => item.active);
}

export function requirementsAreOn(requirements: OfferRequirements): boolean {
  return requirements.settings.invitationRequired || requirements.contracts.length > 0 || activeAcknowledgments(requirements).length > 0;
}

/** The same test as `requirementsAreOn`, in SQL, for an offers row aliased `o`. */
export const OFFER_HAS_REQUIREMENTS = `(
  EXISTS (SELECT 1 FROM offer_contracts oc WHERE oc.offer_id = o.id AND oc.required_before_payment)
  OR EXISTS (SELECT 1 FROM offer_checkout_requirements r WHERE r.offer_id = o.id
              AND (r.invitation_required OR r.acknowledgments @> '[{"active":true}]'::jsonb))
)`;

/** For the paths that cannot collect a tick or a signature: upsells and payment links. */
export async function offerHasRequirements(offerId: number, db: Queryable = pool): Promise<boolean> {
  const found = await db.query(`SELECT 1 FROM offers o WHERE o.id = $1 AND ${OFFER_HAS_REQUIREMENTS}`, [offerId]);
  return found.rows.length > 0;
}

/** A cart has one form for many offers, so an offer with its own step checks out alone. */
export async function refuseRequirementsInCart(slugs: string[], db: Queryable = pool): Promise<void> {
  const found = await db.query<{ title: string }>(
    `SELECT o.title FROM offers o WHERE o.slug = ANY($1::text[]) AND ${OFFER_HAS_REQUIREMENTS} ORDER BY o.title LIMIT 1`,
    [slugs]
  );
  const title = found.rows[0]?.title;
  if (title) throw badRequest(`${title} has its own enrollment step. Remove it from your cart and check out from its own page.`);
}

/* ── The enrollment record ───────────────────────────────────────────────── */

/**
 * The transaction-specific terms a buyer reviews beside an agreement, and that
 * are kept with their signature. Every figure comes from the offer and the
 * chosen payment option at the moment of asking, never from the browser.
 */
export interface EnrollmentTerms {
  offerId: number;
  offerTitle: string;
  pricingOptionId: number | null;
  paymentOption: string;
  pricingType: string;
  currency: string;
  totalInvestmentCents: number | null;
  totalInvestment: string;
  dueTodayCents: number;
  dueToday: string;
  paymentArrangement: string;
  remainingPayments: number;
  remainingCents: number;
  remainingObligations: string;
  programTerm: string;
  termMonths: number | null;
  includedBenefits: string;
  refundTerms: string;
  refundWindowDays: number | null;
  obligationsNote: string;
  /** Added when the order is opened: what this order actually comes to. */
  charged?: { subtotal: string; discount: string; tax: string; total: string; couponCode: string };
  /**
   * The buyer's IANA time zone, chosen at checkout (`resolveBuyerTimeZone`). The
   * dates below stay stored as UTC instants; this says how to print them.
   */
  timeZone?: string;
  /** Added when the payment succeeds. Whole UTC instants. */
  enrollmentStart?: string;
  enrollmentEnd?: string;
  refundDeadline?: string;
}

function everyInterval(interval: string | null, count: number): string {
  const unit = interval ?? "month";
  return count > 1 ? `every ${count} ${unit}s` : `every ${unit}`;
}

export function enrollmentTermsFor(offer: OfferRow, settings: RequirementSettings): EnrollmentTerms {
  const currency = offer.currency || "usd";
  const money = (cents: number) => formatMoney(cents, currency);
  const priced: PricedOffer = {
    id: offer.id,
    title: offer.title,
    currency,
    pricingType: offer.pricing_type,
    amountCents: offer.amount_cents,
    depositCents: offer.deposit_cents ?? 0,
    finalInstallmentCents: offer.final_installment_cents,
    minAmountCents: offer.min_amount_cents,
    interval: offer.interval,
    intervalCount: offer.interval_count,
    installmentCount: offer.installment_count,
    trialDays: offer.trial_days,
  };
  const every = everyInterval(offer.interval, offer.interval_count);
  const trial = offer.trial_days > 0;

  let total: number | null = offer.amount_cents;
  let dueToday = trial ? 0 : offer.amount_cents;
  let remainingPayments = 0;
  let remainingCents = 0;
  let arrangement = `Paid in full: ${money(offer.amount_cents)}`;
  let remaining = "Nothing further after this payment.";

  if (offer.pricing_type === "payment_plan") {
    const count = offer.installment_count ?? 1;
    const deposit = offer.deposit_cents ?? 0;
    total = paymentPlanTotalCents(priced);
    const first = deposit > 0 ? deposit : offer.amount_cents;
    dueToday = trial ? 0 : first;
    remainingPayments = trial ? count : Math.max(0, count - 1);
    remainingCents = total - dueToday;
    arrangement = `${count} payments totaling ${money(total)}: ${money(first)} ${trial ? `after a ${offer.trial_days}-day trial` : "today"}, then ${money(offer.amount_cents)} ${every}`;
    remaining = remainingPayments > 0
      ? `${remainingPayments} more ${remainingPayments === 1 ? "payment" : "payments"} after today, ${money(remainingCents)} in total.`
      : "Nothing further after this payment.";
  } else if (offer.pricing_type === "subscription") {
    total = null;
    arrangement = `${money(offer.amount_cents)} ${every}${trial ? ` after a ${offer.trial_days}-day trial` : ""}, renewing until cancelled`;
    remaining = `Renews at ${money(offer.amount_cents)} ${every} until cancelled.`;
  } else if (offer.pricing_type === "free") {
    arrangement = "No charge";
  }

  return {
    offerId: offer.id,
    offerTitle: offer.title,
    pricingOptionId: offer.pricing_option_id ?? null,
    paymentOption: offer.pricing_label ?? "",
    pricingType: offer.pricing_type,
    currency,
    totalInvestmentCents: total,
    totalInvestment: total === null ? "Recurring: see payment arrangement" : money(total),
    dueTodayCents: dueToday,
    dueToday: money(dueToday),
    paymentArrangement: arrangement,
    remainingPayments,
    remainingCents,
    remainingObligations: remaining,
    programTerm: settings.programTerm,
    termMonths: settings.termMonths,
    includedBenefits: settings.includedBenefits,
    refundTerms: settings.refundTerms,
    refundWindowDays: settings.refundWindowDays,
    obligationsNote: settings.obligationsNote,
  };
}

/* ── The buyer's time zone ───────────────────────────────────────────────── */

/** Refund deadlines are shown in the buyer's zone where known, otherwise Pacific. */
export const FALLBACK_TIME_ZONE = "America/Los_Angeles";

/**
 * The browser's report of its zone is only a hint, so a missing or unusable value
 * falls back rather than refusing a sale. The pattern keeps out what Intl would
 * also accept but is not a zone name, such as an offset ("+01:00").
 */
export function resolveBuyerTimeZone(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(raw)) {
    return FALLBACK_TIME_ZONE;
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/* ── What the checkout page is told ──────────────────────────────────────── */

/**
 * `checkoutRequirements` on the offer view, or null when nothing is switched on.
 *
 * `priceChoices` is the offer overlaid with each way to pay. A failed read shows
 * no requirements here and is only logged: the checkout route reads the same
 * tables and refuses the sale if it cannot, so this can never let one through.
 */
export async function publicCheckoutRequirements(
  offerId: number,
  priceChoices: OfferRow[]
): Promise<Record<string, unknown> | null> {
  try {
    const requirements = await loadOfferRequirements(offerId);
    if (!requirementsAreOn(requirements)) return null;
    return {
      invitationRequired: requirements.settings.invitationRequired,
      acknowledgments: activeAcknowledgments(requirements).map(({ key, version, text, linkLabel, linkUrl }) => ({ key, version, text, linkLabel, linkUrl })),
      agreements: requirements.contracts.map((contract) => ({ contractId: contract.id, title: contract.title, pdfSha256: contract.pdfSha256 })),
      enrollment:
        requirements.contracts.length > 0
          ? priceChoices.map((choice) => ({ optionId: choice.pricing_option_id ?? null, terms: enrollmentTermsFor(choice, requirements.settings) }))
          : [],
      disclosure: ELECTRONIC_CONSENT,
      intent: SIGNING_INTENT,
    };
  } catch (error) {
    console.error("[checkout] could not read checkout requirements", {
      offerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/* ── Invitations ─────────────────────────────────────────────────────────── */

export function hashInvitationToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface UsableInvitation {
  id: number;
  offer_id: number;
  email: string;
  full_name: string;
  offer_slug: string;
}

/** The invitation behind a link, if it can still be used. */
export async function findUsableInvitation(token: string, db: Queryable = pool): Promise<UsableInvitation | null> {
  const found = await db.query<UsableInvitation & { id: string | number }>(
    `SELECT i.id, i.offer_id, i.email, i.full_name, o.slug AS offer_slug
       FROM offer_enrollment_invitations i JOIN offers o ON o.id = i.offer_id
      WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.completed_order_id IS NULL AND i.expires_at > now()`,
    [hashInvitationToken(token)]
  );
  const row = found.rows[0];
  return row ? { ...row, id: Number(row.id) } : null;
}

/* ── Enforcement ─────────────────────────────────────────────────────────── */

export const checkoutRequirementFields = {
  checkoutAcknowledgments: z.array(z.object({ key: z.string().max(64), version: z.number().int().positive() })).max(30).optional(),
  agreementSignatures: z
    .array(
      z.object({
        contractId: z.number().int().positive(),
        typedName: z.string().trim().min(3).max(200),
        electronicConsent: z.literal(true),
        signingIntent: z.literal(true),
      })
    )
    .max(10)
    .optional(),
  invitationToken: z.string().min(20).max(200).optional(),
  // Never fails validation: resolveBuyerTimeZone falls back instead.
  buyerTimeZone: z.unknown().optional(),
};

export interface AcceptedRequirements {
  acknowledgments: Array<Record<string, unknown>>;
  signatures: Array<{ contract: RequiredContract; typedName: string }>;
  terms: EnrollmentTerms;
  invitationId: number | null;
  memberId: number | null;
  email: string;
  ip: string;
  userAgent: string;
}

/**
 * Checks a checkout against what its offer requires, before an order exists.
 * Returns null when the offer requires nothing, and that path changes nothing.
 */
export async function enforceCheckoutRequirements(input: {
  offer: OfferRow;
  email: string;
  memberId: number | null;
  giftRecipientEmail?: string;
  acceptedTerms?: boolean;
  acknowledgments?: Array<{ key: string; version: number }>;
  signatures?: Array<{ contractId: number; typedName: string }>;
  invitationToken?: string;
  buyerTimeZone?: unknown;
  ip?: string;
  userAgent?: string;
}): Promise<AcceptedRequirements | null> {
  const requirements = await loadOfferRequirements(input.offer.id);
  if (!requirementsAreOn(requirements)) return null;
  const { settings, contracts } = requirements;

  let invitationId: number | null = null;
  if (settings.invitationRequired) {
    const invitation = input.invitationToken ? await findUsableInvitation(input.invitationToken) : null;
    if (!invitation || invitation.offer_id !== input.offer.id) {
      throw forbidden("Enrollment is by invitation. Please use the link from your invitation email, or contact support@bossclinician.com.");
    }
    if (invitation.email !== input.email) {
      throw badRequest(`This invitation is for ${invitation.email}. Please check out with that email address.`);
    }
    invitationId = invitation.id;
  }

  // The agreement is between the program and its participant; on a gift the
  // person who pays and signs would not be the person who takes part.
  if (input.giftRecipientEmail && (contracts.length > 0 || settings.invitationRequired)) {
    throw badRequest("This program cannot be sent as a gift.");
  }

  const acceptedAt = new Date().toISOString();
  const ip = (input.ip ?? "").slice(0, 100);
  const userAgent = (input.userAgent ?? "").slice(0, 500);

  const acknowledgments: Array<Record<string, unknown>> = [];
  for (const item of activeAcknowledgments(requirements)) {
    const ticked = input.acknowledgments?.find((entry) => entry.key === item.key);
    if (!ticked) throw badRequest("Please tick each required box to continue.");
    if (ticked.version !== item.version) throw badRequest("The wording of a required box has just changed. Refresh this page, read it again and tick it to continue.");
    acknowledgments.push({ key: item.key, version: item.version, text: item.text, linkLabel: item.linkLabel, linkUrl: item.linkUrl, acceptedAt, ip, userAgent });
  }
  // The offer's own terms box, kept with the rest once an offer uses this feature.
  if (input.offer.require_terms && input.acceptedTerms === true) {
    acknowledgments.push({ key: "offer-terms", version: 1, text: "I agree to the terms of this purchase.", linkLabel: "terms", linkUrl: input.offer.terms_url || "/terms", acceptedAt, ip, userAgent });
  }

  const signatures: AcceptedRequirements["signatures"] = [];
  for (const contract of contracts) {
    const signature = input.signatures?.find((entry) => entry.contractId === contract.id);
    if (!signature) throw badRequest(`Please review and sign ${contract.title} to continue. If you already did, refresh this page: the agreement may have been updated.`);
    signatures.push({ contract, typedName: signature.typedName });
  }

  return {
    acknowledgments,
    signatures,
    terms: { ...enrollmentTermsFor(input.offer, settings), timeZone: resolveBuyerTimeZone(input.buyerTimeZone) },
    invitationId,
    memberId: input.memberId,
    email: input.email,
    ip,
    userAgent,
  };
}

/**
 * Writes what was accepted onto the order just opened, before any charge. A
 * failure here must fail the checkout: the caller closes the order and reports
 * it rather than taking money without the record.
 */
export async function recordAcceptedRequirements(input: {
  orderId: number;
  accepted: AcceptedRequirements;
  total: OrderTotal;
  couponCode?: string;
}): Promise<void> {
  const { accepted, total, orderId } = input;
  const money = (cents: number) => formatMoney(cents, total.currency);
  const terms: EnrollmentTerms = {
    ...accepted.terms,
    charged: {
      subtotal: money(total.subtotalCents),
      discount: money(total.discountCents),
      tax: money(total.taxCents),
      total: money(total.totalCents),
      couponCode: input.couponCode ?? "",
    },
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE orders SET checkout_acknowledgments = $2::jsonb, enrollment_invitation_id = $3, updated_at = now() WHERE id = $1`,
      [orderId, JSON.stringify(accepted.acknowledgments), accepted.invitationId]
    );
    for (const { contract, typedName } of accepted.signatures) {
      const signedAt = new Date().toISOString();
      const evidence = crypto
        .createHash("sha256")
        .update(JSON.stringify({ orderId, contractId: contract.id, pdfSha256: contract.pdfSha256, typedName, email: accepted.email, signedAt, ip: accepted.ip, userAgent: accepted.userAgent, disclosureVersion: DISCLOSURE_VERSION, terms }))
        .digest("hex");
      await client.query(
        `INSERT INTO order_agreement_signatures
           (order_id, offer_id, offer_title, contract_id, contract_title, pdf_sha256, signer_member_id,
            signed_name, signed_email, signer_ip, signer_user_agent, disclosure_version, disclosure_text,
            intent_text, enrollment_terms, evidence_sha256, signed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,
        [
          orderId,
          terms.offerId,
          terms.offerTitle,
          contract.id,
          contract.title,
          contract.pdfSha256,
          accepted.memberId,
          typedName,
          accepted.email,
          accepted.ip,
          accepted.userAgent,
          DISCLOSURE_VERSION,
          ELECTRONIC_CONSENT,
          SIGNING_INTENT,
          JSON.stringify(terms),
          evidence,
          signedAt,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
