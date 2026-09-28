import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

/**
 * The Freedom Masterclass sign-up, end to end against a real database built
 * from every migration: the `freedom-masterclass` form migration 077 creates,
 * posted the way pages/FreedomMasterclass.tsx posts it.
 *
 * What the owner was promised: every registration is filed in Forms, becomes a
 * contact with the first name on it, and carries the "Freedom Masterclass" tag
 * — and nothing else happens (no lead, so no owner email per sign-up).
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

const SLUG = "freedom-masterclass";

describeDb("the Freedom Masterclass sign-up (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: Server;
  let baseUrl: string;

  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  function register(name: string, email: string, elapsedMs = 6000) {
    return fetch(`${baseUrl}/api/forms/${SLUG}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { name, email }, email, company: "", elapsedMs }),
    });
  }

  async function contact(email: string) {
    const found = await client.query<{
      id: number;
      name: string;
      first_name: string;
      source: string;
      tags: string[] | null;
    }>(
      `SELECT c.id, c.name, c.first_name, c.source,
              (SELECT array_agg(t.slug::text ORDER BY t.slug)
                 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
                WHERE ct.contact_id = c.id) AS tags
         FROM contacts c WHERE c.email = $1`,
      [email],
    );
    return found.rows[0];
  }

  beforeAll(async () => {
    db = await createTestDatabase("masterclass");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const [{ growthPublicRouter }, { errorHandler }] = await Promise.all([
      import("./growthPublic"),
      import("../../middleware/errorHandler"),
    ]);

    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", growthPublicRouter);
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  it("is published with only a first name and an email, and tags with Freedom Masterclass", async () => {
    const form = await client.query(
      `SELECT f.published, f.create_lead, f.fields,
              (SELECT array_agg(slug::text) FROM tags WHERE id = ANY(f.apply_tag_ids)) AS tags
         FROM forms f WHERE f.slug = $1`,
      [SLUG],
    );
    expect(form.rows[0].published).toBe(true);
    expect(form.rows[0].create_lead).toBe(false);
    expect(form.rows[0].tags).toEqual(["freedom-masterclass"]);
    expect((form.rows[0].fields as { key: string }[]).map((f) => f.key)).toEqual(["name", "email"]);
  });

  it("files a registration, makes a tagged contact with the first name, and no lead", async () => {
    const response = await register("Test", "zz-masterclass@bossclinician.test");
    expect(response.status).toBe(201);
    await settle();

    const person = await contact("zz-masterclass@bossclinician.test");
    expect(person.first_name).toBe("Test");
    expect(person.source).toBe(`form: ${SLUG}`);
    expect(person.tags).toContain("freedom-masterclass");

    const replies = await client.query(
      `SELECT s.contact_id FROM form_submissions s JOIN forms f ON f.id = s.form_id WHERE f.slug = $1`,
      [SLUG],
    );
    expect(replies.rows).toEqual([{ contact_id: person.id }]);

    const leads = await client.query(`SELECT count(*)::int AS n FROM leads WHERE email = $1`, [
      "zz-masterclass@bossclinician.test",
    ]);
    expect(leads.rows[0].n).toBe(0);
  });

  it("does not shorten the full name of somebody already on the list", async () => {
    await client.query(
      `INSERT INTO contacts (email, name, first_name, last_name, source)
       VALUES ('zz-known@bossclinician.test', 'Yvette Howard', 'Yvette', 'Howard', 'kajabi import')`,
    );
    expect((await register("Yvette", "zz-known@bossclinician.test")).status).toBe(201);
    await settle();

    const person = await contact("zz-known@bossclinician.test");
    expect(person.name).toBe("Yvette Howard");
    expect(person.source).toBe("kajabi import");
    expect(person.tags).toContain("freedom-masterclass");
  });

  it("files nothing for a reply sent faster than a person can type", async () => {
    // The shared 2-second floor (MIN_FILL_MS): answered 201 like a real reply,
    // with nothing written — the reason the page cannot be pre-submitted.
    expect((await register("Bot", "zz-bot@bossclinician.test", 300)).status).toBe(201);
    await settle();
    expect(await contact("zz-bot@bossclinician.test")).toBeUndefined();
  });
});
