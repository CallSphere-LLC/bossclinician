import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember } from "../testing/db";

/**
 * Lane 4 — the payment-failed email quotes the retry this site has booked.
 *
 * With "this site, on a schedule" the owner switches Stripe's own retries off,
 * so Stripe's `next_payment_attempt` arrives empty. The webhook worked out the
 * site's retry date and then emailed Stripe's empty one, which reads as "this
 * was the last automatic attempt" to somebody whose card will be tried again in
 * three days.
 *
 * Stripe is never reached (fake key; nothing in this path calls it) and the
 * mailer is replaced, so no message leaves the process. Recipients are the SES
 * mailbox simulator.
 */

const sent: Array<{ to: string; subject: string; text: string }> = [];

vi.mock("../email/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../email/mailer")>();
  return {
    ...actual,
    sendMail: vi.fn(async (input: { to: string; subject: string; text: string }) => {
      sent.push({ to: input.to, subject: input.subject, text: input.text });
      return { messageId: null, sent: true, providerMessageId: "", error: "" };
    }),
  };
});

const describeDb = hasTestDatabase ? describe : describe.skip;
const WEBHOOK_SECRET = "whsec_lane4_dunning_email";

describeDb("payment-failed email and the site's own retry schedule (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let pool: typeof import("../db/pool").pool;
  let stripeClient: typeof import("../stripe/client");
  let settings: typeof import("./settings");
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("lane4dunmail");
    client = db.client;

    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_integration_never_called";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    delete process.env.NOTIFY_EMAIL;

    const webhook = await import("../routes/public/stripeWebhook");
    pool = (await import("../db/pool")).pool;
    stripeClient = await import("../stripe/client");
    settings = await import("./settings");

    const app = express();
    app.use("/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }));
    app.use(webhook.stripeWebhookRouter);
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterEach(async () => {
    sent.length = 0;
    await settings.writeSetting("failed_payments", { retryMode: "stripe" });
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

  async function subscriber(label: string, email: string): Promise<void> {
    const memberId = await insertMember(client, email, { name: `ZZ Lane4 ${label}` });
    await client.query(
      `INSERT INTO subscriptions (member_id, email, stripe_customer_id, stripe_subscription_id,
                                  status, amount_cents, current_period_end)
       VALUES ($1, $2, $3, $4, 'active', 4700, now() + interval '20 days')`,
      [memberId, email, `cus_${label}`, `sub_${label}`]
    );
  }

  function failedInvoice(label: string, email: string, nextPaymentAttempt: number | null) {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: `in_${label}`,
      object: "invoice",
      customer: `cus_${label}`,
      customer_email: email,
      number: `INV-${label}`,
      currency: "usd",
      amount_due: 4700,
      amount_paid: 0,
      attempt_count: 1,
      status: "open",
      hosted_invoice_url: "https://invoice.test/pay",
      invoice_pdf: "",
      created: now,
      period_start: now,
      period_end: now + 2_592_000,
      next_payment_attempt: nextPaymentAttempt,
      status_transitions: { paid_at: null },
      total_taxes: [],
      payments: { data: [] },
      parent: {
        subscription_details: { subscription: `sub_${label}`, metadata: { pricingType: "subscription" } },
      },
    };
  }

  /** The email is sent without being awaited by the handler. */
  async function emailTo(email: string) {
    for (let i = 0; i < 50 && !sent.some((m) => m.to === email); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return sent.find((m) => m.to === email);
  }

  const RETRY_DATE = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  it("quotes the site's booked retry date when this site is retrying", async () => {
    const email = "success+lane4-sched@simulator.amazonses.com";
    await subscriber("lane4sched", email);
    await settings.writeSetting("failed_payments", { retryMode: "schedule", retryDays: "3, 5, 7" });

    // Stripe's retries are off in this mode, so it sends no next attempt.
    expect(await deliver("invoice.payment_failed", failedInvoice("lane4sched", email, null))).toBe(200);

    const booked = await client.query<{ next_retry_at: Date }>(
      `SELECT next_retry_at FROM invoices WHERE stripe_invoice_id = 'in_lane4sched'`
    );
    const message = await emailTo(email);
    expect(message).toBeDefined();
    expect(message!.text).toContain(`We'll try again on ${RETRY_DATE(booked.rows[0].next_retry_at)}`);
    expect(message!.text).not.toContain("This was the last automatic attempt");
  });

  it("still quotes Stripe's date when Stripe is the one retrying", async () => {
    const email = "success+lane4-stripe@simulator.amazonses.com";
    await subscriber("lane4stripe", email);
    const nextAttempt = new Date(Date.now() + 4 * 86_400_000);

    expect(
      await deliver(
        "invoice.payment_failed",
        failedInvoice("lane4stripe", email, Math.floor(nextAttempt.getTime() / 1000))
      )
    ).toBe(200);

    const message = await emailTo(email);
    expect(message).toBeDefined();
    expect(message!.text).toContain(`We'll try again on ${RETRY_DATE(nextAttempt)}`);
  });
});
