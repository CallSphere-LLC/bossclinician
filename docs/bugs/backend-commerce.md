# Backend commerce — adversarial review

Scope: the checkout, Stripe webhook, offer/affiliate admin, member billing and
pricing/coupon/fulfilment services. Every money path traced end to end by
reading the code; nothing was executed against Stripe.

Five confirmed defects, all fixed. Severities are the financial outcome, not
the difficulty of reaching them.

| # | Severity | Where | What |
|---|----------|-------|------|
| 1 | Critical | `routes/public/checkout.ts:193` | Unauthenticated Stripe Billing Portal session for any email |
| 2 | High | `routes/public/checkout.ts:146` | Coupon cap enforced against a counter this path never writes |
| 3 | High | `routes/public/stripeWebhook.ts:1386` + `services/fulfillment.ts:413` | A replayed opening invoice credits a payment-plan installment nobody paid |
| 4 | Medium | `routes/public/stripeWebhook.ts:1405` | A payment plan is only ever opened by the delivery that settles the order |
| 5 | Medium | `services/affiliates.ts:487` | A partner earns commission on their own purchases |

---

## 1. Critical — anyone can open anyone's Stripe billing portal

**`backend/src/routes/public/checkout.ts:193-218`** (before the fix)

`POST /api/billing/portal` had no authentication of any kind. It read an email
address out of the request body, found the newest `subscriptions` row with that
address, and returned a `billingPortal.sessions.create` URL for that Stripe
customer.

**Exploit**

```
POST /api/billing/portal
Content-Type: application/json

{"email":"victim@theirclinic.com"}
```

→ `201 {"url":"https://billing.stripe.com/p/session/live_..."}`

Open the URL. It is a fully authenticated view of the victim's billing:

- every invoice they have ever been sent, with the PDFs;
- the card on file — brand, last four, expiry, billing address;
- and, per the portal configuration, the buttons that **cancel the
  subscription**, **replace the payment method** and **switch plan**.

**Financial outcome.** An attacker who knows a customer's email address — which
is not a secret; it is on their clinic's own contact page — cancels their
paying membership (recurring revenue lost, and `customer.subscription.deleted`
then revokes their access), harvests their invoice history, or swaps the card
Stripe will bill next month. Repeatable across the whole customer list at
15 requests / 10 min per IP, which is the only control that existed.

The route has no frontend caller: `frontend/src/lib/api.ts` calls
`/checkout/session` and `/checkout/session/:id` and nothing else. It is a
leftover from before `POST /api/member/billing/payment-method/session`, which
does the same job correctly behind `requireMember`.

**Fix.** `requireMember` + `denyImpersonation` in front of the handler, and the
customer resolved from `subscriptions.member_id = req.member.id`. The body's
email is gone entirely — `subscriptions.email` is written from whatever Stripe
reported and is not proof of ownership either. "View as member" must not be
able to open a member's payment methods, hence `denyImpersonation`, matching
every other write on the member billing router.

## 2. High — the legacy plan checkout ignores every coupon cap

**`backend/src/routes/public/checkout.ts:146-158`** (before the fix)

```sql
WHERE code = $1 AND active = true
  AND (expires_at IS NULL OR expires_at > now())
  AND (max_redemptions IS NULL OR redeemed < max_redemptions)
```

`coupons.redeemed` is maintained only by `claimRedemption` / `releaseRedemption`
in `services/coupons.ts`, which recompute it from `coupon_redemptions`. This
route writes no order and no redemption row, so nothing it does ever moves that
counter. It also never checks `starts_at`, `scope` or `max_per_contact`.

This is the same defect `db/migrations/006_phase2_coupon_redemptions.sql` was
written to remove — "`coupons.max_redemptions` was compared against
`coupons.redeemed`, and nothing anywhere incremented `redeemed`" — left behind
on the legacy path when offer checkout was fixed.

**Exploit.** Yvette creates `LAUNCH50` — 50% off, `max_redemptions = 1`,
`scope = 'offers'`, `starts_at` next Monday — and mirrors it into Stripe. Any
anonymous client, today:

```
POST /api/checkout/subscription
{"planSlug":"inner-circle","couponCode":"LAUNCH50"}
```

→ a Stripe hosted-checkout URL with the coupon attached. Repeat as often as the
rate limiter allows, forever: `redeemed` stays at 0 on this path, the launch
window is not consulted, and an offer-scoped code is honoured on a plan it was
never meant for.

**Financial outcome.** Every membership sold at half price instead of one, and
a private pre-launch code usable before the launch.

