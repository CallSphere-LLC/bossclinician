import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

/**
 * GET /account/purchases/:orderId/receipt.pdf as a real server endpoint.
 *
 * That address used to be a client-side route — 200 text/html, the PDF built in
 * the browser — so it could not be forwarded, fetched by a server, or attached
 * to anything. It is now served by the API and authenticated by the document
 * cookie, which is what a browser actually sends to /account/.
 *
 * Driven through the real app (createApp) and the real sign-in, refresh, logout
 * and session-revoke routes, so the cookie under test is the one a browser is
 * handed, not one assembled by the test. Two members, both signed in for real:
 * the owner of the order and a second ZZ member.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-account-receipts-"));

const OWNER_EMAIL = "sagar+zzr2@callsphere.ai";
const STRANGER_EMAIL = "sagar+zzr3@callsphere.ai";
const PASSWORD = "Zz-receipt-probe-2026!";
const DOC_COOKIE = "bc_member_docs";

interface Jar {
  [name: string]: string;
}

interface Reply {
  status: number;
  headers: Headers;
  bytes: Buffer;
  cookies: string[];
}

describeDb("account receipt PDF: served by the server, cookie-authenticated (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: ReturnType<Express["listen"]>;
  let baseUrl: string;

  let ownerId: number;
  let orderId: number;
  let invoiceId: number;
  let receiptNumber: string;

  let cookieModule: typeof import("../../auth/memberDocumentCookie");

  beforeAll(async () => {
    db = await createTestDatabase("accountreceipts");
    client = db.client;

    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    process.env.UPLOAD_DIR = uploadDir;
    process.env.PROTECTED_UPLOAD_DIR = `${uploadDir}-protected`;

    const { hashPassword } = await import("../../auth/password");
    const passwordHash = await hashPassword(PASSWORD);

    ownerId = await insertMember(client, OWNER_EMAIL, { name: "ZZ Receipt Owner" });
    const strangerId = await insertMember(client, STRANGER_EMAIL, { name: "ZZ Receipt Stranger" });
    await client.query(`UPDATE members SET password_hash = $1 WHERE id = ANY($2::int[])`, [
      passwordHash,
      [ownerId, strangerId],
    ]);

    await client.query(
      `INSERT INTO settings (key, value) VALUES ('business', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ name: "Boss Clinician LLC", taxId: "88-1691637" })]
    );

    const offer = await client.query<{ id: number }>(
      `INSERT INTO offers (title, slug, status, pricing_type, amount_cents)
       VALUES ('ZZ Test — receipt download', 'zz-test-receipt-download', 'published', 'one_time', 1900)
       RETURNING id`
    );
    const order = await client.query<{ id: number }>(
      `INSERT INTO orders (offer_id, member_id, email, status, subtotal_cents, discount_cents,
                           tax_cents, total_cents, amount_cents, coupon_code, currency,
                           billing_name, billing_address, source, stripe_session_id)
       VALUES ($1, $2, $3, 'paid', 1900, 0, 0, 1900, 1900, '', 'usd',
               'ZZ Receipt Owner', '{}'::jsonb, 'checkout', 'cs_test_account_receipts')
       RETURNING id`,
      [offer.rows[0].id, ownerId, OWNER_EMAIL]
    );
    orderId = order.rows[0].id;
    await client.query(
      `INSERT INTO order_items (order_id, title, kind, quantity, unit_cents, amount_cents)
       VALUES ($1, 'ZZ Test — receipt download', 'offer', 1, 1900, 1900)`,
      [orderId]
    );

    const { ensureOrderReceipt } = await import("../../services/receiptDocument");
    const issued = await ensureOrderReceipt(orderId);
    if (issued === null) throw new Error("no receipt record was issued for the test order");
    invoiceId = issued;
    const numbered = await client.query<{ number: string }>(
      `SELECT number FROM invoices WHERE id = $1`,
      [invoiceId]
    );
    receiptNumber = numbered.rows[0].number;

    cookieModule = await import("../../auth/memberDocumentCookie");
    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 90_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------- helpers */

  async function call(
    pathname: string,
    options: {
      method?: string;
      cookies?: Jar;
      bearer?: string;
      accept?: string;
      body?: unknown;
    } = {}
  ): Promise<Reply> {
    const headers: Record<string, string> = { Accept: options.accept ?? "*/*" };
    if (options.cookies) {
      headers.Cookie = Object.entries(options.cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    }
    if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: options.method ?? "GET",
      headers,
      redirect: "manual",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return {
      status: res.status,
      headers: res.headers,
      bytes: Buffer.from(await res.arrayBuffer()),
      cookies: res.headers.getSetCookie(),
    };
  }

  /** The cookies a response set, by name, ignoring ones it cleared. */
  function jarFrom(reply: Reply): Jar {
    const jar: Jar = {};
    for (const line of reply.cookies) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value) jar[name] = value;
    }
    return jar;
  }

  function setCookieLine(reply: Reply, name: string): string | undefined {
    return reply.cookies.find((line) => line.startsWith(`${name}=`));
  }

  async function signIn(email: string): Promise<{ jar: Jar; accessToken: string; reply: Reply }> {
    const reply = await call("/api/auth/login", {
      method: "POST",
      body: { email, password: PASSWORD },
      accept: "application/json",
    });
    expect(reply.status).toBe(200);
    const { accessToken } = JSON.parse(reply.bytes.toString("utf8")) as { accessToken: string };
    return { jar: jarFrom(reply), accessToken, reply };
  }

  const pdfPath = () => `/account/purchases/${orderId}/receipt.pdf`;
  const invoicePdfPath = () => `/account/billing/invoices/${invoiceId}/receipt.pdf`;
  const docOnly = (jar: Jar): Jar => ({ [DOC_COOKIE]: jar[DOC_COOKIE] });
  const isPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString("latin1") === "%PDF-";

  /* --------------------------------------------------------------- owner */

  it("signing in hands the browser an HttpOnly, SameSite=Lax cookie scoped to /account/", async () => {
    const { reply } = await signIn(OWNER_EMAIL);
    const line = setCookieLine(reply, DOC_COOKIE);
    expect(line).toBeDefined();
    expect(line).toMatch(/; Path=\/account\//);
    expect(line).toMatch(/; HttpOnly/);
    expect(line).toMatch(/; SameSite=Lax/);
    expect(line).toMatch(/; Expires=/);
  });

  it("serves the owner a real PDF, as an attachment named after the receipt number", async () => {
    expect(receiptNumber).toMatch(/^R-\d{4}-\d{5}$/);
    const { jar } = await signIn(OWNER_EMAIL);

    // Only the document cookie: it is the one a browser sends to /account/.
    for (const pathname of [pdfPath(), invoicePdfPath()]) {
      for (const accept of ["*/*", "text/html,application/xhtml+xml,*/*;q=0.8"]) {
        const res = await call(pathname, { cookies: docOnly(jar), accept });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/pdf");
        expect(res.headers.get("content-disposition")).toBe(
          `attachment; filename="receipt-${receiptNumber}.pdf"`
        );
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(Number(res.headers.get("content-length"))).toBe(res.bytes.byteLength);
        expect(isPdf(res.bytes)).toBe(true);
      }
    }
  });

  it("also accepts a Bearer access token, for an API client", async () => {
    const { accessToken } = await signIn(OWNER_EMAIL);
    const res = await call(pdfPath(), { bearer: accessToken });
    expect(res.status).toBe(200);
    expect(isPdf(res.bytes)).toBe(true);
  });

  /* ------------------------------------------------------------ no session */

  it("refuses a request with no session: 401 to a script, /login?next= to a browser", async () => {
    const script = await call(pdfPath());
    expect(script.status).toBe(401);
    expect(JSON.parse(script.bytes.toString("utf8"))).toEqual({ error: "Please sign in to continue" });

    const browser = await call(pdfPath(), { accept: "text/html,*/*;q=0.8" });
    expect(browser.status).toBe(302);
    expect(browser.headers.get("location")).toBe(
      `/login?next=${encodeURIComponent(`/account/purchases/${orderId}/receipt.pdf`)}`
    );

    for (const res of [script, browser]) expect(isPdf(res.bytes)).toBe(false);
  });

  it("does not honour the refresh cookie, a tampered cookie, or a re-pointed one", async () => {
    const owner = await signIn(OWNER_EMAIL);
    const stranger = await signIn(STRANGER_EMAIL);

    const [body, sig] = owner.jar[DOC_COOKIE].split(".");
    const tampered = `${body}.${sig.slice(0, -3)}${sig.endsWith("AAA") ? "BBB" : "AAA"}`;

    // Correctly signed, but claiming the owner against the stranger's live
    // session: the row must belong to the member the cookie names.
    const strangerPayload = cookieModule.verifyDocumentCookie(stranger.jar[DOC_COOKIE]);
    expect(strangerPayload).not.toBeNull();
    const repointed = cookieModule.signDocumentCookie({
      sessionId: strangerPayload!.sessionId,
      memberId: ownerId,
      expiresAt: strangerPayload!.expiresAt,
    });

    const attempts = await Promise.all([
      call(pdfPath(), { cookies: { [DOC_COOKIE]: owner.jar.bc_member_refresh } }),
      call(pdfPath(), { cookies: { bc_member_refresh: owner.jar.bc_member_refresh } }),
      call(pdfPath(), { cookies: { [DOC_COOKIE]: tampered } }),
      call(pdfPath(), { cookies: { [DOC_COOKIE]: repointed } }),
      call(pdfPath(), { cookies: { [DOC_COOKIE]: "garbage" } }),
    ]);
    for (const res of attempts) {
      expect(res.status).toBe(401);
      expect(isPdf(res.bytes)).toBe(false);
    }
  });

  /* -------------------------------------------------------- everybody else */

  it("answers another member, and an order that does not exist, with the identical 404", async () => {
    const owner = await signIn(OWNER_EMAIL);
    const stranger = await signIn(STRANGER_EMAIL);

    for (const accept of ["*/*", "text/html,*/*;q=0.8"]) {
      const someoneElses = await call(pdfPath(), { cookies: docOnly(stranger.jar), accept });
      const someoneElsesInvoice = await call(invoicePdfPath(), { cookies: docOnly(stranger.jar), accept });
      const nobodys = await call(`/account/purchases/999999/receipt.pdf`, {
        cookies: docOnly(owner.jar),
        accept,
      });
      const nobodysInvoice = await call(`/account/billing/invoices/999999/receipt.pdf`, {
        cookies: docOnly(owner.jar),
        accept,
      });
      const notAnId = await call(`/account/purchases/abc/receipt.pdf`, {
        cookies: docOnly(owner.jar),
        accept,
      });

      for (const res of [someoneElses, someoneElsesInvoice, nobodys, nobodysInvoice, notAnId]) {
        expect(res.status).toBe(404);
        expect(isPdf(res.bytes)).toBe(false);
        expect(res.bytes.equals(someoneElses.bytes)).toBe(true);
        expect(res.headers.get("content-type")).toBe(someoneElses.headers.get("content-type"));
        expect(res.headers.get("content-disposition")).toBeNull();
      }

      if (accept === "*/*") {
        expect(JSON.parse(someoneElses.bytes.toString("utf8"))).toEqual({
          error: "We couldn't find that receipt.",
        });
      } else {
        const html = someoneElses.bytes.toString("utf8");
        expect(html).toContain("We couldn’t find that receipt");
        expect(html).not.toContain(receiptNumber);
        expect(html).not.toContain("ZZ Receipt Owner");
      }
    }
  });

  /* ------------------------------------------------------- ending a session */

  it("refuses the cookie once that session has logged out, and logout clears it", async () => {
    const { jar } = await signIn(OWNER_EMAIL);
    expect((await call(pdfPath(), { cookies: docOnly(jar) })).status).toBe(200);

    const logout = await call("/api/auth/logout", {
      method: "POST",
      cookies: { bc_member_refresh: jar.bc_member_refresh },
    });
    expect(logout.status).toBe(204);
    const cleared = setCookieLine(logout, DOC_COOKIE);
    expect(cleared).toMatch(/^bc_member_docs=;/);
    expect(cleared).toMatch(/; Path=\/account\//);

    // A browser that kept the old value anyway gets nothing for it.
    const replay = await call(pdfPath(), { cookies: docOnly(jar) });
    expect(replay.status).toBe(401);
    expect(isPdf(replay.bytes)).toBe(false);
  });

  it("refuses the cookie once the session is revoked from another device", async () => {
    const laptop = await signIn(OWNER_EMAIL);
    const phone = await signIn(OWNER_EMAIL);
    expect((await call(pdfPath(), { cookies: docOnly(phone.jar) })).status).toBe(200);

    const phoneSessionId = cookieModule.verifyDocumentCookie(phone.jar[DOC_COOKIE])!.sessionId;
    const revoke = await call(`/api/auth/me/sessions/${phoneSessionId}`, {
      method: "DELETE",
      bearer: laptop.accessToken,
      cookies: { bc_member_refresh: laptop.jar.bc_member_refresh },
    });
    expect(revoke.status).toBe(204);

    expect((await call(pdfPath(), { cookies: docOnly(phone.jar) })).status).toBe(401);
    // The device that did the revoking is untouched.
    expect((await call(pdfPath(), { cookies: docOnly(laptop.jar) })).status).toBe(200);
  });

  it("refuses every cookie when all sessions are revoked, and while the account is suspended", async () => {
    const { revokeAllMemberSessions } = await import("../../auth/memberSession");

    const first = await signIn(OWNER_EMAIL);
    await revokeAllMemberSessions(ownerId, "admin");
    expect((await call(pdfPath(), { cookies: docOnly(first.jar) })).status).toBe(401);

    const second = await signIn(OWNER_EMAIL);
    await client.query(`UPDATE members SET status = 'suspended' WHERE id = $1`, [ownerId]);
    try {
      expect((await call(pdfPath(), { cookies: docOnly(second.jar) })).status).toBe(401);
    } finally {
      await client.query(`UPDATE members SET status = 'active' WHERE id = $1`, [ownerId]);
    }
    expect((await call(pdfPath(), { cookies: docOnly(second.jar) })).status).toBe(200);
  });

  it("re-mints the cookie on refresh; the value from before the rotation stops working", async () => {
    const { jar } = await signIn(OWNER_EMAIL);

    const refreshed = await call("/api/auth/refresh", {
      method: "POST",
      cookies: { bc_member_refresh: jar.bc_member_refresh },
    });
    expect(refreshed.status).toBe(200);
    const next = jarFrom(refreshed);
    expect(next[DOC_COOKIE]).toBeDefined();
    expect(next[DOC_COOKIE]).not.toBe(jar[DOC_COOKIE]);
    expect(setCookieLine(refreshed, DOC_COOKIE)).toMatch(/; Path=\/account\//);

    expect((await call(pdfPath(), { cookies: docOnly(next) })).status).toBe(200);
    expect((await call(pdfPath(), { cookies: docOnly(jar) })).status).toBe(401);
  });

  /* ----------------------------------------------------- what stays as it was */

  it("keeps the signed-link download and the member API receipt working", async () => {
    const { accessToken } = await signIn(OWNER_EMAIL);

    const minted = await call(`/api/member/billing/orders/${orderId}/receipt-link`, {
      method: "POST",
      bearer: accessToken,
    });
    expect(minted.status).toBe(200);
    const { url } = JSON.parse(minted.bytes.toString("utf8")) as { url: string };
    const viaLink = await call(url);
    expect(viaLink.status).toBe(200);
    expect(viaLink.headers.get("content-disposition")).toBe(
      `attachment; filename="receipt-${receiptNumber}.pdf"`
    );
    expect(isPdf(viaLink.bytes)).toBe(true);

    const html = await call(`/api/member/billing/orders/${orderId}/receipt`, { bearer: accessToken });
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toMatch(/^text\/html/);
  });
});
