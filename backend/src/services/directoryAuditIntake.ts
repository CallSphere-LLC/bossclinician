import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";

const FORM_SLUG = "directory-makeover-audit-intake";
const OFFER_SLUG = "directory-makeover-audit";
const TOKEN_LIFETIME_SECONDS = 60 * 24 * 60 * 60;

function signature(payload: string): string {
  return createHmac("sha256", env.jwtSecret)
    .update("directory-audit-intake:v1:" + payload).digest("base64url");
}

/** Bearer proof of this purchase, with no name or email in the URL. */
export function issueDirectoryAuditToken(orderId: number, now = Date.now()): string {
  const payload = `${orderId}.${Math.floor(now / 1000) + TOKEN_LIFETIME_SECONDS}`;
  return `${payload}.${signature(payload)}`;
}

/** A token only authorizes a paid, still-active audit purchase for this email. */
export async function authorizeDirectoryAuditSubmission(token: unknown, email: string, now = Date.now()): Promise<boolean> {
  if (typeof token !== "string" || token.length > 180) return false;
  const match = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const orderId = Number(match[1]);
  const expiry = Number(match[2]);
  if (!Number.isSafeInteger(orderId) || !Number.isSafeInteger(expiry) || expiry < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(signature(`${match[1]}.${match[2]}`));
  const actual = Buffer.from(match[3]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  const purchase = await pool.query(
    `SELECT 1 FROM orders o JOIN offers f ON f.id = o.offer_id
      WHERE o.id = $1 AND o.status = 'paid' AND f.slug = $2 AND lower(o.email) = lower($3)
        AND EXISTS (SELECT 1 FROM access_grants g JOIN products p ON p.id = g.product_id
                    WHERE g.order_id = o.id AND g.status = 'active'
                      AND p.slug = $2)
      LIMIT 1`,
    [orderId, OFFER_SLUG, email],
  );
  return purchase.rows.length > 0;
}


export interface AuditIntakeOrder {
  id: number;
  offer_slug: string | null;
  email: string;
  billing_name: string;
  member_id: number | null;
  contact_id: number | null;
  gift_recipient_email: string;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/).find((part) => !/^(dr|mr|mrs|ms|mx|miss|prof|professor)\.?$/i.test(part)) || "there";
}

/** Yvette's Bugs!B175 copy, with the link supplied by the published site form. */
export function directoryAuditIntakeEmail(name: string, formUrl: string) {
  const text = [
    `Hey ${firstName(name)},`,
    "",
    "Thank you so much for booking the Directory Makeover Audit ? I?m excited to help you transform your therapist directory profile so it reflects your expertise and attracts the clients you truly want to work with.",
    "",
    "Before I begin your audit, I need one quick thing from you:",
    "",
    "? Step 1: Complete Your Intake Form",
    "",
    "Please click the link below to submit your profile link(s) and audit preferences:",
    "",
    "?? Complete Questionnaire Here",
    formUrl,
    "",
    "This form helps me understand what platforms you want audited and what you're hoping to improve. It takes just a few minutes and ensures your audit is accurate and tailored.",
    "",
    "? Step 2: I?ll Begin Your Audit",
    "",
    "Once your intake form is submitted, I?ll get to work.",
    "",
    "Your personalized audit video will arrive in 3?5 business days and will include:",
    "",
    "? What?s working",
    "? What?s confusing or unclear to potential clients",
    "? What?s missing",
    "? Which parts of your profile may be hurting your visibility or connection",
    "? Exact recommendations to improve clarity, visibility, and client alignment",
    "",
    "After You Receive Your Audit",
    "",
    "You?ll be able to implement the recommendations right away ? no guessing, no wondering what?s wrong, and no rewriting from scratch.",
    "",
    "Just clear direction and small changes that make a meaningful difference.",
    "",
    "If you have any questions",
    "",
    "You can reply directly to this email or contact me at:",
    "?? yvette@bossclinician.com",
    "",
    "I can?t wait for your profile to finally reflect the incredible therapist you are.",
    "",
    "To much success!",
    "",
    "Yvette Howard, Boss Clinician",
  ].join("\n");
  const link = `<a href="${escapeHtml(formUrl)}">Complete Questionnaire Here</a>`;
  const html = text.split("\n").map((line) =>
    line === "?? Complete Questionnaire Here" ? `?? ${link}` :
    line === formUrl ? "" : escapeHtml(line)
  ).join("<br>");
  return { subject: "Your Directory Makeover Audit ? Intake Form + Next Steps", text, html };
}

/**
 * Called only after a completed purchase. The form lookup is the source of the
 * URL: no hard-coded external questionnaire can be mailed by mistake.
 */
export async function sendDirectoryAuditIntake(order: AuditIntakeOrder): Promise<boolean> {
  if (order.offer_slug !== OFFER_SLUG || !order.email || order.gift_recipient_email) return false;
  try {
    const form = await pool.query<{ slug: string }>(
      "SELECT slug FROM forms WHERE slug = $1 AND name = 'Directory Makeover Audit ? Intake' AND published = true",
      [FORM_SLUG],
    );
    if (!form.rows[0]) return false;
    const origin = new URL(env.publicSiteUrl);
    if (origin.protocol !== "https:") return false;
    const formUrl = new URL(`/f/${form.rows[0].slug}`, origin).toString() +
      `#audit_order_token=${issueDirectoryAuditToken(order.id)}`;
    const claim = await pool.query(
      `INSERT INTO directory_audit_intake_emails (order_id) VALUES ($1)
       ON CONFLICT (order_id) DO UPDATE SET claimed_at = now()
       WHERE directory_audit_intake_emails.sent_at IS NULL
         AND directory_audit_intake_emails.claimed_at < now() - interval '10 minutes'
       RETURNING order_id`,
      [order.id],
    );
    if (!claim.rows.length) return false;
    const result = await sendMail({
      topic: "directory_audit_intake",
      sourceId: order.id,
      memberId: order.member_id,
      contactId: order.contact_id,
      to: order.email,
      replyTo: "yvette@bossclinician.com",
      ...directoryAuditIntakeEmail(order.billing_name, formUrl),
    });
    if (result.sent) {
      await pool.query("UPDATE directory_audit_intake_emails SET sent_at = now() WHERE order_id = $1", [order.id]);
      return true;
    }
    await pool.query("DELETE FROM directory_audit_intake_emails WHERE order_id = $1 AND sent_at IS NULL", [order.id]);
    return false;
  } catch (error) {
    console.error("[directory-audit-intake] could not send:", (error as Error).message);
    return false;
  }
}