**Fix.** A cap this path structurally cannot claim — there is no order to attach
a `coupon_redemptions` row to until the webhook mirrors the subscription — must
be refused rather than half-enforced. The query now requires
`scope = 'global'`, honours `starts_at`, and rejects any code carrying
`max_redemptions` or `max_per_contact`. Uncapped, in-window, global codes still
work exactly as before.

## 3. High — a replayed opening invoice credits an installment nobody paid

**`backend/src/routes/public/stripeWebhook.ts:1386-1430`** and
**`backend/src/services/fulfillment.ts:413-433`** (before the fix)

Two halves of one hole, both of them the unfinished part of migration 008,
whose own header says it exists so "a retry after a partial failure runs again"
and so that rerun is "safe for the one downstream step that is not naturally
idempotent".

- `handleInvoicePaid` returned from the `opensTheOrder` branch **without calling
  `markInvoiceSettled`**. Every subscription's and every payment plan's opening
  invoice therefore sat with `invoices.settled_at IS NULL` forever, which is
  precisely the condition `upsertInvoice` claims on.
- `createPaymentPlan` never wrote `stripe_invoice_id` on installment one. The
  guard in `advancePaymentPlan` —
  `AND NOT EXISTS (SELECT 1 FROM payment_plan_installments prior WHERE prior.stripe_invoice_id = $5)`
  — was therefore blind to the one invoice it most needed to recognise.

**Exploit sequence** (2 x $1,250 plan):

1. Customer checks out. Order `O` is `pending`; Stripe subscription `S` is
   created with `cancel_at` two months out.
2. `invoice.paid` for opening invoice `I1` ($1,250 collected). `upsertInvoice`
   claims it. `opensTheOrder` is true → `fulfillPayment` commits (order paid,
   access granted) → `startPaymentPlan` commits plan `P`
   (`installments_paid = 1`; installment 1 `paid` with **`stripe_invoice_id`
   NULL**; installment 2 `scheduled`). Handler returns. `settled_at` is never
   written.
3. Anything after that commit throws — the `UPDATE invoices SET payment_plan_id`
   statement, a pool timeout, the process being restarted mid-request. The
   receiver answers 500, `markFailed` sets the event to `failed`, and a `failed`
   event is immediately re-claimable by design.
4. Stripe redelivers. `upsertInvoice` re-claims `I1` because `settled_at IS
   NULL`. `order.status` is now `paid`, so `opensTheOrder` is false and control
   falls through to the renewal branch. `collectedCents` is $1,250 > 0, so
   `advancePaymentPlan` runs with `stripeInvoiceId = I1`; `nextSequence` is 2;
   the `NOT EXISTS` guard finds nothing because installment 1 carries no invoice
   id. **Installment 2 is marked paid.** `installments_paid` reaches 2 =
   `installment_count`, so the plan is marked `completed` and the customer is
   emailed "your payment plan is complete".
5. Stripe's `cancel_at` fires → `customer.subscription.deleted` →
   `endPaymentPlanAccess` sums unpaid installments, gets 0, logs
   "ended paid up … access kept" and returns.

**Financial outcome.** The customer paid $1,250 of $2,500 and keeps the
product. Nothing chases the missing installment, because the schedule says it
was paid, and nothing revokes access, because the plan says it settled. On a
3-installment plan the same replay shortens the contract by one payment and
fires a spurious overcharge alert at the admin when the genuine final charge
lands.

**Fix.**
- `createPaymentPlan` takes `firstStripeInvoiceId` and stamps it on installment
  one, so `advancePaymentPlan`'s existing guard covers the opening charge.
- `handleInvoicePaid` calls `markInvoiceSettled(invoice.id)` on the
  opening-invoice paths, as it already did on the two others, so a redelivery of
  a handler that actually finished never re-enters at all.

Both, rather than either: the second stops the rerun happening, the first makes
the rerun harmless if it ever does.

## 4. Medium — a payment plan is opened only by the delivery that settles the order

**`backend/src/routes/public/stripeWebhook.ts:1405`** (before the fix)

`startPaymentPlan` was nested inside `if (opensTheOrder && order !== null)`.
`fulfillPayment` commits in its own transaction, so the moment anything after it
throws — the offer lookup inside `startPaymentPlan`, `planInstallmentPricing`,
`firstTransactionForOrder`, or `createPaymentPlan`'s own transaction, i.e. any
database blip during a launch — the retry finds `order.status = 'paid'`, takes
`opensTheOrder = false`, and **skips plan creation permanently**. No later
event can recover it: the block was unreachable once the order was paid.

