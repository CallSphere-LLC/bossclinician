import crypto from "crypto";
import type { PoolClient } from "pg";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { renderMarkdown, sendEmail } from "../email/provider";
import { enqueue, PRIORITY } from "../jobs/queue";
import { upsertContact } from "./contacts";
import { readSetting } from "./settings";
import { reportDay } from "./reports/rollup";
import { publishDomainEvent } from "./domainEvents";

const recipientList = (value: unknown): string[] => String(value ?? "").toLowerCase().split(/[,\s]+/).filter(Boolean);
function nextStep(settings: Record<string, unknown>, done: number): number | undefined {
  return [0, 1, 2, 3].find((step) => step >= done && settings[`enabled${step}`] === true);
}

/** The offer columns migration 110 added: each offer's own reminder setup. */
export interface OfferRecoveryColumns {
  recovery_enabled: boolean;
  recovery_mode: string;
  recovery_overrides: Record<string, unknown> | null;
}
const OVERRIDE_KEY = /^(enabled|hours|subject|body)[0-3]$/;

/**
 * The reminder sequence one offer's abandoned checkouts follow, or null for none.
 *
 * The site-wide switch stays the master switch, and the site-wide recipient
 * allow-list applies to every offer (callers check it). Under that, an offer
 * can turn its reminders off, or swap in its own delays and copy ("custom") —
 * any reminder field it leaves blank falls back to the site-wide one.
 */
export function effectiveRecoverySettings(
  global: Record<string, unknown>,
  offer: OfferRecoveryColumns,
): Record<string, unknown> | null {
  if (!global.enabled || offer.recovery_enabled === false) return null;
  if (offer.recovery_mode !== "custom") return global;
  const overrides = Object.entries(offer.recovery_overrides ?? {}).filter(
    ([key, value]) => OVERRIDE_KEY.test(key) && value !== null && value !== undefined && value !== "",
  );
  return { ...global, ...Object.fromEntries(overrides) };
}
function sign(body: string): string {
  return crypto.createHmac("sha256", env.jwtSecret).update(`checkout-reminder-v1:${body}`).digest("base64url");
}
export function recoveryToken(reminderId: number): string {
  const body = `${reminderId}.${Math.floor(Date.now() / 1000) + 30 * 86400}`;
  return `${body}.${sign(body)}`;
}
export async function followRecoveryLink(token: string): Promise<string | null> {
  const match = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(token);
  if (!match) return null;
  const body = `${match[1]}.${match[2]}`;
  const expected = sign(body);
  if (match[3].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(match[3]), Buffer.from(expected)) || Number(match[2]) < Date.now() / 1000) return null;
  const result = await pool.query<{ slug: string }>(
    `UPDATE checkout_reminders r SET clicked_at = now()
       FROM abandoned_checkouts a JOIN offers o ON o.id = a.offer_id
      WHERE r.id = $1 AND r.abandoned_checkout_id = a.id AND r.sent_at IS NOT NULL
        AND a.recovered_at IS NULL AND o.status = 'published'
      RETURNING o.slug`, [match[1]]);
  return result.rows[0]?.slug ?? null;
}

export async function sweepAbandonedCheckouts(): Promise<{ queued: number }> {
  const global = await readSetting("cart_recovery");
  if (!global.enabled) return { queued: 0 };
  const recipients = recipientList(global.recipients);
  const due = await pool.query<{id: number; emails_sent: number; age_hours: number; email: string} & OfferRecoveryColumns>(
    `SELECT a.id, a.emails_sent, a.email::text, EXTRACT(EPOCH FROM (now() - a.updated_at))/3600 AS age_hours,
            o.recovery_enabled, o.recovery_mode, o.recovery_overrides
       FROM abandoned_checkouts a JOIN offers o ON o.id = a.offer_id
      WHERE a.recovered_at IS NULL AND a.stopped_at IS NULL AND a.emails_sent < 4 AND o.recovery_enabled
      ORDER BY a.updated_at LIMIT 500`);
  let queued = 0;
  for (const cart of due.rows) {
    const settings = effectiveRecoverySettings(global, cart);
    if (!settings) continue;
    const step = nextStep(settings, cart.emails_sent);
    if (step === undefined || Number(cart.age_hours) < Number(settings[`hours${step}`]) || (recipients.length && !recipients.includes(cart.email.toLowerCase()))) continue;
    if (await enqueue({kind: "checkout.recoveryEmail", payload: {abandonedCheckoutId: cart.id, step}, priority: PRIORITY.bulk, dedupeKey: `cart-recovery:${cart.id}:${step}`})) queued++;
  }
  return { queued };
}

/** Locks the same cart row as fulfillment, so payment commit and email delivery
 * have an unambiguous order, even when a worker and webhook arrive together. */
