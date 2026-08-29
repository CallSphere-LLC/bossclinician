import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, serviceUnavailable } from "../../utils/httpError";
import { stripe } from "../../stripe/client";
import { stripeEnabled, env } from "../../config/env";
import { checkoutLimiter } from "../../middleware/rateLimit";
import { denyImpersonation, requireMember } from "../../middleware/memberAuth";

export const checkoutRouter = Router();

const checkoutSchema = z.object({
  slug: z.string().min(1).max(200),
  email: z.string().email().max(320).optional(),
});

interface PurchasableCourse {
  id: number;
  slug: string;
  title: string;
  price_cents: number | null;
  currency: string;
  stripe_price_id: string | null;
}

/**
 * Creates a Stripe Checkout Session for a published course and returns the
 * hosted-checkout URL for the browser to redirect to.
 *
 * The price is ALWAYS read from the database — never from the request body —
 * so a client cannot choose what it pays.
 */
checkoutRouter.post(
  "/checkout/session",
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    if (!stripeEnabled()) throw serviceUnavailable("Payments are not configured");

    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid checkout payload", parsed.error.flatten());
    const { slug, email } = parsed.data;

    const result = await pool.query(
      `SELECT id, slug, title, price_cents, currency, stripe_price_id
         FROM courses
        WHERE slug = $1 AND published = true`,
      [slug]
    );
    const course = result.rows[0] as PurchasableCourse | undefined;
    if (!course) throw notFound("Course not found");

    const hasPrice =
      (course.stripe_price_id && course.stripe_price_id.length > 0) ||
      (course.price_cents !== null && course.price_cents > 0);
    if (!hasPrice) throw badRequest("This course is not available for online purchase");

    const lineItem = course.stripe_price_id
      ? { price: course.stripe_price_id, quantity: 1 }
      : {
          quantity: 1,
          price_data: {
            currency: course.currency || "usd",
            unit_amount: course.price_cents as number,
            product_data: { name: course.title },
          },
        };

    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [lineItem],
      customer_email: email,
      // Stripe substitutes the real id into {CHECKOUT_SESSION_ID}.
      success_url: `${env.publicSiteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.publicSiteUrl}/courses?checkout=cancelled`,
      metadata: { courseId: String(course.id), courseSlug: course.slug },
    });

    // Recorded as pending; the webhook is what promotes it to paid. Never treat
    // a browser landing on success_url as proof of payment.
    await pool.query(
      `INSERT INTO orders
         (course_id, course_slug, course_title, email, amount_cents, currency, status, stripe_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       ON CONFLICT (stripe_session_id) DO NOTHING`,
      [
        course.id,
        course.slug,
        course.title,
        email ?? "",
        session.amount_total ?? course.price_cents ?? 0,
        course.currency || "usd",
        session.id,
      ]
    );

    res.status(201).json({ url: session.url });
  })
);

const subscriptionSchema = z.object({
  planSlug: z.string().min(1).max(200),
  email: z.string().email().max(320).optional(),
  couponCode: z.string().max(64).optional(),
});

interface SellablePlan {
  id: number;
  slug: string;
  name: string;
  price_cents: number;
  currency: string;
  interval: string;
  stripe_price_id: string | null;
  trial_days: number;
}

/**
 * Creates a Stripe Checkout Session in `subscription` mode for a published
 * plan (community membership, monthly coaching, etc).
 *
 * As with one-time checkout the price comes from the database, never the
 * request. Coupons are validated locally first so an expired or exhausted code
 * cannot be replayed straight into Stripe.
 */