**Financial outcome.** `payment_plans` has no row for a live plan. Installments
2 and 3 are charged by Stripe and land only as loose `transactions`;
`advancePaymentPlan` finds no plan and returns; the member's billing page shows
no plan and no next charge; and when the subscription ends,
`endPaymentPlanAccess` finds no plan and returns, so a customer who stops paying
after the opening charge keeps a $3,750 product for $1,250 with nothing in the
system noticing.

**Fix.** The plan-opening block now keys on the plan being missing
(`isPlan && stripeSubscriptionId && plan === null && order !== null`) rather than
on this delivery having been the one that settled the order, and the member id
falls back to `order.member_id` — which fulfilment has populated by then.
Combined with fix 3, the stamped invoice id makes the `advancePaymentPlan` call
that follows a recovery a no-op rather than a double credit.

## 5. Medium — partners earn commission on their own purchases

**`backend/src/services/affiliates.ts:487-609`** (before the fix)

Neither `resolveAttribution` nor `accrueForTransaction` compared the buyer to
the partner. Every other eligibility question was asked — the cookie window, the
partner's approval status at click time *and* at accrual time, whether the rule
pays on renewals — but not whether the two are the same person.

**Exploit.** A partner is approved (instantly, if `autoApprove` is on). They
open their own share link, which writes an ordinary `affiliate_clicks` row and
sets `bc_ref`. They then buy the $1,997 program with the address they applied
under. `createPendingOrder` freezes `affiliate_id = themselves` onto the order;
`fulfillPayment` enqueues `affiliates.accrue`; `accrueForTransaction` writes a
`sale` commission of $599.10 payable in 30 days, and `POST
/api/admin/affiliates/payouts` pays it out.

**Financial outcome.** A standing 30% discount on everything the partner buys,
repeatable per offer, and repeating on every renewal wherever
`recurring_commission` is set. Invisible on the payouts screen, which shows a
total rather than the buyers behind it.

**Fix.** `accrueForTransaction` now computes a `self_referral` flag in the same
locked read — `affiliates.member_id = orders.member_id`, or
`affiliates.email = orders.email::citext` (both CITEXT-compared, so case does
not matter) — and refuses to accrue. Refused at accrual rather than at
attribution deliberately: the click and the order keep their honest history and
only the money stops.

---

## Tests added

DB-backed, so skipped in this environment (`TEST_DATABASE_URL` unset) but
pinning the behaviour where a database exists:

- `routes/public/stripeWebhook.integration.test.ts` — "does not credit a second
  installment when the opening invoice is re-delivered": drives the real event
  through the real router, asserts the opening invoice is stamped on installment
  one and that `invoices.settled_at` is set, then reproduces the exact partial
  failure (`UPDATE stripe_events SET status = 'failed'`) and redelivers,
  asserting `installments_paid` stays at 1 and installment 2 stays `scheduled`.
- same file — "opens the plan on a retry that finds the order already paid".
- `services/affiliates.integration.test.ts` — "pays nothing to a partner who
  bought it themselves" (email match) and "…whose member account placed the
  order" (member id match).

`npm run typecheck` clean; `vitest run` 423 passed, 99 skipped, 0 failed.

## Cross-boundary

Nothing outside the owned file list was edited. Two items belong to other
owners:

1. **A backfill migration is owed** (`backend/src/db/migrations/`). Plans
   created before this fix have `payment_plan_installments.stripe_invoice_id`
   NULL on installment one and `invoices.settled_at` NULL on their opening
   invoice, so an old `invoice.paid` redelivery can still take the path in
   defect 3. The repair is the same shape as migration 008's own backfill:
   ```sql
   UPDATE invoices SET settled_at = COALESCE(paid_at, created_at)
    WHERE settled_at IS NULL AND status = 'paid';
   ```
   plus stamping installment one of each existing plan from the opening invoice
   recorded against its order. Migration 008 already wrote the first of those
   for invoices that existed *at the time*; every subscription and plan sold
   since has accumulated a fresh unsettled row.

2. **`POST /api/checkout/subscription` and `POST /api/billing/portal` have no
   caller** (`frontend/src/lib/api.ts`). Both are now safe, but whoever owns the
   route surface should decide whether the legacy hosted-checkout path is still
   wanted at all; deleting it removes the only remaining code that reads
   `coupons.redeemed` as an enforcement input.

## Looked hard, found nothing

