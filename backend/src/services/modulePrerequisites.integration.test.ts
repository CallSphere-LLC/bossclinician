import fs from "fs";
import path from "path";
import express from "express";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember } from "../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;
describeDb("PPP phase progression and protected routes", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: ReturnType<express.Express["listen"]>;
  let base: string, token: string, productSlug: string;
  let memberId: number, courseId: number;
  let curriculum: typeof import("./curriculum");
  const modules: number[] = [];
  const lessons: number[][] = [];
  const migration = fs.readFileSync(path.join(__dirname, "../db/migrations/138_course_module_prerequisites.sql"), "utf8");

  beforeAll(async () => {
    db = await createTestDatabase("module_gates");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "zz-module-prerequisite-test";
    const { memberLibraryRouter } = await import("../routes/member/library");
    const { memberProgressRouter } = await import("../routes/member/progress");
    const { requireMember } = await import("../middleware/memberAuth");
    const { errorHandler } = await import("../middleware/errorHandler");
    const { signMemberAccessToken } = await import("../auth/memberSession");
    curriculum = await import("./curriculum");
    const access = await import("./access");
    memberId = await insertMember(db.client, "zz-module-gates@example.test");
    token = signMemberAccessToken({ sub: memberId, email: "zz-module-gates@example.test" });
    await db.client.query("UPDATE courses SET slug='zz-original-ppp-seed' WHERE slug='profitable-private-practices-training'");
    const product = await insertCourseProduct(db.client, "profitable-private-practices-training");
    courseId = product.courseId;
    productSlug = "p-profitable-private-practices-training";
    const titles = ["Welcome", "Tier 1", "Phase 1: Foundation", "Phase 2: Visibility", "Phase 3: Systems",
      "Tier 2: Introduction", "Phase 4: Authority", "Phase 5: Workflow", "Post Exam", "CE Certification and Evaluation"];
    for (const [index, title] of titles.entries()) {
      const mod = (await db.client.query("INSERT INTO course_modules (course_id,title,sort) VALUES ($1,$2,$3) RETURNING id",
        [courseId, title, index])).rows[0].id;
      modules.push(mod);
      const ids: number[] = [];
      for (let n = 0; n < 2; n++) {
        ids.push((await db.client.query(
          "INSERT INTO course_lessons (module_id,slug,title,body_md,published,sort) VALUES ($1,$2,$3,'ZZ protected content',true,$4) RETURNING id",
          [mod, `zz-${index}-${n}`, `ZZ ${title} lesson ${n}`, n])).rows[0].id);
      }
      lessons.push(ids);
    }
    await db.client.query(migration);
    await access.grantAccess({ memberId, productId: product.productId, source: "manual" });
    const app = express();
    app.use(express.json());
    app.use("/library", requireMember, memberLibraryRouter);
    app.use("/member", requireMember, memberProgressRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await (await import("../db/pool")).pool.end();
    await db?.drop();
  });

  async function call(route: string, method = "GET", body?: unknown) {
    const response = await fetch(base + route, { method, headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  }
  const outline = () => curriculum.loadCourseForMember(memberId, courseId);
  async function complete(index: number, n: number) {
    const result = await call(`/member/lessons/${lessons[index][n]}/complete`, "POST", {});
    expect(result.status).toBe(200);
  }
  async function reset() {
    await db.client.query("DELETE FROM lesson_progress WHERE member_id=$1", [memberId]);
  }

  it("keeps all later phases, Tier 2, exam and evaluation closed to a new member", async () => {
    const view = (await outline())!;
    expect(view.modules[2].lessons.every(l => l.unlocked)).toBe(true);
    for (const index of [3, 4, 5, 6, 7, 8, 9]) {
      expect(view.modules[index].unlocked).toBe(false);
      expect(view.modules[index].lessons.every(l => !l.unlocked)).toBe(true);
    }
    const earlyRead = await call(`/library/${productSlug}/lessons/zz-3-0`);
    expect(earlyRead.body.lesson.locked).toBe(true);
    expect(JSON.stringify(earlyRead.body)).not.toContain("ZZ protected content");
    expect((await call(`/member/lessons/${lessons[3][0]}/complete`, "POST", {})).status).toBe(403);
    expect((await call(`/member/lessons/${lessons[3][0]}/progress`, "POST",
      { positionSeconds: 0, watchedPercent: 0 })).status).toBe(403);
  });

  it("requires every lesson, keeps lessons within a phase open, and unlocks phases without a Tier 2 deadlock", async () => {
    await reset();
    await complete(2, 1); // Completing the final lesson alone cannot skip the first.
    expect((await outline())!.modules[3].unlocked).toBe(false);
    expect((await outline())!.modules[2].lessons[0].unlocked).toBe(true);
    await complete(2, 0);
    expect((await outline())!.modules[3].unlocked).toBe(true);
    for (const index of [3, 4, 6, 7]) {
      expect((await outline())!.modules[index].lessons.every(l => l.unlocked)).toBe(true);
      expect((await outline())!.modules[5].unlocked).toBe(false);
      await complete(index, 0);
      await complete(index, 1);
    }
    expect((await outline())!.modules[5].unlocked).toBe(true);
    expect((await outline())!.modules[8].unlocked).toBe(false); // Welcome/Tier lessons remain.
    for (const index of [0, 1, 5]) { await complete(index, 0); await complete(index, 1); }
    expect((await outline())!.modules[8].unlocked).toBe(true);
    expect((await outline())!.modules[9].unlocked).toBe(false);
    await complete(8, 0);
    expect((await outline())!.modules[9].unlocked).toBe(false);
    await complete(8, 1);
    expect((await outline())!.modules[9].unlocked).toBe(true);
  });

  it("does not let historical out-of-order progress or previews bypass required phases", async () => {
    await reset();
    for (const index of [3, 4, 6, 7]) {
      for (const lesson of lessons[index]) await db.client.query(
        "INSERT INTO lesson_progress(member_id,lesson_id,completed_at) VALUES($1,$2,now())", [memberId, lesson]);
    }
    await db.client.query("UPDATE course_lessons SET preview=true WHERE id=$1", [lessons[5][0]]);
    const view = (await outline())!;
    expect(view.modules[5].lessons[0]).toMatchObject({ preview: true, unlocked: false, lockReason: "module_incomplete" });
    expect(view.modules[5].unlockLabel).toContain("Phase 1");
    await db.client.query("UPDATE course_lessons SET preview=false WHERE id=$1", [lessons[5][0]]);
  });

  it("is idempotent and leaves unrelated courses without phase locks", async () => {
    const before = (await db.client.query("SELECT count(*) FROM course_module_prerequisites")).rows[0].count;
    await db.client.query(migration);
    expect((await db.client.query("SELECT count(*) FROM course_module_prerequisites")).rows[0].count).toBe(before);
    const other = await insertCourseProduct(db.client, "zz-unrelated-course");
    expect((await db.client.query("SELECT count(*) FROM course_module_prerequisites p JOIN course_modules m ON m.id=p.module_id WHERE m.course_id=$1",
      [other.courseId])).rows[0].count).toBe("0");
  });
});
