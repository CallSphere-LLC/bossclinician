import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { Client } from "pg";
import type { AddressInfo } from "net";
import {
  createTestDatabase,
  hasTestDatabase,
  insertCourseProduct,
  insertMember,
  insertOffer,
  insertOrder,
} from "../../testing/db";

/**
 * Integration tests for the two properties of the webhook receiver that only
 * exist in the presence of a database and a clock: that one event is processed
 * once even when Stripe delivers it twice at once, and that access ends up tied
 * to the subscription paying for it whichever order the events arrive in.
 *
 * Both failures are invisible to a unit test. They need a real row lock, a real
 * unique index and two handlers actually overlapping — which is why the whole
 * event is driven through the real router over HTTP, with a real signature,
 * rather than by calling the handlers directly.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

const WEBHOOK_SECRET = "whsec_integration_test_secret";

describeDb("stripe webhook (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let pool: typeof import("../../db/pool").pool;
  let stripeClient: typeof import("../../stripe/client");
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("webhook");
    client = db.client;

    // Every module below reads process.env at import time through config/env, so
    // the environment has to be complete before the first dynamic import. The
    // secret key is never used to call Stripe — the only SDK call this route
    // makes is signature verification, which is local HMAC — but `stripeEnabled`
    // gates the endpoint on its presence.
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_integration_never_called";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    delete process.env.NOTIFY_EMAIL;

    const webhook = await import("./stripeWebhook");
    pool = (await import("../../db/pool")).pool;
    stripeClient = await import("../../stripe/client");

    const app = express();
    // Mirrors app.ts: Stripe signs the exact bytes it sent, so this path gets the
    // raw body and never sees express.json().
    app.use("/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }));
    app.use(webhook.stripeWebhookRouter);
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end().catch(() => undefined);
    await db.drop();
  });

  /** Posts an event the way Stripe would, signature and all. */
  async function deliver(event: Record<string, unknown>): Promise<Response> {
    const payload = JSON.stringify(event);
    const signature = stripeClient.stripe().webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    return fetch(`${baseUrl}/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    });
  }

  function envelope(id: string, type: string, object: Record<string, unknown>) {
    return {
      id,
      object: "event",
      api_version: stripeClient.STRIPE_API_VERSION,
      created: Math.floor(Date.now() / 1000),
      type,
      data: { object },
    };
  }

  async function waitUntil(predicate: () => Promise<boolean>, label: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  /**
   * An order that has been paid for and delivered, which is what a refund needs
   * to have something to take back.
   */
  async function paidOrderWithGrant(label: string): Promise<{
    orderId: number;
    memberId: number;
    productId: number;
  }> {
    const email = `${label}@example.test`;
    const memberId = await insertMember(client, email);
    const { productId } = await insertCourseProduct(client, label);
    const offerId = await insertOffer(client, `offer-${label}`, [productId]);
    const orderId = await insertOrder(client, { offerId, email, totalCents: 5000, memberId });

    await client.query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [orderId]);
    await client.query(
      `INSERT INTO transactions
         (order_id, member_id, email, kind, status, amount_cents, currency,
          stripe_payment_intent_id, stripe_charge_id)
       VALUES ($1, $2, $3, 'payment', 'succeeded', 5000, 'usd', $4, $5)`,
      [orderId, memberId, email, `pi_${label}`, `ch_${label}`]
    );
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, offer_id, order_id, source, status)
       VALUES ($1, $2, $3, $4, 'purchase', 'active')`,
      [memberId, productId, offerId, orderId]
    );

    return { orderId, memberId, productId };
  }

  /** A partial refund, in the shape Stripe sends it: no itemised refund list. */
  function partialRefund(label: string) {
    return {
      id: `ch_${label}`,
      object: "charge",
      payment_intent: `pi_${label}`,
      amount: 5000,
      amount_refunded: 2500,
      currency: "usd",
    };
  }

  async function orderRow(orderId: number): Promise<{ status: string; refunded_cents: number }> {
    const res = await client.query<{ status: string; refunded_cents: number }>(
      `SELECT status, refunded_cents FROM orders WHERE id = $1`,
      [orderId]
    );
    return res.rows[0];
  }

  async function refundCount(orderId: number): Promise<number> {
    const res = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM refunds WHERE order_id = $1`,
      [orderId]
    );
    return Number(res.rows[0].count);
  }

  async function grantsOf(orderId: number): Promise<{ status: string; subscription_id: number | null }[]> {
    const res = await client.query<{ status: string; subscription_id: number | null }>(
      `SELECT status, subscription_id FROM access_grants WHERE order_id = $1 ORDER BY id`,
      [orderId]
    );
    return res.rows;
  }

  it("refuses a second delivery while the first is still in the handler", async () => {
    const { orderId } = await paidOrderWithGrant("serial");

    // Holds the order row so the first delivery blocks inside recordRefund, which
    // is the state Stripe's ~10s timeout retry actually arrives in.
    const locker = new Client({ connectionString: db.url });
    await locker.connect();
    await locker.query("BEGIN");
    await locker.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);

    const first = deliver(envelope("evt_serial", "charge.refunded", partialRefund("serial")));

    await waitUntil(async () => {
      const res = await client.query<{ status: string }>(
        `SELECT status FROM stripe_events WHERE id = 'evt_serial'`
      );
      return res.rows[0]?.status === "processing";
    }, "the first delivery to claim the event");

    // Same event id, delivered while the first one is mid-handler.
    const second = await deliver(envelope("evt_serial", "charge.refunded", partialRefund("serial")));
    expect(second.status).toBe(409);

    await locker.query("COMMIT");
    await locker.end();

    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);

    // One delivery's worth of money, and a partial refund that stayed partial.
    expect(await refundCount(orderId)).toBe(1);
    const order = await orderRow(orderId);
    expect(order.refunded_cents).toBe(2500);
    expect(order.status).toBe("paid");
    expect((await grantsOf(orderId))[0].status).toBe("active");

    const event = await client.query<{ status: string }>(
      `SELECT status FROM stripe_events WHERE id = 'evt_serial'`
    );
    expect(event.rows[0].status).toBe("processed");
  });

  it("takes over a claim whose delivery died holding it", async () => {
    const { orderId } = await paidOrderWithGrant("stale");

    // A process killed mid-handler leaves its claim behind. Nothing releases it,
    // so the only thing that can is the next delivery finding it too old to be
    // anybody's live work — without which Stripe's retries would 409 for three
    // days and the event would be abandoned unprocessed.
    await client.query(
      `INSERT INTO stripe_events (id, type, payload, status, claimed_at)
       VALUES ('evt_stale', 'charge.refunded', '{}'::jsonb, 'processing', now() - INTERVAL '1 hour')`
    );

    const response = await deliver(
      envelope("evt_stale", "charge.refunded", partialRefund("stale"))
    );
    expect(response.status).toBe(200);

    expect((await orderRow(orderId)).refunded_cents).toBe(2500);
    const event = await client.query<{ status: string }>(
      `SELECT status FROM stripe_events WHERE id = 'evt_stale'`
    );
    expect(event.rows[0].status).toBe("processed");
  });

  it("counts an unitemised refund once even when two handlers overlap", async () => {
    const { orderId } = await paidOrderWithGrant("overlap");

    // Two DIFFERENT event ids carrying the same refund: the event-level claim
    // cannot help here, which is the point. This is what a stale-claim takeover
    // or a hand-replayed event looks like, and what the unique key has to catch.
    const locker = new Client({ connectionString: db.url });
    await locker.connect();
    await locker.query("BEGIN");
    await locker.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);

    const first = deliver(envelope("evt_overlap_a", "charge.refunded", partialRefund("overlap")));
    await waitUntil(async () => {
      const res = await client.query<{ status: string }>(
        `SELECT status FROM stripe_events WHERE id = 'evt_overlap_a'`
      );
      return res.rows[0]?.status === "processing";
    }, "the first delivery to claim its event");

    const second = deliver(envelope("evt_overlap_b", "charge.refunded", partialRefund("overlap")));
    await waitUntil(async () => {
      const res = await client.query<{ status: string }>(
        `SELECT status FROM stripe_events WHERE id = 'evt_overlap_b'`
      );
      return res.rows[0]?.status === "processing";
    }, "the second delivery to claim its event");

    await locker.query("COMMIT");
    await locker.end();

    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);

    expect(await refundCount(orderId)).toBe(1);
    const order = await orderRow(orderId);
    expect(order.refunded_cents).toBe(2500);
    // Double counting would have made this 'refunded' and taken the course back.
    expect(order.status).toBe("paid");
    expect((await grantsOf(orderId))[0].status).toBe("active");
  });

  it("sends one dunning email per decline, not one per delivery", async () => {
    const email = "dunning@example.test";
    const memberId = await insertMember(client, email);
    const { productId } = await insertCourseProduct(client, "dunning");
    const offerId = await insertOffer(client, "offer-dunning", [productId]);
    const orderId = await insertOrder(client, { offerId, email, totalCents: 5000, memberId });

    const invoice = (attemptCount: number) => ({
      id: "in_dunning",
      object: "invoice",
      customer: "cus_dunning",
      customer_email: email,
      number: "INV-DUNNING",
      currency: "usd",
      amount_due: 5000,
      amount_paid: 0,
      attempt_count: attemptCount,
      status: "open",
      hosted_invoice_url: "https://invoice.test/pay",
      invoice_pdf: "",
      created: Math.floor(Date.now() / 1000),
      total_taxes: [],
      payments: { data: [] },
      parent: {
        subscription_details: {
          subscription: "sub_dunning",
          metadata: { orderId: String(orderId), pricingType: "subscription" },
        },
      },
    });

    expect(
      (await deliver(envelope("evt_dun_1", "invoice.payment_failed", invoice(1)))).status
    ).toBe(200);
    // A different event carrying the same attempt: a redelivery, not a decline.
    expect(
      (await deliver(envelope("evt_dun_1_again", "invoice.payment_failed", invoice(1)))).status
    ).toBe(200);
    // Stripe's second attempt on the same invoice: a real decline, and dunning
    // has to reach the customer again.
    expect(
      (await deliver(envelope("evt_dun_2", "invoice.payment_failed", invoice(2)))).status
    ).toBe(200);

    const recorded = await client.query<{ attempt_count: number; status: string }>(
      `SELECT attempt_count, status FROM invoices WHERE stripe_invoice_id = 'in_dunning'`
    );
    expect(recorded.rows[0].attempt_count).toBe(2);
    expect(recorded.rows[0].status).toBe("failed");
  });

  /**
   * The invoice and subscription payloads for one membership purchase. Stripe
   * guarantees nothing about which of the two events arrives first, so both
   * orderings are run against identical fixtures.
   */
  function membershipEvents(label: string, orderId: number, email: string) {
    const now = Math.floor(Date.now() / 1000);
    const subscriptionId = `sub_${label}`;
    const metadata = { orderId: String(orderId), pricingType: "subscription" };

    return {
      subscriptionId,
      invoicePaid: {
        id: `in_${label}`,
        object: "invoice",
        customer: `cus_${label}`,
        customer_email: email,
        number: `INV-${label}`,
        currency: "usd",
        amount_due: 5000,
        amount_paid: 5000,
        attempt_count: 1,
        status: "paid",
        hosted_invoice_url: "",
        invoice_pdf: "",
        created: now,
        period_start: now,
        period_end: now + 2_592_000,
        status_transitions: { paid_at: now },
        total_taxes: [],
        payments: { data: [] },
        parent: { subscription_details: { subscription: subscriptionId, metadata } },
      },
      subscriptionActive: {
        id: subscriptionId,
        object: "subscription",
        customer: `cus_${label}`,
        status: "active",
        currency: "usd",
        cancel_at_period_end: false,
        created: now,
        metadata,
        items: {
          data: [
            {
              current_period_start: now,
              current_period_end: now + 2_592_000,
              price: { unit_amount: 5000, recurring: { interval: "month", interval_count: 1 } },
            },
          ],
        },
      },
      // Cancelled after the period it had already paid for, so access ends now
      // rather than being clipped to a future date.
      subscriptionDeleted: {
        id: subscriptionId,
        object: "subscription",
        customer: `cus_${label}`,
        status: "canceled",
        currency: "usd",
        cancel_at_period_end: false,
        created: now - 5_184_000,
        canceled_at: now,
        ended_at: now,
        metadata,
        items: {
          data: [
            {
              current_period_start: now - 5_184_000,
              current_period_end: now - 60,
              price: { unit_amount: 5000, recurring: { interval: "month", interval_count: 1 } },
            },
          ],
        },
      },
    };
  }

  async function membershipFixture(label: string): Promise<{ orderId: number; email: string }> {
    const email = `${label}@example.test`;
    const memberId = await insertMember(client, email);
    const { productId } = await insertCourseProduct(client, label);
    const offerId = await insertOffer(client, `offer-${label}`, [productId]);
    const orderId = await insertOrder(client, { offerId, email, totalCents: 5000, memberId });
    return { orderId, email };
  }

  it("links access to the subscription when invoice.paid arrives first", async () => {
    const { orderId, email } = await membershipFixture("firstinvoice");
    const events = membershipEvents("firstinvoice", orderId, email);

    expect((await deliver(envelope("evt_fi_1", "invoice.paid", events.invoicePaid))).status).toBe(
      200
    );

    // The subscription does not exist locally yet, so the grant cannot be linked
    // as it is written. Nothing is wrong at this point — it is the next event's
    // job to finish the job.
    const beforeSubscription = await grantsOf(orderId);
    expect(beforeSubscription).toHaveLength(1);
    expect(beforeSubscription[0].subscription_id).toBeNull();

    expect(
      (await deliver(envelope("evt_fi_2", "customer.subscription.created", events.subscriptionActive)))
        .status
    ).toBe(200);

    const linked = await grantsOf(orderId);
    expect(linked[0].subscription_id).not.toBeNull();

    expect(
      (await deliver(envelope("evt_fi_3", "customer.subscription.deleted", events.subscriptionDeleted)))
        .status
    ).toBe(200);

    const afterCancel = await grantsOf(orderId);
    expect(afterCancel[0].status).toBe("revoked");
  });

  it("links access to the subscription when the subscription arrives first", async () => {
    const { orderId, email } = await membershipFixture("firstsub");
    const events = membershipEvents("firstsub", orderId, email);

    expect(
      (await deliver(envelope("evt_fs_1", "customer.subscription.created", events.subscriptionActive)))
        .status
    ).toBe(200);
    expect((await deliver(envelope("evt_fs_2", "invoice.paid", events.invoicePaid))).status).toBe(
      200
    );

    const linked = await grantsOf(orderId);
    expect(linked).toHaveLength(1);
    expect(linked[0].subscription_id).not.toBeNull();

    expect(
      (await deliver(envelope("evt_fs_3", "customer.subscription.deleted", events.subscriptionDeleted)))
        .status
    ).toBe(200);

    const afterCancel = await grantsOf(orderId);
    expect(afterCancel[0].status).toBe("revoked");
  });

  it("leaves another order's access alone when a subscription is cancelled", async () => {
    const { orderId, email } = await membershipFixture("bystander");
    const events = membershipEvents("bystander", orderId, email);

    // A separate outright purchase by the same member, of a different product.
    const { productId: otherProductId } = await insertCourseProduct(client, "bystanderextra");
    const otherOfferId = await insertOffer(client, "offer-bystanderextra", [otherProductId]);
    const otherOrderId = await insertOrder(client, {
      offerId: otherOfferId,
      email,
      totalCents: 9900,
    });
    const memberRes = await client.query<{ id: number }>(
      `SELECT id FROM members WHERE email = $1`,
      [email]
    );
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, offer_id, order_id, source, status)
       VALUES ($1, $2, $3, $4, 'purchase', 'active')`,
      [memberRes.rows[0].id, otherProductId, otherOfferId, otherOrderId]
    );

    await deliver(envelope("evt_by_1", "invoice.paid", events.invoicePaid));
    await deliver(envelope("evt_by_2", "customer.subscription.created", events.subscriptionActive));
    await deliver(envelope("evt_by_3", "customer.subscription.deleted", events.subscriptionDeleted));

    const bystander = await grantsOf(otherOrderId);
    expect(bystander[0].subscription_id).toBeNull();
    expect(bystander[0].status).toBe("active");
  });

  /* ------------------------------------------------------- payment plans */

  /** A 2 x $1,250 plan, its order still pending, and its opening invoice. */
  async function planFixture(label: string) {
    const now = Math.floor(Date.now() / 1000);
    const email = `${label}@example.test`;
    const memberId = await insertMember(client, email);
    const { productId } = await insertCourseProduct(client, label);
    const offerId = await insertOffer(client, `offer-${label}`, [productId], {
      amountCents: 125_000,
    });
    await client.query(
      `UPDATE offers
          SET pricing_type = 'payment_plan', interval = 'month', interval_count = 1,
              installment_count = 2
        WHERE id = $1`,
      [offerId]
    );
    const orderId = await insertOrder(client, {
      offerId,
      email,
      totalCents: 125_000,
      memberId,
    });

    const metadata = { orderId: String(orderId), pricingType: "payment_plan" };
    return {
      orderId,
      invoiceId: `in_${label}`,
      openingInvoice: {
        id: `in_${label}`,
        object: "invoice",
        customer: `cus_${label}`,
        customer_email: email,
        number: `INV-${label}`,
        currency: "usd",
        amount_due: 125_000,
        amount_paid: 125_000,
        attempt_count: 1,
        status: "paid",
        hosted_invoice_url: "",
        invoice_pdf: "",
        created: now,
        period_start: now,
        period_end: now + 2_592_000,
        status_transitions: { paid_at: now },
        total_taxes: [],
        payments: { data: [] },
        parent: {
          subscription_details: { subscription: `sub_${label}`, metadata },
        },
      },
    };
  }

  async function planState(orderId: number): Promise<{
    installmentsPaid: number;
    status: string;
    installments: { sequence: number; status: string; stripe_invoice_id: string | null }[];
  } | null> {
    const plan = await client.query<{ id: number; installments_paid: number; status: string }>(
      `SELECT id, installments_paid, status FROM payment_plans WHERE order_id = $1`,
      [orderId]
    );
    const row = plan.rows[0];
    if (!row) return null;
    const installments = await client.query<{
      sequence: number;
      status: string;
      stripe_invoice_id: string | null;
    }>(
      `SELECT sequence, status, stripe_invoice_id FROM payment_plan_installments
        WHERE payment_plan_id = $1 ORDER BY sequence`,
      [row.id]
    );
    return {
      installmentsPaid: row.installments_paid,
      status: row.status,
      installments: installments.rows,
    };
  }

  it("does not credit a second installment when the opening invoice is re-delivered", async () => {
    const plan = await planFixture("planreplay");

    expect(
      (await deliver(envelope("evt_pr_1", "invoice.paid", plan.openingInvoice))).status
    ).toBe(200);

    const opened = await planState(plan.orderId);
    expect(opened?.installmentsPaid).toBe(1);
    // The opening invoice is stamped on installment one. Without it,
    // `advancePaymentPlan` cannot tell a replay of the opening charge from the
    // arrival of the second one, and credits a payment nobody made.
    expect(opened?.installments[0].stripe_invoice_id).toBe(plan.invoiceId);
    expect(opened?.installments[1].status).toBe("scheduled");

    const settled = await client.query<{ settled_at: Date | null }>(
      `SELECT settled_at FROM invoices WHERE stripe_invoice_id = $1`,
      [plan.invoiceId]
    );
    expect(settled.rows[0].settled_at).not.toBeNull();

    // Exactly what a handler that threw after opening the plan leaves behind:
    // the event goes back to 'failed' and Stripe redelivers it.
    await client.query(`UPDATE stripe_events SET status = 'failed' WHERE id = 'evt_pr_1'`);
    expect(
      (await deliver(envelope("evt_pr_1", "invoice.paid", plan.openingInvoice))).status
    ).toBe(200);

    const afterReplay = await planState(plan.orderId);
    expect(afterReplay?.installmentsPaid).toBe(1);
    expect(afterReplay?.status).toBe("active");
    expect(afterReplay?.installments[1].status).toBe("scheduled");
  });

  it("opens the plan on a retry that finds the order already paid", async () => {
    const plan = await planFixture("planretry");

    // The state a first delivery leaves when it commits the fulfilment and then
    // throws: the order is paid, and no plan was ever created.
    await client.query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [plan.orderId]);

    expect(
      (await deliver(envelope("evt_prt_1", "invoice.paid", plan.openingInvoice))).status
    ).toBe(200);

    const recovered = await planState(plan.orderId);
    expect(recovered).not.toBeNull();
    expect(recovered?.installmentsPaid).toBe(1);
    expect(recovered?.installments).toHaveLength(2);
    expect(recovered?.installments[1].status).toBe("scheduled");
  });
});
