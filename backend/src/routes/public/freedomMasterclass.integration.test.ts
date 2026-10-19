import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";
import { hashToken } from "../../auth/tokens";

/**
 * The Freedom Masterclass sign-up, end to end against a real database built
 * from every migration: the `freedom-masterclass` form migration 077 creates
 * and migration 123 reshapes (sheet row 104), posted the way
 * pages/FreedomMasterclass.tsx posts it.
 *
 * What the owner was promised: every registration is filed in Forms, becomes a
 * contact with the first name on it, carries the "Freedom Masterclass" tag and
 * the two practice answers, and nothing else happens (no lead, so no owner
 * email per sign-up). Since 123 the form is double opt-in: the reply waits with
 * a confirmation token until the link in the email is opened, which stamps the
 * reply and sends the person to /watch-now.
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

const SLUG = "freedom-masterclass";

/** The two practice questions migration 123 copied from her Kajabi form, answered with real options. */
const ANSWERS = {
  practice_stage: "I’m just getting started",
  practice_goal: "A stronger solo practice",
};

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
      body: JSON.stringify({ data: { name, email, ...ANSWERS }, email, company: "", elapsedMs }),
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

  it("is published with a first name, an email and the two practice questions, double opt-in, tagged Freedom Masterclass", async () => {
    const form = await client.query(
      `SELECT f.published, f.create_lead, f.double_opt_in, f.redirect_url, f.fields,
              (SELECT array_agg(slug::text) FROM tags WHERE id = ANY(f.apply_tag_ids)) AS tags
         FROM forms f WHERE f.slug = $1`,
      [SLUG],
    );
    expect(form.rows[0].published).toBe(true);
    expect(form.rows[0].create_lead).toBe(false);
    expect(form.rows[0].double_opt_in).toBe(true);
    expect(form.rows[0].redirect_url).toBe("/watch-now");
    expect(form.rows[0].tags).toEqual(["freedom-masterclass"]);
    const fields = form.rows[0].fields as { key: string; type: string; required: boolean; options?: string[] }[];
    expect(fields.map((f) => f.key)).toEqual(["name", "email", "practice_stage", "practice_goal"]);
    for (const key of Object.keys(ANSWERS) as (keyof typeof ANSWERS)[]) {
      const field = fields.find((f) => f.key === key);
      expect(field?.type).toBe("select");
      expect(field?.required).toBe(true);
      expect(field?.options).toContain(ANSWERS[key]);
    }
  });

  it("refuses a reply without the practice answers", async () => {
    const response = await fetch(`${baseUrl}/api/forms/${SLUG}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { name: "Short", email: "zz-short@bossclinician.test" }, company: "", elapsedMs: 6000 }),
    });
    expect(response.status).toBe(400);
  });

  it("files a registration, makes a tagged contact with the first name, and no lead", async () => {
    const response = await register("Test", "zz-masterclass@bossclinician.test");
    expect(response.status).toBe(201);
    await settle();

    const person = await contact("zz-masterclass@bossclinician.test");
    expect(person.first_name).toBe("Test");
    expect(person.source).toBe(`form: ${SLUG}`);
    expect(person.tags).toContain("freedom-masterclass");

    const replies = await client.query<{ contact_id: number; data: Record<string, unknown>; confirmed_at: Date | null; has_token: boolean }>(
      `SELECT s.contact_id, s.data, s.confirmed_at, s.confirm_token_hash IS NOT NULL AS has_token
         FROM form_submissions s JOIN forms f ON f.id = s.form_id WHERE f.slug = $1`,
      [SLUG],
    );
    expect(replies.rows.map((r) => r.contact_id)).toEqual([person.id]);
    expect(replies.rows[0].data).toMatchObject(ANSWERS);
    // Double opt-in: the reply is filed but waits for the link in the email.
    expect(replies.rows[0].confirmed_at).toBeNull();
    expect(replies.rows[0].has_token).toBe(true);

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

  it("confirms the reply from the emailed link and sends the person to the masterclass", async () => {
    const token = "integration-confirm-token";
    const reply = await client.query<{ id: number; contact_id: number }>(
      `UPDATE form_submissions s SET confirm_token_hash = $2
         FROM forms f
        WHERE f.id = s.form_id AND f.slug = $1 AND s.email = 'zz-masterclass@bossclinician.test'
        RETURNING s.id, s.contact_id`,
      [SLUG, hashToken(token)],
    );
    expect(reply.rowCount).toBe(1);

    const first = await fetch(`${baseUrl}/api/forms/confirm/${token}`, { redirect: "manual" });
    expect(first.status).toBe(302);
    const location = new URL(first.headers.get("location") ?? "");
    expect(location.pathname).toBe("/watch-now");
    expect(location.searchParams.get("confirmed")).toBe("1");
    expect(location.searchParams.get("name")).toBe("Test");

    const stamped = await client.query<{ confirmed_at: Date | null; opt_in_confirmed_at: Date | null }>(
      `SELECT s.confirmed_at, c.opt_in_confirmed_at
         FROM form_submissions s JOIN contacts c ON c.id = s.contact_id WHERE s.id = $1`,
      [reply.rows[0].id],
    );
    expect(stamped.rows[0].confirmed_at).not.toBeNull();
    expect(stamped.rows[0].opt_in_confirmed_at).not.toBeNull();

    // Idempotent: the same link opened again lands on the same page.
    const again = await fetch(`${baseUrl}/api/forms/confirm/${token}`, { redirect: "manual" });
    expect(again.status).toBe(302);
    expect(new URL(again.headers.get("location") ?? "").pathname).toBe("/watch-now");

    // An unknown link goes home, marked expired.
    const unknown = await fetch(`${baseUrl}/api/forms/confirm/not-a-real-token`, { redirect: "manual" });
    expect(unknown.status).toBe(302);
    expect(new URL(unknown.headers.get("location") ?? "").searchParams.get("confirm")).toBe("expired");
  });

  it("files nothing for a reply sent faster than a person can type", async () => {
    // The shared 2-second floor (MIN_FILL_MS): answered 201 like a real reply,
    // with nothing written — the reason the page cannot be pre-submitted.
    expect((await register("Bot", "zz-bot@bossclinician.test", 300)).status).toBe(201);
    await settle();
    expect(await contact("zz-bot@bossclinician.test")).toBeUndefined();
  });
});
