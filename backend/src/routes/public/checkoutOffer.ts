import crypto from "crypto";
import { Request, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound, serviceUnavailable } from "../../utils/httpError";
import { stripe } from "../../stripe/client";
import { env, stripeEnabled } from "../../config/env";
import { optionalMember } from "../../middleware/memberAuth";
import { safeEqual } from "../../auth/tokens";
import {
  claimRedemption,
  releaseRedemption,
  validateCoupon,
  type ValidatedCoupon,
} from "../../services/coupons";
import { fulfillPayment } from "../../services/fulfillment";
import { addInterval, computeOrderTotal, type OrderTotal } from "../../services/pricing";
import {
  MAX_PWYW_CENTS,
  addressSchema,
  billingToJson,
  isRecurring,
  loadOfferBumps,
  loadPublishedOffer,
  loadPublishedOfferById,
  parseCustomFields,
  resolveTaxRateBps,
  selectBumps,
  submittedTaxAddress,
  toPricedOffer,
  totalToJson,
  type BillingAddress,
  type CustomFieldDef,
  type OfferRow,
} from "./offers";

/**
 * Offer checkout — orders, PaymentIntents and the post-purchase upsell.
 *
 * The legacy `/checkout/session` path in checkout.ts still sells a single
 * course through Stripe's hosted page; this one drives the Payment Element, so
 * it returns a client secret and the browser never leaves the site. That is
 * what makes order bumps, custom fields and one-click upsells possible.
 *
 * The rule that governs every route here: the request chooses, the database
 * prices. A body may say which bumps were ticked, which code was typed and how
 * far above a pay-what-you-want floor to go; it may never say what any of that
 * costs. Every figure charged is recomputed from `offers`, `offer_bumps` and
 * `coupons` immediately before the charge, inside the transaction that writes
 * the order.
 */
export const checkoutOfferRouter = Router();

/* ------------------------------------------------------------- order tokens */

/**
 * Proof that the person asking about an order is the person who placed it.
 *
 * A guest checkout has no account to authenticate against, and the success page
 * still has to be able to read its own order back. An HMAC over the order id
 * gives that without a new column or a lookup table: the value is unguessable,
 * verifiable in constant time, and cannot be extended to a neighbouring order
 * id by incrementing anything.
 *
 * Domain-separated from the member session key so a receipt token can never be
 * presented as a session, or the reverse.
 */
const ORDER_TOKEN_INFO = "bossclinician/order-receipt-token/v1";
const ORDER_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

let orderTokenKey: Buffer | null = null;

function orderTokenSecret(): Buffer {
  if (orderTokenKey === null) {
    orderTokenKey = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        Buffer.from(env.jwtSecret, "utf8"),
        Buffer.alloc(0),
        Buffer.from(ORDER_TOKEN_INFO, "utf8"),
        32
      )
    );
  }
  return orderTokenKey;
}

function signOrder(orderId: number, expiresAt: number): string {
  return crypto
    .createHmac("sha256", orderTokenSecret())
    .update(`${orderId}.${expiresAt}`)
    .digest("base64url");
}

function issueOrderToken(orderId: number): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ORDER_TOKEN_TTL_SECONDS;
  return `${expiresAt}.${signOrder(orderId, expiresAt)}`;
}

function orderTokenValid(orderId: number, token: string): boolean {
  const [expiresPart, signature] = token.split(".");
  if (!expiresPart || !signature) return false;
  const expiresAt = Number(expiresPart);
  if (!Number.isInteger(expiresAt) || expiresAt * 1000 <= Date.now()) return false;
  return safeEqual(signature, signOrder(orderId, expiresAt));
}

/* ---------------------------------------------------------------- limiters */

const TOO_MANY = { error: "Too many requests. Please try again later." };

/** Every call reaches Stripe and can create a customer, so the ceiling is low. */
const offerCheckoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
});

/**
 * Higher than checkout because the browser fires this from an onBlur handler
 * and a shopper who edits their address three times is not abusing anything.
 * Still capped: the endpoint writes a row keyed on an unverified email address.
 */
const abandonedLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
});

/** One-click charges. A loop here spends a real customer's money. */
const upsellLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
});

/** The success page polls this while it waits for the webhook to land. */
const orderReadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
});

/* ----------------------------------------------------------------- helpers */

/**
 * "View as member" must not be able to spend the member's money. The middleware
 * version of this guard requires a signed-in member, which checkout does not,
 * so the same rule is applied by hand on the routes that move money.
 */
function refuseImpersonation(req: Request): void {
  if (req.member?.impersonatedBy !== undefined) {
    throw forbidden("Viewing as a member is read-only.");
  }
}

const submittedFieldSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

/**
 * The answers to the offer's own order-form questions, and nothing else.
 *
 * Built by walking the configured fields rather than the submitted object, so
 * an extra key in the body is dropped instead of stored — `custom_field_data`
 * is rendered back into the admin and onto receipts, and it should only ever
 * contain what Yvette asked for.
 */
