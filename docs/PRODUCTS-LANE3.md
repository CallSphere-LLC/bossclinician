# Lane 3 — Checkout abandonment

## Reproduction (2026-09-12)

Before editing, live staging database read returned `abandoned_checkouts`: **0 captured, 0 mailed, 0 recovered**; the `checkout.abandoned` job schedule was enabled. There was no `cart_recovery` setting.

Source inspection reproduced a partly implemented system, not a completely absent sender: checkout email blur posts `/api/checkout/abandoned`; `jobs/handlers.ts` hardcoded 1/24/72 hour delays; `emailJobs.ts` hardcoded three email bodies. Fulfillment marked every matching purchase recovered without requiring any reminder, and reporting counted those purchases. There was no editable sequence or attribution to an individual reminder. This is why the existing empty report alone could not establish working recovery.

## Changes

- Global configuration under **Settings → Payments → Abandoned checkout reminders**. Master enable, editable recipient list (empty means all eligible checkout visitors), four individually enabled emails with editable delay, subject and body. Defaults: **1 / 6 / 10 / 24 hours**. Validation rejects invalid recipient addresses, empty enabled copy and unordered delays. The global setting uses the existing settings API and generated form; save/read use `cart_recovery`.
- Delays start at last captured checkout activity; jobs recheck current configuration and paid/stopped state immediately before delivery. Disabled steps are skipped. Duplicate concurrent jobs serialize on the checkout row.
- Existing central email provider remains responsible for sender identity, contact and member preference checks, suppression list, unsubscribe footer, staging recipient guard and delivery log. Suppressed messages stop the sequence and do not increment sent counters.
- Each reminder has an audit row, email message id, sent timestamp, subject and clicked timestamp. Its signed, expiring `/api/checkout/recover/:token` URL records a click then redirects to the actual offer checkout. Signature modification fails.
- Payment fulfillment locks the same checkout row, stops the sequence, cancels queued/failed reminder jobs and attributes recovered revenue to the last sent reminder link followed before payment. Organic completion stops reminders but earns no recovery attribution.
- Existing recovered-revenue rollup now requires that attribution. Completion queues a report rebuild for today, so it does not wait for the nightly job. The existing report explains its attribution rule.
- Migration: `053_checkout_recovery.sql` (new reminder audit table and stop/attribution columns). No existing purchases or grants changed by this lane.

## Verification

- Backend TypeScript check passed after implementation.
- Scratch Postgres integration exercises real migrated schema, sender service, suppression/preference checks, queue rows, fulfillment and reporting, replacing only SMTP transport. Cases cover editable reminder, signed link, $27 attributed revenue, completion stopping later reminders/cancelling jobs, organic-purchase exclusion, suppressions, opt-outs, changed delay/recipients, duplicate concurrent jobs, settings validation. See `backend/src/services/checkoutRecovery.integration.test.ts`.
- Run: `./backend/scripts/test-integration.sh src/services/checkoutRecovery.integration.test.ts`.
- The test database is dropped by the harness. Test records use `ZZ` and `sagar+zz-recovery-*@callsphere.ai`; no live email or Stripe call occurs in that suite.

## Live acceptance still required in Lane V

Deployment, real reminder receipt/open, edited-setting persistence after browser reload, public checkout capture, and visible report after completing checkout require live verification by the coordinator. Stripe is configured with a live secret; no real paid charge was attempted. A controlled manual-payment fixture exercises fulfillment without charging; it must be labelled as such, never as a real Stripe purchase.

For a live controlled fixture: create a `ZZ` $27 offer, capture only an approved `sagar+...@callsphere.ai` recipient, restrict the global recipient setting to that address, and use an editable delay or age just that fixture. Run the normal sweep/worker; follow the actual received reminder URL; record/complete the controlled order; then assert no subsequent job sends and the report shows 2700 cents. Restore global settings and delete the fixture plus its member/contact, access, order, email/event/job and report-cache rows. Preserve pre-existing records and suppressions.

## Limits

An SMTP timeout after a provider has accepted a message has the usual ambiguous-delivery risk; no promise of exactly-once delivery across provider/network failure is made. Row locking prevents duplicate concurrent local sends and payment/reminder races. In-flight SMTP begun before a payment commits may finish first; once payment commits, later reminders are blocked.
