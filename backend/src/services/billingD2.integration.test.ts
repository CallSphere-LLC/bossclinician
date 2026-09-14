import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express from "express";
import fs from "fs";
import path from "path";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import {
  createTestDatabase,
  hasTestDatabase,
  insertCourseProduct,
  insertMember,
  insertOffer,
  insertOrder,
} from "../testing/db";

/**
 * Lane D2 — the customer billing portal, end to end against a real database.
 *
 * Stripe is the real SDK object with a fake test key, and every method the code
 * under test calls on it is replaced with a spy, so nothing leaves the process —
 * the key in .env is a live one and must never be reached from a test. Webhook
 * events go through the real router over HTTP with a real signature, as Stripe
 * would send them.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;
const WEBHOOK_SECRET = "whsec_d2_integration_secret";

describeDb("billing portal, dunning and cancellation reports (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let pool: typeof import("../db/pool").pool;
  let stripeClient: typeof import("../stripe/client");
  let dunning: typeof import("./dunning");
  let reports: typeof import("./reports/queries");
  let rollup: typeof import("./reports/rollup");
  let settings: typeof import("./settings");
  let portal: typeof import("./billingPortal");
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("d2billing");
    client = db.client;

    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_integration_never_called";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    delete process.env.NOTIFY_EMAIL;

    const webhook = await import("../routes/public/stripeWebhook");
    pool = (await import("../db/pool")).pool;
    stripeClient = await import("../stripe/client");
    dunning = await import("./dunning");
    reports = await import("./reports/queries");
    rollup = await import("./reports/rollup");
    settings = await import("./settings");
    portal = await import("./billingPortal");

    const app = express();
    app.use("/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }));
    app.use(webhook.stripeWebhookRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await settings.writeSetting("failed_payments", { retryMode: "stripe" });
    await settings.writeSetting("customer_payments", { revokeOnFirstFailedPayment: false });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end().catch(() => undefined);
    await db.drop();
  });

  async function deliver(type: string, object: Record<string, unknown>): Promise<number> {
    const payload = JSON.stringify({
      id: `evt_${type}_${Math.random().toString(36).slice(2)}`,
      object: "event",
      api_version: stripeClient.STRIPE_API_VERSION,
      created: Math.floor(Date.now() / 1000),
      type,
      data: { object },
    });
    const signature = stripeClient.stripe().webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    const res = await fetch(`${baseUrl}/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    return res.status;
  }

  /**
   * A member on a membership, with the course it pays for — and a second course
   * on the same offer that they own outright, with no subscription behind it.
   * Revoking "by offer" used to take that one too.
   */
  async function member(label: string) {
    const email = `success+zz-d2-${label}@simulator.amazonses.com`;
    const memberId = await insertMember(client, email, { name: `ZZ D2 ${label}` });
    const { productId } = await insertCourseProduct(client, `zz-d2-${label}`);
    const { productId: ownedProductId } = await insertCourseProduct(client, `zz-d2-owned-${label}`);
    const offerId = await insertOffer(client, `zz-d2-offer-${label}`, [productId]);
    const orderId = await insertOrder(client, { offerId, email, totalCents: 4700, memberId });
    await client.query(`UPDATE orders SET status = 'paid', stripe_customer_id = $2 WHERE id = $1`, [
      orderId,
      `cus_${label}`,
    ]);
    const sub = await client.query<{ id: number }>(
      `INSERT INTO subscriptions (member_id, offer_id, email, stripe_customer_id, stripe_subscription_id,
                                  status, amount_cents, current_period_end)
       VALUES ($1, $2, $3, $4, $5, 'active', 4700, now() + interval '20 days') RETURNING id`,
      [memberId, offerId, email, `cus_${label}`, `sub_${label}`]
    );
    const subscriptionId = sub.rows[0].id;
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, offer_id, order_id, subscription_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [memberId, productId, offerId, orderId, subscriptionId]
    );
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, offer_id) VALUES ($1, $2, $3)`,
      [memberId, ownedProductId, offerId]
    );
    return { email, memberId, productId, ownedProductId, offerId, orderId, subscriptionId };
  }

  async function grantStatus(memberId: number, productId: number) {
    const res = await client.query<{ status: string; revoke_reason: string }>(
      `SELECT status, revoke_reason FROM access_grants WHERE member_id = $1 AND product_id = $2`,
      [memberId, productId]
    );
    return res.rows[0];
  }

  /** A subscription invoice as Stripe sends it. No orderId: made outside our checkout. */
  function invoice(label: string, status: "open" | "paid", attempt = 1) {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: `in_${label}`,
      object: "invoice",
      customer: `cus_${label}`,
      customer_email: `success+zz-d2-${label}@simulator.amazonses.com`,
      number: `INV-${label}`,
      currency: "usd",
      amount_due: 4700,
      amount_paid: status === "paid" ? 4700 : 0,
      attempt_count: attempt,
      status,
      hosted_invoice_url: "https://invoice.test/pay",
      invoice_pdf: "",
      created: now,
      period_start: now,
      period_end: now + 2_592_000,
      next_payment_attempt: null,
      status_transitions: { paid_at: status === "paid" ? now : null },
      total_taxes: [],
      payments: { data: [] },
      parent: {
        subscription_details: {
          subscription: `sub_${label}`,
          metadata: { pricingType: "subscription" },
        },
      },
    };
  }

  it("pauses only the membership's access on the first failure, and a payment gives it back", async () => {
    const m = await member("pause");
    await settings.writeSetting("customer_payments", { revokeOnFirstFailedPayment: true });

    expect(await deliver("invoice.payment_failed", invoice("pause", "open"))).toBe(200);

    expect(await grantStatus(m.memberId, m.productId)).toEqual({
      status: "revoked",
      revoke_reason: dunning.FAILED_PAYMENT_REVOKE_REASON,
    });
    // Bought outright on the same offer: untouched.
    expect((await grantStatus(m.memberId, m.ownedProductId)).status).toBe("active");
    const past = await client.query(`SELECT status FROM subscriptions WHERE id = $1`, [m.subscriptionId]);
    expect(past.rows[0].status).toBe("past_due");

    expect(await deliver("invoice.paid", invoice("pause", "paid", 2))).toBe(200);

    expect(await grantStatus(m.memberId, m.productId)).toEqual({ status: "active", revoke_reason: "" });
    const back = await client.query(`SELECT status FROM subscriptions WHERE id = $1`, [m.subscriptionId]);
    expect(back.rows[0].status).toBe("active");
  });

  it("never restores access a refund took away", async () => {
    const m = await member("refunded");
    await client.query(
      `UPDATE access_grants SET status = 'revoked', revoke_reason = 'refunded in full'
        WHERE subscription_id = $1`,
      [m.subscriptionId]
    );
    await dunning.restoreAccessAfterPayment(m.subscriptionId);
    expect((await grantStatus(m.memberId, m.productId)).status).toBe("revoked");
  });

  it("books the owner's first retry gap when a payment fails", async () => {
    await member("booked");
    await settings.writeSetting("failed_payments", { retryMode: "schedule", retryDays: "3, 5, 7" });

    const before = Date.now();
    expect(await deliver("invoice.payment_failed", invoice("booked", "open"))).toBe(200);

    const row = await client.query<{ next_retry_at: Date; retries_made: number }>(
      `SELECT next_retry_at, retries_made FROM invoices WHERE stripe_invoice_id = 'in_booked'`
    );
    const gapDays = (row.rows[0].next_retry_at.getTime() - before) / 86_400_000;
    expect(gapDays).toBeGreaterThan(2.99);
    expect(gapDays).toBeLessThan(3.01);
    expect(row.rows[0].retries_made).toBe(0);

    // Ends here, so a later test's sweep three days on does not pick it up.
    await dunning.closeDunning("in_booked", "exhausted");
  });

  it("retries on schedule, and cancels the membership when the last retry is declined", async () => {
    const m = await member("exhaust");
    await settings.writeSetting("failed_payments", {
      retryMode: "schedule",
      retryDays: "1, 2",
      finalAction: "cancel",
    });
    await settings.writeSetting("customer_payments", { revokeOnFirstFailedPayment: true });
    expect(await deliver("invoice.payment_failed", invoice("exhaust", "open"))).toBe(200);

    const s = stripeClient.stripe();
    vi.spyOn(s.invoices, "retrieve").mockResolvedValue({ status: "open" } as never);
    const pay = vi
      .spyOn(s.invoices, "pay")
      .mockRejectedValue(Object.assign(new Error("Your card was declined."), { type: "StripeCardError" }));
    const cancel = vi.spyOn(s.subscriptions, "cancel").mockResolvedValue({} as never);

    // First retry, a day on: declined, the second gap is booked.
    const dayOne = new Date(Date.now() + 1.01 * 86_400_000);
    await expect(dunning.sweepDunning(dayOne)).resolves.toMatchObject({ retried: 1, declined: 1, canceled: 0 });
    const afterFirst = await client.query<{ retries_made: number; next_retry_at: Date; last_retry_error: string }>(
      `SELECT retries_made, next_retry_at, last_retry_error FROM invoices WHERE stripe_invoice_id = 'in_exhaust'`
    );
    expect(afterFirst.rows[0].retries_made).toBe(1);
    expect(afterFirst.rows[0].last_retry_error).toBe("Your card was declined.");
    expect(Math.round((afterFirst.rows[0].next_retry_at.getTime() - dayOne.getTime()) / 86_400_000)).toBe(2);

    // Running again before the date does nothing at all.
    await expect(dunning.sweepDunning(dayOne)).resolves.toMatchObject({ retried: 0 });

    // Second and last retry: declined, so the membership is cancelled.
    const dayThree = new Date(dayOne.getTime() + 2.01 * 86_400_000);
    await expect(dunning.sweepDunning(dayThree)).resolves.toMatchObject({ retried: 1, canceled: 1 });

    expect(pay).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith("sub_exhaust", expect.any(Object), {
      idempotencyKey: "dunning-cancel-in_exhaust",
    });
    const sub = await client.query(
      `SELECT status, cancel_reason, ended_at FROM subscriptions WHERE id = $1`,
      [m.subscriptionId]
    );
    expect(sub.rows[0]).toMatchObject({ status: "canceled", cancel_reason: "payment_failed" });
    expect(sub.rows[0].ended_at).not.toBeNull();
    expect(await grantStatus(m.memberId, m.productId)).toEqual({
      status: "revoked",
      revoke_reason: dunning.RETRIES_EXHAUSTED_REASON,
    });
    expect((await grantStatus(m.memberId, m.ownedProductId)).status).toBe("active");
    const inv = await client.query(
      `SELECT dunning_outcome, next_retry_at FROM invoices WHERE stripe_invoice_id = 'in_exhaust'`
    );
    expect(inv.rows[0]).toEqual({ dunning_outcome: "canceled", next_retry_at: null });
  });

  it("records the reason from a cancellation made in Stripe's own portal", async () => {
    const m = await member("portalcancel");
    await settings.writeSetting("customer_payments", {
      cancellationReasons: "too_expensive | Money is tight\nother | Something else",
    });
    const now = Math.floor(Date.now() / 1000);
    expect(
      await deliver("customer.subscription.updated", {
        id: "sub_portalcancel",
        object: "subscription",
        customer: "cus_portalcancel",
        status: "active",
        currency: "usd",
        cancel_at_period_end: true,
        cancel_at: null,
        canceled_at: now,
        cancellation_details: { feedback: "too_expensive", comment: "ZZ going somewhere cheaper", reason: "cancellation_requested" },
        created: now - 86_400,
        metadata: {},
        items: {
          data: [
            {
              current_period_start: now - 86_400,
              current_period_end: now + 2_505_600,
              price: { unit_amount: 4700, recurring: { interval: "month", interval_count: 1 } },
            },
          ],
        },
      })
    ).toBe(200);

    const row = await client.query(
      `SELECT cancel_reason, cancel_feedback, cancel_at_period_end FROM subscriptions WHERE id = $1`,
      [m.subscriptionId]
    );
    expect(row.rows[0]).toEqual({
      cancel_reason: "too_expensive",
      cancel_feedback: "ZZ going somewhere cheaper",
      cancel_at_period_end: true,
    });
  });

  it("prints the owner's wording in both cancellation reports", async () => {
    const m = await member("reports");
    await settings.writeSetting("customer_payments", {
      cancellationReasons: "too_expensive | Money is tight\nother | Something else",
    });
    await client.query(
      `UPDATE subscriptions SET cancel_reason = 'too_expensive', cancel_feedback = 'ZZ report note',
                                cancel_at_period_end = true, canceled_at = now()
        WHERE id = $1`,
      [m.subscriptionId]
    );
    const involuntary = await member("reports-involuntary");
    await client.query(
      `UPDATE subscriptions SET status = 'canceled', cancel_reason = 'payment_failed', canceled_at = now(), ended_at = now()
        WHERE id = $1`,
      [involuntary.subscriptionId]
    );

    const day = rollup.reportDay();
    await rollup.runRollup({ from: day, to: day });

    const left = await reports.canceledSubscriptions({ from: day, to: day });
    const labels = (left.breakdown ?? []).map((row) => row.label);
    expect(labels).toEqual(expect.arrayContaining(["Money is tight", "Their payment kept failing"]));

    const said = await reports.cancellationFeedback({ from: day, to: day });
    expect((said.breakdown ?? []).map((row) => row.label)).toContain("ZZ report note (Money is tight)");
  });

  it("refuses payment settings Stripe or the reports would reject, and says why", async () => {
    const reason = async (key: string, patch: Record<string, unknown>) => {
      try {
        await settings.writeSetting(key, patch);
        return "saved";
      } catch (err) {
        return JSON.stringify((err as { details?: unknown }).details);
      }
    };
    expect(await reason("customer_payments", { statementDescriptor: "BOSS*CLIN" })).toContain(
      "only use letters"
    );
    expect(await reason("customer_payments", { cancellationReasons: "too_expensive | " })).toContain(
      "no wording"
    );
    expect(await reason("failed_payments", { retryDays: "0, 3" })).toContain("between 1 and 30");
    expect(await reason("customer_payments", { statementDescriptor: "BOSS CLINICIAN" })).toBe("saved");
  });

  it("turns a stored 0-day reminder into a switched-off one, and is safe to run twice", async () => {
    await client.query(
      `UPDATE settings SET value = (value - 'sendTrialReminders') || '{"trialReminderDays": 0}'::jsonb
        WHERE key = 'customer_payments'`
    );
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "db", "migrations", "046_billing_portal_dunning.sql"),
      "utf8"
    );
    await client.query(sql);
    await client.query(sql);
    const row = await client.query<{ value: Record<string, unknown> }>(
      `SELECT value FROM settings WHERE key = 'customer_payments'`
    );
    expect(row.rows[0].value).toMatchObject({ sendTrialReminders: false, trialReminderDays: 3 });
  });

  it("sends each trial, renewal and instalment reminder once, and only while switched on", async () => {
    const { sweepBillingReminders } = await import("../jobs/billingJobs");
    await settings.writeSetting("customer_payments", {
      sendTrialReminders: true,
      trialReminderDays: 3,
      sendUpcomingPaymentReminders: true,
      upcomingPaymentReminderDays: 3,
    });

    const trial = await member("remind-trial");
    await client.query(
      `UPDATE subscriptions SET status = 'trialing', trial_ends_at = now() + interval '2 days' WHERE id = $1`,
      [trial.subscriptionId]
    );
    const renew = await member("remind-renew");
    await client.query(
      `UPDATE subscriptions SET current_period_end = now() + interval '2 days' WHERE id = $1`,
      [renew.subscriptionId]
    );
    const plan = await client.query<{ id: number }>(
      `INSERT INTO payment_plans (member_id, offer_id, email, installment_cents, installment_count,
                                  installments_paid, status)
       VALUES ($1, $2, 'success+zz-d2-remind-plan@simulator.amazonses.com', 1250, 3, 1, 'active') RETURNING id`,
      [renew.memberId, renew.offerId]
    );
    await client.query(
      `INSERT INTO payment_plan_installments (payment_plan_id, sequence, amount_cents, due_at, status)
       VALUES ($1, 1, 1250, now() - interval '28 days', 'paid'),
              ($1, 2, 1250, now() + interval '2 days', 'scheduled'),
              ($1, 3, 1250, now() + interval '32 days', 'scheduled')`,
      [plan.rows[0].id]
    );

    // Everything else this suite created is 20 days out or more, so exactly these three.
    await expect(sweepBillingReminders()).resolves.toEqual({ trial: 1, upcoming: 1, instalments: 1 });
    await expect(sweepBillingReminders()).resolves.toEqual({ trial: 0, upcoming: 0, instalments: 0 });

    const sent = await client.query<{ to_email: string; topic: string }>(
      `SELECT to_email, topic FROM email_messages
        WHERE topic IN ('trial_ending','upcoming_payment') ORDER BY to_email`
    );
    expect(sent.rows).toEqual([
      { to_email: "success+zz-d2-remind-plan@simulator.amazonses.com", topic: "upcoming_payment" },
      { to_email: "success+zz-d2-remind-renew@simulator.amazonses.com", topic: "upcoming_payment" },
      { to_email: "success+zz-d2-remind-trial@simulator.amazonses.com", topic: "trial_ending" },
    ]);

    // Switched off: a new instalment coming due is left alone.
    await settings.writeSetting("customer_payments", { sendUpcomingPaymentReminders: false });
    await client.query(
      `UPDATE payment_plan_installments SET due_at = now() + interval '1 day'
        WHERE payment_plan_id = $1 AND sequence = 3`,
      [plan.rows[0].id]
    );
    await expect(sweepBillingReminders()).resolves.toMatchObject({ instalments: 0 });
  });

  it("makes a newly saved card the default everywhere and pays the overdue invoice with it", async () => {
    const m = await member("newcard");
    await client.query(
      `INSERT INTO invoices (stripe_invoice_id, subscription_id, member_id, status, amount_due_cents, next_retry_at)
       VALUES ('in_newcard', $1, $2, 'failed', 4700, now() + interval '2 days')`,
      [m.subscriptionId, m.memberId]
    );
    const s = stripeClient.stripe();
    vi.spyOn(s.setupIntents, "retrieve").mockResolvedValue({
      id: "seti_newcard",
      customer: "cus_newcard",
      status: "succeeded",
      payment_method: "pm_newcard",
      metadata: { memberId: String(m.memberId) },
    } as never);
    const customerUpdate = vi.spyOn(s.customers, "update").mockResolvedValue({} as never);
    const subUpdate = vi.spyOn(s.subscriptions, "update").mockResolvedValue({} as never);
    const pay = vi.spyOn(s.invoices, "pay").mockResolvedValue({ status: "paid" } as never);

    await expect(portal.adoptSavedCard(m.memberId, "seti_newcard")).resolves.toEqual({
      updated: 1,
      retried: 1,
      paid: 1,
    });
    expect(customerUpdate).toHaveBeenCalledWith(
      "cus_newcard",
      { invoice_settings: { default_payment_method: "pm_newcard" } },
      expect.any(Object)
    );
    expect(subUpdate).toHaveBeenCalledWith("sub_newcard", { default_payment_method: "pm_newcard" }, expect.any(Object));
    expect(pay).toHaveBeenCalledWith("in_newcard", { payment_method: "pm_newcard" }, expect.any(Object));
    const inv = await client.query(`SELECT dunning_outcome FROM invoices WHERE stripe_invoice_id = 'in_newcard'`);
    expect(inv.rows[0].dunning_outcome).toBe("paid");

    // Somebody else's SetupIntent is refused before anything is written.
    const other = await member("othercard");
    customerUpdate.mockClear();
    await expect(portal.adoptSavedCard(other.memberId, "seti_newcard")).rejects.toThrow("couldn't find that card update");
    expect(customerUpdate).not.toHaveBeenCalled();
  });
});