checkoutRouter.post(
  "/checkout/subscription",
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    if (!stripeEnabled()) throw serviceUnavailable("Payments are not configured");

    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid subscription payload", parsed.error.flatten());
    const { planSlug, email, couponCode } = parsed.data;

    const result = await pool.query(
      `SELECT id, slug, name, price_cents, currency, interval, stripe_price_id, trial_days
         FROM plans WHERE slug = $1 AND published = true`,
      [planSlug]
    );
    const plan = result.rows[0] as SellablePlan | undefined;
    if (!plan) throw notFound("Plan not found");
    if (!plan.stripe_price_id && plan.price_cents <= 0) {
      throw badRequest("This plan is not available for online purchase");
    }

    let discounts: { coupon: string }[] | undefined;
    if (couponCode) {
      // A plan is not an offer, so `services/coupons.ts` — which scopes and
      // counts a code against `offers` and claims a redemption row against the
      // order it discounts — cannot be used here: this path creates no order at
      // all until Stripe's webhook mirrors the subscription, so there is nothing
      // to claim a redemption against.
      //
      // That is exactly why a usage cap may not be silently honoured here. The
      // old test compared `max_redemptions` against `coupons.redeemed`, a
      // counter this path never writes, so a code limited to one use worked for
      // everybody who typed it — the same defect migration 006 was written to
      // remove from offer checkout. A capped code is refused rather than
      // half-enforced; the launch window (`starts_at`) and an offer-scoped code
      // are checked for the same reason.
      const coupon = await pool.query(
        `SELECT stripe_coupon_id FROM coupons
          WHERE code = $1 AND active = true
            AND scope = 'global'
            AND (starts_at IS NULL OR starts_at <= now())
            AND (expires_at IS NULL OR expires_at > now())
            AND max_redemptions IS NULL
            AND max_per_contact IS NULL`,
        [couponCode.trim().toUpperCase()]
      );
      const stripeCouponId = coupon.rows[0]?.stripe_coupon_id as string | undefined;
      if (!stripeCouponId) throw badRequest("That coupon code is not valid");
      discounts = [{ coupon: stripeCouponId }];
    }

    const lineItem = plan.stripe_price_id
      ? { price: plan.stripe_price_id, quantity: 1 }
      : {
          quantity: 1,
          price_data: {
            currency: plan.currency || "usd",
            unit_amount: plan.price_cents,
            recurring: { interval: plan.interval === "year" ? ("year" as const) : ("month" as const) },
            product_data: { name: plan.name },
          },
        };

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [lineItem],
      customer_email: email,
      ...(discounts ? { discounts } : {}),
      ...(plan.trial_days > 0
        ? { subscription_data: { trial_period_days: plan.trial_days } }
        : {}),
      success_url: `${env.publicSiteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.publicSiteUrl}/courses?checkout=cancelled`,
      metadata: { planId: String(plan.id), planSlug: plan.slug },
    });

    res.status(201).json({ url: session.url });
  })
);

/**
 * Stripe-hosted billing portal so members can update cards, switch plans and
 * cancel without us building any of that UI.
 *
 * Behind `requireMember`, and keyed on the signed-in member rather than on an
 * address in the body. A portal session is a fully authenticated view of
 * somebody's billing: their invoices and PDFs, the card on file, and the buttons
 * that cancel the subscription or replace that card. Taking the address from the
 * request meant anyone who knew a customer's email — which is not a secret —
 * could post it here and be handed that customer's portal link.
 *
 * `member_id` is the match, not `subscriptions.email`: that column is written
 * from whatever Stripe reported and is not proof of ownership either.
 */
checkoutRouter.post(
  "/billing/portal",
  requireMember,
  denyImpersonation,
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    if (!stripeEnabled()) throw serviceUnavailable("Payments are not configured");
    const member = req.member;
    if (!member) throw notFound("No billing account found");

    const result = await pool.query(
      `SELECT stripe_customer_id FROM subscriptions
        WHERE member_id = $1 AND stripe_customer_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [member.id]
    );
    const customerId = result.rows[0]?.stripe_customer_id as string | undefined;
    if (!customerId) throw notFound("No billing account found");

    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.publicSiteUrl}/`,
    });

    res.status(201).json({ url: session.url });
  })
);

/**
 * Read-back for the success page. Reports only what the webhook has already
 * confirmed, so a forged session_id cannot manufacture a "paid" response.
 */
checkoutRouter.get(
  "/checkout/session/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT course_slug, course_title, email, amount_cents, currency, status
         FROM orders WHERE stripe_session_id = $1`,
      [req.params.id]
    );
    const order = result.rows[0];
    if (!order) throw notFound("Order not found");

    res.json({
      courseSlug: order.course_slug,
      courseTitle: order.course_title,
      email: order.email,
      amountCents: order.amount_cents,
      currency: order.currency,
      status: order.status,
    });
  })
);
