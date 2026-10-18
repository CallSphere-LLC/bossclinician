# PayPal checkout

PayPal is a second way to pay on every checkout (`/checkout/:offer`, the cart, and `/club/checkout`), next to Stripe. It covers all three offer types:

| Offer type | PayPal API | What the buyer approves |
|---|---|---|
| One-time (incl. pay-what-you-want, bumps, coupons, gifts, carts) | Orders v2, captured on return | One payment of the order total |
| Membership (monthly / yearly) | Catalog Product + Billing Plan + Subscriptions v1 | A plan that renews until cancelled |
| Payment plan ("6 x $397", "9 x $612") | Same, with `total_cycles = N` | Exactly N charges, then it stops |

The button appears only when PayPal is fully configured (below). Without that configuration nothing about PayPal is shown, and the Stripe checkout behaves exactly as before.

## Setup (owner / developer)

1. Sign in at https://developer.paypal.com with the Boss Clinician business account (yvette@bossclinician.com, merchant ID `RVHE6XW3M7452`).
2. **Apps & Credentials** → switch to **Live** → **Create App** (type: Merchant). Copy the **Client ID** and **Secret**.
   For a test run first, do the same under **Sandbox** and use a sandbox buyer account to pay.
3. In the app, open **Webhooks** → **Add Webhook**:
   - URL: `https://bossclinician.callsphere.site/api/paypal/webhook`
   - Events:
     - `CHECKOUT.ORDER.APPROVED`
     - `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`
     - `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.RE-ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
     - `PAYMENT.SALE.COMPLETED`, `PAYMENT.SALE.DENIED`, `PAYMENT.SALE.REFUNDED`, `PAYMENT.SALE.REVERSED`
   - Save, then copy the **Webhook ID** it shows.
4. Put these in `backend/.env` (server secrets, never in code), then redeploy the backend:

   ```
   PAYPAL_CHECKOUT_ENABLED=true
   PAYPAL_ENVIRONMENT=live            # or sandbox, matching the app's credentials
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   PAYPAL_WEBHOOK_ID=...
   PAYPAL_MERCHANT_ID=RVHE6XW3M7452   # optional; sent as the payee on one-time orders
   ```

   All of the first five are required; if any is missing or `PAYPAL_ENVIRONMENT` is not exactly `sandbox` or `live`, the button stays hidden. The webhook ID is required because renewals, refunds and cancellations only reach the site through the webhook.
5. Admin → Sales → Payments shows a "PayPal checkout" line: On (live), On (sandbox), or Off with what is missing. No credential is ever displayed.

Switching environments: sandbox and live use different credentials, products and plans. Plans are stored per environment, so changing `PAYPAL_ENVIRONMENT` (with that environment's credentials and webhook) is all that is needed.

## How it works

- **Prices come from the database, never the browser.** The order is written and priced exactly as for Stripe (`createPendingOrder` → `computeOrderTotal`, including coupons, bumps, pay-what-you-want and tax), and the PayPal amount or plan is built from that order.
- **One-time:** the order is created with `PayPal-Request-Id: boss-offer-<orderId>`; the buyer approves on PayPal and returns to `/checkout/paypal/return`, which captures (`boss-capture-<paypalOrderId>`, so a retry never charges twice) and fulfils through `fulfillPayment` — the same receipts, access grants, set-password email, owner notification and automations as a Stripe sale. If the buyer closes the tab after approving, the `CHECKOUT.ORDER.APPROVED` webhook captures and fulfils instead.
- **Recurring:** a PayPal Billing Plan is created the first time a given price shape is sold and reused after (table `paypal_plans`, keyed by environment + a hash of the plan; the Catalog Product per offer is in `paypal_products`). The plan mirrors what Stripe bills for the same order:
  - membership: REGULAR cycle, `total_cycles = 0` (until cancelled); payment plan: `total_cycles = N`;
  - free trial: a TRIAL cycle of N days with no price;
  - coupon "first payment only": a one-cycle TRIAL at the discounted price, then the full price; "every payment": the discounted price on every cycle;
  - order bumps: charged once as the plan's setup fee (net of their share of the coupon);
  - tax is not added to recurring charges (same as the Stripe subscription path).
  PayPal caps intervals at 365 days / 52 weeks / 12 months / 1 year; an offer outside that shows a "please pay by card" message.
- **Access is never granted on approval alone.** The order is fulfilled when PayPal reports the first payment completed (or immediately when nothing is due at activation, i.e. a free trial — as Stripe does for a $0 trial invoice).
- **Reconciliation reads PayPal's current state.** Every subscription webhook (and the return page) calls `reconcilePayPalSubscription`, which GETs the subscription and its transactions and moves local records to match: the `subscriptions` row (membership) or `payment_plans` schedule (installments), one `transactions` row per PayPal payment (unique on the sale id), a paid receipt row in `invoices` (origin `paypal`), renewal receipts, access extension on renewals, installments paid set from PayPal's cycle count (never incremented, so a replay cannot over-count), plan completion email, and access ending on cancel/expiry with the same rules as Stripe (`endSubscriptionAccess`, `endPaymentPlanAccess`: a paid-up plan keeps access, a defaulted one loses it).
- **Webhooks** are verified with PayPal's `/v1/notifications/verify-webhook-signature` against `PAYPAL_WEBHOOK_ID`, logged in `paypal_webhook_events` (idempotent, same claim/retry rules as `stripe_events`), and answer 500 on failure so PayPal retries.
- **Refunds** are made in the PayPal dashboard; `PAYMENT.CAPTURE.REFUNDED` / `PAYMENT.SALE.REFUNDED` record them through `recordRefund` (unique on the PayPal refund id). A full refund of everything the order collected revokes its access, per the billing settings.
- **Members** cancel, pause and resume PayPal memberships from their billing page. PayPal has no "cancel at period end": cancelling stops future charges immediately and access runs to the end of the paid period. A cancelled PayPal subscription cannot be un-cancelled; the member subscribes again.
- **Upsells:** the one-click upsell needs a saved card, so a PayPal buyer goes straight to the thank-you page.
- **Sandbox:** when `PAYPAL_ENVIRONMENT=sandbox` (or Stripe is in test mode) PayPal renewal, dunning, plan-completion and refund emails are not sent. The first-purchase receipt and owner notification follow the existing Stripe test-mode switch only.

## Testing checklist (sandbox)

One-time purchase; purchase with coupon; with bump; cancel on PayPal (order closes, coupon released); close the tab after approving (webhook completes it); refund from PayPal (access revoked when fully refunded). Monthly membership; yearly membership with trial; cancel from the member billing page (access until period end); failed renewal (sandbox: use a buyer with no funding). Payment plan of N: N charges then `EXPIRED` with access kept; cancel mid-plan → access revoked and the defaulted emails. Replay any webhook from the developer dashboard: nothing changes the second time.

## Code

- `backend/src/services/paypalClient.ts` — REST client: environment, cached OAuth token, Orders, Products, Plans, Subscriptions, webhook verification.
- `backend/src/services/paypalPlans.ts` — pure plan/installment arithmetic (tested).
- `backend/src/services/paypalBilling.ts` — plan minting, one-time settlement, subscription reconciliation, refunds.
- `backend/src/routes/public/checkoutOffer.ts` — `/api/checkout/paypal/*` (config, capture, subscription confirm, cancel) and the PayPal branch of `/api/checkout/offer/:slug`.
- `backend/src/routes/public/paypalWebhook.ts` — `POST /api/paypal/webhook`.
- `backend/src/db/migrations/117_paypal_checkout.sql`, `118_paypal_recurring.sql`.
- `frontend/src/pages/Checkout.tsx` (button), `frontend/src/pages/PayPalReturn.tsx` (return/cancel page).

## Klarna and Afterpay (via Stripe)

These come through Stripe, not PayPal. The Stripe PaymentIntent already uses `automatic_payment_methods`, so the Payment Element shows every method switched on in the Stripe Dashboard. What hid Klarna and Afterpay/Clearpay was the intent-wide `setup_future_usage: off_session` (they cannot be saved for later charges). It is now set per method (card and Link only), on the server and in the Payment Element options together, so cards are still saved for one-click upsells.

To turn them on: Stripe Dashboard → Settings → Payment methods → enable **Klarna** and **Afterpay / Clearpay** (USD, US customers; Stripe applies amount limits). They appear for one-time purchases only — subscriptions and payment plans are card-only on Stripe. A Klarna/Afterpay buyer has no saved card, so a one-click upsell after such a purchase cannot be charged (the buyer sees "We couldn't find a saved card for that order").
