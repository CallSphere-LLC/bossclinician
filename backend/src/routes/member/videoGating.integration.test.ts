import express from "express";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  hasTestDatabase,
  insertCourseProduct,
  insertMember,
  insertOffer,
} from "../../testing/db";

/**
 * Sheet rows 122/124 end to end: "Require watching the full video before the
 * next lesson", the CE certificate gated on the evaluation, and the $57
 * Educational Access option that carries no certificate.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("video gating and the evaluation-gated certificate (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: ReturnType<express.Express["listen"]>;
  let base: string;
  let token: string;
  let memberId: number;
  let certificates: typeof import("../../services/certificates");
  let curriculum: typeof import("../../services/curriculum");
  let access: typeof import("../../services/access");

  beforeAll(async () => {
    db = await createTestDatabase("video_gating");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "ZZ-video-gating-secret";
    const { assessmentsPublicRouter } = await import("../public/assessmentsPublic");
    const { adminAssessmentsRouter } = await import("../admin/assessments");
    const { adminCurriculumRouter } = await import("../admin/curriculum");
    const { memberProgressRouter } = await import("./progress");
    const { requireMember } = await import("../../middleware/memberAuth");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const { signMemberAccessToken } = await import("../../auth/memberSession");
    certificates = await import("../../services/certificates");
    curriculum = await import("../../services/curriculum");
    access = await import("../../services/access");
    memberId = await insertMember(db.client, "sagar+zz-gating-member@callsphere.ai");
    token = signMemberAccessToken({ sub: memberId, email: "sagar+zz-gating-member@callsphere.ai" });
    const app = express();
    app.use(express.json());
    app.use("/api", assessmentsPublicRouter);
    app.use("/admin-curriculum", adminCurriculumRouter);
    app.use("/admin", adminAssessmentsRouter);
    app.use("/api/member", requireMember, memberProgressRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await (await import("../../db/pool")).pool.end();
    await db?.drop();
  });

  async function call(path: string, method = "GET", data?: unknown, auth = token) {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: (await response.json()) as any };
  }

  /** A CE-style course: video (1000s), a reading, and a course evaluation survey. */
  async function setupCourse(slug: string, forMember: number) {
    const product = await insertCourseProduct(db.client, slug);
    await db.client.query(`UPDATE courses SET require_full_video = true WHERE id = $1`, [product.courseId]);
    await db.client.query(
      `INSERT INTO certificate_templates (course_id, title, issue_on, enabled)
       VALUES ($1, 'ZZ Certificate', 'completion', true)`,
      [product.courseId]
    );
    const module = (
      await db.client.query(`INSERT INTO course_modules (course_id, title) VALUES ($1, 'ZZ Module') RETURNING id`, [
        product.courseId,
      ])
    ).rows[0].id;
    const lessons = (
      await db.client.query(
        `INSERT INTO course_lessons (module_id, slug, title, content_type, video_url, video_duration_seconds, published, sort)
         VALUES ($1, 'video', 'ZZ Watch the training', 'video', '/uploads/zz-training.mp4', 1000, true, 0),
                ($1, 'reading', 'ZZ Reading', 'text', '', 0, true, 1),
                ($1, 'evaluation', 'ZZ Course Evaluation', 'assessment', '', 0, true, 2)
         RETURNING id`,
        [module]
      )
    ).rows.map((row: { id: number }) => row.id);
    await access.grantAccess({ memberId: forMember, productId: product.productId, source: "manual" });
    const survey = await call("/admin", "POST", {
      title: `${slug} evaluation`,
      kind: "survey",
      lessonId: lessons[2],
      published: true,
      requireEmail: false,
      requirePass: false,
      passMark: null,
      passMessage: "ZZ Thanks",
      failMessage: "ZZ Thanks",
    });
    expect(survey.status).toBe(201);
    const question = await call(`/admin/${survey.body.id}/questions`, "POST", {
      prompt: "ZZ How was it?",
      kind: "text",
      required: true,
    });
    expect(question.status).toBe(201);
    return {
      ...product,
      video: lessons[0],
      reading: lessons[1],
      evaluation: lessons[2],
      surveySlug: survey.body.slug as string,
      questionId: question.body.id as number,
    };
  }

  it("refuses an early completion and locks the next lesson until the video is watched through", async () => {
    const c = await setupCourse("zz-gating-video", memberId);

    // The tick is no way round it.
    const early = await call(`/api/member/lessons/${c.video}/complete`, "POST", {});
    expect(early.status).toBe(403);
    expect(early.body.error ?? early.body.message).toMatch(/Finish the video to complete this lesson — \d+:\d\d left/);

    const outline = await curriculum.loadCourseForMember(memberId, c.courseId);
    const reading = outline!.modules[0].lessons[1];
    expect(reading).toMatchObject({ unlocked: false, lockReason: "previous_incomplete" });
    expect(reading.unlockLabel).toMatch(/^Finish watching “ZZ Watch the training” to unlock — 15:50 left$/);

    // Seeking to the end and reporting it is credited only real time.
    const seek = await call(`/api/member/lessons/${c.video}/progress`, "POST", {
      positionSeconds: 990,
      watchedPercent: 99,
      playedToSeconds: 990,
    });
    expect(seek.status).toBe(200);
    expect(seek.body.completed).toBe(false);
    expect(seek.body.fullWatch.playedToSeconds).toBeLessThan(100);

    // 94% played through: still refused.
    await db.client.query(
      `UPDATE lesson_progress SET max_position_seconds = 940 WHERE member_id = $1 AND lesson_id = $2`,
      [memberId, c.video]
    );
    expect((await call(`/api/member/lessons/${c.video}/complete`, "POST", {})).status).toBe(403);

    // Playing on from 940 for ten seconds reaches 950 (95%): the ping completes it.
    await db.client.query(
      `UPDATE lesson_progress SET last_viewed_at = now() - interval '10 seconds'
        WHERE member_id = $1 AND lesson_id = $2`,
      [memberId, c.video]
    );
    const done = await call(`/api/member/lessons/${c.video}/progress`, "POST", {
      positionSeconds: 955,
      watchedPercent: 95,
      playedToSeconds: 955,
    });
    expect(done.status).toBe(200);
    expect(done.body.completed).toBe(true);
    expect(done.body.fullWatch).toMatchObject({ required: true, requiredSeconds: 950 });

    const after = await curriculum.loadCourseForMember(memberId, c.courseId);
    expect(after!.modules[0].lessons[1].unlocked).toBe(true);
  });

  it("issues the certificate only once the evaluation is submitted", async () => {
    const c = await setupCourse("zz-gating-certificate", memberId);
    await db.client.query(
      `INSERT INTO lesson_progress (member_id, lesson_id, max_position_seconds, watched_percent, completed_at)
       VALUES ($1, $2, 1000, 100, now())`,
      [memberId, c.video]
    );
    expect((await call(`/api/member/lessons/${c.reading}/complete`, "POST", {})).status).toBe(200);

    // Evaluation missing: no certificate, and the reason in one sentence.
    expect(await certificates.issueCertificateIfEarned(memberId, c.courseId)).toBeNull();
    const pending = await certificates.certificateStatus(memberId, c.courseId);
    expect(pending).toMatchObject({ eligible: false, evaluationsToSubmit: ["ZZ Course Evaluation"] });
    expect(pending.message).toBe("Complete the course evaluation to receive your certificate.");

    // Submitting it completes the lesson and issues the certificate.
    const submitted = await call(`/api/assessments/${c.surveySlug}/submit`, "POST", {
      responses: [{ questionId: c.questionId, text: "ZZ Very useful" }],
      elapsedMs: 4000,
    });
    expect(submitted.status).toBe(201);
    const issued = await db.client.query(
      `SELECT id FROM certificates WHERE member_id = $1 AND course_id = $2`,
      [memberId, c.courseId]
    );
    expect(issued.rows).toHaveLength(1);
    expect((await certificates.certificateStatus(memberId, c.courseId)).issued).toBe(true);
  });

  it("gives no certificate to a member whose only access is the Educational (no CE) option", async () => {
    const eduMember = await insertMember(db.client, "sagar+zz-gating-edu@callsphere.ai");
    const product = await insertCourseProduct(db.client, "zz-gating-edu");
    await db.client.query(
      `INSERT INTO certificate_templates (course_id, title, issue_on, enabled)
       VALUES ($1, 'ZZ Certificate', 'completion', true)`,
      [product.courseId]
    );
    const offerId = await insertOffer(db.client, "zz-gating-edu-offer", [product.productId]);
    const options = (
      await db.client.query(
        `INSERT INTO offer_pricing_options (offer_id, label, pricing_type, amount_cents, includes_certificate, sort)
         VALUES ($1, 'Training + CE Credit — $77', 'one_time', 7700, true, 0),
                ($1, 'Educational Access — $57 | No CE Credit', 'one_time', 5700, false, 1)
         RETURNING id`,
        [offerId]
      )
    ).rows.map((row: { id: number }) => row.id);
    const eduOrder = (
      await db.client.query(
        `INSERT INTO orders (offer_id, member_id, email, status, total_cents, amount_cents, subtotal_cents, pricing_option_id)
         VALUES ($1, $2, 'sagar+zz-gating-edu@callsphere.ai', 'paid', 5700, 5700, 5700, $3) RETURNING id`,
        [offerId, eduMember, options[1]]
      )
    ).rows[0].id;
    await access.grantAccess({ memberId: eduMember, productId: product.productId, offerId, orderId: eduOrder, source: "purchase" });

    expect(await certificates.certificateAccessAllowed(eduMember, product.courseId)).toBe(false);
    const status = await certificates.certificateStatus(eduMember, product.courseId);
    expect(status).toMatchObject({ excludedByPurchase: true, eligible: false, offered: false });

    // Upgrading to the CE option restores it.
    await db.client.query(
      `INSERT INTO orders (offer_id, member_id, email, status, total_cents, amount_cents, subtotal_cents, pricing_option_id)
       VALUES ($1, $2, 'sagar+zz-gating-edu@callsphere.ai', 'paid', 7700, 7700, 7700, $3)`,
      [offerId, eduMember, options[0]]
    );
    expect(await certificates.certificateAccessAllowed(eduMember, product.courseId)).toBe(true);

    // A member granted the course by hand keeps the certificate.
    const manualMember = await insertMember(db.client, "sagar+zz-gating-manual@callsphere.ai");
    await access.grantAccess({ memberId: manualMember, productId: product.productId, source: "manual" });
    expect(await certificates.certificateAccessAllowed(manualMember, product.courseId)).toBe(true);
  });

  it("a lowered pass mark counts for attempts already taken", async () => {
    const product = await insertCourseProduct(db.client, "zz-gating-passmark");
    const module = (
      await db.client.query(`INSERT INTO course_modules (course_id, title) VALUES ($1, 'ZZ Module') RETURNING id`, [
        product.courseId,
      ])
    ).rows[0].id;
    const quizLesson = (
      await db.client.query(
        `INSERT INTO course_lessons (module_id, slug, title, content_type, published, sort)
         VALUES ($1, 'post-test', 'ZZ Post-Test', 'assessment', true, 0) RETURNING id`,
        [module]
      )
    ).rows[0].id;
    await access.grantAccess({ memberId, productId: product.productId, source: "manual" });
    const quiz = await call("/admin", "POST", {
      title: "zz passmark quiz",
      kind: "graded",
      lessonId: quizLesson,
      published: true,
      requireEmail: false,
      requirePass: true,
      passMark: 80,
      passMessage: "ZZ pass",
      failMessage: "ZZ fail",
    });
    expect(quiz.status).toBe(201);
    await db.client.query(
      `INSERT INTO assessment_attempts (assessment_id, member_id, email, percent, passed, completed_at)
       VALUES ($1, $2, 'sagar+zz-gating-member@callsphere.ai', 75, false, now())`,
      [quiz.body.id, memberId]
    );
    expect(await certificates.loadUnpassedQuizzes(memberId, product.courseId)).toHaveLength(1);

    // "Passing score required for certificate", edited from the certificate panel.
    const path = `/admin-curriculum/${product.courseId}/certificate/quizzes/${quiz.body.id}`;
    expect((await call(path, "PUT", { passMark: 0 })).status).toBe(400);
    expect((await call(path, "PUT", { passMark: 101 })).status).toBe(400);
    const saved = await call(path, "PUT", { passMark: 70 });
    expect(saved.status).toBe(200);
    expect(saved.body.newlyPassed).toBe(1);
    expect(saved.body.gradedQuizzes[0]).toMatchObject({ id: quiz.body.id, passMark: 70 });

    expect(await certificates.loadUnpassedQuizzes(memberId, product.courseId)).toHaveLength(0);
    const progress = await db.client.query(
      `SELECT completed_at FROM lesson_progress WHERE member_id = $1 AND lesson_id = $2`,
      [memberId, quizLesson]
    );
    expect(progress.rows[0].completed_at).not.toBeNull();
  });
});