- **Client-controlled prices.** `computeOrderTotal` is fed only from `offers`,
  `offer_bumps` and `coupons`, resolved inside the order transaction;
  `selectBumps` intersects the requested ids with the offer's own configured
  bumps and drops the rest; `pwywAmountCents` is floored at
  `offers.min_amount_cents`; the upsell retry rebuilds its figures from
  `loadOrderTotal` rather than from the offer's current price. No route accepts
  an amount, a currency or a discount from a body.
- **Money arithmetic.** `services/pricing.ts` is integer cents throughout with
  `assertCents` rejecting NaN/Infinity/negatives/non-integers; percentage and
  commission both `Math.round`, both clamped to their basis; the installment
  remainder lands on the final payment; `prorate` clamps the fraction to [0,1];
  `commerceSchemas` restricts currencies to the two-decimal set, which is what
  keeps the cents assumption true.
- **Webhook signature and raw body.** `app.ts:35` mounts
  `express.raw()` on `/api/stripe/webhook` ahead of `express.json()` at
  `app.ts:47`, and `publicRouter` (which owns the handler) is mounted after
  both, so the handler receives the Buffer. Nothing is read off the payload
  before `constructEvent` succeeds; the metadata the codebase itself wrote is
  re-parsed through zod on the way back.
- **Webhook idempotency and ordering.** `claimEvent` holds `'processing'` for
  the life of the handler with a 15-minute takeover window, answers 409 (not
  200) to an in-flight duplicate, and 500 on failure so Stripe retries.
  Subscription upserts refuse to resurrect a `canceled` row from a stale
  `active`; `linkGrantsToSubscription` completes from whichever side lands
  second; dunning is keyed on Stripe's `attempt_count` rather than an increment.
  Defects 3 and 4 were the only holes in this, and both were in the same branch.
- **Refunds.** `recordRefund` writes both the `refunds` row and a matching
  `transactions` row of `kind = 'refund'` under one unique guard, measures
  "fully refunded" against what the order actually *collected* rather than
  `total_cents`, and `reconciledRefundKey` gives a synthetic identity to a
  refund Stripe did not itemise so a redelivery cannot add it twice.
- **IDOR.** `routes/member/billing.ts` puts `member_id` (or an EXISTS chain to a
  row that has one) inside every WHERE clause and answers 404, never 403;
  `routes/member/affiliatePortal.ts` resolves the partner from the session and
  takes no affiliate id in any route; the guest order read-back and the upsell
  charge both require an HMAC receipt token verified with `safeEqual`, or
  membership of the order. I could not construct a request that reached another
  person's order, invoice, subscription, payout or portal.
- **Affiliate payouts.** `payout_id IS NULL` in both `payableBalances` and
  `POST /payouts` is what stops one commission being handed to two payout runs;
  the rows are locked `FOR UPDATE` and attached inside the transaction that
  computes the total; clawbacks are negative rows keyed on the refund id, so a
  replayed `charge.refunded` reverses once and a second partial refund is not
  swallowed. The accrual and clawback sweeps are genuinely scheduled
  (migration 017), so a missed webhook self-heals within the hour.
- **Coupons on the offer path.** The cap is counted from `coupon_redemptions`
  under `SELECT … FOR UPDATE` inside the order transaction, claimed before the
  buyer reaches Stripe and released on every path an order dies by (client-side
  failure, `payment_intent.payment_failed`, `checkout.session.expired`,
  `async_payment_failed`). A fixed-amount code in the wrong currency is refused.
  Only the legacy path (defect 2) was wrong.
- **Tax.** `resolveTaxRateBps` returns 0 for recurring offers, deliberately, so
  the figure shown can never diverge from what Stripe invoices; the rate is
  keyed on a submitted address only where the offer collects one, and the rate
  itself always comes from settings, never the body. Tax is excluded from the
  affiliate commission basis on the opening charge.
- **`admin/products.ts`** carries no money at all — a product has no price by
  design — and `admin/offers.ts` re-runs `offerPricingIssue` against the *merged*
  row on update and releases `stripe_price_id` on any change to amount,
  currency, interval or pricing type, which is what stops the page and Stripe
  disagreeing about what a subscriber pays.

### One bounded observation, deliberately not fixed

A refund against a subscription sold through the legacy
`/api/checkout/subscription` path is dropped by `handleChargeRefunded`, because
`mirrorLegacyPlanSubscription` creates no `orders` row and the handler needs an
order-linked transaction. It is real, but it is unreachable in practice: that
route has no caller, so there are no such subscriptions, and fixing it would
mean inventing an order for a purchase that never had one. It is recorded here
rather than patched, and it disappears entirely if the cross-boundary decision
above is to retire the legacy path.

