import crypto from "crypto";
import type Stripe from "stripe";
import { pool } from "../db/pool";
import { stripe } from "../stripe/client";
import { badRequest, notFound } from "../utils/httpError";
import { readSetting } from "./settings";
import { cleanStatementDescriptor } from "./paymentRules";
import { assertOfferDeliverable } from "./downloadReadiness";
import {
  loadPublishedOfferById,
  selectOfferPricing,
  type OfferRow,
} from "../routes/public/offers";

/**
 * Stripe Payment Links for an offer's prices (QA sheet row 92: "Can we add a
 * stripe pay link to check out").
 *
 * A Payment Link is a stripe.com page that sells one Price. It is made only
 * when the admin presses "Create Stripe payment link" on the offer — never on
 * a page load, never in bulk — and it sells the offer exactly as our own
 * checkout does: the payment arrives as `checkout.session.completed`, and
 * `recordPaymentLinkOrder` below writes the order the webhook then settles
 * through `fulfillPayment`, so the buyer gets the same account, access grant,
 * receipt and owner notification as a buyer on our checkout.
 *
 * One-time prices only. A Payment Link cannot stop a subscription after N
 * charges, so a payment plan would bill forever; a subscription sold through
 * one opens a Stripe subscription with no order behind it, which the
 * subscription and renewal handlers in the webhook do not yet follow; and
 * free / pay-what-you-want prices have no fixed Price to sell. Those keep
 * using our checkout link, which handles all of them.
 */

export type PaymentLinkRow = {
  id: number;
  offer_id: number;
  pricing_option_id: number | null;
  stripe_payment_link_id: string;
  stripe_price_id: string;
  url: string;
  pricing_type: string;
  amount_cents: number;
  currency: string;
  active: boolean;
  created_by: string;
  created_at: string;
  deactivated_at: string | null;
};

/** Metadata key marking a session as ours, on the link and on the payment. */
export const PAYMENT_LINK_SOURCE = "payment_link";

/**
 * Whether a price can be sold through a Payment Link, and in words the admin
 * can act on when it cannot. Pure, so the admin screen and the create route
 * give the same answer.
 */
export function paymentLinkSupport(price: {
  pricing_type: string;
  amount_cents: number;
}): { supported: true } | { supported: false; reason: string } {
  switch (price.pricing_type) {
    case "one_time":
      return price.amount_cents >= 50
        ? { supported: true }
        : { supported: false, reason: "Stripe needs a price of at least $0.50." };
    case "payment_plan":
      return {
        supported: false,
        reason:
          "Stripe payment links can't stop after a set number of payments, so a payment plan would keep charging. Share the checkout link for this one.",
      };
    case "subscription":
      return {
        supported: false,
        reason: "Subscriptions aren't available on Stripe payment links yet. Share the checkout link for this one.",
      };
    case "free":
      return { supported: false, reason: "A free price has nothing to pay. Share the checkout link for this one." };
    default:
      return {
        supported: false,
        reason: "Pay-what-you-want prices aren't available on Stripe payment links. Share the checkout link for this one.",
      };
  }
}

const LINK_COLUMNS = `id, offer_id, pricing_option_id, stripe_payment_link_id, stripe_price_id, url,
                      pricing_type, amount_cents, currency, active, created_by, created_at, deactivated_at`;

/** Every link the offer has had, live ones first. Deactivated rows stay as history. */
export async function listOfferPaymentLinks(offerId: number): Promise<PaymentLinkRow[]> {
  const res = await pool.query<PaymentLinkRow>(
    `SELECT ${LINK_COLUMNS} FROM offer_payment_links WHERE offer_id = $1
      ORDER BY active DESC, created_at DESC, id DESC`,
    [offerId]
  );
  return res.rows;
}

/**
 * The one-time Price a link sells, and the idempotency key it is created under.
 *
 * Mirrors `recurringPriceRequest` in checkoutOffer.ts: the key hashes the whole
 * request, so a double click shares one Price and any change of figures gets
 * its own. The offer's Stripe Product is reused when it has one — it carries
 * the name, not the amount.
 */
