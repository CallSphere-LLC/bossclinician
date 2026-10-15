# PayPal checkout rollout

Decision: PayPal must cover one-time offers, recurring memberships, and fixed-installment plans before the option is shown to customers. The sandbox Orders v2 one-time path in this branch is groundwork only. Do not enable `PAYPAL_ALL_OFFERS_VALIDATED` or publish a PayPal button while the recurring path is incomplete. The public checkout config keeps the button hidden unless that explicit release gate is set.

## Required implementation

1. Connect a Boss Clinician PayPal Business sandbox REST app. Keep its Client ID, Secret, and webhook ID in server secrets. Do not use live credentials during this work.
2. Use PayPal Catalog Products and Subscription Plans for recurring offers. Map Boss Clinician interval, interval count, trial, currency, coupons, and installment count to an exact PayPal plan. Finite payment plans must stop after the contracted number of billing cycles; memberships continue until cancellation. Validate incompatible offer features before checkout.
3. Persist provider subscription, plan, and sale IDs with unique constraints. Tie them to one local order and buyer. Add idempotent fulfillment for the first successful payment, renewals, retries, refunds, reversals, suspensions, cancellations, and expiration. Do not grant paid access on approval alone.
4. Verify webhook signatures against the configured PayPal webhook ID. Reconcile provider state if the customer closes the browser after approval or capture, and when webhook delivery is delayed. Handle duplicate and out-of-order events. Put failed reconciliations in an operator-visible queue.
5. Test all three offer types in sandbox, including trial, coupon, failed payment, cancellation, duplicate webhook, abandoned browser, and successful renewal. Remove all test contacts, orders, subscriptions, and provider sandbox test artifacts that are safe to delete. Keep the live checkout hidden until all tests pass.

The one-time adapter uses only `https://api-m.sandbox.paypal.com`, and requires `PAYPAL_ENVIRONMENT=sandbox`, `PAYPAL_CHECKOUT_ENABLED=true`, and PayPal sandbox Client ID and Secret. No live PayPal mode exists in this adapter. Its capture return flow is not yet a substitute for the required webhook reconciliation.
