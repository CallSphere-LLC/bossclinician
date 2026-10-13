import { env, stripeTestMode } from "../config/env";
import { pool } from "../db/pool";
import { sendMail } from "../email/mailer";
import { ownerSaleNotification } from "../email/templates";
import { formatAmount } from "../utils/money";
import { notificationRecipients } from "./notificationRecipients";
import { readSetting } from "./settings";

/**
 * "Email me when someone buys this offer."
 *
 * The site-wide sale email (Settings → "What you get told about") has always
 * gone out for every sale. Kajabi sets it per offer, so each offer now carries
 * its own switch and, optionally, its own addresses:
 *
 *  - the site-wide "Someone buys something" switch still silences every sale
 *    email — it is the one place she turns them all off;
 *  - an offer switched off sends nothing for that offer;
 *  - an offer with its own addresses tells those instead of the site-wide one.
 *
 * A cart holding several offers sends one email, to everyone any of its offers
 * asks for. And one per order however many times it is asked: Stripe retries
 * webhooks, and `orders.owner_notified_at` is claimed before anything is sent.
 */

const ADDRESS = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Comma, semicolon or whitespace separated; anything that is not an address is dropped. */
export function parseRecipientList(raw: unknown): string[] {
  return [
    ...new Set(
      String(raw ?? "")
        .split(/[,;\s]+/)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => ADDRESS.test(part)),
    ),
  ];
}

export interface OfferNotifyPrefs {
  notify_owner_on_sale: boolean;
  notify_owner_recipients: string;
}

/** Who hears about a sale of these offers. Empty means nobody. Never throws. */
export async function saleRecipients(offers: OfferNotifyPrefs[]): Promise<string[]> {
  let saved: Record<string, unknown> = {};
  try {
    saved = await readSetting("notifications");
  } catch {
    // notificationRecipients logs the same failure and falls back to NOTIFY_EMAIL.
  }
  if (saved.onSale === false) return [];

  const siteWide = parseRecipientList(await notificationRecipients("sale"));
  // A legacy course order has no offer behind it: the site-wide address, as before.
  if (offers.length === 0) return siteWide;

  const out = new Set<string>();
  for (const offer of offers) {
    if (offer.notify_owner_on_sale === false) continue;
    const own = parseRecipientList(offer.notify_owner_recipients);
    for (const address of own.length > 0 ? own : siteWide) out.add(address);
  }
  return [...out];
}

type PricingFacts = {
  pricing_type: string;
  amount_cents: number;
  interval: string | null;
  interval_count: number;
  installment_count: number | null;
  trial_days: number;
};

/** "Payment plan: 3 payments of $1,250.00 every month", in the words of the offer screen. */
export function planDescription(p: PricingFacts | null, formatCents: (cents: number) => string): string {
  if (!p) return "";
  const every = p.interval
    ? p.interval_count > 1
      ? `every ${p.interval_count} ${p.interval}s`
      : `every ${p.interval}`
    : "";
  const trial = p.trial_days > 0 ? ` (${p.trial_days}-day free trial)` : "";
  switch (p.pricing_type) {
    case "payment_plan":
      return `Payment plan: ${p.installment_count ?? "?"} payments of ${formatCents(p.amount_cents)} ${every}`.trim() + trial;
    case "subscription":
      return `Subscription: ${formatCents(p.amount_cents)} ${every}`.trim() + trial;
    case "free":
      return "Free";
    case "pwyw":
      return "Pay what you want";
    default:
      return "One-time payment";
  }
}

type ClaimedOrder = {
  id: number;
  email: string;
  billing_name: string;
  total_cents: number;
  currency: string;
  coupon_code: string | null;
  gift_recipient_email: string | null;
  offer_id: number | null;
  course_title: string | null;
  pricing_option_id: number | null;
};

type OfferFacts = OfferNotifyPrefs & PricingFacts & { id: number; title: string };

/**
 * Sends the owner's sale email for one order, once. Never throws.
 *
 * Sandbox (a Stripe test key) sends nothing and claims nothing, exactly as the
 * site-wide alert always has; it logs one line instead so a test purchase can
 * still be checked from the logs.
 */
export async function sendOwnerSaleNotification(orderId: number): Promise<{ sent: boolean; to: string[]; skipped?: string }> {
  try {
    if (stripeTestMode()) {
      // eslint-disable-next-line no-console
      console.log(`[notify] Stripe test mode: owner sale email for order ${orderId} not sent`);
      return { sent: false, to: [], skipped: "sandbox" };
    }

    const claimed = await pool.query<ClaimedOrder>(
      `UPDATE orders SET owner_notified_at = now()
        WHERE id = $1 AND owner_notified_at IS NULL
        RETURNING id, email, billing_name, total_cents, currency, coupon_code,
                  gift_recipient_email, offer_id, course_title, pricing_option_id`,
      [orderId],
    );
    const order = claimed.rows[0];
    if (!order) return { sent: false, to: [], skipped: "already notified" };

    const offers = await pool.query<OfferFacts>(
      `SELECT f.id, f.title, f.pricing_type, f.amount_cents, f.interval, f.interval_count,
              f.installment_count, f.trial_days, f.notify_owner_on_sale, f.notify_owner_recipients
         FROM offers f
        WHERE f.id = $2
           OR f.id IN (SELECT offer_id FROM order_items
                        WHERE order_id = $1 AND kind IN ('offer', 'upsell') AND offer_id IS NOT NULL)
        ORDER BY (f.id = $2) DESC, f.id`,
      [order.id, order.offer_id],
    );

    const to = await saleRecipients(offers.rows);
    if (to.length === 0) return { sent: false, to, skipped: "switched off" };

    // The chosen payment option, when the buyer picked one, describes the plan
    // better than the offer's own headline price does.
    let pricing: PricingFacts | null = offers.rows[0] ?? null;
    if (order.pricing_option_id !== null) {
      const option = await pool.query<PricingFacts>(
        `SELECT pricing_type, amount_cents, interval, interval_count, installment_count, trial_days
           FROM offer_pricing_options WHERE id = $1`,
        [order.pricing_option_id],
      );
      pricing = option.rows[0] ?? pricing;
    }

    const titles = offers.rows.map((offer) => offer.title).filter(Boolean);
    const currency = order.currency || "usd";
    const content = ownerSaleNotification({
      offerTitle: titles.join(" + ") || order.course_title || `Order #${order.id}`,
      buyerName: order.billing_name ?? "",
      buyerEmail: order.email ?? "",
      amountCents: order.total_cents,
      currency,
      plan: offers.rows.length > 1 ? "" : planDescription(pricing, (cents) => formatAmount(cents, currency)),
      couponCode: order.coupon_code ?? "",
      giftRecipientEmail: order.gift_recipient_email ?? "",
      adminUrl: `${env.adminOrigin || env.publicSiteUrl}/admin/purchases/order-${order.id}`,
    });
    // One message per address, so each lands in the delivery log on its own.
    let sent = false;
    for (const address of to) {
      const outcome = await sendMail({ to: address, ...content, topic: "owner_sale_notification", sourceId: order.id });
      sent = sent || outcome.sent;
    }
    return { sent, to };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[notify] owner sale email for order ${orderId} failed:`, (err as Error).message);
    return { sent: false, to: [], skipped: "error" };
  }
}
