import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";

/**
 * The coupon a declined card gave back.
 *
 * `createPendingOrder` claims a `coupon_redemptions` row before the buyer
 * reaches Stripe, and `payment_intent.payment_failed` releases it so a shopper
 * retrying with another card is not told the code is used up. The order itself
 * survives that decline — the Payment Element confirms the same PaymentIntent —
 * so the successful retry settles an order whose redemption is still released,
 * and `validateCoupon` counts only unreleased rows.
 *
 * Driven through the real router so the assertion is about what the handler
 * actually sends to Postgres. The pool and the Stripe client are mocked, so
 * nothing here touches a database or the account the key in .env belongs to.
 */

const { query, connect, constructEvent, fulfillPayment } = vi.hoisted(() => {
  // config/env reads process.env when it is first imported, and `stripeEnabled`
  // gates the receiver on the key being present. The Stripe client is mocked, so
  // neither value ever reaches Stripe.
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_never_called";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit_test_secret";
  return {
    query: vi.fn(),
    connect: vi.fn(),
    constructEvent: vi.fn(),
    fulfillPayment: vi.fn(),
  };
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

const ORDER_ID = 7701;

interface Statement {
  sql: string;
  params: unknown[];
}

let statements: Statement[] = [];

/** One responder for both `pool.query` and the client a transaction checks out. */
function respond(sql: string, params: unknown[] = []): { rows: unknown[]; rowCount: number } {
  statements.push({ sql, params });

  if (sql.includes("INSERT INTO stripe_events")) return rows([{ attempts: 0 }]);
  if (sql.includes("UPDATE stripe_events")) return rows([]);
  if (sql.includes("FROM orders o")) {
    return rows([
      {
        id: ORDER_ID,
        offer_id: 12,
        member_id: 34,
        email: "buyer@example.test",
        billing_name: "A Buyer",
        status: "failed",
        currency: "usd",
        subtotal_cents: 20000,
        discount_cents: 10000,
        tax_cents: 0,
        total_cents: 10000,
        refunded_cents: 0,
        coupon_code: "LAUNCH50",
        course_title: "Signature Program",
        offer_title: "Signature Program",
      },
    ]);
  }
  if (sql.includes("UPDATE coupon_redemptions")) return releasedRows;
  return rows([]);
}

function rows(data: unknown[]): { rows: unknown[]; rowCount: number } {
  return { rows: data, rowCount: data.length };
}

/** What the reclaim's UPDATE ... RETURNING finds; empty means nothing was released. */
let releasedRows = rows([{ coupon_id: 55 }]);

let baseUrl = "";

const app = express();
app.use("/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }));
app.use(stripeWebhookRouter);
const server = app.listen(0);
baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function deliverPaymentSucceeded(eventId: string): Promise<Response> {
  constructEvent.mockReturnValue({
    id: eventId,
    object: "event",
    api_version: "2025-08-27.basil",
    created: Math.floor(Date.now() / 1000),
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_retry_after_decline",
        object: "payment_intent",
        amount: 10000,
        amount_received: 10000,
        currency: "usd",
        created: Math.floor(Date.now() / 1000),
        customer: "cus_test",
        latest_charge: "ch_retry",
        receipt_email: "buyer@example.test",
        metadata: { orderId: String(ORDER_ID) },
      },
    },
  });
  return fetch(`${baseUrl}/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=stub" },
    body: JSON.stringify({ stub: true }),
  });
}

function reclaimStatement(): Statement | undefined {
  return statements.find((s) => s.sql.includes("UPDATE coupon_redemptions"));
}

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("stripe webhook: a settled payment takes its coupon use back", () => {
  beforeEach(() => {
    statements = [];
    releasedRows = rows([{ coupon_id: 55 }]);
    query.mockImplementation((sql: string, params: unknown[]) => Promise.resolve(respond(sql, params)));
    connect.mockImplementation(() =>
      Promise.resolve({
        query: (sql: string, params: unknown[]) => Promise.resolve(respond(sql, params)),
        release: () => undefined,
      })
    );
    fulfillPayment.mockResolvedValue({
      orderId: ORDER_ID,
      fulfilled: true,
      memberId: 34,
      createdMember: false,
      grantedProductIds: [9],
    });
  });

  it("un-releases the redemption the decline gave back and recomputes the cap", async () => {
    const response = await deliverPaymentSucceeded("evt_reclaim_1");
    expect(response.status).toBe(200);

    const reclaim = reclaimStatement();
    expect(reclaim).toBeDefined();
    expect(reclaim?.sql).toContain("released_at = NULL");
    expect(reclaim?.sql).toContain("released_at IS NOT NULL");
    expect(reclaim?.params).toEqual([ORDER_ID]);

    // The counter the admin list reads is recomputed from the ledger for the
    // coupon the released row belonged to, exactly as claimRedemption does.
    const recompute = statements.find((s) => s.sql.includes("UPDATE coupons SET redeemed"));
    expect(recompute?.params).toEqual([55]);

    // ...and it committed, rather than being left open on the pool.
    expect(statements.some((s) => s.sql === "COMMIT")).toBe(true);
  });

  it("leaves an order that never released a redemption alone", async () => {
    releasedRows = rows([]);

    const response = await deliverPaymentSucceeded("evt_reclaim_2");
    expect(response.status).toBe(200);

    expect(reclaimStatement()).toBeDefined();
    expect(statements.some((s) => s.sql.includes("UPDATE coupons SET redeemed"))).toBe(false);
  });

  it("still reclaims when this delivery found the order already fulfilled", async () => {
    // The delivery that settled the order can die between `fulfillPayment`'s
    // commit and the reclaim. Gating on `fulfilled` would make that permanent,
    // because the retry reports nothing done.
    fulfillPayment.mockResolvedValue({
      orderId: ORDER_ID,
      fulfilled: false,
      memberId: 34,
      createdMember: false,
      grantedProductIds: [],
    });

    const response = await deliverPaymentSucceeded("evt_reclaim_3");
    expect(response.status).toBe(200);

    expect(reclaimStatement()?.params).toEqual([ORDER_ID]);
    expect(statements.find((s) => s.sql.includes("UPDATE coupons SET redeemed"))?.params).toEqual([55]);
  });
});