---

# Follow-up fixes (verify pass)

Three items from the verify pass landed on the commerce side. Each was
re-confirmed against the code before anything was changed.

## C1 — a later instalment could open a second payment plan, and its money vanished

`routes/public/stripeWebhook.ts`, the plan branch of `handleInvoicePaid`.

**Confirmed.** The branch is keyed on `isPlan && stripeSubscriptionId && plan ===
null && order !== null` and returns before `recordRecurringPayment`. `plan ===
null` is not the same question as "is this the opening invoice": `startPaymentPlan`
answers `null` whenever the offer behind the purchase has been deleted or its
`installment_count` cleared, and when it does, no plan row exists for the next
invoice to find either. Instalment two therefore walked into the same branch,
opened a brand-new plan dated from itself with "instalment 1 paid", and returned
— so no `transactions` row was written for money that had been collected. That
money is missing from every revenue report and from the affiliate's commission
accrual, and the plan's schedule is a year out of date.

**Fixed.** The branch now additionally requires that no *other* settled invoice
exists against the same order. An earlier settled invoice is proof this delivery
is not the opening one, and the handler falls through to `recordRecurringPayment`
where it belongs. The existing reasoning — that opening the plan must not be
keyed on this delivery being the one that settled the order — is preserved
intact; the new test is about which invoice, not about which delivery.

**Also fixed (the related low).** `markInvoiceSettled` ran even when
`startPaymentPlan` returned `null`, which closed the invoice as fully handled and
made the missing schedule permanent: no redelivery and no manual replay could
ever build it. The invoice is now left unsettled in that case, the reason is
logged, and the owner is emailed a note saying which offer to put back and that
resending the invoice event from Stripe will finish the job. The money itself was
never at risk on this path — `settleOrderPayment` had already written the order's
own transaction.

**Deliberately left.** The guard reads `invoices.order_id`, which is the only
column linking a plan invoice to its purchase before the plan exists
(`subscription_id` is null for plans by design, and `payment_plan_id` is exactly
what is missing). A plan invoice that reaches the handler with no resolvable
order is still not repaired, and cannot be: there is nothing in the row to tie it
to.

## C2 — migration `020_payment_plan_backfill.sql`

**Confirmed.** Migration 008 added `invoices.settled_at` and
`payment_plan_installments.stripe_invoice_id` precisely so that a redelivered
opening invoice could not be mistaken for the next instalment, and the plan
branch set neither of them. Every plan opened between 008 and this session's fix
therefore has a NULL `settled_at` on its opening invoice and a NULL
`stripe_invoice_id` on instalment 1 — the exact pair that lets a redelivery
re-claim the invoice, fall through to the renewal path and credit instalment
**two** with the opening payment. On a two-instalment plan that marks the plan
complete and stops the billing after one payment.

**Fixed, conservatively.** The migration does two guarded, re-runnable updates:

1. Instalment 1 is given the id of its plan's opening invoice — defined as the
   earliest invoice carrying that plan's id, which is a link the webhook writes
   only after the plan has been created. Applied only where instalment 1 is
   already `paid`, the invoice is `paid` and collected more than zero, and no
   other instalment already claims that invoice id.
2. Invoices are settled *only* where instalment 1 now names them. Keying step 2
   off step 1's own result rather than off "earliest invoice for the plan" means
   nothing is closed unless an instalment row vouches for it. `settled_at` is
   backdated to the payment, not set to `now()`, so historical reports do not see
   a year of plan openings land on the deploy date.

No Stripe invoice id is invented anywhere: every value written is copied from an
existing invoice row.

**Deliberately left, and counted.** The migration ends with `RAISE NOTICE` lines
giving the numbers for each category it would not touch:

- plans with no linked invoice row at all — nothing in the database says which
  Stripe invoice opened them; recoverable only from the Stripe dashboard;
- plans whose opening invoice collected nothing (a trial, or a deferred first
  charge) — instalment 1 was not paid by that invoice and stamping it would be a
  claim about money that never moved. These are not exposed to the miscredit
  anyway: a $0 invoice is refused by the counter before it can advance anything;
- plans where the opening invoice's id is *already* on a later instalment — the
  miscredit has happened here and unwinding a counter is a person's job, not an
  UPDATE's;
- the residual count of paid plan invoices still unsettled, which is the first
  three plus later instalments that genuinely did not finish.
