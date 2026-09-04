import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Client } from "pg";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;

/**
 * Practical acceptance coverage for the parity work. These are deliberately
 * recognisable business records rather than `foo`/`bar`: when a failure leaves
 * a row in a scratch database, the scenario can be understood from the row.
 */
describeDb("Kajabi parity admin workflows (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("parity_admin");
    client = db.client;
    await client.query(
      `INSERT INTO admin_users (id, email, password_hash, name, role)
       VALUES (1, 'owner@bossclinician.test', 'not-used-in-route-tests', 'Test Owner', 'owner')`,
    );
    process.env.DATABASE_URL = db.url;
    process.env.STRIPE_SECRET_KEY = "";
    process.env.JWT_SECRET ??= "parity-integration-secret";

    const [
      { adminContactsRouter },
      { adminSalesRouter },
      { adminCurriculumRouter },
      { adminOffersRouter },
      { adminGrowthRouter },
      { adminAssessmentsRouter },
      { adminUsersRouter },
      { offersRouter },
      { checkoutOfferRouter },
      { assessmentsPublicRouter },
      { errorHandler },
    ] =
      await Promise.all([
        import("./contacts"),
        import("./sales"),
        import("./curriculum"),
        import("./offers"),
        import("./growth"),
        import("./assessments"),
        import("./adminUsers"),
        import("../public/offers"),
        import("../public/checkoutOffer"),
        import("../public/assessmentsPublic"),
        import("../../middleware/errorHandler"),
      ]);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { sub: 1, email: "owner@bossclinician.test", role: "owner" };
      next();
    });
    app.use("/contacts", adminContactsRouter);
    app.use("/sales", adminSalesRouter);
    app.use("/curriculum", adminCurriculumRouter);
    app.use("/offers-admin", adminOffersRouter);
    app.use("/growth", adminGrowthRouter);
    app.use("/assessments-admin", adminAssessmentsRouter);
    app.use("/admins", adminUsersRouter);
    app.use("/api", offersRouter);
    app.use("/api", checkoutOfferRouter);
    app.use("/api", assessmentsPublicRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  async function request(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("json") ? await response.json() : await response.text();
    return { response, body };
  }

  it("reports real list-health cohorts and safely exports selected people", async () => {
    const inserted = await client.query<{ id: number; email: string }>(
      `INSERT INTO contacts
         (email, name, email_marketing_status, opted_in_at, consent_source,
          order_count, last_ordered_at, created_at)
       VALUES
         ('maya.thompson@example.test', 'Maya Thompson', 'subscribed', now(), 'course checkout', 2, now(), now()),
         ('jordan.lee@example.test', 'Jordan Lee', 'subscribed', now() - interval '120 days', 'newsletter', 0, null, now() - interval '120 days'),
         ('priya.shah@example.test', 'Priya Shah', 'bounced', now() - interval '20 days', 'event signup', 0, null, now() - interval '20 days'),
         ('theo.martin@example.test', 'Theo Martin', 'unconfirmed', null, 'form', 0, null, now() - interval '10 days'),
         ('formula.guard@example.test', '=HYPERLINK(""https://invalid.test"",""click"")', 'subscribed', now(), 'manual', 0, null, now())
       RETURNING id, email::text`,
    );

    const insight = await request("/contacts/insights");
    expect(insight.response.status).toBe(200);
    expect(insight.body).toMatchObject({
      contacts: 5,
      customers: 1,
      bounced: 1,
      neverSubscribed: 1,
      engagement: { healthy: 3, passive: 1 },
    });

    const formula = inserted.rows.find((row) => row.email === "formula.guard@example.test")!;
    const exported = await request("/contacts/bulk/export.csv", {
      method: "POST",
      body: JSON.stringify({ contactIds: [formula.id] }),
    });
    expect(exported.response.status).toBe(200);
    expect(exported.body).toContain("'=HYPERLINK");
    expect(exported.body).toContain("formula.guard@example.test");

    const passive = await request("/contacts?engagement=passive");
    expect(passive.response.status).toBe(200);
    expect((passive.body as { items: { name: string }[] }).items.map((person) => person.name)).toEqual(["Jordan Lee"]);

    const bounced = await request("/contacts?status=bounced");
    expect(bounced.response.status).toBe(200);
    expect((bounced.body as { items: { name: string }[] }).items.map((person) => person.name)).toEqual(["Priya Shah"]);
  });

  it("persists campaign folders and subject-line splits through the real CRUD route", async () => {
    const created = await request("/growth/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: "Autumn waitlist",
        folder: "Autumn launch",
        subject: "The waitlist is open",
        subjectB: "You can join the autumn cohort",
        abSplitPercent: 50,
        previewText: "A place for your practice",
        bodyMd: '[See the details](https://example.test/join "button")',
        audience: "all_subscribers",
        status: "draft",
        timezone: "America/New_York",
      }),
    });

    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      folder: "Autumn launch",
      subjectB: "You can join the autumn cohort",
      abSplitPercent: 50,
      timezone: "America/New_York",
    });

    const stored = await client.query(
      `SELECT folder, subject_b, ab_split_percent, timezone FROM email_campaigns WHERE id = $1`,
      [(created.body as { id: number }).id],
    );
    expect(stored.rows[0]).toMatchObject({
      folder: "Autumn launch",
      subject_b: "You can join the autumn cohort",
      ab_split_percent: 50,
      timezone: "America/New_York",
    });
  });

  it("builds and cleans up a connected webinar funnel blueprint", async () => {
    const created = await request("/growth/funnels/blueprint", {
      method: "POST",
      body: JSON.stringify({
        name: "September supervision webinar",
        slug: "september-supervision-webinar",
        description: "Registration and replay journey",
        kind: "webinar",
        published: false,
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({ stageCount: 4, emailCount: 3 });

    const built = created.body as {
      funnel: { id: number; formId: number; tagId: number; sequenceId: number };
    };
    const [stages, form, tag, sequence, emails] = await Promise.all([
      client.query(`SELECT id FROM funnel_steps WHERE funnel_id = $1`, [built.funnel.id]),
      client.query(`SELECT id, subscribe_sequence_id FROM forms WHERE id = $1`, [built.funnel.formId]),
      client.query(`SELECT id FROM tags WHERE id = $1`, [built.funnel.tagId]),
      client.query(`SELECT id FROM email_sequences WHERE id = $1`, [built.funnel.sequenceId]),
      client.query(`SELECT id FROM sequence_emails WHERE sequence_id = $1`, [built.funnel.sequenceId]),
    ]);
    expect(stages.rowCount).toBe(4);
    expect(form.rows[0]).toMatchObject({ id: built.funnel.formId, subscribe_sequence_id: built.funnel.sequenceId });
    expect(tag.rowCount).toBe(1);
    expect(sequence.rowCount).toBe(1);
    expect(emails.rowCount).toBe(3);

    const removed = await request(`/growth/funnels/${built.funnel.id}`, { method: "DELETE" });
    expect(removed.response.status).toBe(200);
    const leftovers = await Promise.all([
      client.query(`SELECT id FROM funnels WHERE id = $1`, [built.funnel.id]),
      client.query(`SELECT id FROM forms WHERE id = $1`, [built.funnel.formId]),
      client.query(`SELECT id FROM tags WHERE id = $1`, [built.funnel.tagId]),
      client.query(`SELECT id FROM email_sequences WHERE id = $1`, [built.funnel.sequenceId]),
    ]);
    expect(leftovers.every((result) => result.rowCount === 0)).toBe(true);
  });

  it("shows human admin sessions but hides internal loopback traffic", async () => {
    await client.query(
      `INSERT INTO admin_sessions
         (admin_user_id, token_hash, user_agent, ip, expires_at, last_used_at, interactive)
       VALUES
         (1, 'browser-session', 'Mozilla/5.0 Chrome/140', '203.0.113.9', now() + interval '1 day', now(), true),
         (1, 'internal-session', 'node', '::ffff:127.0.0.1', now() + interval '1 day', now(), false)`,
    );

    const security = await request("/admins/me/security");
    expect(security.response.status).toBe(200);
    expect((security.body as { sessions: { ip: string }[] }).sessions).toHaveLength(1);
    expect((security.body as { sessions: { ip: string }[] }).sessions[0]?.ip).toBe("203.0.113.9");
  });

  it("lets one recurring plan unlock a course and a download", async () => {
    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (slug, title, published)
       VALUES ('practice-growth-lab-plan', 'Practice Growth Lab', true) RETURNING id`,
    );
    const products = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, course_id, status)
       VALUES ('practice-growth-lab', 'Practice Growth Lab', 'course', $1, 'published'),
              ('cashflow-toolkit', 'Private Practice Cashflow Toolkit', 'download', null, 'published')
       RETURNING id`,
      [course.rows[0].id],
    );
    const productIds = products.rows.map((row) => row.id);

    const created = await request("/sales/plans", {
      method: "POST",
      body: JSON.stringify({
        name: "B.O.S.S. Club Monthly",
        description: "Monthly clinical-business training and implementation tools.",
        priceCents: 0,
        interval: "month",
        productIds,
        features: ["Practice Growth Lab", "Cashflow toolkit"],
        published: true,
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({ name: "B.O.S.S. Club Monthly", productIds });

    const planId = (created.body as { id: number }).id;
    const onlyEntitlements = await request(`/sales/plans/${planId}`, {
      method: "PUT",
      body: JSON.stringify({ productIds: [productIds[1]] }),
    });
    expect(onlyEntitlements.response.status).toBe(200);
    expect(onlyEntitlements.body).toMatchObject({ productIds: [productIds[1]] });

    const linked = await client.query<{ product_id: number }>(
      `SELECT product_id FROM plan_products WHERE plan_id = $1 ORDER BY sort`,
      [planId],
    );
    expect(linked.rows.map((row) => row.product_id)).toEqual([productIds[1]]);
  });

  it("creates a fixed, expiring coupon restricted to selected offers", async () => {
    const offers = await client.query<{ id: number }>(
      `INSERT INTO offers (slug, title, status, pricing_type, amount_cents, currency)
       VALUES ('clinical-ceo-fall', 'Clinical CEO Fall Cohort', 'published', 'one_time', 149700, 'usd'),
              ('documentation-toolkit', 'Documentation Toolkit', 'published', 'one_time', 19700, 'usd')
       RETURNING id`,
    );
    const expiry = new Date();
    expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);

    const created = await request("/sales/coupons", {
      method: "POST",
      body: JSON.stringify({
        code: "CLINICALCEO50",
        amountOffCents: 5000,
        currency: "usd",
        duration: "forever",
        expiresAt: expiry.toISOString().slice(0, 10),
        maxRedemptions: 40,
        offerIds: [offers.rows[0].id],
      }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      code: "CLINICALCEO50",
      amountOffCents: 5000,
      duration: "forever",
      scope: "offers",
      offerIds: [offers.rows[0].id],
    });

    const { validateCoupon } = await import("../../services/coupons");
    const accepted = await validateCoupon("clinicalceo50", offers.rows[0].id, "maya.thompson@example.test");
    expect(accepted).toMatchObject({ ok: true, coupon: { amountOffCents: 5000, duration: "forever" } });
    expect(await validateCoupon("clinicalceo50", offers.rows[1].id)).toEqual({
      ok: false,
      reason: "That discount code isn't valid for this offer.",
    });

    const changed = await request(`/sales/coupons/${(created.body as { id: number }).id}`, {
      method: "PUT",
      body: JSON.stringify({
        percentOff: 25,
        amountOffCents: null,
        currency: "usd",
        duration: "first",
        expiresAt: expiry.toISOString().slice(0, 10),
        maxRedemptions: 12,
        offerIds: [offers.rows[1].id],
      }),
    });
    expect(changed.response.status).toBe(200);
    expect(changed.body).toMatchObject({
      code: "CLINICALCEO50",
      percentOff: 25,
      amountOffCents: null,
      maxRedemptions: 12,
      scope: "offers",
      offerIds: [offers.rows[1].id],
    });
    expect(await validateCoupon("CLINICALCEO50", offers.rows[0].id)).toEqual({
      ok: false,
      reason: "That discount code isn't valid for this offer.",
    });
    expect(await validateCoupon("CLINICALCEO50", offers.rows[1].id)).toMatchObject({
      ok: true,
      coupon: { percentOff: 25, amountOffCents: null, duration: "first" },
    });
  });

  it("quotes and records the recommended payment option chosen on one checkout", async () => {
    const offer = await client.query<{ id: number }>(
      `INSERT INTO offers
         (slug, title, description, status, pricing_type, amount_cents, currency,
          interval_count, collect_tax)
       VALUES
         ('lounge-vip', 'Lounge VIP', 'Six months of hands-on practice growth support.',
          'published', 'one_time', 349700, 'usd', 1, false)
       RETURNING id`,
    );
    const option = await request(`/offers-admin/${offer.rows[0].id}/pricing-options`, {
      method: "POST",
      body: JSON.stringify({
        label: "6 monthly payments",
        pricingType: "payment_plan",
        amountCents: 34700,
        minAmountCents: 0,
        interval: "month",
        intervalCount: 1,
        installmentCount: 6,
        trialDays: 0,
        recommended: true,
        active: true,
        sort: 0,
      }),
    });
    expect(option.response.status).toBe(201);
    const optionId = (option.body as { id: number }).id;

    const publicOffer = await request("/api/offers/lounge-vip");
    expect(publicOffer.response.status).toBe(200);
    expect(publicOffer.body).toMatchObject({
      selectedPricingOptionId: optionId,
      amountCents: 34700,
      billing: { pricingType: "payment_plan", installmentCount: 6, planTotalCents: 208200 },
    });
    expect((publicOffer.body as { pricingOptions: unknown[] }).pricingOptions).toHaveLength(2);

    const payInFull = await request("/api/offers/lounge-vip/quote", {
      method: "POST",
      body: JSON.stringify({ pricingOptionId: null }),
    });
    expect(payInFull.response.status).toBe(200);
    expect(payInFull.body).toMatchObject({ selectedPricingOptionId: null, totalCents: 349700 });

    const paymentPlan = await request("/api/offers/lounge-vip/quote", {
      method: "POST",
      body: JSON.stringify({ pricingOptionId: optionId }),
    });
    expect(paymentPlan.response.status).toBe(200);
    expect(paymentPlan.body).toMatchObject({
      selectedPricingOptionId: optionId,
      totalCents: 34700,
      billing: { installmentCount: 6 },
    });

    // Stripe is intentionally disabled in integration tests. The endpoint can
    // still prove that the server—not the browser—records the chosen option and
    // its price before it refuses to contact a payment provider.
    const checkout = await request("/api/checkout/offer/lounge-vip", {
      method: "POST",
      body: JSON.stringify({
        pricingOptionId: optionId,
        email: "maya.thompson@example.test",
        name: "Maya Thompson",
      }),
    });
    expect(checkout.response.status).toBe(503);
    const order = await client.query<{ pricing_option_id: number; amount_cents: number; status: string }>(
      `SELECT pricing_option_id, amount_cents, status FROM orders
        WHERE offer_id = $1 ORDER BY id DESC LIMIT 1`,
      [offer.rows[0].id],
    );
    expect(order.rows[0]).toEqual({ pricing_option_id: optionId, amount_cents: 34700, status: "failed" });
  });

  it("persists audio, thumbnail, prerequisite and multiple protected lesson files", async () => {
    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (slug, title, published)
       VALUES ('clinical-ceo-intensive', 'Clinical CEO Intensive', true) RETURNING id`,
    );
    const module = await request(`/curriculum/${course.rows[0].id}/modules`, {
      method: "POST",
      body: JSON.stringify({ title: "Build your resilient practice" }),
    });
    expect(module.response.status).toBe(201);

    const foundation = await request(`/curriculum/modules/${(module.body as { id: number }).id}/lessons`, {
      method: "POST",
      body: JSON.stringify({
        title: "Know your numbers",
        bodyMd: "Complete the baseline exercise before moving into pricing.",
        contentType: "text",
        published: true,
      }),
    });
    expect(foundation.response.status).toBe(201);

    const lesson = await request(`/curriculum/modules/${(module.body as { id: number }).id}/lessons`, {
      method: "POST",
      body: JSON.stringify({
        title: "Price with confidence",
        bodyMd: "Use the worksheet while you listen to the coaching session.",
        contentType: "audio",
        audioUrl: "protected:courses/clinical-ceo/price-with-confidence.mp3",
        thumbnailUrl: "/uploads/price-with-confidence.jpg",
        requiresPreviousLesson: true,
        published: true,
      }),
    });
    expect(lesson.response.status).toBe(201);
    expect(lesson.body).toMatchObject({
      contentType: "audio",
      audioUrl: "protected:courses/clinical-ceo/price-with-confidence.mp3",
      thumbnailUrl: "/uploads/price-with-confidence.jpg",
      requiresPreviousLesson: true,
    });

    const lessonId = (lesson.body as { id: number }).id;
    for (const [title, filename] of [
      ["Pricing worksheet", "pricing-worksheet.pdf"],
      ["Reflection prompts", "reflection-prompts.pdf"],
    ]) {
      const attached = await request(`/curriculum/lessons/${lessonId}/files`, {
        method: "POST",
        body: JSON.stringify({
          title,
          filename,
          storagePath: `protected:courses/clinical-ceo/${filename}`,
          mime: "application/pdf",
          sizeBytes: 2048,
        }),
      });
      expect(attached.response.status).toBe(201);
    }

    const files = await request(`/curriculum/lessons/${lessonId}/files`);
    expect(files.response.status).toBe(200);
    expect(files.body).toHaveLength(2);
    expect(files.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Pricing worksheet" }),
        expect.objectContaining({ title: "Reflection prompts" }),
      ]),
    );

    const contact = await client.query<{ id: number }>(
      `INSERT INTO contacts (email, name, email_marketing_status)
       VALUES ('amara.williams@example.test', 'Amara Williams', 'subscribed') RETURNING id`,
    );
    const member = await client.query<{ id: number }>(
      `INSERT INTO members (email, name, status, contact_id)
       VALUES ('amara.williams@example.test', 'Amara Williams', 'active', $1) RETURNING id`,
      [contact.rows[0].id],
    );
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, course_id, status)
       VALUES ('clinical-ceo-intensive-product', 'Clinical CEO Intensive', 'course', $1, 'published')
       RETURNING id`,
      [course.rows[0].id],
    );
    const { grantAccess } = await import("../../services/access");
    const { loadCourseForMember } = await import("../../services/curriculum");
    await grantAccess({ memberId: member.rows[0].id, productId: product.rows[0].id, source: "manual" });
    const memberCourse = await loadCourseForMember(member.rows[0].id, course.rows[0].id);
    expect(memberCourse?.modules[0].lessons).toEqual([
      expect.objectContaining({ title: "Know your numbers", unlocked: true }),
      expect.objectContaining({
        title: "Price with confidence",
        unlocked: false,
        unlockLabel: "Finish “Know your numbers” first",
      }),
    ]);
  });

  it("stores a member's graded lesson attempt and unlocks the next lesson only after a pass", async () => {
    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (slug, title, published) VALUES ('ethics-ceu', 'Ethics CEU', true) RETURNING id`,
    );
    const module = await client.query<{ id: number }>(
      `INSERT INTO course_modules (course_id, title, sort) VALUES ($1, 'Final section', 0) RETURNING id`,
      [course.rows[0].id],
    );
    const lessons = await client.query<{ id: number }>(
      `INSERT INTO course_lessons
         (module_id, slug, title, content_type, published, requires_previous_lesson, sort)
       VALUES ($1, 'final-test', 'Final test', 'assessment', true, false, 0),
              ($1, 'certificate-next', 'Claim your certificate', 'text', true, true, 1)
       RETURNING id`,
      [module.rows[0].id],
    );
    const assessment = await client.query<{ id: number }>(
      `INSERT INTO assessments
         (slug, title, kind, lesson_id, pass_mark, max_attempts, require_email, published)
       VALUES ('ethics-final-test', 'Ethics final test', 'graded', $1, 70, 2, false, true)
       RETURNING id`,
      [lessons.rows[0].id],
    );
    const question = await client.query<{ id: number }>(
      `INSERT INTO assessment_questions (assessment_id, prompt, kind, required)
       VALUES ($1, 'Which response protects confidentiality?', 'single', true) RETURNING id`,
      [assessment.rows[0].id],
    );
    const answers = await client.query<{ id: number; is_correct: boolean }>(
      `INSERT INTO assessment_answers (question_id, position, label, is_correct)
       VALUES ($1, 0, 'Use the secure record', true), ($1, 1, 'Use personal email', false)
       RETURNING id, is_correct`,
      [question.rows[0].id],
    );
    const member = await client.query<{ id: number }>(
      `INSERT INTO members (email, name, status)
       VALUES ('ceu.student@example.test', 'Casey Student', 'active') RETURNING id`,
    );
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, course_id, status)
       VALUES ('ethics-ceu-product', 'Ethics CEU', 'course', $1, 'published') RETURNING id`,
      [course.rows[0].id],
    );
    const { grantAccess } = await import("../../services/access");
    const { loadCourseForMember } = await import("../../services/curriculum");
    const { signMemberAccessToken } = await import("../../auth/memberSession");
    await grantAccess({ memberId: member.rows[0].id, productId: product.rows[0].id, source: "manual" });

    const before = await loadCourseForMember(member.rows[0].id, course.rows[0].id);
    expect(before?.modules[0].lessons[1]).toMatchObject({ unlocked: false });

    const token = signMemberAccessToken({ sub: member.rows[0].id, email: "ceu.student@example.test" });
    const passed = await request("/api/assessments/ethics-final-test/submit", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        responses: [{ questionId: question.rows[0].id, answerIds: [answers.rows.find((row) => row.is_correct)!.id] }],
        elapsedMs: 3000,
      }),
    });
    expect(passed.response.status).toBe(201);
    expect(passed.body).toMatchObject({ passed: true, percent: 100 });

    const attempt = await client.query<{ member_id: number; passed: boolean }>(
      `SELECT member_id, passed FROM assessment_attempts WHERE assessment_id = $1`,
      [assessment.rows[0].id],
    );
    expect(attempt.rows[0]).toEqual({ member_id: member.rows[0].id, passed: true });
    const after = await loadCourseForMember(member.rows[0].id, course.rows[0].id);
    expect(after?.modules[0].lessons[1]).toMatchObject({ unlocked: true });
  });
});
