import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

/**
 * The course tabs (sheet row 160): a course made in the admin can be sold, its
 * Offers tab lists what sells it, its Customers tab shows who has it and how far
 * in, and its Settings tab links a community and records live sessions.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;
describeDb("Course hub: offers, customers, settings (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server;
  let base: string;
  let admin: string;

  beforeAll(async () => {
    db = await createTestDatabase("course_hub");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "course-hub-integration-secret";
    process.env.STRIPE_SECRET_KEY = "";
    const { createApp } = await import("../../app");
    const { signToken } = await import("../../utils/jwt");
    const { hashToken } = await import("../../auth/tokens");
    const owner = await db.client.query(
      `INSERT INTO admin_users (email,password_hash,name,role) VALUES ('sagar+zzhub@callsphere.ai','unused','ZZ Hub','owner') RETURNING id`,
    );
    admin = signToken({ sub: owner.rows[0].id, email: "sagar+zzhub@callsphere.ai", role: "owner" });
    await db.client.query(
      `INSERT INTO admin_sessions (admin_user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 hour')`,
      [owner.rows[0].id, hashToken(admin)],
    );
    server = createApp().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const { pool } = await import("../../db/pool");
    await pool.end();
    await db?.drop();
  });

  async function call(url: string, method = "GET", body?: unknown) {
    return fetch(`${base}${url}`, {
      method,
      headers: { authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  it("makes a product with a new course, and never a second one", async () => {
    const created = await call("/api/admin/courses", "POST", { slug: "zz-hub-course", title: "ZZ Hub Course" });
    expect(created.status).toBe(201);
    const courseId = ((await created.json()) as { id: number }).id;

    const products = await db.client.query(`SELECT id, kind, status FROM products WHERE course_id = $1`, [courseId]);
    expect(products.rows).toHaveLength(1);
    expect(products.rows[0]).toMatchObject({ kind: "course", status: "published" });

    const again = await call(`/api/admin/courses/${courseId}/hub/product`, "POST");
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: number; created: boolean })).toMatchObject({
      id: products.rows[0].id,
      created: false,
    });
  });

  it("makes a product for a course that predates it, stepping round a taken slug", async () => {
    const course = (await db.client.query(
      `INSERT INTO courses (slug, title, published) VALUES ('zz-old-course', 'ZZ Old', false) RETURNING id`,
    )).rows[0].id;
    await db.client.query(`INSERT INTO products (slug, title, kind, status) VALUES ('zz-old-course', 'Taken', 'download', 'published')`);

    const ensured = await call(`/api/admin/courses/${course}/hub/product`, "POST");
    expect(ensured.status).toBe(201);
    const row = await db.client.query(`SELECT slug FROM products WHERE course_id = $1`, [course]);
    expect(row.rows).toEqual([{ slug: "zz-old-course-course" }]);
  });

  it("lists the offers that sell a course and the customers who have it, with progress", async () => {
    const course = (await db.client.query(
      `INSERT INTO courses (slug, title, published) VALUES ('zz-sold', 'ZZ Sold', true) RETURNING id`,
    )).rows[0].id;
    const product = ((await (await call(`/api/admin/courses/${course}/hub/product`, "POST")).json()) as { id: number }).id;
    const mod = (await db.client.query(`INSERT INTO course_modules (course_id, title) VALUES ($1, 'One') RETURNING id`, [course])).rows[0].id;
    const lessons = await db.client.query(
      `INSERT INTO course_lessons (module_id, slug, title, body_md, published)
       VALUES ($1, 'a', 'A', 'x', true), ($1, 'b', 'B', 'x', true), ($1, 'c', 'C', 'x', false) RETURNING id`,
      [mod],
    );

    const offer = await call("/api/admin/offers", "POST", { slug: "zz-sold-offer", title: "ZZ Sold Offer", pricingType: "free" });
    const offerId = ((await offer.json()) as { id: number }).id;
    expect((await call(`/api/admin/offers/${offerId}/products`, "POST", { productId: product, sort: 0 })).status).toBe(201);

    const listed = (await (await call(`/api/admin/courses/${course}/hub/offers`)).json()) as {
      offers: { id: number; productId: number; viaBundle: string | null }[];
    };
    expect(listed.offers).toEqual([expect.objectContaining({ id: offerId, productId: product, viaBundle: null })]);

    const member = await insertMember(db.client, "sagar+zzhubstudent@callsphere.ai", { name: "ZZ Student" });
    await db.client.query(
      `INSERT INTO access_grants (member_id, product_id, offer_id, source, status) VALUES ($1, $2, $3, 'manual', 'active')`,
      [member, product, offerId],
    );
    // One published lesson done, plus the draft one, which doesn't count.
    await db.client.query(
      `INSERT INTO lesson_progress (member_id, lesson_id, completed_at, last_viewed_at)
       VALUES ($1, $2, now(), now()), ($1, $3, now(), now())`,
      [member, lessons.rows[0].id, lessons.rows[2].id],
    );

    const customers = (await (await call(`/api/admin/courses/${course}/hub/customers`)).json()) as {
      lessonsTotal: number;
      customers: { memberId: number; lessonsCompleted: number; status: string; offerTitle: string }[];
    };
    expect(customers.lessonsTotal).toBe(2);
    expect(customers.customers).toEqual([
      expect.objectContaining({ memberId: member, lessonsCompleted: 1, status: "active", offerTitle: "ZZ Sold Offer" }),
    ]);
  });

  it("links a community and records a live session with its replay lesson", async () => {
    const course = (await db.client.query(
      `INSERT INTO courses (slug, title, published) VALUES ('zz-live', 'ZZ Live', true) RETURNING id`,
    )).rows[0].id;
    const community = (await db.client.query(
      `INSERT INTO communities (slug, name, access, published) VALUES ('zz-hub-room', 'ZZ Room', 'paid', true) RETURNING id`,
    )).rows[0].id;

    expect((await call(`/api/admin/courses/${course}/hub/settings`, "PUT", { communityId: community })).status).toBe(200);
    const settings = (await (await call(`/api/admin/courses/${course}/hub/settings`)).json()) as {
      communityId: number;
      community: { id: number; sold: boolean } | null;
    };
    expect(settings.communityId).toBe(community);
    expect(settings.community).toMatchObject({ id: community, sold: true });

    const event = (await db.client.query(
      `INSERT INTO community_events (community_id, title, starts_at) VALUES ($1, 'ZZ Q&A', now() + interval '1 day') RETURNING id`,
      [community],
    )).rows[0].id;
    const mod = (await db.client.query(`INSERT INTO course_modules (course_id, title) VALUES ($1, 'Replays') RETURNING id`, [course])).rows[0].id;
    const lesson = (await db.client.query(
      `INSERT INTO course_lessons (module_id, slug, title, published) VALUES ($1, 'qa', 'ZZ Q&A (replay)', false) RETURNING id`,
      [mod],
    )).rows[0].id;

    // A lesson from another course is refused.
    const other = (await db.client.query(`INSERT INTO courses (slug, title) VALUES ('zz-other', 'Other') RETURNING id`)).rows[0].id;
    const otherMod = (await db.client.query(`INSERT INTO course_modules (course_id, title) VALUES ($1, 'X') RETURNING id`, [other])).rows[0].id;
    const otherLesson = (await db.client.query(`INSERT INTO course_lessons (module_id, slug, title) VALUES ($1, 'x', 'X') RETURNING id`, [otherMod])).rows[0].id;
    expect((await call(`/api/admin/courses/${course}/hub/live-sessions`, "POST", { communityEventId: event, lessonId: otherLesson })).status).toBe(400);

    expect((await call(`/api/admin/courses/${course}/hub/live-sessions`, "POST", { communityEventId: event, lessonId: lesson })).status).toBe(201);
    const sessions = (await (await call(`/api/admin/courses/${course}/hub/live-sessions`)).json()) as {
      id: number; title: string; lessonId: number; lessonHasRecording: boolean; eventExists: boolean;
    }[];
    expect(sessions).toEqual([
      expect.objectContaining({ title: "ZZ Q&A", lessonId: lesson, lessonHasRecording: false, eventExists: true }),
    ]);

    expect((await call(`/api/admin/courses/${course}/hub/live-sessions/${sessions[0].id}`, "DELETE")).status).toBe(204);
    await expect((await call(`/api/admin/courses/${course}/hub/live-sessions`)).json()).resolves.toEqual([]);
  });
});
