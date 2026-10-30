import type { PoolClient } from "pg";
import PDFDocument from "pdfkit";
import { pool } from "../db/pool";
import { env, stripeTestMode } from "../config/env";
import { sendMail, type MailAttachment } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import { appendContractEvent } from "./contractAudit";
import { readContractSource } from "./contractStorage";
import { MEMBER_CONTRACTS_PATH } from "./offerContracts";
import { addInterval } from "./pricing";
import type { EnrollmentTerms } from "./checkoutRequirements";

/**
 * What happens to an agreement signed at checkout once the payment succeeds, and
 * the copies of it: the member's email and the admin's download.
 *
 * Settling runs inside fulfillPayment's transaction and follows the rule beside
 * it there: a charged customer never loses access over a contract, so it works
 * under a savepoint and never throws. The signature row itself is already safe,
 * written before the charge (services/checkoutRequirements.ts).
 */

type Queryable = Pick<PoolClient, "query">;

export interface SignatureRow {
  id: string | number;
  order_id: number | null;
  offer_id: number | null;
  offer_title: string;
  contract_id: string | number;
  contract_title: string;
  pdf_sha256: string;
  signer_member_id: number | null;
  signed_name: string;
  signed_email: string;
  signer_ip: string;
  signer_user_agent: string;
  disclosure_version: string;
  disclosure_text: string;
  intent_text: string;
  enrollment_terms: EnrollmentTerms;
  evidence_sha256: string;
  signed_at: Date | string;
  assignment_id: string | number | null;
}

/** The dates a payment fixes. Whole UTC instants, labelled as UTC wherever printed. */
function withPaymentDates(terms: EnrollmentTerms, paidAt: Date): EnrollmentTerms {
  return {
    ...terms,
    enrollmentStart: paidAt.toISOString(),
    ...(terms.termMonths ? { enrollmentEnd: addInterval(paidAt, "month", terms.termMonths).toISOString() } : {}),
    ...(terms.refundWindowDays !== null && terms.refundWindowDays !== undefined
      ? { refundDeadline: new Date(paidAt.getTime() + terms.refundWindowDays * 86_400_000).toISOString() }
      : {}),
  };
}

async function markSigned(client: Queryable, assignmentId: number, memberId: number, signature: SignatureRow, terms: EnrollmentTerms): Promise<void> {
  const signedAt = new Date(signature.signed_at).toISOString();
  // The same keys routes/member/contracts.ts writes, so the member's Contracts
  // page, the evidence PDF and the admin's audit view all read this one too.
  const evidenceHash = await appendContractEvent(client as PoolClient, assignmentId, {
    type: "signed",
    memberId,
    ip: signature.signer_ip,
    userAgent: signature.signer_user_agent,
    data: {
      pdfSha256: signature.pdf_sha256,
      typedName: signature.signed_name,
      email: signature.signed_email,
      disclosureVersion: signature.disclosure_version,
      disclosureText: signature.disclosure_text,
      intentText: signature.intent_text,
      electronicConsent: true,
      signingIntent: true,
      signedAt,
      source: "checkout",
      signatureId: Number(signature.id),
      orderId: signature.order_id,
      enrollmentTerms: terms,
    },
  });
  await client.query(
    `UPDATE participant_contract_assignments
        SET status = 'signed', signed_at = $2, signed_name = $3, signed_email = $4, signer_ip = $5,
            signer_user_agent = $6, disclosure_version = $7, evidence_sha256 = $8
      WHERE id = $1`,
    [assignmentId, signedAt, signature.signed_name, signature.signed_email, signature.signer_ip, signature.signer_user_agent, signature.disclosure_version, evidenceHash]
  );
}

/**
 * Turns this order's signatures into signed assignments on the member who now
 * has access, and closes the invitation it used. Returns how many signatures the
 * order has, so the caller knows whether a copy needs sending.
 *
 * Call before assignOfferContractsSafely: UNIQUE(contract_id, member_id) then
 * stops that function assigning the same contract as "please sign".
 *
 * Someone who already holds this contract keeps that assignment. A pending one
 * is completed only when the signer was signed in as that member: a guest typing
 * an address does not prove they own the account, so it stays pending for the
 * member to sign, and this row still records what the guest signed.
 */
