import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Client } from "pg";
import fs from "fs";
import path from "path";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember } from "../../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("Lounge VIP assessment ownership (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;
  let owner: { id: number; token: string };
  let peer: { id: number; token: string };
  let outsider: { id: number; token: string };
  let formIds: { slug: string; id: number }[];

  beforeAll(async () => {
    db = await createTestDatabase("loungevip182");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    const { requireMember } = await import("../../middleware/memberAuth");
    const { memberToolStateRouter } = await import("./toolState");
    const { memberLessonFormsRouter } = await import("./lessonForms");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const { signMemberAccessToken } = await import("../../auth/memberSession");

    const { courseId, productId } = await insertCourseProduct(client, "lounge-vip-privacy-test");
    const module = await client.query<{ id: number }>(
      "INSERT INTO course_modules (course_id, title, sort) VALUES ($1, 'Welcome to VIP', 0) RETURNING id", [courseId],
    );
    await client.query(
      `INSERT INTO course_lessons (module_id, title, slug, content_type, published, sort, tool_key)
       VALUES ($1, 'Welcome', 'welcome', 'text', true, 0, null),
              ($1, 'Practice Health', 'practice-health', 'text', true, 1, 'vip-practice-health'),
              ($1, 'Voice Note', 'voice-note', 'text', true, 2, 'form-lounge-vip-voice-note-question'),
              ($1, 'Materials Review', 'materials', 'text', true, 3, 'form-lounge-vip-materials-review'),
              ($1, 'Hot Seat', 'hot-seat', 'text', true, 4, 'form-lounge-vip-hot-seat-request')`,
      [module.rows[0].id],
    );
    const forms = await client.query<{ id: number; slug: string }>(
      `SELECT id, slug FROM forms WHERE slug IN
       ('lounge-vip-voice-note-question', 'lounge-vip-materials-review', 'lounge-vip-hot-seat-request')
       ORDER BY slug`,
    );
    formIds = forms.rows;
    expect(formIds).toHaveLength(3);
    async function member(label: string) {
      const email = `vip-${label}@test.invalid`;
      const id = await insertMember(client, email);
      return { id, token: signMemberAccessToken({ sub: id, email }) };
    }
    owner = await member("owner");
    peer = await member("peer");
    outsider = await member("outsider");
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, status, source)
       VALUES ($1,$3,'active','manual'),($2,$3,'active','manual')`,
      [owner.id, peer.id, productId],
    );
    // Deliberately merge contacts. An older email/contact-based reply query
    // would reveal the peer's submission metadata to the owner.
    const contact = await client.query<{ id: number }>(
      "INSERT INTO contacts (email, name) VALUES ('shared@test.invalid', 'Shared') RETURNING id",
    );
    await client.query("UPDATE members SET contact_id=$1 WHERE id IN ($2,$3)", [contact.rows[0].id, owner.id, peer.id]);

    const app = express();
    app.use(express.json());
    app.use("/api/member", requireMember, memberToolStateRouter, memberLessonFormsRouter);
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

  async function request(path: string, token?: string, state?: object, revision?: number) {
    const response = await fetch(baseUrl + path, {
      method: state ? "PUT" : "GET",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(state ? { "Content-Type": "application/json" } : {}) },
      ...(state ? { body: JSON.stringify({ state, revision }) } : {}),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  it("keeps the new assessment answers and report private to each member", async () => {
    const path = "/api/member/tool-state/vip-practice-health";
    const ownerState = { scores: [1, 2, 3, 4, 1, 2], challenges: ["Owner pay or profitability"], priority: "Improve take-home income", completedAt: "2026-10-25T00:00:00Z" };
    const peerState = { scores: [4, 4, 4, 4, 4, 4], challenges: [], priority: "Protect capacity and time off", completedAt: "2026-10-25T01:00:00Z" };
    expect((await request(path, owner.token, ownerState, 0)).status).toBe(200);
    expect((await request(path, peer.token)).body.state).toBeNull();
    expect((await request(path, peer.token, peerState, 0)).status).toBe(200);
    expect((await request(path, owner.token)).body.state).toEqual(ownerState);
    // A debounced save started by the owner must not land in the peer account
    // when a shared browser switches tokens before the request goes out.
    const crossed = await fetch(baseUrl + path, {
      method: "PUT",
      headers: { Authorization: `Bearer ${peer.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: ownerState, revision: 1, expectedMemberId: owner.id }),
    });
    expect(crossed.status).toBe(409);
    expect((await request(path, peer.token)).body.state).toEqual(peerState);
    expect((await request(path, outsider.token)).status).toBe(404);
    expect((await request(path)).status).toBe(401);
    const impersonated = (await import("../../auth/memberSession")).signMemberAccessToken({ sub: owner.id, email: "admin@test.invalid", impersonatedBy: 1 });
    expect((await request(path, impersonated, peerState, 1)).status).toBe(403);
    expect((await request(path, owner.token)).body.state).toEqual(ownerState);
  });

  it("shows only member-owned replies for each VIP form even when two members share a contact", async () => {
    const { storeSubmission } = await import("../public/growthPublic");
    const shared = await client.query<{ id: number }>("SELECT contact_id AS id FROM members WHERE id=$1", [owner.id]);
    const contactId = shared.rows[0].id;
    for (const form of formIds) {
      const ownerReply = await storeSubmission({ formId: form.id, memberId: owner.id, data: { question: "Owner private question" }, email: "vip-owner@test.invalid", ip: "", userAgent: "", files: [] });
      const peerReply = await storeSubmission({ formId: form.id, memberId: peer.id, data: { question: "Peer private question" }, email: "vip-peer@test.invalid", ip: "", userAgent: "", files: [] });
      await client.query("UPDATE form_submissions SET contact_id=$1 WHERE id IN ($2,$3)", [contactId, ownerReply.submissionId, peerReply.submissionId]);
      const formPath = `/api/member/lesson-forms/${form.slug}`;
      const own = await request(formPath, owner.token);
      const other = await request(formPath, peer.token);
      expect(own.status).toBe(200);
      expect(other.status).toBe(200);
      expect(own.body.replies).toEqual([expect.objectContaining({ id: ownerReply.submissionId })]);
      expect(other.body.replies).toEqual([expect.objectContaining({ id: peerReply.submissionId })]);
      expect((await request(formPath, outsider.token)).status).toBe(404);
    }
  });

  it("places the new lesson after the exact VIP welcome lesson and is idempotent", async () => {
    const course = await client.query<{ id: number }>(
      "SELECT id FROM courses WHERE slug='the-lounge-vip'",
    );
    expect(course.rows).toHaveLength(1);
    const module = await client.query<{ id: number }>(
      "INSERT INTO course_modules (course_id, title, sort) VALUES ($1, 'Welcome to Your VIP Access', 0) RETURNING id",
      [course.rows[0].id],
    );
    await client.query(
      `INSERT INTO course_lessons (module_id, title, slug, content_type, published, sort)
       VALUES ($1, 'Welcome VIP Boss Clinician', 'welcome-vip-boss-clinician', 'text', true, 0),
              ($1, 'Book Your Strategy Calls', 'book-your-strategy-calls', 'text', true, 1),
              ($1, 'Monthly Voice Note question', 'monthly-voice-note-question', 'text', true, 2)`,
      [module.rows[0].id],
    );
    const sql = fs.readFileSync(path.join(__dirname, "../../db/migrations/157_lounge_vip_practice_health.sql"), "utf8");
    await client.query(sql);
    await client.query(sql);
    const lessons = await client.query<{ slug: string; sort: number; tool_key: string | null }>(
      "SELECT slug, sort, tool_key FROM course_lessons WHERE module_id=$1 ORDER BY sort, id", [module.rows[0].id],
    );
    expect(lessons.rows.map((lesson) => [lesson.slug, lesson.sort])).toEqual([
      ["welcome-vip-boss-clinician", 0],
      ["vip-practice-health-check", 1],
      ["book-your-strategy-calls", 2],
      ["monthly-voice-note-question", 3],
    ]);
    expect(lessons.rows[1].tool_key).toBe("vip-practice-health");
  });
});