function collectCustomFields(
  defs: CustomFieldDef[],
  submitted: Record<string, string | number | boolean> | undefined
): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const def of defs) {
    const raw = submitted?.[def.key];
    const value = raw === undefined ? "" : String(raw).trim().slice(0, 2000);
    const label = def.label || def.key;
    if (def.required && value === "") throw badRequest(`${label} is required`);
    if (value !== "" && def.options.length > 0 && !def.options.includes(value)) {
      throw badRequest(`${label} is not one of the available options`);
    }
    if (value !== "") out[def.key] = value;
  }
  return out;
}

/**
 * The billing address as stored on an order.
 *
 * Read field by field rather than through `addressSchema`, which is strict
 * because it guards a request body. An order written by the admin with a
 * spelled-out country should still yield a usable state for the tax lookup
 * instead of collapsing the whole address on one unexpected value.
 */
function readAddress(raw: unknown): BillingAddress {
  if (typeof raw !== "object" || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const pick = (key: string): string | undefined => {
    const value = source[key];
    return typeof value === "string" && value !== "" ? value.slice(0, 200) : undefined;
  };
  return {
    line1: pick("line1"),
    line2: pick("line2"),
    city: pick("city"),
    state: pick("state"),
    postalCode: pick("postalCode"),
    country: pick("country"),
  };
}

/**
 * An order's own figures, rebuilt from what was written when it was created.
 *
 * A retried upsell charge must be for the amount the order says, not for
 * whatever the offer costs now — otherwise a price change between the two
 * clicks bills one number and records another.
 */
async function loadOrderTotal(orderId: number): Promise<OrderTotal> {
  const orderRes = await pool.query<{
    currency: string;
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    total_cents: number;
  }>(
    `SELECT currency, subtotal_cents, discount_cents, tax_cents, total_cents
       FROM orders WHERE id = $1`,
    [orderId]
  );
  const order = orderRes.rows[0];
  if (!order) throw notFound("Order not found");

  const itemsRes = await pool.query<{
    offer_id: number | null;
    product_id: number | null;
    title: string;
    kind: string;
    quantity: number;
    unit_cents: number;
    amount_cents: number;
  }>(
    `SELECT offer_id, product_id, title, kind, quantity, unit_cents, amount_cents
       FROM order_items WHERE order_id = $1 ORDER BY id`,
    [orderId]
  );

  return {
    lines: itemsRes.rows.map((i) => ({
      kind: i.kind === "bump" || i.kind === "upsell" ? i.kind : "offer",
      offerId: i.offer_id ?? undefined,
      productId: i.product_id ?? undefined,
      title: i.title,
      quantity: i.quantity,
      unitCents: i.unit_cents,
      amountCents: i.amount_cents,
    })),
    subtotalCents: order.subtotal_cents,
    discountCents: order.discount_cents,
    taxableCents: Math.max(0, order.subtotal_cents - order.discount_cents),
    taxCents: order.tax_cents,
    totalCents: order.total_cents,
    currency: order.currency,
  };
}

/**
 * The Stripe customer this buyer already has, or a new one.
 *
 * Reusing it keeps a returning customer's saved cards and receipts on one
 * record, which is also what lets an upsell charge a card entered months ago.
 *
 * That reuse is gated on an AUTHENTICATED member and nothing else. Matching on
 * a submitted email would let a signed-out stranger type a customer's address
 * and be handed that customer's Stripe id — and with it, their saved card. The
 * concrete attack: post a trial subscription offer with the victim's email,
 * abandon the tab, and Stripe bills the victim's default payment method when
 * the trial ends, on a subscription they never agreed to. The same handle also
 * makes the post-purchase upsell an off-session charge against their card.
 *
 * An unverified email address proves nothing, so it may not be used to reach an
 * existing payment relationship. A guest gets a fresh customer; the records are
 * merged later against the account they claim, where ownership is proven.
 */
async function resolveStripeCustomerId(input: {
  memberId: number | null;
  email: string;
  name: string;
}): Promise<string> {
  if (input.memberId !== null) {
    const existing = await pool.query<{ stripe_customer_id: string }>(
      `SELECT stripe_customer_id
         FROM orders
        WHERE stripe_customer_id IS NOT NULL
          AND member_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [input.memberId]
    );
    const found = existing.rows[0]?.stripe_customer_id;
    if (found) return found;
  }

  const customer = await stripe().customers.create({
    email: input.email,
    ...(input.name ? { name: input.name } : {}),
    ...(input.memberId ? { metadata: { memberId: String(input.memberId) } } : {}),
  });
  return customer.id;
}

/**
 * The Stripe Price a recurring offer bills against.
 *
 * An offer configured in the Stripe dashboard names its own price and that one
 * wins. Otherwise one is minted from the offer's own figures and written back,
 * so the second sale of the same plan reuses it rather than filling the account
 * with a Price per checkout.
 *
 * Editing the amount, the currency or the billing shape releases the pinned id
 * (see PUT /admin/offers/:id), so the mint here is not a once-in-a-lifetime
 * event and the idempotency key has to distinguish one set of figures from the
 * next. Two shoppers arriving together on the first sale of a plan then share
 * one Price instead of creating two for the same $99/mo.
 *
 * The Product is reused when the offer already has one: it carries the name,
 * not the amount, so one entry per offer is right and one per repricing is not.
 */
async function ensureRecurringPrice(offer: OfferRow): Promise<string> {
  if (offer.stripe_price_id) return offer.stripe_price_id;
  if (!offer.interval) throw badRequest("This offer is not set up for recurring billing");

  const currency = offer.currency || "usd";
  const price = await stripe().prices.create(
    {
      currency,
      unit_amount: offer.amount_cents,
      recurring: { interval: offer.interval, interval_count: offer.interval_count },
      ...(offer.stripe_product_id
        ? { product: offer.stripe_product_id }
        : { product_data: { name: offer.title } }),
      metadata: { offerId: String(offer.id), offerSlug: offer.slug },
    },
    {
      idempotencyKey:
        `offer-price-${offer.id}-${currency}-${offer.amount_cents}` +
        `-${offer.interval}-${offer.interval_count}`,
    }
  );

  const productId = typeof price.product === "string" ? price.product : price.product.id;
  await pool.query(
    `UPDATE offers
        SET stripe_price_id = $2,
            stripe_product_id = COALESCE(stripe_product_id, $3),
            updated_at = now()
      WHERE id = $1 AND stripe_price_id IS NULL`,
    [offer.id, price.id, productId]
  );

  return price.id;
}

/**
 * The Stripe coupon mirroring one of ours.
 *
 * Recurring charges are raised by Stripe from its own invoice, so a discount
 * that only exists in our database would apply to the first payment we compute
 * and silently vanish from every renewal. `duration` carries across: 'first'
 * becomes Stripe's 'once'.
 */
async function ensureStripeCoupon(coupon: ValidatedCoupon): Promise<string> {
  if (coupon.stripeCouponId) return coupon.stripeCouponId;

  const params: Stripe.CouponCreateParams = {
    name: coupon.code,
    duration: coupon.duration === "forever" ? "forever" : "once",
    metadata: { couponId: String(coupon.id), code: coupon.code },
  };
  if (coupon.percentOff !== null) {
    params.percent_off = coupon.percentOff;
  } else {
    params.amount_off = coupon.amountOffCents ?? 0;
    params.currency = coupon.currency;
  }

  // Keyed on our coupon id: if the write-back below is lost, the next checkout
  // to use the code gets the same Stripe coupon rather than a duplicate.
  const created = await stripe().coupons.create(params, {
    idempotencyKey: `offer-coupon-${coupon.id}`,
  });
  await pool.query(
    `UPDATE coupons SET stripe_coupon_id = $2 WHERE id = $1 AND stripe_coupon_id IS NULL`,
    [coupon.id, created.id]
  );
  return created.id;
}

/**
 * Removes pending invoice items whose subscription never came into being.
 *
 * A pending invoice item is attached to the CUSTOMER, not to an invoice and not
 * to an order, so one that outlives the checkout that created it is collected
 * on whatever that customer is billed for next: a $97 line on some other
 * subscription's renewal, with no order behind it, no `order_items` row and no
 * access granted. Nobody would ever find it from this end.
 *
 * Best effort by design. The order is already on its way to `failed` and the
 * caller has a real error to report; a sweep that threw would replace it with a
 * more confusing one, so a failure here is logged and the original stands.
 */
async function discardInvoiceItems(ids: string[]): Promise<void> {
  for (const id of ids) {
    await stripe()
      .invoiceItems.del(id)
      .catch((err: unknown) => {
        console.error(
          `[checkout] left a pending invoice item on a Stripe customer: ${id}`,
          (err as Error).message
        );
      });
  }
}

interface PendingOrderInput {
  offer: OfferRow;
  memberId: number | null;
  email: string;
  billingName: string;
  billingPhone: string;
  billingAddress: BillingAddress;
  customFieldData: Record<string, string>;
  couponCode?: string;
  bumpProductIds: number[];
  pwywAmountCents?: number;
  taxRateBps: number;
  parentOrderId?: number | null;
  source: string;
  /** Lines that would be 'offer' become this — an upsell order is one purchase, not two. */
  primaryLineKind?: "offer" | "upsell";
}

interface PendingOrder {
  orderId: number;
  total: OrderTotal;
  coupon: ValidatedCoupon | null;
}

/**
 * Writes the order and its lines, at prices resolved inside the transaction.
 *
 * The coupon is revalidated here with a row lock rather than trusted from the
 * quote the page last showed. A code with one redemption left can be taken
 * between the two, and two shoppers reaching the last one together would
 * otherwise both read `redeemed` below the cap and both be let through.
 */
async function createPendingOrder(input: PendingOrderInput): Promise<PendingOrder> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    let coupon: ValidatedCoupon | null = null;
    if (input.couponCode) {
      const check = await validateCoupon(input.couponCode, input.offer.id, input.email, {
        client,
        lock: true,
      });
      if (!check.ok) throw badRequest(check.reason);
      coupon = check.coupon;
    }

    const bumpRows = await loadOfferBumps(input.offer.id, client);
    const total = computeOrderTotal({
      offer: toPricedOffer(input.offer),
      bumps: selectBumps(bumpRows, input.bumpProductIds),
      coupon,
      taxRateBps: input.taxRateBps,
      pwywAmountCents: input.pwywAmountCents,
    });

    const orderRes = await client.query<{ id: number }>(
      `INSERT INTO orders
         (offer_id, member_id, email, amount_cents, currency, status,
          subtotal_cents, discount_cents, tax_cents, total_cents,
          coupon_id, coupon_code, billing_name, billing_phone, billing_address,
          custom_field_data, parent_order_id, source)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        input.offer.id,
        input.memberId,
        input.email,
        total.totalCents,
        total.currency,
        total.subtotalCents,
        total.discountCents,
        total.taxCents,
        total.totalCents,
        coupon?.id ?? null,
        coupon?.code ?? "",
        input.billingName,
        input.billingPhone,
        JSON.stringify(input.billingAddress),
        JSON.stringify(input.customFieldData),
        input.parentOrderId ?? null,
        input.source,
      ]
    );
    const orderId = orderRes.rows[0].id;

    for (const line of total.lines) {
      const kind = line.kind === "offer" ? (input.primaryLineKind ?? "offer") : line.kind;
      await client.query(
        `INSERT INTO order_items
           (order_id, offer_id, product_id, title, kind, quantity, unit_cents, amount_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          orderId,
          input.offer.id,
          line.productId ?? null,
          line.title,
          kind,
          line.quantity,
          line.unitCents,
          line.amountCents,
        ]
      );
    }

    // Written in the same transaction as the order it belongs to, because a
    // tax figure that can exist without its order — or an order whose tax
    // cannot be explained — is not an audit trail. `rate_bps` is the rate that
    // was actually applied; the address beside it is the one recorded on the
    // order, which is what a tax authority asks to see.
    if (input.taxRateBps > 0 || total.taxCents > 0) {
      await client.query(
        `INSERT INTO tax_records
           (order_id, country, state, postal_code, rate_bps,
            taxable_cents, tax_cents, currency, provider)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'internal')`,
        [
          orderId,
          input.billingAddress.country ?? "",
          input.billingAddress.state ?? "",
          input.billingAddress.postalCode ?? "",
          input.taxRateBps,
          total.taxableCents,
          total.taxCents,
          total.currency,
        ]
      );
    }

    // Inside the same transaction, while the coupon row is still locked. The
    // check above only read a count; this is what makes the cap binding, and
    // without it two shoppers reaching the last of a limited code both pass.
    if (coupon) {
      await claimRedemption(client, {
        couponId: coupon.id,
        orderId,
        memberId: input.memberId,
        email: input.email,
        amountCents: total.discountCents,
      });
    }

    await client.query("COMMIT");
    return { orderId, total, coupon };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * An order that never reached Stripe is dead, not waiting.
 *
 * Its coupon redemption goes back on the shelf: a customer who closed the tab
 * must not permanently consume one of fifty launch codes.
 */
async function markOrderFailed(orderId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE orders SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'pending'`,
      [orderId]
    );
    await releaseRedemption(client, orderId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/* ---------------------------------------------------------------- checkout */

const checkoutOfferSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  address: addressSchema.optional(),
  customFields: submittedFieldSchema.optional(),
  couponCode: z.string().trim().max(64).optional(),
  bumpProductIds: z.array(z.number().int().positive()).max(20).optional(),
  pwywAmountCents: z.number().int().min(0).max(MAX_PWYW_CENTS).optional(),
  acceptedTerms: z.boolean().optional(),
});

/**
 * POST /api/checkout/offer/:slug
 *
 * Creates the order and whatever Stripe object collects the money: a
 * PaymentIntent for a one-time or pay-what-you-want offer, a Subscription for a
 * plan or a membership. Either way the answer is a client secret, because the
 * Payment Element renders card, Apple Pay, Google Pay and the 3DS challenge in
 * place from that one value.
 *
 * The order is written as `pending` and stays that way until the webhook says
 * otherwise. A browser reaching this endpoint has paid nothing yet.
 */
checkoutOfferRouter.post(
  "/checkout/offer/:slug",
  offerCheckoutLimiter,
  optionalMember,
  asyncHandler(async (req, res) => {
    refuseImpersonation(req);

    const parsed = checkoutOfferSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid checkout payload", parsed.error.flatten());
    const body = parsed.data;

    const offer = await loadPublishedOffer(req.params.slug);
    if (!offer) throw notFound("Offer not found");

    if (offer.require_terms && body.acceptedTerms !== true) {
      throw badRequest("Please accept the terms to continue");
    }
    if (offer.collect_phone && !body.phone) {
      throw badRequest("A phone number is required");
    }
    if (offer.collect_address && (!body.address?.line1 || !body.address.country)) {
      throw badRequest("A billing address is required");
    }
    const customFieldData = collectCustomFields(
      parseCustomFields(offer.custom_fields),
      body.customFields
    );

    // A signed-in buyer's own email wins over whatever the form posted, so a
    // purchase can never be attached to somebody else's account.
    const memberId = req.member?.id ?? null;
    const email = (req.member?.email ?? body.email).trim().toLowerCase();
    const billingName = body.name ?? "";
    const billingAddress = body.address ?? {};

    const taxRateBps = await resolveTaxRateBps(offer, submittedTaxAddress(offer, billingAddress));

    const { orderId, total, coupon } = await createPendingOrder({
      offer,
      memberId,
      email,
      billingName,
      billingPhone: body.phone ?? "",
      billingAddress,
      customFieldData,
      couponCode: body.couponCode,
      bumpProductIds: body.bumpProductIds ?? [],
      pwywAmountCents: body.pwywAmountCents,
      taxRateBps,
      source: "checkout",
    });

    const receipt = {
      orderId,
      orderToken: issueOrderToken(orderId),
      offerSlug: offer.slug,
      billing: billingToJson(offer, toPricedOffer(offer)),
      redirectUrl: offer.redirect_url || null,
      thankYouPageSlug: offer.thank_you_page_id,
      ...totalToJson(total),
    };

    // A genuinely free enrolment has nothing to charge and so no webhook to
    // wait for. It still runs through the same fulfilment service a paid order
    // does, which is what keeps access, member creation and cart recovery
    // identical either way.
    //
    // TODO: a guest whose account was created here needs the set-password link
    // that routes/auth/memberAuth.ts sends on registration. The webhook owner
    // needs the same hook for paid guest orders — it belongs in one place, not
    // two, so `memberCreated` is reported rather than mailed from here.
    if (total.totalCents === 0 && !isRecurring(offer)) {
      const result = await fulfillPayment({
        orderId,
        amountCents: 0,
        currency: total.currency,
        email,
      });
      res.status(201).json({
        ...receipt,
        status: "paid",
        requiresPayment: false,
        clientSecret: null,
        clientSecretType: null,
        memberCreated: result.createdMember,
      });
      return;
    }

    if (!stripeEnabled()) {
      await markOrderFailed(orderId);
      throw serviceUnavailable("Payments are not configured");
    }

    try {
      const customerId = await resolveStripeCustomerId({ memberId, email, name: billingName });
      const metadata: Stripe.MetadataParam = {
        orderId: String(orderId),
        offerId: String(offer.id),
        offerSlug: offer.slug,
        pricingType: offer.pricing_type,
      };

      if (isRecurring(offer)) {
        // Everything that can fail is resolved before the first invoice item
        // exists. Minting the Price, mirroring the coupon and working out where
        // a payment plan stops are all calls that can throw — a coupon whose
        // currency differs from the offer's is the everyday example — and each
        // one used to throw with a $97 bump already sitting on the customer.
        const priceId = await ensureRecurringPrice(offer);

        const params: Stripe.SubscriptionCreateParams = {
          customer: customerId,
          items: [{ price: priceId }],
          payment_behavior: "default_incomplete",
          payment_settings: { save_default_payment_method: "on_subscription" },
          expand: ["latest_invoice.confirmation_secret", "pending_setup_intent"],
          metadata: {
            ...metadata,
            installmentCount: String(offer.installment_count ?? ""),
            installmentCents: String(offer.amount_cents),
          },
        };
        if (offer.trial_days > 0) params.trial_period_days = offer.trial_days;
        if (coupon) params.discounts = [{ coupon: await ensureStripeCoupon(coupon) }];

        // A payment plan ends; a membership does not. Stopping the
        // subscription after the final installment is what makes "3 x $1,250"
        // three charges rather than a monthly bill nobody agreed to.
        if (offer.pricing_type === "payment_plan" && offer.installment_count && offer.interval) {
          const lastCharge = addInterval(
            new Date(),
            offer.interval,
            offer.interval_count * offer.installment_count
          );
          params.cancel_at = Math.floor(lastCharge.getTime() / 1000);
        }

        const bumpLines = total.lines.filter((line) => line.kind === "bump");
        const invoiceItemIds: string[] = [];

        let subscription: Stripe.Subscription;
        try {
          // Bumps are one-off purchases riding along with a recurring one. A
          // pending invoice item lands on the subscription's first invoice, so
          // the buyer is charged once for it rather than every renewal — which
          // means it has to exist before `subscriptions.create` raises that
          // invoice. The window cannot be closed, only made as narrow as one
          // call and swept if that call fails.
          for (const [index, line] of bumpLines.entries()) {
            const item = await stripe().invoiceItems.create(
              {
                customer: customerId,
                amount: line.amountCents,
                currency: total.currency,
                description: line.title,
                metadata: { orderId: String(orderId), productId: String(line.productId ?? "") },
              },
              // Keyed on the order and the line, so a checkout retried after a
              // network timeout charges for the bump once rather than twice.
              { idempotencyKey: `offer-order-${orderId}-bump-${index}` }
            );
            invoiceItemIds.push(item.id);
          }

          subscription = await stripe().subscriptions.create(params, {
            idempotencyKey: `offer-order-${orderId}`,
          });
        } catch (err) {
          await discardInvoiceItems(invoiceItemIds);
          throw err;
        }

        const invoice =
          typeof subscription.latest_invoice === "string" ? null : subscription.latest_invoice;
        const setupIntent =
          typeof subscription.pending_setup_intent === "string"
            ? null
            : subscription.pending_setup_intent;

        // With a trial there is no first payment to confirm, only a card to
        // collect — Stripe hands back a SetupIntent instead, and the Payment
        // Element takes either.
        const paymentSecret = invoice?.confirmation_secret?.client_secret ?? null;
        const setupSecret = setupIntent?.client_secret ?? null;

        await pool.query(
          `UPDATE orders SET stripe_customer_id = $2, updated_at = now() WHERE id = $1`,
          [orderId, customerId]
        );

        res.status(201).json({
          ...receipt,
          status: "pending",
          requiresPayment: true,
          clientSecret: paymentSecret ?? setupSecret,
          clientSecretType: paymentSecret ? "payment_intent" : setupSecret ? "setup_intent" : null,
          subscriptionId: subscription.id,
        });
        return;
      }

      const intent = await stripe().paymentIntents.create(
        {
          amount: total.totalCents,
          currency: total.currency,
          customer: customerId,
          // Apple Pay, Google Pay, cards and the 3DS challenge all come from
          // this one flag plus the Payment Element on the page.
          automatic_payment_methods: { enabled: true },
          // Keeping the method on file is what makes the post-purchase upsell a
          // single click instead of a second card entry.
          setup_future_usage: "off_session",
          receipt_email: email,
          description: offer.title,
          metadata,
        },
        { idempotencyKey: `offer-order-${orderId}` }
      );

      await pool.query(
        `UPDATE orders
            SET stripe_payment_intent_id = $2, stripe_customer_id = $3, updated_at = now()
          WHERE id = $1`,
        [orderId, intent.id, customerId]
      );

      res.status(201).json({
        ...receipt,
        status: "pending",
        requiresPayment: true,
        clientSecret: intent.client_secret,
        clientSecretType: "payment_intent",
      });
    } catch (err) {
      await markOrderFailed(orderId);
      throw err;
    }
  })
);

/* ------------------------------------------------------- abandoned capture */

const abandonedSchema = z.object({
  offerSlug: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  firstName: z.string().trim().max(120).optional(),
});

/**
 * POST /api/checkout/abandoned
 *
 * Fired the moment the email field loses focus, long before anyone has decided
 * to buy. Nothing it can say is worth interrupting a checkout for, so every
 * outcome — bad payload, unknown offer, already recovered — is a 204 and the
 * page carries on.
 */
checkoutOfferRouter.post(
  "/checkout/abandoned",
  abandonedLimiter,
  optionalMember,
  asyncHandler(async (req, res) => {
    const parsed = abandonedSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(204).end();
      return;
    }
    const { offerSlug, firstName } = parsed.data;

    // The same rule the charge follows: a signed-in buyer's own address wins
    // over whatever the form posted. It is also what stops a member typing a
    // stranger's address and having their own member_id written onto that
    // person's recovery row — a row keyed on an address, joined to an account
    // that never asked for it. An impersonated session claims nothing, because
    // "view as member" is read-only everywhere else on this router too.
    const member = req.member?.impersonatedBy === undefined ? req.member : undefined;
    const email = (member?.email ?? parsed.data.email).trim().toLowerCase();

    const offer = await loadPublishedOffer(offerSlug);
    if (offer) {
      // The guard on the conflict path keeps a cart that already converted from
      // being reopened by a stray keystroke on a back-button visit.
      await pool.query(
        `INSERT INTO abandoned_checkouts
           (offer_id, email, first_name, member_id, amount_cents, currency)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (offer_id, email) DO UPDATE SET
           first_name = CASE WHEN EXCLUDED.first_name <> ''
                             THEN EXCLUDED.first_name
                             ELSE abandoned_checkouts.first_name END,
           member_id    = COALESCE(EXCLUDED.member_id, abandoned_checkouts.member_id),
           amount_cents = EXCLUDED.amount_cents,
           updated_at   = now()
         WHERE abandoned_checkouts.recovered_at IS NULL`,
        [offer.id, email, firstName ?? "", member?.id ?? null, offer.amount_cents, offer.currency || "usd"]
      );
    }

    res.status(204).end();
  })
);

