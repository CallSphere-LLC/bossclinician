import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember } from "../../testing/db";

/**
 * FlourisHealer retreat dashboard (sheet row 248): two ZZ guests of the same
 * retreat, an outsider, and a guest of a DIFFERENT retreat. Every guest
 * endpoint must answer only with the caller's own records, and the gallery
 * only to that retreat's guests — including through a direct media link.
 *
 * Runs against a scratch Postgres with every migration replayed, so it also
 * proves migration 218 seeds the Bali retreat unpublished and grants nobody.
 */
describe.skipIf(!hasTestDatabase)("FlourisHealer retreat dashboard access (scratch Postgres)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server | undefined;
  let base: string;
  let retreatId: number;
  let productId: number;
  let guestA: { id: number; token: string };
  let guestB: { id: number; token: string };
  let outsider: { id: number; token: string };
  let otherGuest: { id: number; token: string };
  let impersonatedA: string;
  let ownerToken: string;
  let supportToken: string;
  let protectedDir: string;
  let services: typeof import("../../services/retreats");
  let emailBaseline = 0;

  async function call(method: string, url: string, token?: string, body?: unknown) {
    const response = await fetch(base + url, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { raw: text };
    }
    return { status: response.status, body: json as Record<string, any> };
  }

  async function adminSession(role: "owner" | "support") {
    const { signToken } = await import("../../utils/jwt");
    const { hashToken } = await import("../../auth/tokens");
    const email = `zz-retreat-${role}@test.invalid`;
    const id = (
      await db.client.query("INSERT INTO admin_users (email,password_hash,name,role) VALUES ($1,'unused','ZZ Retreat',$2) RETURNING id", [email, role])
    ).rows[0].id as number;
    const token = signToken({ sub: id, email, role });
    await db.client.query(
      "INSERT INTO admin_sessions (admin_user_id,token_hash,expires_at,last_used_at) VALUES ($1,$2,now()+interval '1 hour',now())",
      [id, hashToken(token)],
    );
    return { id, token };
  }

  const dash = "/api/member/retreats/bali-2027";

  beforeAll(async () => {
    db = await createTestDatabase("retreat_dashboard");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "retreat-scratch-test-secret";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "retreat-media-"));
    process.env.UPLOAD_DIR = path.join(root, "public");
    process.env.PROTECTED_UPLOAD_DIR = path.join(root, "protected");
    protectedDir = process.env.PROTECTED_UPLOAD_DIR;
    fs.mkdirSync(protectedDir, { recursive: true });

    const seeded = await db.client.query<{ id: number; product_id: number }>(`SELECT id, product_id FROM retreats WHERE slug = 'bali-2027'`);
    retreatId = seeded.rows[0].id;
    productId = seeded.rows[0].product_id;

    const { signMemberAccessToken } = await import("../../auth/memberSession");
    const member = async (label: string) => {
      const email = `zz-retreat-${label}@test.invalid`;
      const id = await insertMember(db.client, email, { name: `ZZ ${label}` });
      return { id, token: signMemberAccessToken({ sub: id, email }) };
    };
    guestA = await member("guest-a");
    guestB = await member("guest-b");
    outsider = await member("outsider");
    otherGuest = await member("other-retreat");
    impersonatedA = signMemberAccessToken({ sub: guestA.id, email: "zz-retreat-guest-a@test.invalid", impersonatedBy: 1 } as never);

    // A second, published retreat with its own dashboard product and its own guest.
    const other = await insertCourseProduct(db.client, "zz-domestic-retreat");
    await db.client.query(
      `INSERT INTO retreats (slug, title, location, start_date, end_date, product_id, course_id, published, settings)
       VALUES ('zz-domestic', 'ZZ Domestic', 'Somewhere', '2027-09-01', '2027-09-05', $1, $2, true,
               '{"gallery":{"mode":"open","uploadsMode":"open"}}'::jsonb)`,
      [other.productId, other.courseId],
    );
    await db.client.query(`INSERT INTO access_grants (member_id, product_id, source, status) VALUES ($1, $2, 'manual', 'active')`, [otherGuest.id, other.productId]);

    services = await import("../../services/retreats");
    const { default: express } = await import("express");
    const { requireMember } = await import("../../middleware/memberAuth");
    const { requireAuth } = await import("../../middleware/auth");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const { memberRetreatsRouter } = await import("./retreats");
    const { adminRetreatsRouter } = await import("../admin/retreats");
    const { retreatMediaRouter } = await import("../public/retreatMedia");
    const app = express();
    app.use(express.json());
    app.use("/api/member", requireMember, memberRetreatsRouter);
    app.use("/api/admin/retreats", requireAuth, adminRetreatsRouter);
    app.use("/api", retreatMediaRouter);
    app.use(errorHandler);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    ownerToken = (await adminSession("owner")).token;
    emailBaseline = (await db.client.query(`SELECT count(*)::int AS n FROM email_messages`)).rows[0].n;
    supportToken = (await adminSession("support")).token;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
    if (services) await (await import("../../db/pool")).pool.end().catch(() => undefined);
    await db?.drop();
  });

  it("migration 218 seeds Bali unpublished, as its own draft product, granted to nobody", async () => {
    const row = await db.client.query(
      `SELECT r.published, r.start_date::text AS start_date, r.end_date::text AS end_date, r.timezone, p.status, p.kind,
              c.published AS course_published, l.tool_key, l.tool_config
         FROM retreats r JOIN products p ON p.id = r.product_id JOIN courses c ON c.id = r.course_id
         JOIN course_modules m ON m.course_id = c.id JOIN course_lessons l ON l.module_id = m.id
        WHERE r.slug = 'bali-2027'`,
    );
    expect(row.rows[0]).toMatchObject({
      published: false,
      start_date: "2027-06-15",
      end_date: "2027-06-20",
      timezone: "America/Los_Angeles",
      status: "draft",
      kind: "course",
      course_published: false,
      tool_key: "flourishealer-retreat-dashboard",
      tool_config: { retreat: "bali-2027" },
    });
    const grants = await db.client.query(`SELECT count(*)::int AS n FROM access_grants WHERE product_id = $1`, [productId]);
    expect(grants.rows[0].n).toBe(0);
  });

  it("answers 404 to a granted guest while the retreat is unpublished", async () => {
    await db.client.query(`INSERT INTO access_grants (member_id, product_id, source, status) VALUES ($1, $3, 'manual', 'active'), ($2, $3, 'manual', 'active')`, [
      guestA.id,
      guestB.id,
      productId,
    ]);
    expect((await call("GET", dash, guestA.token)).status).toBe(404);
    expect((await call("GET", "/api/member/retreats", guestA.token)).body.retreats).toEqual([]);
  });

  it("keeps the organizer API to the owner and admins", async () => {
    expect((await call("GET", "/api/admin/retreats", supportToken)).status).toBe(403);
    expect((await call("GET", "/api/admin/retreats", guestA.token)).status).toBe(401);
    expect((await call("GET", "/api/admin/retreats", ownerToken)).status).toBe(200);
  });

  it("opens only to the retreat's own guests once the owner publishes", async () => {
    const published = await call("POST", `/api/admin/retreats/${retreatId}/publish`, ownerToken, { published: true });
    expect(published.status).toBe(200);
    expect(published.body.published).toBe(true);

    const a = await call("GET", dash, guestA.token);
    expect(a.status).toBe(200);
    expect(a.body.dashboardTitle).toBe("YOUR RETREAT DASHBOARD");
    expect(a.body.welcomeMessage.startsWith("We are so excited to have you join us in Ubud, Bali, June 15–20, 2027!")).toBe(true);
    expect(JSON.stringify(a.body)).not.toMatch(/\{\{/);
    expect(JSON.stringify(a.body)).not.toContain("Bali mornings");
    expect(a.body.retreat).toMatchObject({ startDate: "2027-06-15", endDate: "2027-06-20" });
    expect(a.body.payments.status).toBe("incomplete");
    expect(a.body.groupCall.confirmed).toBe(false);
    expect(a.body.details.shuttle.confirmed).toBe(false);
    expect((await call("GET", dash, outsider.token)).status).toBe(404);
    expect((await call("GET", dash, otherGuest.token)).status).toBe(404);
    expect((await call("GET", "/api/member/retreats/zz-domestic", guestA.token)).status).toBe(404);
    expect((await call("GET", "/api/member/retreats", guestA.token)).body.retreats.map((r: { slug: string }) => r.slug)).toEqual(["bali-2027"]);
  });

  const fp = `${dash}/questionnaires/flight-preferences`;

  it("keeps each guest's questionnaire answers to herself", async () => {
    const saved = await call("PUT", fp, guestA.token, { answers: { departure_airport: "LAX" }, submit: false, revision: 0 });
    expect(saved.status).toBe(200);
    expect(saved.body.response).toMatchObject({ state: "draft", answers: { departure_airport: "LAX" }, revision: 1 });

    const b = await call("GET", dash, guestB.token);
    expect(b.body.questionnaires.find((q: { key: string }) => q.key === "flight-preferences").response.state).toBe("none");
    expect(JSON.stringify(b.body)).not.toContain("LAX");

    // There is no way to name another guest: unknown body keys are refused.
    const smuggled = await call("PUT", fp, guestB.token, { answers: { departure_airport: "JFK" }, submit: false, revision: 0, memberId: guestA.id });
    expect(smuggled.status).toBe(400);
    const own = await call("PUT", fp, guestB.token, { answers: { departure_airport: "JFK" }, submit: false, revision: 0 });
    expect(own.status).toBe(200);
    const a = await call("GET", fp, guestA.token);
    expect(a.body.response.answers).toEqual({ departure_airport: "LAX" });
    expect((await call("GET", fp, outsider.token)).status).toBe(404);
    expect((await call("GET", fp, otherGuest.token)).status).toBe(404);
  });

  it("validates a submission, keeps drafts free, and refuses a stale revision", async () => {
    const missing = await call("PUT", fp, guestA.token, { answers: { departure_airport: "LAX" }, submit: true, revision: 1 });
    expect(missing.status).toBe(400);
    expect(Object.keys(missing.body.details.fieldErrors).sort()).toEqual(["connections", "group_travel"]);

    const stale = await call("PUT", fp, guestA.token, { answers: { departure_airport: "SFO" }, submit: false, revision: 0 });
    expect(stale.status).toBe(409);

    const submitted = await call("PUT", fp, guestA.token, {
      answers: { departure_airport: "LAX", connections: "One stop is fine", group_travel: "Yes" },
      submit: true,
      revision: 1,
    });
    expect(submitted.status).toBe(200);
    const a = await call("GET", dash, guestA.token);
    expect(a.body.checklist.find((i: { key: string }) => i.key === "questionnaire:flight-preferences").status).toBe("submitted");
    const history = await db.client.query(`SELECT count(*)::int AS n FROM retreat_questionnaire_submissions`);
    expect(history.rows[0].n).toBe(1);
  });

  it("lets a guest report her passport Submitted but never Verified, and blocks 'view as member' writes", async () => {
    const reported = await call("POST", `${dash}/tasks/passport`, guestA.token, { done: true });
    expect(reported.body.status).toBe("submitted");
    expect((await call("POST", `${dash}/tasks/agreement`, guestA.token, { done: true })).status).toBe(404);
    expect((await call("POST", `${dash}/tasks/payments`, guestA.token, { done: true })).status).toBe(404);
    expect((await call("POST", `${dash}/tasks/guest_profile`, guestA.token, { done: true })).status).toBe(404);
    expect((await call("POST", `${dash}/tasks/passport`, guestA.token, { done: true, status: "verified" })).status).toBe(400);
    expect((await call("POST", `${dash}/tasks/passport`, impersonatedA, { done: true })).status).toBe(403);
    expect((await call("PUT", fp, impersonatedA, { answers: {}, submit: false, revision: 2 })).status).toBe(403);
    expect((await call("GET", dash, impersonatedA)).status).toBe(200);

    const b = await call("GET", dash, guestB.token);
    expect(b.body.checklist.find((i: { key: string }) => i.key === "passport").status).toBe("not_started");
    // Travel insurance is guidance only: no checklist item, no form.
    expect(b.body.checklist.map((i: { key: string }) => i.key)).not.toContain("travel_insurance");
    expect(b.body.insurance).toEqual({ show: true });
  });

  it("shows the agreement as signed only from the signing record, and never its title", async () => {
    const contract = await db.client.query<{ id: string }>(
      `INSERT INTO participant_contracts (title, storage_ref, pdf_sha256) VALUES ('Bali Retreat Agreement ZZ Month 2026', 'protected:zz.pdf', repeat('a', 64)) RETURNING id`,
    );
    const contractId = Number(contract.rows[0].id);
    await db.client.query(`INSERT INTO retreat_contracts (retreat_id, contract_id) VALUES ($1, $2)`, [retreatId, contractId]);
    const assignment = await db.client.query<{ id: string }>(
      `INSERT INTO participant_contract_assignments (contract_id, member_id) VALUES ($1, $2) RETURNING id`,
      [contractId, guestA.id],
    );
    let a = await call("GET", dash, guestA.token);
    expect(a.body.agreement).toMatchObject({ status: "not_started", awaitingSignature: true });
    await db.client.query(`UPDATE participant_contract_assignments SET status = 'signed', signed_at = now() WHERE id = $1`, [assignment.rows[0].id]);
    a = await call("GET", dash, guestA.token);
    expect(a.body.agreement.status).toBe("verified");
    expect(JSON.stringify(a.body)).not.toContain("ZZ Month");
    const b = await call("GET", dash, guestB.token);
    expect(b.body.agreement).toMatchObject({ status: "not_started", awaitingSignature: false });
  });

  it("lets only the organizer verify, with the guest seeing a correction note", async () => {
    const qid = (await db.client.query(`SELECT id FROM retreat_questionnaires WHERE retreat_id = $1 AND key = 'flight-preferences'`, [retreatId])).rows[0].id;
    const review = await call("PUT", `/api/admin/retreats/${retreatId}/guests/${guestA.id}/questionnaires/${qid}/review`, ownerToken, {
      status: "needs_attention",
      note: "Please add your return date",
    });
    expect(review.status).toBe(200);
    const a = await call("GET", dash, guestA.token);
    const item = a.body.checklist.find((i: { key: string }) => i.key === "questionnaire:flight-preferences");
    expect(item).toMatchObject({ status: "needs_attention", reviewNote: "Please add your return date" });
    const b = await call("GET", dash, guestB.token);
    expect(JSON.stringify(b.body)).not.toContain("Please add your return date");
    expect((await call("PUT", `/api/admin/retreats/${retreatId}/guests/${guestA.id}/tasks/agreement`, ownerToken, { status: "verified" })).status).toBe(400);
    expect((await call("PUT", `/api/admin/retreats/${retreatId}/guests/${outsider.id}/tasks/passport`, ownerToken, { status: "verified" })).status).toBe(404);
  });

  it("keeps the gallery private to this retreat's guests, even through a direct link", async () => {
    const opened = await call("PUT", `/api/admin/retreats/${retreatId}`, ownerToken, { settings: { gallery: { mode: "open", uploadsMode: "open" } } });
    expect(opened.status).toBe(200);

    const dir = path.join(protectedDir, "retreat-memories", `r${retreatId}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "approved.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    fs.writeFileSync(path.join(dir, "pending.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]));
    const insert = async (name: string, status: string) =>
      (
        await db.client.query<{ id: number }>(
          `INSERT INTO retreat_media (retreat_id, member_id, storage_ref, mime, kind, size_bytes, sharing_consent, status)
           VALUES ($1, $2, $3, 'image/jpeg', 'photo', 7, true, $4) RETURNING id`,
          [retreatId, guestA.id, `protected:retreat-memories/r${retreatId}/${name}`, status],
        )
      ).rows[0].id;
    const approvedId = await insert("approved.jpg", "approved");
    const pendingId = await insert("pending.jpg", "pending");

    const listB = await call("GET", `${dash}/memories`, guestB.token);
    expect(listB.status).toBe(200);
    expect(listB.body.items.map((i: { id: number }) => i.id)).toEqual([approvedId]);
    const listA = await call("GET", `${dash}/memories`, guestA.token);
    expect(listA.body.items.map((i: { id: number }) => i.id).sort()).toEqual([approvedId, pendingId].sort());

    expect((await call("GET", `${dash}/memories`, otherGuest.token)).status).toBe(404);
    expect((await call("GET", `${dash}/memories`, outsider.token)).status).toBe(404);

    // B's own signed link works…
    const url = listB.body.items[0].url as string;
    const ok = await fetch(base + url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    // …a link minted for a guest of another retreat does not, nor for B on A's pending upload.
    const foreign = services.signMediaToken({ audience: "m", principalId: otherGuest.id, mediaId: approvedId });
    expect((await fetch(`${base}/api/retreat-media/${foreign}`)).status).toBe(404);
    const peek = services.signMediaToken({ audience: "m", principalId: guestB.id, mediaId: pendingId });
    expect((await fetch(`${base}/api/retreat-media/${peek}`)).status).toBe(404);

    // B cannot delete A's photo; A can, and then nobody can fetch it.
    expect((await call("DELETE", `${dash}/memories/${approvedId}`, guestB.token)).status).toBe(404);
    expect((await call("POST", `${dash}/memories/${pendingId}/report`, guestB.token, { reason: "x" })).status).toBe(404);
    expect((await call("POST", `${dash}/memories/${approvedId}/report`, guestB.token, { reason: "Please remove" })).status).toBe(200);
    expect((await call("DELETE", `${dash}/memories/${approvedId}`, guestA.token)).status).toBe(200);
    expect((await fetch(base + url)).status).toBe(404);
  });

  it("accepts a guest upload only with the sharing acknowledgement and a real image", async () => {
    const upload = async (bytes: Buffer, name: string, consent: boolean) => {
      const form = new FormData();
      form.append("file", new Blob([bytes]), name);
      form.append("caption", "Sunset");
      form.append("sharingConsent", consent ? "true" : "false");
      const response = await fetch(`${base}${dash}/memories`, { method: "POST", headers: { Authorization: `Bearer ${guestB.token}` }, body: form });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
    expect((await upload(jpeg, "a.jpg", false)).status).toBe(400);
    expect((await upload(Buffer.from("<svg onload=alert(1)>"), "a.jpg", true)).status).toBe(400);
    const ok = await upload(jpeg, "a.jpg", true);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ status: "pending", mine: true, kind: "photo" });
    const stored = await db.client.query<{ storage_ref: string; sharing_consent: boolean }>(`SELECT storage_ref, sharing_consent FROM retreat_media WHERE id = $1`, [ok.body.id]);
    expect(stored.rows[0].storage_ref.startsWith(`protected:retreat-memories/r${retreatId}/`)).toBe(true);
    // Not visible to the other guest until the owner approves it.
    const listA = await call("GET", `${dash}/memories`, guestA.token);
    expect(listA.body.items.map((i: { id: number }) => i.id)).not.toContain(ok.body.id);
  });

  it("keeps feedback and interest per guest, and gates publication on consent", async () => {
    expect((await call("PUT", `${dash}/feedback`, guestA.token, { answers: { rating: 5 }, submit: true })).status).toBe(403);
    await call("PUT", `/api/admin/retreats/${retreatId}`, ownerToken, { settings: { feedback: { mode: "open" }, interest: { mode: "open" } } });

    const saved = await call("PUT", `${dash}/feedback`, guestA.token, {
      answers: { rating: 5, favoriteMoment: "The flower bath" },
      testimonialText: "",
      testimonialConsent: "no",
      testimonialRole: "",
      submit: true,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.current.state).toBe("submitted");
    expect((await call("GET", `${dash}/feedback`, guestB.token)).body.current.state).toBe("none");

    const rows = await call("GET", `/api/admin/retreats/${retreatId}/feedback`, ownerToken);
    const feedbackId = rows.body.feedback[0].id as number;
    expect((await call("PUT", `/api/admin/retreats/${retreatId}/feedback/${feedbackId}/publication`, ownerToken, { approved: true })).status).toBe(400);

    const interest = await call("PUT", `${dash}/interest`, guestA.token, { interest: "both", destinations: "Portugal", marketingOptIn: true });
    expect(interest.status).toBe(200);
    expect((await call("GET", `${dash}/interest`, guestB.token)).body.current.interest).toBeNull();
    const stored = await db.client.query(`SELECT retreat_id, interest, marketing_opt_in FROM retreat_interest WHERE member_id = $1`, [guestA.id]);
    expect(stored.rows).toEqual([{ retreat_id: retreatId, interest: "both", marketing_opt_in: true }]);
    const feedbackRow = await db.client.query(`SELECT submitted_at IS NOT NULL AS submitted FROM retreat_feedback WHERE retreat_id = $1 AND member_id = $2`, [retreatId, guestA.id]);
    expect(feedbackRow.rows[0].submitted).toBe(true);
  });

  it("never sends email or grants access as a side effect", async () => {
    const grants = await db.client.query(`SELECT count(*)::int AS n FROM access_grants WHERE product_id = $1`, [productId]);
    expect(grants.rows[0].n).toBe(2);
    const outbox = await db.client.query(`SELECT count(*)::int AS n FROM email_messages`);
    expect(outbox.rows[0].n).toBe(emailBaseline);
  });
});