export function oneTimePriceRequest(
  offer: OfferRow,
  productId: string | null,
  descriptor: string | undefined
): { params: Stripe.PriceCreateParams; idempotencyKey: string } {
  const params: Stripe.PriceCreateParams = {
    currency: offer.currency || "usd",
    unit_amount: offer.amount_cents,
    ...(productId
      ? { product: productId }
      : {
          product_data: {
            name: offer.title,
            ...(descriptor ? { statement_descriptor: descriptor } : {}),
          },
        }),
    metadata: {
      offerId: String(offer.id),
      offerSlug: offer.slug,
      pricingOptionId: String(offer.pricing_option_id ?? ""),
      source: PAYMENT_LINK_SOURCE,
    },
  };
  const digest = crypto.createHash("sha256").update(JSON.stringify(params)).digest("hex");
  return { params, idempotencyKey: `offer-plink-price-${offer.id}-${digest.slice(0, 32)}` };
}

/**
 * The Payment Link create call.
 *
 * `metadata` is copied by Stripe onto every Checkout Session the link opens;
 * the webhook still resolves the offer from our own row by link id and treats
 * the metadata as a label only. The PaymentIntent gets a marker but no
 * `offerId`/`orderId`: those keys make the PaymentIntent handlers look for an
 * order, and the order belongs to the session.
 */
export function paymentLinkRequest(
  offer: OfferRow,
  priceId: string,
  attempt: number
): { params: Stripe.PaymentLinkCreateParams; idempotencyKey: string } {
  const label = {
    source: PAYMENT_LINK_SOURCE,
    offerId: String(offer.id),
    offerSlug: offer.slug,
    pricingOptionId: String(offer.pricing_option_id ?? ""),
  };
  const redirect = /^https:\/\//i.test(offer.redirect_url.trim()) ? offer.redirect_url.trim() : "";
  const params: Stripe.PaymentLinkCreateParams = {
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: label,
    payment_intent_data: { metadata: { source: PAYMENT_LINK_SOURCE, offerSlug: offer.slug } },
    customer_creation: "always",
    billing_address_collection: offer.collect_address ? "required" : "auto",
    phone_number_collection: { enabled: offer.collect_phone },
    after_completion: redirect
      ? { type: "redirect", redirect: { url: redirect } }
      : {
          type: "hosted_confirmation",
          hosted_confirmation: {
            custom_message:
              "Thank you — your payment went through. Check your email for your receipt and how to sign in.",
          },
        },
  };
  // `attempt` is how many links this price has had: a double click repeats the
  // key and gets the same link back; a new link after a deactivation does not.
  return {
    params,
    idempotencyKey: `offer-plink-${offer.id}-${offer.pricing_option_id ?? 0}-${priceId}-${attempt}`,
  };
}

async function cardStatementDescriptor(): Promise<string | undefined> {
  const setting = await readSetting("customer_payments");
  return cleanStatementDescriptor(setting.statementDescriptor);
}

/**
 * Creates the Payment Link for one of an offer's prices (`pricingOptionId`
 * null = the offer's own price). Refuses when the price already has a live
 * link, so the database's one-live-link rule is met with a sentence, not a 500.
 */
