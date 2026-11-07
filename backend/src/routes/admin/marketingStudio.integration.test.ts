import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

/**
 * Integration tests for Marketing → Studio storage, through the real app: the
 * path-scoped body parser in app.ts, the marketing gate in admin/index.ts, and
 * the optimistic-concurrency SQL against migration 194.
 *
 * Skipped when TEST_DATABASE_URL is unset, so `npm test` needs nothing running.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("marketing studio (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server | undefined;
  let base: string, owner: string, support: string;

  const endpoint = "/api/admin/marketing-studio";
  const doc = (title: string) => ({ settings: { theme: "light" }, posts: [{ id: title }], savedIdeas: [], customHooks: [] });

  async function call(method: string, body?: unknown, token = owner) {
    const res = await fetch(base + endpoint, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  beforeAll(async () => {
    db = await createTestDatabase("mktstudio");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "marketing-studio-isolated-test-secret";
    process.env.STRIPE_SECRET_KEY = "";
    const { createApp } = await import("../../app");
    const { signToken } = await import("../../utils/jwt");
    const { hashToken } = await import("../../auth/tokens");
    for (const role of ["owner", "support"] as const) {
      const email = `${role}-studio@example.invalid`;
      const id = (
        await db.client.query(
          `INSERT INTO admin_users(email,password_hash,name,role) VALUES($1,'unused','QA',$2) RETURNING id`,
          [email, role]
        )
      ).rows[0].id;
      const token = signToken({ sub: id, email, role });
      await db.client.query(
        `INSERT INTO admin_sessions(admin_user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')`,
        [id, hashToken(token)]
      );
      if (role === "owner") owner = token;
      else support = token;
    }
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 90_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await (await import("../../db/pool")).pool.end().catch(() => undefined);
    await db?.drop();
  });

  beforeEach(async () => {
    await db.client.query(`DELETE FROM marketing_studio_state`);
  });

  it("answers an empty studio with null state and version 0", async () => {
    const res = await call("GET");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: null, recovery: null, version: 0, updatedAt: null });
  });

  it("creates the row on the first save, 0 → 1, and records who saved", async () => {
    const saved = await call("PUT", { state: doc("first"), version: 0, recovery: { at: "t0" } });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(1);
    expect(typeof saved.body.updatedAt).toBe("string");

    const read = await call("GET");
    expect(read.body).toMatchObject({ state: doc("first"), recovery: { at: "t0" }, version: 1 });
    const row = (await db.client.query(`SELECT updated_by FROM marketing_studio_state`)).rows[0];
    expect(row.updated_by).toBe("owner-studio@example.invalid");
    const audit = (
      await db.client.query(`SELECT action, after_state FROM admin_audit_log WHERE entity_type = 'marketing_studio_state'`)
    ).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].after_state)).not.toContain("first");
  });

  it("refuses a stale version with 409 and the server's copy, changing nothing", async () => {
    await call("PUT", { state: doc("v1"), version: 0 });
    await call("PUT", { state: doc("v2"), version: 1 });

    const stale = await call("PUT", { state: doc("stale"), version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ error: "conflict", code: "version_conflict", state: doc("v2"), version: 2 });

    const again = await call("PUT", { state: doc("again"), version: 0 });
    expect(again.status).toBe(409);
    expect((await call("GET")).body).toMatchObject({ state: doc("v2"), version: 2 });
  });

  it("keeps recovery when a save omits it, and clears it on an explicit null", async () => {
    await call("PUT", { state: doc("v1"), version: 0, recovery: { snapshot: "keep me" } });
    await call("PUT", { state: doc("v2"), version: 1 });
    expect((await call("GET")).body).toMatchObject({ state: doc("v2"), recovery: { snapshot: "keep me" }, version: 2 });

    await call("PUT", { state: doc("v3"), version: 2, recovery: null });
    expect((await call("GET")).body).toMatchObject({ recovery: null, version: 3 });
  });

  it("accepts a document larger than the site-wide 2 MB JSON limit", async () => {
    const big = { ...doc("big"), posts: [{ id: "big", body: "x".repeat(3 * 1024 * 1024) }] };
    const res = await call("PUT", { state: big, version: 0 });
    expect(res.status).toBe(200);
  });

  it("rejects an invalid document and roles without marketing permissions", async () => {
    expect((await call("PUT", { state: { posts: [] }, version: 0 })).status).toBe(400);
    expect((await call("GET", undefined, support)).status).toBe(403);
    expect((await call("PUT", { state: doc("x"), version: 0 }, support)).status).toBe(403);
    expect([401, 403]).toContain((await call("GET", undefined, "")).status);
  });
});