/* ------------------------------------------------------------------ upsell */

const upsellParamsSchema = z.object({
  slug: z.string().min(1).max(200),
  step: z.string().regex(/^\d{1,6}$/),
});

/** Capped at int4: an id Postgres cannot hold is a 404, not a failed query. */
const MAX_ORDER_ID = 2_147_483_647;

const upsellBodySchema = z.object({
  parentOrderId: z.number().int().positive().max(MAX_ORDER_ID),
  orderToken: z.string().max(400).optional(),
});

interface ParentOrderRow {
  id: number;
  member_id: number | null;
  email: string;
  status: string;
  currency: string;
  billing_name: string;
  billing_phone: string;
  billing_address: unknown;
  stripe_customer_id: string | null;
  stripe_payment_intent_id: string | null;
}

/**
 * The card the parent order was actually paid with, so the upsell needs no
 * re-entry.
 *
 * Strictly the payment method on the parent's own PaymentIntent. Falling back
 * to "any card on that Stripe customer" looks equivalent and is not: an order
 * can reach `paid` without a payment ever being made — a $0 trial invoice does
 * exactly that — leaving a valid receipt token for an order whose customer
 * record was never charged. Listing the customer's cards from there turns the
 * upsell into an off-session charge against a card the buyer never presented
 * for this purchase.
 *
 * If this order did not move money, there is no card it earned the right to
 * charge, and the customer is asked for one.
 */