export async function createOfferPaymentLink(input: {
  offerId: number;
  pricingOptionId: number | null;
  createdBy: string;
}): Promise<PaymentLinkRow> {
  const base = await loadPublishedOfferById(input.offerId);
  if (!base) {
    const exists = await pool.query(`SELECT 1 FROM offers WHERE id = $1`, [input.offerId]);
    if (exists.rowCount === 0) throw notFound("Offer not found");
    throw badRequest("Publish this offer first — a payment link sells it straight away.");
  }
  const offer = await selectOfferPricing(base, input.pricingOptionId);

  const support = paymentLinkSupport(offer);
  if (!support.supported) throw badRequest(support.reason);
  // The same check our checkout makes: a download with no file is not sold.
  await assertOfferDeliverable(offer.id);

  const live = await pool.query(
    `SELECT 1 FROM offer_payment_links
      WHERE offer_id = $1 AND COALESCE(pricing_option_id, 0) = $2 AND active`,
    [offer.id, offer.pricing_option_id ?? 0]
  );
  if ((live.rowCount ?? 0) > 0) {
    throw badRequest("This price already has a live payment link. Deactivate it first to make a new one.");
  }

  // One Product per offer: the base offer's, whichever price is being linked.
  const { params: priceParams, idempotencyKey: priceKey } = oneTimePriceRequest(
    offer,
    base.stripe_product_id,
    await cardStatementDescriptor()
  );
  const price = await stripe().prices.create(priceParams, { idempotencyKey: priceKey });
  const productId = typeof price.product === "string" ? price.product : price.product.id;
  await pool.query(
    `UPDATE offers SET stripe_product_id = COALESCE(stripe_product_id, $2), updated_at = now()
      WHERE id = $1`,
    [offer.id, productId]
  );

  const attempts = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM offer_payment_links
      WHERE offer_id = $1 AND COALESCE(pricing_option_id, 0) = $2`,
    [offer.id, offer.pricing_option_id ?? 0]
  );
  const { params, idempotencyKey } = paymentLinkRequest(offer, price.id, attempts.rows[0]?.n ?? 0);
  const link = await stripe().paymentLinks.create(params, { idempotencyKey });

  // ON CONFLICT: a double click came back with the same link from Stripe.
  const saved = await pool.query<PaymentLinkRow>(
    `INSERT INTO offer_payment_links
       (offer_id, pricing_option_id, stripe_payment_link_id, stripe_price_id, url,
        pricing_type, amount_cents, currency, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (stripe_payment_link_id) DO UPDATE SET url = EXCLUDED.url
     RETURNING ${LINK_COLUMNS}`,
    [
      offer.id,
      offer.pricing_option_id ?? null,
      link.id,
      price.id,
      link.url,
      offer.pricing_type,
      offer.amount_cents,
      offer.currency || "usd",
      input.createdBy.slice(0, 200),
    ]
  );
  return saved.rows[0];
}

/**
 * Switches a link off in Stripe, then here. Stripe first: a row marked inactive
 * while the link still takes money would hide a live till from the admin.
 * The row is kept — a payment already under way still has to find its offer.
 */
export async function deactivateOfferPaymentLink(
  offerId: number,
  linkId: number
): Promise<PaymentLinkRow> {
  const found = await pool.query<PaymentLinkRow>(
    `SELECT ${LINK_COLUMNS} FROM offer_payment_links WHERE id = $1 AND offer_id = $2`,
    [linkId, offerId]
  );
  const row = found.rows[0];
  if (!row) throw notFound("Payment link not found");
  if (!row.active) return row;

  await stripe().paymentLinks.update(row.stripe_payment_link_id, { active: false });
  const updated = await pool.query<PaymentLinkRow>(
    `UPDATE offer_payment_links SET active = false, deactivated_at = now()
      WHERE id = $1 RETURNING ${LINK_COLUMNS}`,
    [row.id]
  );
  return updated.rows[0];
}

/**
 * After a price is edited, switched off, deleted, or its offer archived or
 * deleted: the live link still sells the old figure — or sells something the
 * webhook can no longer find — so it is switched off. `pricingOptionId` null is
 * the offer's own price; "all" is every price on the offer.
 *
 * Best effort: the edit has already been saved, and a Stripe outage must not
 * undo it. A link that could not be switched off stays listed as live, and the
 * offer screen flags it as out of date.
 */
export async function deactivateRepricedPaymentLinks(
  offerId: number,
  pricingOptionId: number | null | "all"
): Promise<number> {
  const live = await pool.query<{ id: number }>(
    pricingOptionId === "all"
      ? `SELECT id FROM offer_payment_links WHERE offer_id = $1 AND active`
      : `SELECT id FROM offer_payment_links
          WHERE offer_id = $1 AND active AND COALESCE(pricing_option_id, 0) = $2`,
    pricingOptionId === "all" ? [offerId] : [offerId, pricingOptionId ?? 0]
  );
  let done = 0;
  for (const row of live.rows) {
    try {
      await deactivateOfferPaymentLink(offerId, row.id);
      done += 1;
    } catch (err) {
      console.error(`[payment-links] could not deactivate link ${row.id} after a price change:`, err);
    }
  }
  return done;
}

/* ------------------------------------------------------------------ webhook */

type LinkForSession = {
  offer_id: number;
  /** The option if it still exists; a deleted option's sale books against the offer. */
  pricing_option_id: number | null;
  offer_title: string;
  option_label: string | null;
};

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * The order behind a Checkout Session opened by one of our Payment Links.
 *
 * Called by the webhook before it settles a paid session. Stripe opened the
 * session, not our checkout, so no order exists yet; this writes one shaped
 * like a checkout order — the offer, the price option, one offer line, the
 * buyer's email/name/address, `source = 'payment_link'` — and the webhook's
 * normal session path then finds it by `stripe_session_id` and hands it to
 * `fulfillPayment`, which creates the member and contact for a new buyer
 * exactly as guest checkout does.
 *
 * The offer is found from our own `offer_payment_links` row by the link's id,
 * never from the session's metadata. Idempotent: the partial unique index on
 * `orders.stripe_session_id` (migration 120) means a redelivery, or the
 * async-payment event racing the completed one, finds the order it already
 * wrote. Returns false for every session that is not one of ours.
 */
export async function recordPaymentLinkOrder(session: Stripe.Checkout.Session): Promise<boolean> {
  const linkId = idOf(session.payment_link);
  if (!linkId) return false;

  const found = await pool.query<LinkForSession>(
    `SELECT l.offer_id, po.id AS pricing_option_id, o.title AS offer_title, po.label AS option_label
       FROM offer_payment_links l
       JOIN offers o ON o.id = l.offer_id
       LEFT JOIN offer_pricing_options po ON po.id = l.pricing_option_id AND po.offer_id = l.offer_id
      WHERE l.stripe_payment_link_id = $1`,
    [linkId]
  );
  const link = found.rows[0];
  if (!link) return false;

  // Only one-time links are made (see the header). A subscription session here
  // would be a link edited in the Stripe dashboard; selling it as a one-off
  // would be wrong, so it is left for a person to look at.
  if (session.mode !== "payment") {
    console.warn(`[payment-links] session ${session.id} on link ${linkId} is mode=${session.mode}; not recorded`);
    return false;
  }

  const details = session.customer_details;
  const email = (details?.email ?? session.customer_email ?? "").trim().toLowerCase();
  const address = details?.address ?? null;
  const billingAddress = address
    ? {
        line1: address.line1 ?? "",
        line2: address.line2 ?? "",
        city: address.city ?? "",
        state: address.state ?? "",
        postalCode: address.postal_code ?? "",
        country: address.country ?? "",
      }
    : {};
  const subtotal = session.amount_subtotal ?? session.amount_total ?? 0;
  const total = session.amount_total ?? subtotal;
  // The order line carries the price's own name when it was one of the extra
  // options, as the receipt and the payments list read it.
  const title = link.option_label ? `${link.offer_title} — ${link.option_label}` : link.offer_title;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO orders
         (offer_id, pricing_option_id, email, amount_cents, currency, status,
          subtotal_cents, discount_cents, tax_cents, total_cents,
          billing_name, billing_phone, billing_address, stripe_session_id,
          stripe_customer_id, source)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$4,$9,$10,$11,$12,$13,'payment_link')
       ON CONFLICT (stripe_session_id) WHERE source = 'payment_link' AND stripe_session_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        link.offer_id,
        link.pricing_option_id,
        email,
        total,
        session.currency ?? "usd",
        subtotal,
        session.total_details?.amount_discount ?? 0,
        session.total_details?.amount_tax ?? 0,
        (details?.name ?? "").trim().slice(0, 200),
        (details?.phone ?? "").trim().slice(0, 50),
        JSON.stringify(billingAddress),
        session.id,
        idOf(session.customer),
      ]
    );
    const orderId = inserted.rows[0]?.id;
    if (orderId !== undefined) {
      await client.query(
        `INSERT INTO order_items
           (order_id, offer_id, product_id, title, kind, quantity, unit_cents, amount_cents)
         VALUES ($1,$2,NULL,$3,'offer',1,$4,$4)`,
        [orderId, link.offer_id, title, subtotal]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return true;
}
