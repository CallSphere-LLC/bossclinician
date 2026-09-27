import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("importing a Kajabi contacts export", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: ReturnType<express.Express["listen"]>;
  let base: string;

  beforeAll(async () => {
    db = await createTestDatabase("contactimport");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    const { adminContactsRouter } = await import("./contacts");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const app = express();
    app.use(express.json({ limit: "2mb" }), (req, _res, next) => {
      (req as any).admin = { id: 1, role: "owner" };
      next();
    });
    app.use("/contacts", adminContactsRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/contacts`;
    await db.client.query(
      `INSERT INTO contacts (email, name, custom_fields, created_at)
       VALUES ('known@example.invalid', 'Known Person', '{"Instagram": "@known"}', '2026-09-01')`
    );
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end();
    await db?.drop();
  });

  const post = async (rows: unknown[]) =>
    (await fetch(`${base}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows }),
    })).json() as Promise<any>;

  it("keeps every column, the original dates, products and tag names, and refuses card data", async () => {
    const outcome = await post([
      {
        email: "New.Person@Example.invalid",
        name: "New Person",
        firstName: "New",
        tags: "[Purchased] PPP Leap Accelerator, quiz",
        products: "Credential With Confidence, Boss Builders Community archived 1765349256",
        createdAt: "2024-05-06 18:01:32 -0700",
        lastActivityAt: "2025-01-02 03:04:05 -0800",
        customFields: {
          "What is your license type": "LCSW",
          ["I hereby authorize ".padEnd(366, "x")]: "Yes",
          "Member ID": "12345",
          "Credit Card Number": "4111 1111 1111 1111",
          "Sneaky": "4111111111111111",
        },
      },
      {
        email: "known@example.invalid",
        createdAt: "2023-01-01 00:00:00 -0500",
        customFields: { "Source": "webinar" },
      },
    ]);
    expect(outcome).toMatchObject({ created: 1, updated: 1, skipped: 0 });

    const fresh = (await db.client.query(
      `SELECT custom_fields, created_at, last_activity_at, source, consent_source
         FROM contacts WHERE email = 'new.person@example.invalid'`
    )).rows[0];
    expect(fresh.custom_fields).toEqual({
      "What is your license type": "LCSW",
      ["I hereby authorize ".padEnd(366, "x")]: "Yes",
      "Member ID": "12345",
      Products: "Credential With Confidence, Boss Builders Community archived 1765349256",
    });
    expect(new Date(fresh.created_at).toISOString()).toBe("2024-05-07T01:01:32.000Z");
    expect(new Date(fresh.last_activity_at).toISOString()).toBe("2025-01-02T11:04:05.000Z");
    expect(fresh.consent_source).toBe("import");

    const tags = (await db.client.query(
      `SELECT t.name, t.slug FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
         JOIN contacts c ON c.id = ct.contact_id
        WHERE c.email = 'new.person@example.invalid' ORDER BY t.slug`
    )).rows;
    expect(tags).toEqual([
      { name: "Bought: Boss Builders Community", slug: "bought-boss-builders-community" },
      { name: "Bought: Credential With Confidence", slug: "bought-credential-with-confidence" },
      { name: "[Purchased] PPP Leap Accelerator", slug: "purchased-ppp-leap-accelerator" },
      { name: "quiz", slug: "quiz" },
    ]);

    const known = (await db.client.query(
      `SELECT name, custom_fields, created_at FROM contacts WHERE email = 'known@example.invalid'`
    )).rows[0];
    expect(known.name).toBe("Known Person");
    expect(known.custom_fields).toEqual({ Instagram: "@known", Source: "webinar" });
    expect(new Date(known.created_at).toISOString()).toBe("2023-01-01T05:00:00.000Z");
  });

  it("is safe to send the same file twice", async () => {
    const again = await post([{ email: "new.person@example.invalid", tags: "quiz" }]);
    expect(again).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    const count = (await db.client.query(`SELECT count(*)::int AS n FROM contacts`)).rows[0].n;
    expect(count).toBe(2);
  });
});
