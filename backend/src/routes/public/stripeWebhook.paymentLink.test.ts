import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";

/**
 * A payment made through a Stripe Payment Link from the Offers screen (QA row
 * 92) is fulfilled like a checkout: the completed session gets an order, and
 * that order is settled through `fulfillPayment` (mocked here — it is what
 * creates the member, the contact and the access grant).
 *
 * Driven through the real router and the real services/paymentLinks.ts; the
 * pool and the Stripe client are mocked, so nothing touches a database or the
 * live Stripe account.
 */

const { query, connect, constructEvent, fulfillPayment } = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_never_called";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_test_secret";
  return { query: vi.fn(), connect: vi.fn(), constructEvent: vi.fn(), fulfillPayment: vi.fn() };
});

vi.mock("../../db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../stripe/client", () => ({
  stripe: () => ({ webhooks: { constructEvent } }),
  STRIPE_API_VERSION: "2025-08-27.basil",
}));
vi.mock("../../services/fulfillment", () => ({
  fulfillPayment,
  createPaymentPlan: vi.fn(),
  recordRefund: vi.fn(),
}));
vi.mock("../../services/purchaseDelivery", () => ({
  deliverPurchase: vi.fn().mockResolvedValue({}),
  notifyOwnerOfSale: vi.fn(),
}));
vi.mock("../../automations/engine", () => ({ fireTriggerAsync: vi.fn() }));

import { stripeWebhookRouter } from "./stripeWebhook";

const ORDER_ID = 9001;
const SESSION_ID = "cs_test_plink_session";

interface Statement {
  sql: string;
  params: unknown[];
}
let statements: Statement[] = [];
/** Whether the order for the session has been written yet. */
let orderWritten = false;

function rows(data: unknown[]) {
  return { rows: data, rowCount: data.length };
}

function respond(sql: string, params: unknown[] = []) {
  statements.push({ sql, params });
  if (sql.includes("INSERT INTO stripe_events")) return rows([{ attempts: 0 }]);
  if (sql.includes("FROM offer_payment_links l")) {
    return rows([{ offer_id: 42, pricing_option_id: null, offer_title: "Practice Reset Intensive", option_label: null }]);
  }
  if (sql.includes("INSERT INTO orders")) {
    if (orderWritten) return rows([]);
    orderWritten = true;
    return rows([{ id: ORDER_ID }]);
  }
  if (sql.includes("FROM orders o") && orderWritten && params.includes(SESSION_ID)) {
    return rows([
      {
        id: ORDER_ID,
        offer_id: 42,
        member_id: null,
        email: "client@example.test",
        billing_name: "Pat Client",
        status: "pending",
        currency: "usd",
        subtotal_cents: 350000,
        discount_cents: 0,
        tax_cents: 0,
        total_cents: 350000,
        refunded_cents: 0,
        coupon_code: "",
        course_title: "",
        offer_title: "Practice Reset Intensive",
      },
    ]);
  }
  return rows([]);
}

const app = express();
app.use("/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }));
app.use(stripeWebhookRouter);
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function deliver(id: string, type: string, object: Record<string, unknown>): Promise<Response> {
  constructEvent.mockReturnValue({
    id,
    object: "event",
    api_version: "2025-08-27.basil",
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
  });
  return fetch(`${baseUrl}/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=stub" },
    body: JSON.stringify({ stub: true }),
  });
}

const completedSession = {
  id: SESSION_ID,
  object: "checkout.session",
  mode: "payment",
  payment_link: "plink_1",
  payment_status: "paid",
  payment_intent: "pi_plink_1",
  amount_subtotal: 350000,
  amount_total: 350000,
  currency: "usd",
  created: Math.floor(Date.now() / 1000),
  customer: "cus_plink",
  customer_details: { email: "client@example.test", name: "Pat Client", phone: null, address: null },
  total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
  metadata: { source: "payment_link", offerId: "42", offerSlug: "practice-reset-intensive", pricingOptionId: "" },
};

describe("stripe webhook: a Stripe Payment Link sale", () => {
  beforeEach(() => {
    statements = [];
    orderWritten = false;
    fulfillPayment.mockReset();
    query.mockImplementation((sql: string, params: unknown[]) => Promise.resolve(respond(sql, params)));
    connect.mockImplementation(() =>
      Promise.resolve({
        query: (sql: string, params: unknown[]) => Promise.resolve(respond(sql, params)),
        release: () => undefined,
      }),
    );
    fulfillPayment.mockResolvedValue({
      orderId: ORDER_ID,
      fulfilled: true,
      memberId: 77,
      createdMember: true,
      grantedProductIds: [10],
      transactionId: 1,
    });
  });

  it("writes the order for the session and settles it through fulfillPayment", async () => {
    const response = await deliver("evt_plink_completed", "checkout.session.completed", completedSession);
    expect(response.status).toBe(200);

    expect(statements.some((s) => s.sql.includes("INSERT INTO orders") && s.sql.includes("'payment_link'"))).toBe(true);
    expect(fulfillPayment).toHaveBeenCalledTimes(1);
    expect(fulfillPayment.mock.calls[0][0]).toMatchObject({
      orderId: ORDER_ID,
      paymentIntentId: "pi_plink_1",
      amountCents: 350000,
      email: "client@example.test",
      stripeCustomerId: "cus_plink",
    });
  });

  it("does not fulfil from a payment_intent.succeeded that arrives before the session", async () => {
    const response = await deliver("evt_plink_pi_first", "payment_intent.succeeded", {
      id: "pi_plink_1",
      object: "payment_intent",
      amount: 350000,
      amount_received: 350000,
      currency: "usd",
      created: Math.floor(Date.now() / 1000),
      customer: "cus_plink",
      latest_charge: "ch_plink",
      receipt_email: null,
      metadata: { source: "payment_link", offerSlug: "practice-reset-intensive" },
    });
    expect(response.status).toBe(200);
    expect(fulfillPayment).not.toHaveBeenCalled();
    expect(statements.some((s) => s.sql.includes("INSERT INTO orders"))).toBe(false);
  });

  it("waits on a session whose payment has not cleared, then settles on async success", async () => {
    const unpaid = { ...completedSession, payment_status: "unpaid" };
    expect((await deliver("evt_plink_unpaid", "checkout.session.completed", unpaid)).status).toBe(200);
    expect(fulfillPayment).not.toHaveBeenCalled();

    const cleared = await deliver("evt_plink_async_ok", "checkout.session.async_payment_succeeded", completedSession);
    expect(cleared.status).toBe(200);
    expect(fulfillPayment).toHaveBeenCalledTimes(1);
    expect(fulfillPayment.mock.calls[0][0]).toMatchObject({ orderId: ORDER_ID });
  });

  it("leaves sessions from the site's own checkout untouched", async () => {
    const ours = { ...completedSession, payment_link: null, metadata: {} };
    expect((await deliver("evt_not_plink", "checkout.session.completed", ours)).status).toBe(200);
    expect(statements.some((s) => s.sql.includes("offer_payment_links"))).toBe(false);
    expect(statements.some((s) => s.sql.includes("INSERT INTO orders"))).toBe(false);
  });
});
