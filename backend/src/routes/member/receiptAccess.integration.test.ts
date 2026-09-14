import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

/**
 * Integration tests for who can open a receipt, at every address it has.
 *
 * The receipt used to have no address: it was written into a blank popup, which
 * the browser blocked. It now lives at the member's own URL (HTML through the
 * Bearer-authenticated API, the PDF through a short-lived signed link) and at
 * the admin's. What matters is the boundary around those: the buyer gets their
 * receipt; the office gets any receipt; anybody else — another signed-in member,
 * a signed-out browser, a guessed id, a forged or stale link — gets nothing, and
 * the "nothing" is the same 404 whether or not the receipt exists.
 *
 * Real HTTP against a real database, with the real member and admin middleware.
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

/** Where the receipt logo would be read from, pointed at scratch before config loads. */
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-receipt-access-"));

/** The drawn text of a pdfkit PDF (see routes/member/receipt.test.ts). */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let out = "";
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    const body = Buffer.from(raw.slice(start, end), "latin1");
    let content: string;
    try {
      content = zlib.inflateSync(body).toString("latin1");
    } catch {
      content = body.toString("latin1");
    }
    for (const run of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
      out += Buffer.from(run[1], "hex").toString("latin1");
    }
  }
  return out;
}

describeDb("receipt URLs: owner, admin, and everyone else (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  let receiptLinks: typeof import("../../services/receiptLinks");
  let ownerId: number;
  let strangerId: number;
  let orderId: number;
  let invoiceId: number;
  let ownerToken: string;
  let strangerToken: string;
  let impersonationToken: string;
  let adminToken: string;

  const MISSING = { error: "We couldn't find that receipt." };

  beforeAll(async () => {
    db = await createTestDatabase("receiptaccess");
    client = db.client;

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
          address: "848 N Rainbow Blvd\n451\nLas Vegas, NV 89107\nUnited States",
        }),
        JSON.stringify({ receiptTitle: "Receipt", refundPolicy: "Refunds within 14 days." }),
      ]
    );

    ownerId = await insertMember(client, "owner-zzr@test.invalid", { name: "Madhav Shankaran" });
    strangerId = await insertMember(client, "sagar+zzr1@callsphere.ai", { name: "ZZ Receipt Stranger" });

    // The order on file: $19.00 less MADHAVFREE, $0.00 paid.
    const offer = await client.query<{ id: number }>(
      `INSERT INTO offers (title, slug, status, pricing_type, amount_cents)
       VALUES ('ZZ Test — checkout probe', 'zz-test-checkout-probe', 'published', 'one_time', 1900)
       RETURNING id`
    );
    const order = await client.query<{ id: number }>(
      `INSERT INTO orders (offer_id, member_id, email, status, subtotal_cents, discount_cents,
                           tax_cents, total_cents, amount_cents, coupon_code, currency,
                           billing_name, billing_address, source, stripe_session_id)
       VALUES ($1, $2, 'owner-zzr@test.invalid', 'paid', 1900, 1900, 0, 0, 0, 'MADHAVFREE', 'usd',
               'Madhav Shankaran', '{}'::jsonb, 'checkout', 'cs_test_receipt_access')
       RETURNING id`,
      [offer.rows[0].id, ownerId]
    );
    orderId = order.rows[0].id;
    await client.query(
      `INSERT INTO order_items (order_id, title, kind, quantity, unit_cents, amount_cents)
       VALUES ($1, 'ZZ Test — checkout probe', 'offer', 1, 1900, 1900)`,
      [orderId]
    );

    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.UPLOAD_DIR = uploadDir;
    process.env.PROTECTED_UPLOAD_DIR = `${uploadDir}-protected`;

    const { requireMember } = await import("../../middleware/memberAuth");
    const { requireAuth } = await import("../../middleware/auth");
    const { requirePermission } = await import("../../services/permissions");
    const { memberBillingRouter } = await import("./billing");
    const { adminSalesRouter } = await import("../admin/sales");
    const { receiptLinkRouter } = await import("../public/receiptLink");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const { signMemberAccessToken } = await import("../../auth/memberSession");
    const { signToken } = await import("../../utils/jwt");
    const { hashToken } = await import("../../auth/tokens");
    const { ensureOrderReceipt } = await import("../../services/receiptDocument");
    receiptLinks = await import("../../services/receiptLinks");

    const issued = await ensureOrderReceipt(orderId);
    if (issued === null) throw new Error("no receipt record was issued for the test order");
    invoiceId = issued;

    ownerToken = signMemberAccessToken({ sub: ownerId, email: "owner-zzr@test.invalid" });
    strangerToken = signMemberAccessToken({ sub: strangerId, email: "sagar+zzr1@callsphere.ai" });
    impersonationToken = signMemberAccessToken({
      sub: ownerId,
      email: "owner-zzr@test.invalid",
      impersonatedBy: 1,
    });

    // An office account with a live session row, as requireAuth demands.
    const adminUser = await client.query<{ id: number }>(
      `INSERT INTO admin_users (email, password_hash, name, role)
       VALUES ('office-zzr@test.invalid', 'not-used', 'Office', 'owner') RETURNING id`
    );
    adminToken = signToken({
      sub: adminUser.rows[0].id,
      email: "office-zzr@test.invalid",
      role: "owner",
    });
    await client.query(
      `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      [adminUser.rows[0].id, hashToken(adminToken)]
    );

    // Mounted as app.ts and the routers' own index files mount them.
    const app = express();
    app.use(express.json());
    app.use("/api/admin/sales", requireAuth, requirePermission("orders.view"), adminSalesRouter);
    app.use("/api/member/billing", requireMember, memberBillingRouter);
    app.use("/api", receiptLinkRouter);
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  async function call(
    pathname: string,
    token?: string,
    method: "GET" | "POST" = "GET"
  ): Promise<{ status: number; headers: Headers; bytes: Buffer }> {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
  }

  const json = (bytes: Buffer): unknown => JSON.parse(bytes.toString("utf8"));

  /* ----------------------------------------------------------------- owner */

  it("shows the buyer their receipt, with every line a receipt needs", async () => {
    const res = await call(`/api/member/billing/orders/${orderId}/receipt`, ownerToken);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = res.bytes.toString("utf8");
    expect(html).toContain("Boss Clinician LLC");
    expect(html).toContain("848 N Rainbow Blvd");
    expect(html).toContain("Tax ID 88-1691637");
    expect(html).toMatch(/R-\d{4}-\d{5} &middot; Order no\. \d+/);
    expect(html).toContain("Madhav Shankaran");
    expect(html).toContain("owner-zzr@test.invalid");
    expect(html).toContain("ZZ Test — checkout probe");
    expect(html).toContain("Discount (MADHAVFREE)");
    expect(html).toContain('<tr><td>Tax</td><td class="num">$0.00</td></tr>');
    expect(html).toContain('<td>Total paid</td><td class="num">$0.00</td>');
  });

  it("serves the buyer their PDF as a download", async () => {
    const res = await call(`/api/member/billing/orders/${orderId}/receipt.pdf`, ownerToken);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="receipt-.+\.pdf"$/);
    expect(res.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("mints a signed link the buyer's browser can download from without a session", async () => {
    const minted = await call(`/api/member/billing/orders/${orderId}/receipt-link`, ownerToken, "POST");
    expect(minted.status).toBe(200);
    const { url } = json(minted.bytes) as { url: string };
    expect(url).toMatch(/^\/api\/receipts\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    // No Authorization header: this is what a plain navigation sends.
    const downloaded = await call(url);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("application/pdf");
    expect(downloaded.headers.get("content-disposition")).toMatch(/^attachment; filename="receipt-/);

    const text = pdfText(downloaded.bytes);
    expect(text).toContain("Tax ID 88-1691637");
    expect(text).toContain("MADHAVFREE");
    expect(text).toMatch(/R-\d{4}-\d{5}/);
    expect(text).toMatch(/Tax\$0\.00/);
    expect(text).toMatch(/Total paid\$0\.00/);
  });

  it("reaches the same receipt by its invoice id, and lets an impersonating admin read it", async () => {
    const byInvoice = await call(`/api/member/billing/invoices/${invoiceId}/receipt`, ownerToken);
    expect(byInvoice.status).toBe(200);

    const viewing = await call(`/api/member/billing/orders/${orderId}/receipt-link`, impersonationToken, "POST");
    expect(viewing.status).toBe(200);
  });

  /* ------------------------------------------------------ everybody else */

  it("answers another signed-in member with a 404 on every receipt address", async () => {
    const attempts = await Promise.all([
      call(`/api/member/billing/orders/${orderId}/receipt`, strangerToken),
      call(`/api/member/billing/orders/${orderId}/receipt.pdf`, strangerToken),
      call(`/api/member/billing/orders/${orderId}/receipt-link`, strangerToken, "POST"),
      call(`/api/member/billing/invoices/${invoiceId}/receipt`, strangerToken),
      call(`/api/member/billing/invoices/${invoiceId}/receipt.pdf`, strangerToken),
      call(`/api/member/billing/invoices/${invoiceId}/receipt-link`, strangerToken, "POST"),
    ]);

    for (const attempt of attempts) {
      expect(attempt.status).toBe(404);
      expect(json(attempt.bytes)).toEqual(MISSING);
    }
  });

  it("answers a receipt that does not exist exactly as it answers somebody else's", async () => {
    const nobody = await call(`/api/member/billing/orders/999999/receipt`, ownerToken);
    const someoneElses = await call(`/api/member/billing/orders/${orderId}/receipt`, strangerToken);

    expect(nobody.status).toBe(404);
    expect(nobody.bytes.equals(someoneElses.bytes)).toBe(true);
    expect((await call(`/api/member/billing/orders/not-a-number/receipt`, ownerToken)).status).toBe(404);
  });

  it("refuses a signed-out visitor, and hands over no document", async () => {
    const attempts = await Promise.all([
      call(`/api/member/billing/orders/${orderId}/receipt`),
      call(`/api/member/billing/orders/${orderId}/receipt.pdf`),
      call(`/api/member/billing/orders/${orderId}/receipt-link`, undefined, "POST"),
    ]);

    for (const attempt of attempts) {
      expect(attempt.status).toBe(401);
      expect(attempt.bytes.toString("utf8")).not.toContain("MADHAVFREE");
      expect(attempt.bytes.subarray(0, 5).toString("latin1")).not.toBe("%PDF-");
    }
  });

  it("refuses a bad, expired, misdirected or forged download link with the same 404", async () => {
    const { token } = receiptLinks.signReceiptLink({ target: { orderId }, memberId: ownerId });
    const [body, signature] = token.split(".");

    const expired = receiptLinks.signReceiptLink({
      target: { orderId },
      memberId: ownerId,
      now: new Date(Date.now() - 60 * 60 * 1000),
    });
    // Correctly signed, but for a member who does not own the order: ownership is
    // proven again on delivery, not trusted from the link.
    const wrongOwner = receiptLinks.signReceiptLink({ target: { orderId }, memberId: strangerId });

    const attempts = await Promise.all([
      call(`/api/receipts/${body}.${signature.slice(0, -3)}AAA`),
      call(`/api/receipts/garbage`),
      call(expired.url),
      call(wrongOwner.url),
      // The owner's own link, presented by a different signed-in member.
      call(`/api/receipts/${token}`, strangerToken),
    ]);

    for (const attempt of attempts) {
      expect(attempt.status).toBe(404);
      expect(attempt.bytes.subarray(0, 5).toString("latin1")).not.toBe("%PDF-");
    }
    // And the untouched link still works, so the refusals above are the checks.
    expect((await call(`/api/receipts/${token}`)).status).toBe(200);
  });

  it("stops a live link working the moment the account is suspended", async () => {
    const { url } = receiptLinks.signReceiptLink({ target: { orderId }, memberId: ownerId });
    await client.query(`UPDATE members SET status = 'suspended' WHERE id = $1`, [ownerId]);
    try {
      expect((await call(url)).status).toBe(404);
    } finally {
      await client.query(`UPDATE members SET status = 'active' WHERE id = $1`, [ownerId]);
    }
  });

  /* ----------------------------------------------------------------- admin */

  it("shows the office any receipt through the admin path, and nobody else", async () => {
    const html = await call(`/api/admin/sales/invoices/${invoiceId}/receipt`, adminToken);
    expect(html.status).toBe(200);
    expect(html.bytes.toString("utf8")).toContain("Tax ID 88-1691637");

    const pdf = await call(`/api/admin/sales/invoices/${invoiceId}/receipt.pdf`, adminToken);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-disposition")).toMatch(/^attachment; filename="receipt-/);

    expect((await call(`/api/admin/sales/invoices/${invoiceId}/receipt`)).status).toBe(401);
    // A member token is not an admin token, whoever the member is.
    expect((await call(`/api/admin/sales/invoices/${invoiceId}/receipt`, ownerToken)).status).toBe(401);
    expect((await call(`/api/admin/sales/invoices/999999/receipt`, adminToken)).status).toBe(404);
  });
});