export async function settleCheckoutAgreementsSafely(input: {
  client: Queryable;
  orderId: number;
  memberId: number | null;
}): Promise<number> {
  const { client, orderId, memberId } = input;
  try {
    await client.query("SAVEPOINT checkout_agreements");
    await client.query(
      `UPDATE offer_enrollment_invitations
          SET completed_order_id = $1, completed_at = now()
        WHERE completed_order_id IS NULL
          AND id = (SELECT enrollment_invitation_id FROM orders WHERE id = $1)`,
      [orderId]
    );
    const found = await client.query<SignatureRow>(
      `SELECT * FROM order_agreement_signatures WHERE order_id = $1 ORDER BY id`,
      [orderId]
    );
    if (memberId !== null) {
      const paidAt = new Date();
      for (const signature of found.rows) {
        const terms = withPaymentDates(signature.enrollment_terms, paidAt);
        const inserted = await client.query<{ id: string | number }>(
          `INSERT INTO participant_contract_assignments (contract_id, member_id, source_order_id, source_offer_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (contract_id, member_id) DO NOTHING
           RETURNING id`,
          [signature.contract_id, memberId, orderId, signature.offer_id]
        );
        let assignmentId: number;
        if (inserted.rows[0]) {
          assignmentId = Number(inserted.rows[0].id);
          await appendContractEvent(client as PoolClient, assignmentId, {
            type: "assigned",
            data: { contractId: Number(signature.contract_id), memberId, orderId, offerId: signature.offer_id, source: "checkout" },
          });
          await markSigned(client, assignmentId, memberId, signature, terms);
        } else {
          const existing = await client.query<{ id: string | number; status: string }>(
            `SELECT id, status FROM participant_contract_assignments WHERE contract_id = $1 AND member_id = $2 FOR UPDATE`,
            [signature.contract_id, memberId]
          );
          assignmentId = Number(existing.rows[0].id);
          if (existing.rows[0].status === "pending" && signature.signer_member_id === memberId) {
            await markSigned(client, assignmentId, memberId, signature, terms);
          }
        }
        await client.query(
          `UPDATE order_agreement_signatures SET assignment_id = $2, enrollment_terms = $3::jsonb WHERE id = $1`,
          [signature.id, assignmentId, JSON.stringify(terms)]
        );
      }
    }
    await client.query("RELEASE SAVEPOINT checkout_agreements");
    return found.rows.length;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT checkout_agreements").catch(() => undefined);
    console.error("[contracts] could not settle the agreement signed at checkout", {
      orderId,
      memberId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/* ── The record ──────────────────────────────────────────────────────────── */

function utc(value: string): string {
  return `${new Date(value).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

/** The enrollment record as label/value lines, for any PDF. */
export function enrollmentTermLines(terms: EnrollmentTerms): Array<[string, string]> {
  const lines: Array<[string, string]> = [
    ["Program", terms.offerTitle],
    ["Payment option", terms.paymentOption],
    ["Program term", terms.programTerm],
    ["Start date", terms.enrollmentStart ? utc(terms.enrollmentStart) : ""],
    ["End date", terms.enrollmentEnd ? utc(terms.enrollmentEnd) : ""],
    ["Total investment", terms.totalInvestment],
    ["Payment arrangement", terms.paymentArrangement],
    ["Due at enrollment", terms.dueToday],
    ["Remaining obligations", terms.remainingObligations],
    ["Further payment terms", terms.obligationsNote],
    ["Order total", terms.charged ? `${terms.charged.total} (subtotal ${terms.charged.subtotal}, discount ${terms.charged.discount}${terms.charged.couponCode ? ` with code ${terms.charged.couponCode}` : ""}, tax ${terms.charged.tax})` : ""],
    ["Included benefits", terms.includedBenefits],
    ["Refund terms", terms.refundTerms],
    ["Refund deadline", terms.refundDeadline ? utc(terms.refundDeadline) : ""],
  ];
  return lines.filter(([, value]) => value !== "");
}

/** One signature's full record as a PDF: who, what, when, and the terms accepted. */
export function renderSigningRecord(signature: SignatureRow): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.fontSize(18).text("Boss Clinician signing record").moveDown();
    pdf.fontSize(10)
      .text(`Agreement: ${signature.contract_title} (version ${signature.contract_id})`)
      .text(`Original PDF SHA-256: ${signature.pdf_sha256}`)
      .moveDown();
    pdf.text(`Signed by: ${signature.signed_name} (${signature.signed_email})`)
      .text(`Signed at (UTC): ${new Date(signature.signed_at).toISOString()}, before payment`)
      .text(`Order: ${signature.order_id ?? "Unavailable"}`)
      .text(`Disclosure version: ${signature.disclosure_version}`)
      .text(`Signer IP: ${signature.signer_ip || "Unavailable"}`)
      .text(`Browser: ${signature.signer_user_agent || "Unavailable"}`)
      .moveDown();
    pdf.text(signature.disclosure_text).moveDown().text(signature.intent_text).moveDown();
    pdf.fontSize(12).text("Enrollment record").moveDown(0.5);
    for (const [label, value] of enrollmentTermLines(signature.enrollment_terms)) pdf.fontSize(10).text(`${label}: ${value}`);
    pdf.moveDown().fontSize(10).text(`Record hash: ${signature.evidence_sha256}`);
    pdf.end();
  });
}

export async function loadSignature(id: number): Promise<SignatureRow | null> {
  const found = await pool.query<SignatureRow>(`SELECT * FROM order_agreement_signatures WHERE id = $1`, [id]);
  return found.rows[0] ?? null;
}

const MAX_ATTACHED_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Sends the member their copy: the agreement they signed and its signing record.
 * Call after COMMIT. Best effort, and silent under Stripe test keys, like purchase
 * delivery. The copy also waits on their Contracts page.
 */
export async function emailSignedAgreementCopies(orderId: number): Promise<void> {
  if (stripeTestMode()) return;
  try {
    const found = await pool.query<SignatureRow & { storage_ref: string; member_id: number | null }>(
      `SELECT s.*, c.storage_ref, o.member_id
         FROM order_agreement_signatures s
         JOIN participant_contracts c ON c.id = s.contract_id
         JOIN orders o ON o.id = s.order_id
        WHERE s.order_id = $1 AND s.copy_emailed_at IS NULL
        ORDER BY s.id`,
      [orderId]
    );
    for (const signature of found.rows) {
      const attachments: MailAttachment[] = [];
      const original = await readContractSource(signature.storage_ref, MAX_ATTACHED_PDF_BYTES).catch(() => null);
      if (original) attachments.push({ filename: `${signature.contract_title}.pdf`, content: original.toString("base64"), contentType: "application/pdf", encoding: "base64" });
      const record = await renderSigningRecord(signature);
      attachments.push({ filename: "Signing record.pdf", content: record.toString("base64"), contentType: "application/pdf", encoding: "base64" });

      const url = `${env.publicSiteUrl}${MEMBER_CONTRACTS_PATH}`;
      const intro = `Here is your copy of ${signature.contract_title}, which you signed when you enrolled in ${signature.offer_title}. The signing record shows the payment terms you accepted.`;
      const outcome = await sendMail({
        topic: "contract_signed_copy",
        sourceId: Number(signature.id),
        memberId: signature.member_id,
        to: signature.signed_email,
        subject: `Your signed agreement: ${signature.contract_title}`,
        text: [`Hi ${signature.signed_name},`, "", intro, "", `You can find it any time in your account: ${url}`, "", "If you have any questions, just reply to this email."].join("\n"),
        html: [
          `<p>Hi ${escapeHtml(signature.signed_name)},</p>`,
          `<p>${escapeHtml(intro)}</p>`,
          `<p>You can find it any time in <a href="${escapeHtml(url)}">your account</a>.</p>`,
          `<p>If you have any questions, just reply to this email.</p>`,
        ].join("\n"),
        attachments,
      });
      if (outcome.sent) await pool.query(`UPDATE order_agreement_signatures SET copy_emailed_at = now() WHERE id = $1`, [signature.id]);
    }
  } catch (error) {
    console.error("[contracts] could not email the signed agreement", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