async function savedPaymentMethodId(parent: ParentOrderRow): Promise<string | null> {
  if (!parent.stripe_payment_intent_id) return null;

  const intent = await stripe().paymentIntents.retrieve(parent.stripe_payment_intent_id);
  if (intent.status !== "succeeded") return null;

  return typeof intent.payment_method === "string"
    ? intent.payment_method
    : (intent.payment_method?.id ?? null);
}

/**
 * POST /api/checkout/offer/:slug/upsell/:step
 *
 * The one-click charge behind a post-purchase upsell: `:slug` is the offer the
 * customer just bought, `:step` the offer_upsells row being accepted.
 *
 * Authentication is the parent order plus a proof of owning it — the receipt
 * token issued at checkout, or being signed in as the member the order belongs
 * to. Somebody else's order id is a 404 rather than a 403, because a 403 would
 * confirm that the id exists and tell an attacker how many orders have been
 * placed.
 */
checkoutOfferRouter.post(
  "/checkout/offer/:slug/upsell/:step",
  upsellLimiter,
  optionalMember,
  asyncHandler(async (req, res) => {
    refuseImpersonation(req);
    if (!stripeEnabled()) throw serviceUnavailable("Payments are not configured");

    const params = upsellParamsSchema.safeParse(req.params);
    if (!params.success) throw notFound("Upsell not found");
    const parsedBody = upsellBodySchema.safeParse(req.body);
    if (!parsedBody.success) throw badRequest("Invalid upsell request", parsedBody.error.flatten());
    const body = parsedBody.data;

    const parentOffer = await loadPublishedOffer(params.data.slug);
    if (!parentOffer) throw notFound("Offer not found");

    const stepRes = await pool.query<{ upsell_offer_id: number }>(
      `SELECT u.upsell_offer_id
         FROM offer_upsells u
         JOIN offers o ON o.id = u.upsell_offer_id AND o.status = 'published'
        WHERE u.offer_id = $1 AND u.step = $2`,
      [parentOffer.id, Number(params.data.step)]
    );
    const upsellOfferId = stepRes.rows[0]?.upsell_offer_id;
    if (!upsellOfferId) throw notFound("Upsell not found");

    const upsellOffer = await loadPublishedOfferById(upsellOfferId);
    if (!upsellOffer) throw notFound("Upsell not found");
    if (isRecurring(upsellOffer)) {
      throw badRequest("This offer has to be bought from its own checkout page");
    }

    const parentRes = await pool.query<ParentOrderRow>(
      `SELECT id, member_id, email, status, currency, billing_name, billing_phone,
              billing_address, stripe_customer_id, stripe_payment_intent_id
         FROM orders
        WHERE id = $1 AND offer_id = $2`,
      [body.parentOrderId, parentOffer.id]
    );
    const parent = parentRes.rows[0];
    if (!parent) throw notFound("Order not found");

    const ownsByToken = body.orderToken ? orderTokenValid(parent.id, body.orderToken) : false;
    const ownsByMember = req.member !== undefined && parent.member_id === req.member.id;
    if (!ownsByToken && !ownsByMember) throw notFound("Order not found");

    // Charging off-session against a card that has not actually cleared yet
    // would be selling on credit we do not extend.
    if (parent.status !== "paid") {
      throw badRequest("The original order hasn't finished processing yet");
    }

    // A declined attempt is deliberately not reused: it leaves a 'failed' order
    // behind, and the customer trying a different card deserves a fresh charge
    // rather than Stripe replaying the original decline from its idempotency
    // cache.
    const existing = await pool.query<{ id: number; status: string }>(
      `SELECT id, status FROM orders
        WHERE parent_order_id = $1 AND offer_id = $2 AND status IN ('paid', 'pending')
        ORDER BY id DESC LIMIT 1`,
      [parent.id, upsellOffer.id]
    );
    const reusable = existing.rows[0];
    if (reusable?.status === "paid") {
      res.json({
        status: "paid",
        orderId: reusable.id,
        orderToken: issueOrderToken(reusable.id),
        clientSecret: null,
        clientSecretType: null,
      });
      return;
    }

    let orderId: number;
    let total: OrderTotal;
    if (reusable) {
      // A second click while the first charge is still settling must not open a
      // second order, and must charge what the first one recorded.
      orderId = reusable.id;
      total = await loadOrderTotal(reusable.id);
    } else {
      const billingAddress = readAddress(parent.billing_address);
      const created = await createPendingOrder({
        offer: upsellOffer,
        memberId: parent.member_id,
        email: parent.email,
        billingName: parent.billing_name,
        billingPhone: parent.billing_phone,
        billingAddress,
        customFieldData: {},
        bumpProductIds: [],
        taxRateBps: await resolveTaxRateBps(upsellOffer, billingAddress),
        parentOrderId: parent.id,
        source: "upsell",
        primaryLineKind: "upsell",
      });
      orderId = created.orderId;
      total = created.total;
    }

    const paymentMethodId = await savedPaymentMethodId(parent);
    if (!paymentMethodId) {
      await markOrderFailed(orderId);
      throw badRequest("We couldn't find a saved card for that order");
    }

    const metadata: Stripe.MetadataParam = {
      orderId: String(orderId),
      offerId: String(upsellOffer.id),
      offerSlug: upsellOffer.slug,
      parentOrderId: String(parent.id),
      pricingType: upsellOffer.pricing_type,
    };

    try {
      const intent = await stripe().paymentIntents.create(
        {
          amount: total.totalCents,
          currency: total.currency,
          ...(parent.stripe_customer_id ? { customer: parent.stripe_customer_id } : {}),
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          ...(parent.email ? { receipt_email: parent.email } : {}),
          description: upsellOffer.title,
          metadata,
        },
        // Keyed on the order rather than the step, so a double click replays one
        // charge while a genuine retry after a decline gets a real second try.
        { idempotencyKey: `upsell-order-${orderId}` }
      );

      await pool.query(
        `UPDATE orders
            SET stripe_payment_intent_id = $2,
                stripe_customer_id = COALESCE(stripe_customer_id, $3),
                updated_at = now()
          WHERE id = $1`,
        [orderId, intent.id, parent.stripe_customer_id]
      );

      // 'processing', not 'paid': Stripe accepting the charge is not the same
      // event as the webhook that grants access, and only one of them is
      // allowed to say an order is paid.
      res.status(201).json({
        status: "processing",
        orderId,
        orderToken: issueOrderToken(orderId),
        clientSecret: null,
        clientSecretType: null,
        ...totalToJson(total),
      });
    } catch (err) {
      const stripeError = err as Stripe.errors.StripeError;
      const pendingIntent = stripeError.payment_intent;

      // The bank wants the customer present. Handing the client secret back
      // lets the page raise the 3DS sheet instead of reporting a decline the
      // buyer could have cleared with a thumbprint.
      if (stripeError.code === "authentication_required" && pendingIntent?.client_secret) {
        await pool.query(
          `UPDATE orders SET stripe_payment_intent_id = $2, updated_at = now() WHERE id = $1`,
          [orderId, pendingIntent.id]
        );
        res.json({
          status: "requires_action",
          orderId,
          orderToken: issueOrderToken(orderId),
          clientSecret: pendingIntent.client_secret,
          clientSecretType: "payment_intent",
          ...totalToJson(total),
        });
        return;
      }

      await markOrderFailed(orderId);
      // A decline is the customer's news to hear; anything else is ours, and
      // goes to the error handler as a 500 with the detail kept in the log.
      if (stripeError.type === "StripeCardError") {
        throw badRequest(stripeError.message || "That card was declined");
      }
      throw err;
    }
  })
);

