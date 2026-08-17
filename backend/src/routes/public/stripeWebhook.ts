import { Router } from "express";
import type Stripe from "stripe";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { stripe } from "../../stripe/client";
import { env, stripeEnabled } from "../../config/env";
import { sendMail } from "../../email/mailer";
import { orderPaidNotification } from "../../email/templates";
import { fireTriggerAsync } from "../../automations/engine";

export const stripeWebhookRouter = Router();

/**
 * Stripe webhook receiver — the ONLY place an order becomes `paid`.
 *
 * Requires the raw request body for signature verification, so app.ts mounts
 * express.raw() on this path ahead of the JSON body parser. If the body has
 * already been parsed to an object, verification will (correctly) fail.
 */
stripeWebhookRouter.post(
  "/stripe/webhook",
  asyncHandler(async (req, res) => {
    if (!stripeEnabled() || !env.stripe.webhookSecret) {
      res.status(503).json({ error: "Payments are not configured" });
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(
        req.body as Buffer,
        signature,
        env.stripe.webhookSecret
      );
    } catch (err) {
      // Unverified payload: never act on it, and don't echo the reason back.
      console.error("[stripe] webhook signature verification failed:", (err as Error).message);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Subscription checkout settles differently from one-time payment: with
        // a trial there is no payment at all yet, so it never reaches
        // payment_status === "paid". Record the subscription and stop here;
        // customer.subscription.* keeps it in sync from now on.
        if (session.mode === "subscription") {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : (session.subscription?.id ?? null);
          const customerId =
            typeof session.customer === "string"
              ? session.customer
              : (session.customer?.id ?? null);
          const planId = session.metadata?.planId ? Number(session.metadata.planId) : null;
          const subEmail = session.customer_details?.email ?? session.customer_email ?? "";

          if (subscriptionId) {
            // Ensure a member record exists so the subscription has an owner.
            const member = subEmail
              ? await pool.query(
                  `INSERT INTO members (email, name, status) VALUES ($1, '', 'active')
                   ON CONFLICT (email) DO UPDATE SET updated_at = now()
                   RETURNING id`,
                  [subEmail.toLowerCase()]
                )
              : null;

            await pool.query(
              `INSERT INTO subscriptions
                 (member_id, plan_id, email, stripe_customer_id, stripe_subscription_id,
                  status, amount_cents, currency)
               VALUES ($1,$2,$3,$4,$5,'active',$6,$7)
               ON CONFLICT (stripe_subscription_id) DO UPDATE
                 SET status = 'active', updated_at = now()`,
              [
                member?.rows[0]?.id ?? null,
                planId,
                subEmail.toLowerCase(),
                customerId,
                subscriptionId,
                session.amount_total ?? 0,
                session.currency ?? "usd",
              ]
            );

            // Paid plans can unlock a community — enroll the member on purchase.
            if (planId && member?.rows[0]?.id) {
              await pool.query(
                `INSERT INTO community_memberships (community_id, member_id)
                 SELECT p.community_id, $2 FROM plans p
                  WHERE p.id = $1 AND p.community_id IS NOT NULL
                 ON CONFLICT (community_id, member_id) DO NOTHING`,
                [planId, member.rows[0].id]
              );
            }
          }
          break;
        }

        // `complete` + unpaid happens for async methods; only mark paid on paid.
        if (session.payment_status !== "paid") break;

        const email =
          session.customer_details?.email ?? session.customer_email ?? "";
        const paymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);

        // Idempotent: Stripe retries webhooks, and `status <> 'paid'` in the
        // WHERE clause means a duplicate delivery updates zero rows and sends
        // no second notification email.
        const updated = await pool.query(
          `UPDATE orders
              SET status = 'paid',
                  email = CASE WHEN $2 <> '' THEN $2 ELSE email END,
                  amount_cents = $3,
                  stripe_payment_intent_id = $4,
                  updated_at = now()
            WHERE stripe_session_id = $1 AND status <> 'paid'
        RETURNING course_title, email, amount_cents, currency`,
          [session.id, email, session.amount_total ?? 0, paymentIntentId]
        );

        const order = updated.rows[0];
        if (order) {
          fireTriggerAsync("order_paid", {
            email: order.email,
            courseTitle: order.course_title,
            amountCents: order.amount_cents,
          });
        }
        if (order && env.notifyEmail) {
          const { subject, text, html } = orderPaidNotification({
            courseTitle: order.course_title,
            email: order.email,
            amountCents: order.amount_cents,
            currency: order.currency,
          });
          void sendMail({ to: env.notifyEmail, subject, text, html });
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        await pool.query(
          `UPDATE orders SET status = 'expired', updated_at = now()
            WHERE stripe_session_id = $1 AND status = 'pending'`,
          [session.id]
        );
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await pool.query(
          `UPDATE orders SET status = 'failed', updated_at = now()
            WHERE stripe_session_id = $1 AND status <> 'paid'`,
          [session.id]
        );
        break;
      }

      // Stripe is the source of truth for subscription lifecycle; mirror it
      // rather than trying to infer state transitions locally.
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        // Stripe moved current_period_end off the subscription and onto each
        // subscription item. Single-price subscriptions have exactly one item.
        const periodEndUnix = sub.items?.data?.[0]?.current_period_end;
        const periodEnd =
          typeof periodEndUnix === "number"
            ? new Date(periodEndUnix * 1000).toISOString()
            : null;

        await pool.query(
          `UPDATE subscriptions
              SET status = $2,
                  current_period_end = $3,
                  cancel_at_period_end = $4,
                  updated_at = now()
            WHERE stripe_subscription_id = $1`,
          [
            sub.id,
            event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
            periodEnd,
            sub.cancel_at_period_end ?? false,
          ]
        );
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        // The flat `invoice.subscription` field was replaced by the polymorphic
        // `parent` object in recent API versions.
        const parentSubscription = invoice.parent?.subscription_details?.subscription;
        const subscriptionId =
          typeof parentSubscription === "string"
            ? parentSubscription
            : (parentSubscription?.id ?? null);

        // ON CONFLICT keeps this idempotent across Stripe's retries.
        await pool.query(
          `INSERT INTO invoices
             (stripe_invoice_id, subscription_id, email, amount_paid_cents, currency,
              status, hosted_invoice_url)
           VALUES ($1,
                   (SELECT id FROM subscriptions WHERE stripe_subscription_id = $2),
                   $3, $4, $5, $6, $7)
           ON CONFLICT (stripe_invoice_id) DO UPDATE
             SET status = EXCLUDED.status,
                 amount_paid_cents = EXCLUDED.amount_paid_cents`,
          [
            invoice.id,
            subscriptionId,
            invoice.customer_email ?? "",
            invoice.amount_paid ?? 0,
            invoice.currency ?? "usd",
            event.type === "invoice.paid" ? "paid" : "failed",
            invoice.hosted_invoice_url ?? "",
          ]
        );
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying them.
        break;
    }

    res.json({ received: true });
  })
);
