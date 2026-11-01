import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import type { AuditIntakeOrder } from "./directoryAuditIntake";

/**
 * The buyer's way back to the intake form. The page after a Credential For You
 * purchase is the only other route to it, and closing that tab would lose it. These
 * offers send no welcome, because its template points at a library item they don't
 * have (migration 181), so this is its own message beside the receipt.
 */

const FORM_SLUG = "credential-for-you-intake";
const OFFER_SLUG_PREFIX = "credential-for-you-";
const INTAKE_PATH = "/credentialing-intake";
const CREDENTIALING_EMAIL = "allondra@bossclinician.com";

function firstName(name: string): string {
  return name.trim().split(/\s+/).find((part) => !/^(dr|mr|mrs|ms|mx|miss|prof|professor)\.?$/i.test(part)) || "there";
}

/** Her "What Happens Next" and her refund sentence, as the page after purchase has them. */
export function credentialingIntakeEmail(name: string, offerTitle: string, intakeUrl: string) {
  const happensNext = [
    "After completing your intake, a member of our credentialing team will review your information.",
    `Allondra from Boss Clinician will contact you at the email address provided during checkout with your service agreement and instructions for submitting the additional information and documentation needed for your credentialing application.`,
    `Please watch for an email from: ${CREDENTIALING_EMAIL}`,
    "Important: Your credentialing timeline begins once your intake is complete, your service agreement is completed, and all required documents and information have been received.",
  ];
  const policy = "All Credential For You purchases are final and non-refundable. Because credentialing services involve administrative preparation, review, onboarding, and reserved service capacity, refunds are not provided after purchase.";
  const notice = "Please do not enter banking details, a Social Security number or a date of birth on this form.";
  const opening = `Thank you for your purchase of ${offerTitle}. Your next step is to complete your credentialing intake:`;

  const text = [
    `Hi ${firstName(name)},`,
    "",
    opening,
    intakeUrl,
    "",
    notice,
    "",
    "What Happens Next",
    "",
    ...happensNext.flatMap((line) => [line, ""]),
    policy,
    "",
    "Boss Clinician",
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(firstName(name))},</p>`,
    `<p>${escapeHtml(opening)}</p>`,
    `<p><a href="${escapeHtml(intakeUrl)}">Complete My Credentialing Intake</a></p>`,
    `<p>${escapeHtml(notice)}</p>`,
    `<p><strong>What Happens Next</strong></p>`,
    ...happensNext.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p>${escapeHtml(policy)}</p>`,
    `<p>Boss Clinician</p>`,
  ].join("\n");
  return { subject: "Your next step: complete your credentialing intake", text, html };
}

/**
 * Called only after a completed purchase, and at most once for an order: the claim
 * is the same one the audit intake uses, so a replayed payment callback sends nothing
 * and a failed send can be tried again. Never throws.
 */
export async function sendCredentialingIntake(order: AuditIntakeOrder & { offer_title?: string | null }): Promise<boolean> {
  if (!order.offer_slug?.startsWith(OFFER_SLUG_PREFIX) || !order.email || order.gift_recipient_email) return false;
  try {
    const form = await pool.query(`SELECT 1 FROM forms WHERE slug = $1 AND published = true`, [FORM_SLUG]);
    if (!form.rows[0]) {
      console.error("[credentialing-intake] the intake form is not published, so no email was sent", { orderId: order.id });
      return false;
    }
    const claim = await pool.query(
      `INSERT INTO credentialing_intake_emails (order_id) VALUES ($1)
       ON CONFLICT (order_id) DO UPDATE SET claimed_at = now()
       WHERE credentialing_intake_emails.sent_at IS NULL
         AND credentialing_intake_emails.claimed_at < now() - interval '10 minutes'
       RETURNING order_id`,
      [order.id],
    );
    if (!claim.rows.length) return false;
    const result = await sendMail({
      topic: "credentialing_intake",
      sourceId: order.id,
      memberId: order.member_id,
      contactId: order.contact_id,
      to: order.email,
      replyTo: CREDENTIALING_EMAIL,
      ...credentialingIntakeEmail(order.billing_name, order.offer_title || "credentialing support", `${env.publicSiteUrl}${INTAKE_PATH}`),
    });
    if (result.sent) {
      await pool.query(`UPDATE credentialing_intake_emails SET sent_at = now() WHERE order_id = $1`, [order.id]);
      return true;
    }
    await pool.query(`DELETE FROM credentialing_intake_emails WHERE order_id = $1 AND sent_at IS NULL`, [order.id]);
    return false;
  } catch (error) {
    console.error("[credentialing-intake] could not send:", (error as Error).message);
    return false;
  }
}