/* -------------------------------------------------------------- read-back */

const orderReadParamsSchema = z.object({
  id: z
    .string()
    .regex(/^\d{1,10}$/)
    .refine((v) => Number(v) > 0 && Number(v) <= MAX_ORDER_ID),
});

/**
 * GET /api/checkout/order/:id
 *
 * The success page's view of its own order. `status` is whatever the database
 * holds, and the database only ever reaches 'paid' through the webhook — a
 * browser landing here, however it got the id, cannot make an order look paid.
 */
checkoutOfferRouter.get(
  "/checkout/order/:id",
  orderReadLimiter,
  optionalMember,
  asyncHandler(async (req, res) => {
    const params = orderReadParamsSchema.safeParse(req.params);
    if (!params.success) throw notFound("Order not found");
    const orderId = Number(params.data.id);

    const result = await pool.query<{
      id: number;
      member_id: number | null;
      status: string;
      email: string;
      currency: string;
      subtotal_cents: number;
      discount_cents: number;
      tax_cents: number;
      total_cents: number;
      coupon_code: string;
      created_at: Date;
      offer_slug: string | null;
      offer_title: string | null;
      redirect_url: string | null;
      thank_you_page_id: string | null;
    }>(
      `SELECT o.id, o.member_id, o.status, o.email, o.currency, o.subtotal_cents,
              o.discount_cents, o.tax_cents, o.total_cents, o.coupon_code, o.created_at,
              f.slug AS offer_slug, f.title AS offer_title,
              f.redirect_url, f.thank_you_page_id
         FROM orders o
         LEFT JOIN offers f ON f.id = o.offer_id
        WHERE o.id = $1`,
      [orderId]
    );
    const order = result.rows[0];
    if (!order) throw notFound("Order not found");

    const token = typeof req.query.token === "string" ? req.query.token : "";
    const ownsByToken = token ? orderTokenValid(order.id, token) : false;
    const ownsByMember = req.member !== undefined && order.member_id === req.member.id;
    if (!ownsByToken && !ownsByMember) throw notFound("Order not found");

    const items = await pool.query<{
      title: string;
      kind: string;
      quantity: number;
      unit_cents: number;
      amount_cents: number;
    }>(
      `SELECT title, kind, quantity, unit_cents, amount_cents
         FROM order_items WHERE order_id = $1 ORDER BY id`,
      [orderId]
    );

    res.json({
      orderId: order.id,
      status: order.status,
      email: order.email,
      currency: order.currency,
      subtotalCents: order.subtotal_cents,
      discountCents: order.discount_cents,
      taxCents: order.tax_cents,
      totalCents: order.total_cents,
      couponCode: order.coupon_code,
      createdAt: order.created_at,
      offerSlug: order.offer_slug,
      offerTitle: order.offer_title,
      redirectUrl: order.redirect_url || null,
      thankYouPageSlug: order.thank_you_page_id,
      items: items.rows.map((i) => ({
        title: i.title,
        kind: i.kind,
        quantity: i.quantity,
        unitCents: i.unit_cents,
        amountCents: i.amount_cents,
      })),
    });
  })
);
