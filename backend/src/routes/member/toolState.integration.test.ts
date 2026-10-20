import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;

/** Boardroom's coaching product opens a workbook course; dashboard entries belong to a member. */
describeDb("Boardroom dashboard isolation (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;
  let signToken: typeof import("../../auth/memberSession").signMemberAccessToken;
  let owner: { id: number; token: string };
  let peer: { id: number; token: string };
  let outsider: { id: number; token: string };
  let productId: number;

  beforeAll(async () => {
    db = await createTestDatabase("boardroomtool");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const { requireMember } = await import("../../middleware/memberAuth");
    const { memberToolStateRouter } = await import("./toolState");
    const { memberLibraryRouter } = await import("./library");
    const { errorHandler } = await import("../../middleware/errorHandler");
    signToken = (await import("../../auth/memberSession")).signMemberAccessToken;

    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (slug, title, published)
       VALUES ('the-boss-boardroom-test', 'The Boss Boardroom', false) RETURNING id`,
    );
    const courseId = course.rows[0].id;
    const module = await client.query<{ id: number }>(
      `INSERT INTO course_modules (course_id, title, sort)
       VALUES ($1, 'Boardroom CEO Dashboard', 0) RETURNING id`, [courseId],
    );
    await client.query(
      `INSERT INTO course_lessons (module_id, title, slug, content_type, published, sort, tool_key)
       VALUES ($1, 'Boardroom CEO Dashboard', 'boardroom-ceo-dashboard', 'text', true, 0,
               'boardroom-ceo-dashboard')`, [module.rows[0].id],
    );
    const coachingOffer = await client.query<{ id: number }>(
      `INSERT INTO coaching_offers (slug, title)
       VALUES ('the-boss-boardroom-test', 'The Boss Boardroom') RETURNING id`,
    );
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, coaching_offer_id, legacy_course_id, status)
       VALUES ('the-boss-boardroom-test', 'The Boss Boardroom', 'coaching', $1, $2, 'published')
       RETURNING id`, [coachingOffer.rows[0].id, courseId],
    );
    productId = product.rows[0].id;

    async function member(label: string) {
      const email = `boardroom-${label}@test.invalid`;
      const id = await insertMember(client, email);
      return { id, token: signToken({ sub: id, email }) };
    }
    owner = await member("owner");
    peer = await member("peer");
    outsider = await member("outsider");
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, status, source)
       VALUES ($1, $3, 'active', 'manual'), ($2, $3, 'active', 'manual')`,
      [owner.id, peer.id, productId],
    );

    const app = express();
    app.use(express.json());
    app.use("/api/member", requireMember, memberToolStateRouter);
    app.use("/api/member/library", requireMember, memberLibraryRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  async function request(path: string, token?: string, state?: object) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: state ? "PUT" : "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(state ? { "Content-Type": "application/json" } : {}),
      },
      ...(state ? { body: JSON.stringify({ state }) } : {}),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  const toolPath = "/api/member/tool-state/boardroom-ceo-dashboard";

  it("opens the dashboard as the first lesson of the coaching workbook course", async () => {
    const response = await request("/api/member/library/the-boss-boardroom-test", owner.token);
    expect(response.status).toBe(200);
    const course = response.body.course as { modules: { lessons: { slug: string }[] }[] };
    expect(course.modules[0].lessons[0].slug).toBe("boardroom-ceo-dashboard");
  });

  it("keeps two members' financial entries separate and ignores client-supplied identity", async () => {
    expect((await request(toolPath, owner.token)).body.state).toBeNull();
    expect((await request(toolPath, peer.token)).body.state).toBeNull();

    expect((await request(toolPath, owner.token, { revenue: 1234, memberId: peer.id })).status).toBe(200);
    expect((await request(toolPath, peer.token)).body.state).toBeNull();
    expect((await request(toolPath, peer.token, { revenue: 9876 })).status).toBe(200);
    expect((await request(toolPath, owner.token)).body.state).toEqual({ revenue: 1234, memberId: peer.id });
    expect((await request(toolPath, peer.token)).body.state).toEqual({ revenue: 9876 });

    const saved = await client.query<{ member_id: number; state: { revenue: number } }>(
      `SELECT member_id, state FROM member_tool_state WHERE tool_key = 'boardroom-ceo-dashboard'
       ORDER BY member_id`,
    );
    expect(saved.rows).toHaveLength(2);
    expect(saved.rows.map((row) => [row.member_id, row.state.revenue])).toEqual(
      [[owner.id, 1234], [peer.id, 9876]].sort((a, b) => Number(a[0]) - Number(b[0])),
    );
  });

  it("rejects a stranger and unauthenticated requests without exposing saved state", async () => {
    expect((await request(toolPath, outsider.token)).status).toBe(404);
    expect((await request(toolPath, outsider.token, { revenue: 1 })).status).toBe(404);
    expect((await request(toolPath)).status).toBe(401);
  });

  it("stops reads and writes when Boardroom access is revoked", async () => {
    await client.query(
      `UPDATE access_grants SET status = 'revoked', revoked_at = now()
       WHERE member_id = $1 AND product_id = $2`, [peer.id, productId],
    );
    expect((await request(toolPath, peer.token)).status).toBe(404);
    expect((await request(toolPath, peer.token, { revenue: 1 })).status).toBe(404);
    expect((await request(toolPath, owner.token)).body.state).toEqual({ revenue: 1234, memberId: peer.id });
  });

  it("does not let an admin viewing as member overwrite the member's entries", async () => {
    const token = signToken({ sub: owner.id, email: "admin@test.invalid", impersonatedBy: 1 });
    expect((await request(toolPath, token, { revenue: 1 })).status).toBe(403);
    expect((await request(toolPath, owner.token)).body.state).toEqual({ revenue: 1234, memberId: peer.id });
  });
});
