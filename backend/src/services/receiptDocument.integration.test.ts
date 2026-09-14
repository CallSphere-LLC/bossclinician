import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase, insertMember } from "../testing/db";

/**
 * Integration tests for the receipt a one-off purchase produces.
 *
 * The bug these cover was not a rendering bug: `invoices` was written by the
 * Stripe subscription webhook and by nothing else, so a member who bought a
 * course outright had an order, a charge, access — and no receipt document
 * anywhere. Both member screens said so out loud, and the admin invoice list
 * reported "0 invoices" on an account that had made sales.
 *
 * None of that is observable without a database: what is being tested is which
 * rows exist after a purchase and what the document built from them says.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

/** A valid 1x1 PNG, small enough to inline and real enough for pdfkit to draw. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Where the receipt logo is read from, pointed at scratch before config loads. */
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-receipt-uploads-"));

describeDb("receipts for one-off orders (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let receipts: typeof import("./receiptDocument");

  /** A published offer, so the receipt has something to name. */
  async function insertOffer(slug: string, amountCents: number): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO offers (title, slug, status, pricing_type, amount_cents)
       VALUES ($1, $2, 'published', 'one_time', $3) RETURNING id`,
      [`ZZ Test — ${slug}`, slug, amountCents]
    );
    return res.rows[0].id;
  }

  /** An order as the offer checkout writes one, with its single line item. */
  async function insertOrder(input: {
    offerId: number;
    memberId: number;
    email: string;
    subtotalCents: number;
    discountCents: number;
    couponCode?: string;
    status?: string;
    title?: string;
  }): Promise<number> {
    const total = input.subtotalCents - input.discountCents;
    const res = await client.query<{ id: number }>(
      `INSERT INTO orders (offer_id, member_id, email, status, subtotal_cents, discount_cents,
                           tax_cents, total_cents, amount_cents, coupon_code, currency,
                           billing_name, billing_address, source, stripe_session_id)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7, $8, 'usd', 'Madhav Shankaran',
               '{"line1":"1 Test Way","city":"Las Vegas","state":"NV","postalCode":"89107"}'::jsonb,
               'checkout', $9)
       RETURNING id`,
      [
        input.offerId,
        input.memberId,
        input.email,
        input.status ?? "paid",
        input.subtotalCents,
        input.discountCents,
        total,
        input.couponCode ?? "",
        `cs_test_${input.offerId}_${input.email}`,
      ]
    );
    const orderId = res.rows[0].id;
    await client.query(
      `INSERT INTO order_items (order_id, title, kind, quantity, unit_cents, amount_cents)
       VALUES ($1, $2, 'offer', 1, $3, $3)`,
      [orderId, input.title ?? "ZZ Test — checkout probe", input.subtotalCents]
    );
    return orderId;
  }

  beforeAll(async () => {
    db = await createTestDatabase("receipts");
    client = db.client;

    // The seller's own details, as the settings form writes them — including the
    // tax number, whose help text has always promised it prints on receipts.
    await client.query(
      `INSERT INTO settings (key, value) VALUES
         ('business', $1::jsonb),
         ('customer_payments', $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [
        JSON.stringify({
          name: "Boss Clinician LLC",
          email: "support@bossclinician.com",
          taxId: "88-1691637",
          address: "848 N Rainbow Blvd\n451\nLas Vegas, NV 89107",
        }),
        JSON.stringify({
          receiptTitle: "Receipt",
          refundPolicy: "Refunds within 14 days, no questions asked.",
        }),
      ]
    );

    // The module reads DATABASE_URL at import time through config/env, so the
    // environment has to be pointed at the scratch database before it loads.
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.UPLOAD_DIR = uploadDir;
    process.env.PROTECTED_UPLOAD_DIR = `${uploadDir}-protected`;
    receipts = await import("./receiptDocument");
  }, 60_000);

  afterAll(async () => {
    const { pool } = await import("../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  it("issues a receipt for a paid order, once however often it is asked", async () => {
    const memberId = await insertMember(client, "receipt-basic@test.invalid");
    const offerId = await insertOffer("receipt-basic", 4900);
    const orderId = await insertOrder({
      offerId,
      memberId,
      email: "receipt-basic@test.invalid",
      subtotalCents: 4900,
      discountCents: 0,
    });

    const first = await receipts.ensureOrderReceipt(orderId);
    const again = await receipts.ensureOrderReceipt(orderId);

    expect(first).not.toBeNull();
    expect(again).toBe(first);

    const rows = await client.query(
      `SELECT origin, status, number, amount_paid_cents, order_id, member_id, settled_at
         FROM invoices WHERE order_id = $1`,
      [orderId]
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      origin: "order",
      status: "paid",
      amount_paid_cents: 4900,
      order_id: orderId,
      member_id: memberId,
      // Left NULL on purpose: `settled_at` is the Stripe webhook's claim marker
      // for work it still has to finish.
      settled_at: null,
    });
    expect(String(rows.rows[0].number)).toMatch(/^R-\d{4}-\d{5}$/);
  });

  it("issues one for an order a coupon took to $0.00, and gets the figures right", async () => {
    // The order on file: $19.00 less MADHAVFREE, total $0.00, status paid.
    const memberId = await insertMember(client, "receipt-free@test.invalid");
    const offerId = await insertOffer("receipt-free", 1900);
    const orderId = await insertOrder({
      offerId,
      memberId,
      email: "receipt-free@test.invalid",
      subtotalCents: 1900,
      discountCents: 1900,
      couponCode: "MADHAVFREE",
    });

    const invoiceId = await receipts.ensureOrderReceipt(orderId);
    expect(invoiceId).not.toBeNull();

    const document = await receipts.loadReceiptDocument({ orderId }, { memberId });
    expect(document).not.toBeNull();

    // A zero total is a real total, not a missing one: the receipt has to say
    // what it started at, what came off, and that nothing is left to pay.
    expect(document?.view.subtotalCents).toBe(1900);
    expect(document?.view.discountCents).toBe(1900);
    expect(document?.view.totalCents).toBe(0);
    expect(document?.view.couponCode).toBe("MADHAVFREE");
    expect(document?.view.paid).toBe(true);
    expect(document?.view.business.taxId).toBe("88-1691637");
    expect(document?.view.lines).toHaveLength(1);

    const html = receipts.renderReceipt(document!.view);
    expect(html).toContain("Tax ID 88-1691637");
    expect(html).toContain("MADHAVFREE");
    expect(html).toContain("$0.00");

    const pdf = await receipts.renderReceiptPdf(document!);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Nothing was taken, and the document should not print a dash where the
    // card would be.
    expect(document?.pdf?.paymentMethod).toBe("No payment due");
  });

  it("reaches the same document from the receipt record as from the order", async () => {
    const memberId = await insertMember(client, "receipt-both@test.invalid");
    const offerId = await insertOffer("receipt-both", 2700);
    const orderId = await insertOrder({
      offerId,
      memberId,
      email: "receipt-both@test.invalid",
      subtotalCents: 2700,
      discountCents: 0,
    });
    const invoiceId = (await receipts.ensureOrderReceipt(orderId)) as number;

    const byOrder = await receipts.loadReceiptDocument({ orderId }, { memberId });
    const byInvoice = await receipts.loadReceiptDocument({ invoiceId }, { memberId });

    expect(byOrder?.reference).toBe(byInvoice?.reference);
    expect(byOrder?.view.totalCents).toBe(2700);
    expect(byInvoice?.view.totalCents).toBe(2700);
    expect(byInvoice?.orderId).toBe(orderId);
  });

  it("refuses somebody else's receipt, by either key", async () => {
    const owner = await insertMember(client, "receipt-owner@test.invalid");
    const stranger = await insertMember(client, "receipt-stranger@test.invalid");
    const offerId = await insertOffer("receipt-owned", 9900);
    const orderId = await insertOrder({
      offerId,
      memberId: owner,
      email: "receipt-owner@test.invalid",
      subtotalCents: 9900,
      discountCents: 0,
    });
    const invoiceId = (await receipts.ensureOrderReceipt(orderId)) as number;

    expect(await receipts.loadReceiptDocument({ orderId }, { memberId: stranger })).toBeNull();
    expect(await receipts.loadReceiptDocument({ invoiceId }, { memberId: stranger })).toBeNull();
    // The office can read either.
    expect(await receipts.loadReceiptDocument({ orderId }, { admin: true })).not.toBeNull();
  });

  it("issues nothing for a checkout nobody paid for", async () => {
    const memberId = await insertMember(client, "receipt-pending@test.invalid");
    const offerId = await insertOffer("receipt-pending", 1900);
    const orderId = await insertOrder({
      offerId,
      memberId,
      email: "receipt-pending@test.invalid",
      subtotalCents: 1900,
      discountCents: 0,
      status: "pending",
    });

    expect(await receipts.ensureOrderReceipt(orderId)).toBeNull();
    expect(await receipts.loadReceiptDocument({ orderId }, { memberId })).toBeNull();

    const rows = await client.query(`SELECT 1 FROM invoices WHERE order_id = $1`, [orderId]);
    expect(rows.rowCount).toBe(0);
  });

  it("dresses the receipt from the customiser: logo, footer note, tax ID, name and address", async () => {
    // A real 1x1 PNG in the upload directory, referenced the way the media
    // upload names it — and a second file that only pretends to be one.
    fs.writeFileSync(path.join(uploadDir, "zz-receipt-logo.png"), Buffer.from(TINY_PNG, "base64"));
    fs.writeFileSync(path.join(uploadDir, "zz-not-a-logo.png"), "<svg onload=alert(1)>");

    await client.query(
      `UPDATE settings SET value = value || $1::jsonb WHERE key = 'business'`,
      [
        JSON.stringify({
          name: "ZZ Receipt Co",
          address: "1 ZZ Street\nLas Vegas, NV 89107",
          footerNote: "ZZ thank you for your purchase.",
          logoUrl: "/uploads/zz-receipt-logo.png",
        }),
      ]
    );

    const memberId = await insertMember(client, "receipt-custom@test.invalid");
    const offerId = await insertOffer("receipt-custom", 1900);
    const orderId = await insertOrder({
      offerId,
      memberId,
      email: "receipt-custom@test.invalid",
      subtotalCents: 1900,
      discountCents: 1900,
      couponCode: "MADHAVFREE",
    });
    await receipts.ensureOrderReceipt(orderId);

    const document = await receipts.loadReceiptDocument({ orderId }, { memberId });
    expect(document).not.toBeNull();
    expect(document?.view.logoDataUri).toMatch(/^data:image\/png;base64,/);
    expect(document?.pdf?.logo?.subarray(0, 4).toString("latin1")).toBe("\x89PNG");

    const html = receipts.renderReceipt(document!.view);
    expect(html).toContain('<img class="logo" src="data:image/png;base64,');
    expect(html).toContain("ZZ Receipt Co");
    expect(html).toContain("1 ZZ Street");
    expect(html).toContain("Tax ID 88-1691637");
    expect(html).toContain("ZZ thank you for your purchase.");

    const pdf = await receipts.renderReceiptPdf(document!);
    const raw = pdf.toString("latin1");
    // The logo is drawn as an image XObject, not silently dropped.
    expect(raw).toMatch(/\/Subtype \/Image/);

    // The preview the settings screen opens is dressed the same way.
    const sample = await receipts.sampleReceiptDocument();
    expect(sample.view.logoDataUri).toMatch(/^data:image\/png;base64,/);
    expect(receipts.renderReceipt(sample.view)).toContain("ZZ thank you for your purchase.");
    expect((await receipts.renderReceiptPdf(sample)).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // A file named .png that is not one is refused, and the receipt still renders.
    await client.query(
      `UPDATE settings SET value = value || $1::jsonb WHERE key = 'business'`,
      [JSON.stringify({ logoUrl: "/uploads/zz-not-a-logo.png" })]
    );
    const { clearSettingsCache } = await import("./settings");
    clearSettingsCache();
    const withoutLogo = await receipts.loadReceiptDocument({ orderId }, { memberId });
    expect(withoutLogo?.view.logoDataUri).toBeUndefined();
    expect(receipts.renderReceipt(withoutLogo!.view)).not.toContain("<img");
    expect((await receipts.renderReceiptPdf(withoutLogo!)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("leaves a payment plan's receipts to Stripe rather than issuing a second one", async () => {
    const memberId = await insertMember(client, "receipt-plan@test.invalid");
    const offerId = await insertOffer("receipt-plan", 120000);
    const orderId = await insertOrder({
      offerId,
      memberId,
      email: "receipt-plan@test.invalid",
      subtotalCents: 120000,
      discountCents: 0,
    });
    await client.query(
      `INSERT INTO payment_plans (order_id, member_id, offer_id, status, installment_cents,
                                  installment_count, currency)
       VALUES ($1, $2, $3, 'active', 40000, 3, 'usd')`,
      [orderId, memberId, offerId]
    );

    expect(await receipts.ensureOrderReceipt(orderId)).toBeNull();
    const rows = await client.query(`SELECT 1 FROM invoices WHERE order_id = $1`, [orderId]);
    expect(rows.rowCount).toBe(0);
  });
});