export async function checkoutRecoveryEmail(payload: Record<string, unknown>): Promise<unknown> {
  const id = Number(payload.abandonedCheckoutId), step = Number(payload.step);
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isInteger(step) || step < 0 || step > 3) throw new Error("Invalid reminder job");
  const global = await readSetting("cart_recovery");
  if (!global.enabled) return { skipped: "disabled" };
  const initial = await pool.query(`SELECT a.email, a.first_name, a.recovered_at, a.stopped_at, o.recovery_enabled, o.recovery_mode, o.recovery_overrides
    FROM abandoned_checkouts a JOIN offers o ON o.id=a.offer_id WHERE a.id=$1`, [id]);
  if (!initial.rows[0] || initial.rows[0].recovered_at || initial.rows[0].stopped_at) return {skipped: "already bought or stopped"};
  if (!effectiveRecoverySettings(global, initial.rows[0])) return {skipped: "off for this offer"};
  const recipients = recipientList(global.recipients);
  if (recipients.length && !recipients.includes(initial.rows[0].email.toLowerCase())) return {skipped: "outside recipients"};
  // Contact writes finish before taking the cart lock: fulfillment also updates
  // contacts and must never deadlock against a worker waiting for that contact.
  const contactId = await upsertContact({email: initial.rows[0].email, name: initial.rows[0].first_name, source: "checkout"});
  const client = await pool.connect();
  let sent = false;
  try {
    await client.query("BEGIN");
    const rows = await client.query(`SELECT a.*, o.title AS offer_title, o.status AS offer_status,
      o.recovery_enabled, o.recovery_mode, o.recovery_overrides,
      EXTRACT(EPOCH FROM (now() - a.updated_at))/3600 AS age_hours
      FROM abandoned_checkouts a JOIN offers o ON o.id=a.offer_id WHERE a.id=$1 FOR UPDATE OF a`, [id]);
    const cart = rows.rows[0];
    // Re-resolved under the lock: the offer's setup may have changed since the sweep queued this.
    const settings = cart ? effectiveRecoverySettings(global, cart) : null;
    if (!cart || !settings || cart.recovered_at || cart.stopped_at || cart.offer_status !== "published" || nextStep(settings, cart.emails_sent) !== step || Number(cart.age_hours) < Number(settings[`hours${step}`])) {
      await client.query("COMMIT"); return {skipped: "not due or already bought"};
    }
    // A day of slack before the cart: a buyer whose email was captured a moment
    // after a free order completed (the capture and the checkout race), or who
    // came back to the page right after buying, has already bought.
    const paid = await client.query(`SELECT id FROM orders WHERE offer_id=$1 AND email=$2 AND status='paid' AND created_at >= $3::timestamptz - interval '1 day' LIMIT 1`, [cart.offer_id, cart.email, cart.created_at]);
    if (paid.rowCount) {
      await stopCheckoutRecovery(client, {orderId: paid.rows[0].id, offerId: cart.offer_id, email: cart.email});
      await client.query("COMMIT"); return {skipped: "already bought"};
    }
    const subject = String(settings[`subject${step}`]).replaceAll("{offer}", cart.offer_title).replaceAll("{name}", cart.first_name || "there");
    const reminder = await client.query<{id: number}>(`INSERT INTO checkout_reminders(abandoned_checkout_id,step,subject) VALUES($1,$2,$3) ON CONFLICT(abandoned_checkout_id,step) DO UPDATE SET subject=EXCLUDED.subject RETURNING id`, [id, step, subject]);
    const url = `${env.publicSiteUrl}/api/checkout/recover/${recoveryToken(reminder.rows[0].id)}`;
    let body = String(settings[`body${step}`]);
    if (!body.includes("{checkout_url}")) body += "\n\n[Continue checkout]({checkout_url})";
    body = body.replaceAll("{name}", cart.first_name || "there").replaceAll("{offer}", cart.offer_title).replaceAll("{checkout_url}", url);
    const result = await sendEmail({to: cart.email, subject, text: body, html: renderMarkdown(body), contactId, memberId: cart.member_id, sourceType: "automation", sourceId: id, topic: "marketing"});
    if (result.outcome === "sent") {
      await client.query(`UPDATE checkout_reminders SET email_message_id=$2,sent_at=now() WHERE id=$1`, [reminder.rows[0].id, result.messageId]);
      await client.query(`UPDATE abandoned_checkouts SET emails_sent=$2,last_email_at=now() WHERE id=$1`, [id, step + 1]);
      sent = true;
    } else {
      await client.query(`UPDATE abandoned_checkouts SET stopped_at=now(),stop_reason=$2 WHERE id=$1`, [id, result.suppressedReason]);
    }
    await client.query("COMMIT");
    if (sent && cart.emails_sent === 0) await publishDomainEvent("abandoned_checkout", {eventKey: `abandoned-checkout:${id}`, contactId, subjectId: cart.offer_id, email: cart.email, name: cart.first_name, facts: {offer: cart.offer_title, offerId: cart.offer_id}});
    return {outcome: result.outcome, step, reminderId: reminder.rows[0].id, messageId: result.messageId};
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function stopCheckoutRecovery(client: PoolClient, input: {orderId: number; offerId: number; email: string}): Promise<void> {
  // Explicit lock before reading attribution handles a concurrent click/sender.
  const carts = await client.query<{id:number}>(`SELECT id FROM abandoned_checkouts WHERE offer_id=$1 AND email=$2 AND recovered_at IS NULL FOR UPDATE`, [input.offerId, input.email]);
  if (carts.rows.length) {
    const today = reportDay();
    await enqueue({kind: "reports.rebuild", payload: {from: today, to: today}, priority: PRIORITY.normal,
      dedupeKey: `recovery-report:${input.orderId}`, client});
  }
  for (const cart of carts.rows) {
    await client.query(`UPDATE abandoned_checkouts SET recovered_order_id=$2,recovered_at=now(),stopped_at=now(),stop_reason='purchased',
      recovered_reminder_id=(SELECT id FROM checkout_reminders WHERE abandoned_checkout_id=$1 AND sent_at IS NOT NULL AND clicked_at IS NOT NULL ORDER BY clicked_at DESC,id DESC LIMIT 1)
      WHERE id=$1`, [cart.id, input.orderId]);
    await client.query(`UPDATE jobs SET status='cancelled',finished_at=now() WHERE kind='checkout.recoveryEmail' AND status IN ('queued','failed') AND payload->>'abandonedCheckoutId'=$1`, [String(cart.id)]);
  }
}
