import express from "express";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase } from "../testing/db";

(hasTestDatabase ? describe : describe.skip)("public quiz capture", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: ReturnType<express.Express["listen"]>;
  let base: string, quizId: number, questionId: number, answerId: number, tagId: number;

  beforeAll(async () => {
    db = await createTestDatabase("quiz_capture");
    process.env.DATABASE_URL = db.url;
    const { assessmentsPublicRouter } = await import("../routes/public/assessmentsPublic");
    const { adminAssessmentsRouter } = await import("../routes/admin/assessments");
    const { errorHandler } = await import("../middleware/errorHandler");
    const app = express();
    app.use(express.json());
    app.use("/api", assessmentsPublicRouter);
    app.use("/admin/assessments", adminAssessmentsRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    quizId = (await db.client.query("INSERT INTO assessments(slug,title,published) VALUES('zz-fast-quiz','ZZ Fast quiz',true) RETURNING id")).rows[0].id;
    questionId = (await db.client.query("INSERT INTO assessment_questions(assessment_id,prompt) VALUES($1,'ZZ One question') RETURNING id", [quizId])).rows[0].id;
    answerId = (await db.client.query("INSERT INTO assessment_answers(question_id,label,weight) VALUES($1,'ZZ Answer',3) RETURNING id", [questionId])).rows[0].id;
    tagId = (await db.client.query("INSERT INTO tags(slug,name) VALUES('zz-result-tag','ZZ Result tag') RETURNING id")).rows[0].id;
    await db.client.query("INSERT INTO assessment_results(assessment_id,slug,title,apply_tag_id) VALUES($1,'zz-result','ZZ Result',$2)", [quizId, tagId]);
  }, 60000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await (await import("../db/pool")).pool.end();
    await db?.drop();
  });

  async function submit(email: string, overrides: Record<string, unknown> = {}) {
    const response = await fetch(`${base}/api/assessments/zz-fast-quiz/submit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name: "ZZ Fast Reader", elapsedMs: 500, company: "", responses: [{ questionId, answerIds: [answerId] }], ...overrides }),
    });
    return { status: response.status, body: await response.json() as { attemptId: number; error: string } };
  }

  it("saves a fast valid completion, contact, answers and configured tag before returning success; updates the visible count", async () => {
    const email = "sagar+zz-fast-quiz@callsphere.ai";
    const saved = await submit(email);
    expect(saved.status).toBe(201);
    expect(saved.body.attemptId).toBeGreaterThan(0);
    const attempt = (await db.client.query("SELECT * FROM assessment_attempts WHERE id=$1", [saved.body.attemptId])).rows[0];
    expect(attempt.email).toBe(email);
    expect(attempt.responses[0].answerIds).toEqual([answerId]);
    const contact = (await db.client.query("SELECT * FROM contacts WHERE id=$1", [attempt.contact_id])).rows[0];
    expect(contact).toMatchObject({ email, name: "ZZ Fast Reader" });
    expect((await db.client.query("SELECT * FROM contact_tags WHERE contact_id=$1 AND tag_id=$2", [contact.id, tagId])).rowCount).toBe(1);
    const list = await (await fetch(`${base}/admin/assessments`)).json() as { id: number; attemptCount: number }[];
    expect(list.find((quiz) => quiz.id === quizId)?.attemptCount).toBe(1);
    const again = await submit(email, { name: "ZZ Returning Reader", elapsedMs: 0 });
    expect(again.status).toBe(201);
    expect(again.body.attemptId).not.toBe(saved.body.attemptId);
    expect((await db.client.query("SELECT id FROM contacts WHERE email=$1", [email])).rowCount).toBe(1);
    expect((await db.client.query("SELECT * FROM assessment_attempts WHERE contact_id=$1", [contact.id])).rowCount).toBe(2);
  });

  it("rejects a triggered honeypot without a fake successful result or discarded lead", async () => {
    const email = "sagar+zz-trapped-quiz@callsphere.ai";
    const result = await submit(email, { company: "filled trap", elapsedMs: 30000 });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("not saved");
    expect(result.body).not.toHaveProperty("result");
    expect((await db.client.query("SELECT id FROM contacts WHERE email=$1", [email])).rowCount).toBe(0);
    expect((await db.client.query("SELECT id FROM assessment_attempts WHERE email=$1", [email])).rowCount).toBe(0);
  });
});
