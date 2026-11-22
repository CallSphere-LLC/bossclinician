import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember } from "../../testing/db";

/**
 * Yvette's item 7 (migration 224) against a scratch Postgres with every
 * migration replayed:
 *   * granting / removing dashboard access has NO side effect — no order, plan,
 *     installment, balance, email, notice, domain event, webhook, automation
 *     run, sequence or alumni enrolment, no contact, no other product;
 *   * the booking email must match the account email, or be accepted;
 *   * the access email is preview-only until an explicit send, mints a
 *     set-password link only on send, and never carries a placeholder;
 *   * editing a questionnaire never rewrites a submitted answer or its wording;
 *   * "shared-room guests only" questions follow the guest's room;
 *   * duplicating a retreat copies settings + questionnaires and nothing personal;
 *   * one guest can never read another guest's answers or files.
 * The mailer is mocked: nothing leaves the machine.
 */
const { sendMail } = vi.hoisted(() => ({
  sendMail: vi.fn(async () => ({ messageId: 1, sent: true, providerMessageId: "zz", error: "" })),
}));
vi.mock("../../email/mailer", async (importOriginal) => ({ ...(await importOriginal<object>()), sendMail }));

describe.skipIf(!hasTestDatabase)("retreat questionnaires, access and duplicate (scratch Postgres)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server | undefined;
  let base: string;
  let retreatId: number;
  let productId: number;
  let bookingProductId: number;
  let ownerToken: string;
  let sharon: { id: number; token: string };
  let guestB: { id: number; token: string };
  let profileId: number;
  const dash = "/api/member/retreats/bali-2027";
  const profile = `${dash}/questionnaires/retreat-profile`;

  async function call(method: string, url: string, token?: string, body?: unknown) {
    const response = await fetch(base + url, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: response.status, body: json, headers: response.headers };
  }

  const count = async (sql: string, params: unknown[] = []) => (await db.client.query(sql, params)).rows[0].n as number;

  /** Every table a purchase, an automation or an email would touch. */
  async function sideEffects() {
    return {
      orders: await count(`SELECT count(*)::int n FROM orders`),
      plans: await count(`SELECT count(*)::int n FROM payment_plans`),
      installments: await count(`SELECT count(*)::int n FROM payment_plan_installments`),
      sequences: await count(`SELECT count(*)::int n FROM sequence_subscriptions`),
      alumni: await count(`SELECT count(*)::int n FROM retreat_alumni_enrolments`),
      tags: await count(`SELECT count(*)::int n FROM contact_tags`),
      runs: await count(`SELECT count(*)::int n FROM automation_runs`),
      events: await count(`SELECT count(*)::int n FROM domain_events`),
      webhooks: await count(`SELECT count(*)::int n FROM webhook_deliveries`),
      notices: await count(`SELECT count(*)::int n FROM member_notifications`),
      emails: await count(`SELECT count(*)::int n FROM email_messages`),
      contacts: await count(`SELECT count(*)::int n FROM contacts`),
      otherGrants: await count(`SELECT count(*)::int n FROM access_grants WHERE product_id <> $1`, [productId]),
      resets: await count(`SELECT count(*)::int n FROM member_password_resets`),
    };
  }

  const fullProfile = {
    full_legal_name: "Sharon ZZ Smith",
    preferred_name: "Sharon",
    mailing_address: "1 ZZ Street",
    phone: "555-0100",
    email: "zz@test.invalid",
    departure_city: "Las Vegas, NV — LAS Airport",
    emergency_contact: "ZZ Partner",
    emergency_phone: "555-0101",
    health_conditions: "ZZ-HEALTH-SECRET",
    massage_comfort: "I prefer not to receive a massage.",
    diet: ["Vegan", "Gluten free"],
    allergies: "ZZ-ALLERGY-SECRET",
    drinks: ["Mocktails and non-alcoholic options"],
    drink_favorite: "Sparkling water",
    snacks: "ZZ-SNACKS",
    coffee_tea: "Tea, no sugar",
    size: "M",
    hopes: "Rest",
    shared_room_friend: "Should be ignored",
  };

  beforeAll(async () => {
    db = await createTestDatabase("retreat_extras");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "retreat-extras-test-secret";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "retreat-q-"));
    process.env.UPLOAD_DIR = path.join(root, "public");
    process.env.PROTECTED_UPLOAD_DIR = path.join(root, "protected");
    fs.mkdirSync(process.env.PROTECTED_UPLOAD_DIR, { recursive: true });

    const retreat = (await db.client.query(`SELECT id, product_id FROM retreats WHERE slug = 'bali-2027'`)).rows[0];
    retreatId = retreat.id;
    productId = retreat.product_id;
    // Test DBs have no product 70; give Bali a booking product like live.
    bookingProductId = (await insertCourseProduct(db.client, "zz-bali-booking")).productId;
    await db.client.query(`UPDATE retreats SET booking_product_id = $2 WHERE id = $1`, [retreatId, bookingProductId]);
    profileId = (await db.client.query(`SELECT id FROM retreat_questionnaires WHERE retreat_id = $1 AND key = 'retreat-profile'`, [retreatId])).rows[0].id;

    const { signMemberAccessToken } = await import("../../auth/memberSession");
    const member = async (label: string) => {
      const email = `zz-extras-${label}@test.invalid`;
      const id = await insertMember(db.client, email, { name: `ZZ ${label}` });
      return { id, token: signMemberAccessToken({ sub: id, email }) };
    };
    sharon = await member("sharon");
    guestB = await member("guest-b");
    // Like the Kajabi bookings: an imported booking grant, no password, no order.
    await db.client.query(`INSERT INTO access_grants (member_id, product_id, source, status) VALUES ($1, $2, 'import', 'active')`, [sharon.id, bookingProductId]);

    const { signToken } = await import("../../utils/jwt");
    const { hashToken } = await import("../../auth/tokens");
    const ownerId = (
      await db.client.query(`INSERT INTO admin_users (email,password_hash,name,role) VALUES ('zz-extras-owner@test.invalid','unused','ZZ Owner','owner') RETURNING id`)
    ).rows[0].id;
    ownerToken = signToken({ sub: ownerId, email: "zz-extras-owner@test.invalid", role: "owner" });
    await db.client.query(
      `INSERT INTO admin_sessions (admin_user_id,token_hash,expires_at,last_used_at) VALUES ($1,$2,now()+interval '1 hour',now())`,
      [ownerId, hashToken(ownerToken)],
    );

    const { default: express } = await import("express");
    const { requireMember } = await import("../../middleware/memberAuth");
    const { requireAuth } = await import("../../middleware/auth");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const { memberRetreatsRouter } = await import("../member/retreats");
    const { adminRetreatsRouter } = await import("./retreats");
    const app = express();
    app.use(express.json());
    app.use("/api/member", requireMember, memberRetreatsRouter);
    app.use("/api/admin/retreats", requireAuth, adminRetreatsRouter);
    app.use(errorHandler);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await (await import("../../db/pool")).pool.end().catch(() => undefined);
    await db?.drop();
  });

  const admin = (url: string) => `/api/admin/retreats/${retreatId}${url}`;

  it("seeds the three Bali questionnaires as version 1 with Yvette's changes", async () => {
    const list = await call("GET", admin("/questionnaires"), ownerToken);
    expect(list.status).toBe(200);
    expect(list.body.questionnaires.map((q: any) => [q.key, q.version])).toEqual([
      ["retreat-profile", 1],
      ["flight-preferences", 1],
      ["flight-details", 1],
    ]);
    const text = JSON.stringify(list.body.questionnaires[0].definition);
    expect(text).toContain("If you arranged a shared room with a friend, please enter her full name.");
    expect(text).toContain("Are there any planned activities you would prefer to skip or discuss with us beforehand?");
    expect(text).toContain("I prefer not to receive a massage.");
    expect(text).toContain(
      "Are there any mobility, accessibility, or participation needs you would like us to consider? Please share only information relevant to arranging your retreat experience.",
    );
    expect(text).not.toContain("completely confidential");
    expect(text).not.toContain("alternative treatment");
    expect(text).not.toContain("roommate");
    expect(text).not.toContain("Bali mornings");
  });

  it("grants the dashboard with no purchase, payment, email, automation or alumni side effect", async () => {
    const before = await sideEffects();
    const granted = await call("POST", admin("/access"), ownerToken, { memberId: sharon.id, bookingEmail: "ZZ-EXTRAS-SHARON@test.invalid" });
    expect(granted.status, JSON.stringify(granted.body)).toBe(201);
    expect(granted.body).toMatchObject({ memberId: sharon.id, created: false });
    // A new guest without an account: created through the normal "added by the owner" account (no password, no contact).
    const created = await call("POST", admin("/access"), ownerToken, { email: "zz-extras-new@test.invalid", name: "ZZ New Guest" });
    expect(created.status).toBe(201);
    expect(created.body.created).toBe(true);
    // Granting the same email again matches the existing account instead of duplicating it.
    const again = await call("POST", admin("/access"), ownerToken, { email: "ZZ-EXTRAS-NEW@test.invalid" });
    expect(again.body).toMatchObject({ memberId: created.body.memberId, created: false, alreadyHadAccess: true });
    expect(await count(`SELECT count(*)::int n FROM members WHERE lower(email::text) = 'zz-extras-new@test.invalid'`)).toBe(1);

    expect(await sideEffects()).toEqual(before);
    expect(sendMail).not.toHaveBeenCalled();
    const grants = await db.client.query(`SELECT member_id, source, status FROM access_grants WHERE product_id = $1 ORDER BY member_id`, [productId]);
    expect(grants.rows).toEqual([
      { member_id: sharon.id, source: "manual", status: "active" },
      { member_id: created.body.memberId, source: "manual", status: "active" },
    ]);
    // Her booking grant (import) is untouched.
    expect((await db.client.query(`SELECT source, status FROM access_grants WHERE member_id = $1 AND product_id = $2`, [sharon.id, bookingProductId])).rows[0]).toEqual({
      source: "import",
      status: "active",
    });
    const newMember = (await db.client.query(`SELECT password_hash, contact_id FROM members WHERE id = $1`, [created.body.memberId])).rows[0];
    expect(newMember).toEqual({ password_hash: null, contact_id: null });
  });

  it("flags a booking email that differs from the account email until it is accepted", async () => {
    const refused = await call("POST", admin("/access"), ownerToken, { memberId: guestB.id, bookingEmail: "someone-else@test.invalid" });
    expect(refused.status).toBe(409);
    expect(refused.body.details).toMatchObject({ code: "email_mismatch", bookingEmail: "someone-else@test.invalid", accountEmail: "zz-extras-guest-b@test.invalid" });
    expect(await count(`SELECT count(*)::int n FROM access_grants WHERE member_id = $1 AND product_id = $2`, [guestB.id, productId])).toBe(0);
    const accepted = await call("POST", admin("/access"), ownerToken, { memberId: guestB.id, bookingEmail: "someone-else@test.invalid", acceptEmailMismatch: true });
    expect(accepted.status).toBe(201);
    const record = (await db.client.query(`SELECT booking_email, email_mismatch_accepted FROM retreat_guests WHERE retreat_id = $1 AND member_id = $2`, [retreatId, guestB.id])).rows[0];
    expect(record).toEqual({ booking_email: "someone-else@test.invalid", email_mismatch_accepted: true });
  });

  it("previews the access email without minting a link, and sends only on an explicit action", async () => {
    const before = await count(`SELECT count(*)::int n FROM member_password_resets`);
    const preview = await call("GET", admin(`/guests/${sharon.id}/access-email`), ownerToken);
    expect(preview.status).toBe(200);
    expect(preview.body.includesPasswordSetup).toBe(true);
    expect(preview.body.text).toContain("This is access for your existing reservation. No new purchase is required.");
    expect(preview.body.text).toContain("/retreats/dashboard/bali-2027");
    expect(preview.body.text).toContain("SAMPLE-LINK-CREATED-WHEN-SENT");
    expect(preview.body.blockers.join(" ")).toContain("Publish");
    expect(await count(`SELECT count(*)::int n FROM member_password_resets`)).toBe(before);

    // Unpublished: refused, nothing sent.
    expect((await call("POST", admin(`/guests/${sharon.id}/access-email`), ownerToken, { confirm: true })).status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();

    await call("POST", admin("/publish"), ownerToken, { published: true });
    expect((await call("POST", admin(`/guests/${sharon.id}/access-email`), ownerToken, {})).status).toBe(400);
    const sent = await call("POST", admin(`/guests/${sharon.id}/access-email`), ownerToken, { confirm: true });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = (sendMail.mock.calls[0] as unknown as [Record<string, string>])[0];
    expect(mail.to).toBe("zz-extras-sharon@test.invalid");
    expect(mail.replyTo).toBe("retreats@bossclinician.com");
    expect(mail.text).toMatch(/\/reset-password\/[^\s?]+\?next=%2Fretreats%2Fdashboard%2Fbali-2027/);
    expect(mail.text).not.toContain("SAMPLE-LINK");
    expect(`${mail.subject}${mail.text}${mail.html}`).not.toMatch(/\{\{|\}\}/);
    expect(mail.text).toContain("No new purchase is required.");
    expect(await count(`SELECT count(*)::int n FROM member_password_resets WHERE member_id = $1`, [sharon.id])).toBe(1);
    expect((await db.client.query(`SELECT welcome_send_count FROM retreat_guests WHERE retreat_id = $1 AND member_id = $2`, [retreatId, sharon.id])).rows[0].welcome_send_count).toBe(1);
  });

  it("hides the shared-room question unless her room is shared, and ignores answers to it", async () => {
    let view = await call("GET", profile, sharon.token);
    const ids = (v: any) => v.body.definition.sections.flatMap((s: any) => s.questions.map((q: any) => q.id));
    expect(ids(view)).not.toContain("shared_room_friend");
    const saved = await call("PUT", profile, sharon.token, { answers: fullProfile, submit: true, revision: 0 });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.response.state).toBe("submitted");
    let stored = (await db.client.query(`SELECT answers FROM retreat_questionnaire_responses WHERE questionnaire_id = $1 AND member_id = $2`, [profileId, sharon.id])).rows[0];
    expect(stored.answers.shared_room_friend).toBeUndefined();
    expect(stored.answers.diet).toEqual(["Vegan", "Gluten free"]);

    expect((await call("PUT", admin(`/guests/${sharon.id}/room-type`), ownerToken, { roomType: "shared" })).status).toBe(200);
    view = await call("GET", profile, sharon.token);
    expect(ids(view)).toContain("shared_room_friend");
    const preview = await call("GET", admin("/preview?audience=all"), ownerToken);
    expect(JSON.stringify(preview.body.questionnaires)).toContain("shared_room_friend");
    const privatePreview = await call("GET", admin("/preview?audience=private"), ownerToken);
    expect(JSON.stringify(privatePreview.body.questionnaires)).not.toContain("shared_room_friend");
    await call("PUT", admin(`/guests/${sharon.id}/room-type`), ownerToken, { roomType: null });
    stored = (await db.client.query(`SELECT revision FROM retreat_questionnaire_responses WHERE questionnaire_id = $1 AND member_id = $2`, [profileId, sharon.id])).rows[0];
    expect(stored.revision).toBe(1);
  });

  it("never rewrites a submitted answer or its wording when the owner edits the questionnaire", async () => {
    const list = await call("GET", admin("/questionnaires"), ownerToken);
    const q = list.body.questionnaires.find((x: any) => x.key === "retreat-profile");
    const edited = structuredClone(q.definition);
    const basics = edited.sections[0];
    basics.questions.find((x: any) => x.id === "preferred_name").label = "What should we call you?";
    const food = edited.sections.find((s: any) => s.id === "food_drink");
    food.questions = food.questions.filter((x: any) => x.id !== "snacks");
    basics.questions.push({ id: "zz_new", type: "yes_no", label: "ZZ new question", help: "", required: true, options: [], showTo: "all", showIf: null, sensitive: false });
    const submissionBefore = (await db.client.query(`SELECT answers, question_snapshot, version FROM retreat_questionnaire_submissions ORDER BY id`)).rows;

    const saved = await call("PUT", admin(`/questionnaires/${q.id}`), ownerToken, { definition: edited });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ version: 2, newVersion: true });
    // Saving the same wording again makes no new version.
    expect((await call("PUT", admin(`/questionnaires/${q.id}`), ownerToken, { definition: edited })).body).toMatchObject({ version: 2, newVersion: false });

    const v1 = (await db.client.query(`SELECT definition FROM retreat_questionnaire_versions WHERE questionnaire_id = $1 AND version = 1`, [q.id])).rows[0].definition;
    expect(JSON.stringify(v1)).toContain("Preferred Name (Nickname)");
    expect((await db.client.query(`SELECT answers, question_snapshot, version FROM retreat_questionnaire_submissions ORDER BY id`)).rows).toEqual(submissionBefore);

    const detail = await call("GET", admin(`/guests/${sharon.id}`), ownerToken);
    const answers = detail.body.questionnaires.find((x: any) => x.key === "retreat-profile").answers;
    expect(answers.find((a: any) => a.questionId === "preferred_name")).toMatchObject({ label: "Preferred Name (Nickname)", askedInVersion: 1, value: "Sharon" });
    expect(answers.find((a: any) => a.questionId === "snacks")).toMatchObject({ removedFromQuestionnaire: true, value: "ZZ-SNACKS" });

    // She updates her profile under version 2: the removed question's answer is kept with its old wording.
    const view = await call("GET", profile, sharon.token);
    const resaved = await call("PUT", profile, sharon.token, { answers: { ...view.body.response.answers, preferred_name: "Shar" }, submit: false, revision: view.body.response.revision });
    expect(resaved.status).toBe(200);
    const row = (await db.client.query(`SELECT version, answers, question_snapshot FROM retreat_questionnaire_responses WHERE questionnaire_id = $1 AND member_id = $2`, [profileId, sharon.id])).rows[0];
    expect(row.version).toBe(2);
    expect(row.answers.snacks).toBe("ZZ-SNACKS");
    expect(row.question_snapshot.snacks).toMatchObject({ label: "What are your favorite snacks?", version: 1 });
    expect(row.question_snapshot.preferred_name).toMatchObject({ label: "What should we call you?", version: 2 });
    // Submitting under v2 needs the new required question.
    const missing = await call("PUT", profile, sharon.token, { answers: { ...row.answers }, submit: true, revision: resaved.body.response.revision });
    expect(missing.status).toBe(400);
    expect(Object.keys(missing.body.fieldErrors)).toEqual(["zz_new"]);
    // An answered questionnaire cannot be deleted.
    expect((await call("DELETE", admin(`/questionnaires/${q.id}`), ownerToken)).status).toBe(409);
  });

  it("keeps each guest's answers, files and payments to herself", async () => {
    // Sharon uploads a photo; guest B can neither list nor fetch it.
    const form = new FormData();
    form.append("questionId", "photo");
    form.append("file", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])]), "me.jpg");
    const uploaded = await fetch(`${base}${profile}/files`, { method: "POST", headers: { Authorization: `Bearer ${sharon.token}` }, body: form });
    expect(uploaded.status).toBe(201);
    const file = (await uploaded.json()) as { id: number };
    expect((await fetch(`${base}${profile}/files/${file.id}`, { headers: { Authorization: `Bearer ${sharon.token}` } })).status).toBe(200);
    expect((await fetch(`${base}${profile}/files/${file.id}`, { headers: { Authorization: `Bearer ${guestB.token}` } })).status).toBe(404);
    // A file id that isn't hers is ignored as an answer.
    const smuggle = await call("PUT", profile, guestB.token, { answers: { photo: file.id }, submit: false, revision: 0 });
    expect(smuggle.status).toBe(200);
    expect(smuggle.body.response.answers.photo).toBeUndefined();

    const b = await call("GET", dash, guestB.token);
    const text = JSON.stringify(b.body);
    for (const secret of ["ZZ-HEALTH-SECRET", "ZZ-ALLERGY-SECRET", "ZZ-SNACKS", "Sharon ZZ Smith", "zz-extras-sharon"]) expect(text).not.toContain(secret);
    expect(b.body.payments.status).toBe("incomplete");
    // Guests cannot reach the organizer API at all.
    expect((await call("GET", admin("/guests"), sharon.token)).status).toBe(401);

    // Health answers stay out of the export unless asked for.
    const csv = await call("GET", admin(`/questionnaires/${profileId}/responses.csv`), ownerToken);
    expect(csv.body.raw).not.toContain("ZZ-HEALTH-SECRET");
    expect(csv.body.raw).toContain("Vegan; Gluten free");
    const withHealth = await call("GET", admin(`/questionnaires/${profileId}/responses.csv?sensitive=1`), ownerToken);
    expect(withHealth.body.raw).toContain("ZZ-HEALTH-SECRET");
  });

  it("removes access without touching her answers, and gives it back intact", async () => {
    expect((await call("DELETE", admin(`/access/${sharon.id}`), ownerToken)).body.revoked).toBe(true);
    expect((await call("GET", dash, sharon.token)).status).toBe(404);
    expect((await call("GET", profile, sharon.token)).status).toBe(404);
    expect(await count(`SELECT count(*)::int n FROM retreat_questionnaire_responses WHERE member_id = $1`, [sharon.id])).toBe(1);
    expect((await db.client.query(`SELECT status FROM access_grants WHERE member_id = $1 AND product_id = $2`, [sharon.id, bookingProductId])).rows[0].status).toBe("active");
    const before = await sideEffects();
    expect((await call("POST", admin("/access"), ownerToken, { memberId: sharon.id })).status).toBe(201);
    expect(await sideEffects()).toEqual(before);
    expect((await call("GET", profile, sharon.token)).body.response.answers.preferred_name).toBe("Shar");

    // A guest with no booking product stays listed (with her answers) after her access is removed.
    await call("DELETE", admin(`/access/${guestB.id}`), ownerToken);
    const list = await call("GET", admin("/guests"), ownerToken);
    expect(list.body.guests.find((g: any) => g.memberId === guestB.id)).toMatchObject({ hasDashboardAccess: false, accessRemovedAt: expect.any(String) });
    expect((await call("GET", admin(`/guests/${guestB.id}`), ownerToken)).status).toBe(200);
  });

  it("duplicates a retreat as a new draft with settings and questionnaires, and nothing personal", async () => {
    await call("PUT", admin(""), ownerToken, { settings: { shuttle: { confirmed: true, details: "ZZ 10am" } } });
    const dup = await call("POST", admin("/duplicate"), ownerToken, {
      title: "FlourisHealer ZZ 2028",
      slug: "zz-costa-rica-2028",
      location: "ZZ Costa Rica",
      startDate: "2028-03-01",
      endDate: "2028-03-06",
      airport: "ZZ Airport",
    });
    expect(dup.status, JSON.stringify(dup.body)).toBe(201);
    const id = dup.body.id as number;
    const row = (
      await db.client.query(
        `SELECT r.published, r.booking_product_id, r.settings, p.status AS product_status, c.published AS course_published, l.tool_config
           FROM retreats r JOIN products p ON p.id = r.product_id JOIN courses c ON c.id = r.course_id
           JOIN course_modules m ON m.course_id = c.id JOIN course_lessons l ON l.module_id = m.id WHERE r.id = $1`,
        [id],
      )
    ).rows[0];
    expect(row).toMatchObject({ published: false, booking_product_id: null, product_status: "draft", course_published: false, tool_config: { retreat: "zz-costa-rica-2028" } });
    expect(row.settings.shuttle).toEqual({ confirmed: false, details: "" });
    expect(row.settings.airport).toBe("ZZ Airport");
    expect(row.settings.welcomeMessage).toContain("{{destination}}");
    const qs = (await db.client.query(`SELECT key, current_version FROM retreat_questionnaires WHERE retreat_id = $1 ORDER BY sort`, [id])).rows;
    expect(qs).toEqual([
      { key: "retreat-profile", current_version: 1 },
      { key: "flight-preferences", current_version: 1 },
      { key: "flight-details", current_version: 1 },
    ]);
    // The copy carries the edited (version 2) wording of Bali's profile.
    const copied = (await db.client.query(
      `SELECT v.definition FROM retreat_questionnaire_versions v JOIN retreat_questionnaires q ON q.id = v.questionnaire_id WHERE q.retreat_id = $1 AND q.key = 'retreat-profile'`,
      [id],
    )).rows[0].definition;
    expect(JSON.stringify(copied)).toContain("What should we call you?");
    for (const table of ["retreat_offers", "retreat_contracts", "retreat_guests", "retreat_announcements", "retreat_media", "retreat_offer_cards"]) {
      expect(await count(`SELECT count(*)::int n FROM ${table} WHERE retreat_id = $1`, [id])).toBe(0);
    }
    expect(await count(`SELECT count(*)::int n FROM retreat_questionnaire_responses r JOIN retreat_questionnaires q ON q.id = r.questionnaire_id WHERE q.retreat_id = $1`, [id])).toBe(0);
    expect(await count(`SELECT count(*)::int n FROM access_grants g JOIN retreats r ON r.product_id = g.product_id WHERE r.id = $1`, [id])).toBe(0);
    // Slugs are unique.
    expect((await call("POST", admin("/duplicate"), ownerToken, { title: "Again", slug: "zz-costa-rica-2028", startDate: "2028-03-01", endDate: "2028-03-06" })).status).toBe(400);
  });
});
