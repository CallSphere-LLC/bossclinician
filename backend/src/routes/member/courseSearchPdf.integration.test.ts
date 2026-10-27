import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember } from "../../testing/db";
import type { CourseSearchResult } from "../../services/courseSearch";

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("course search and plan PDF access boundaries", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: ReturnType<express.Express["listen"]>;
  let base: string;
  let owner: { id: number; token: string }, outsider: { id: number; token: string };
  let productId: number;
  let openId: number;
  let planId: number;
  const searchPath = "/api/member/library/p-searchpdf/search";
  const pdfPath = "/api/member/tool-state/living-business-plan/pdf";
  const report = { year: 2026, archived: false, sections: Array.from({ length: 11 }, (_, index) => ({
    title: `Section ${index}`, description: "Annual strategy", reviewed: false,
    fields: [{ label: `Field ${index}`, value: "Current unsaved input" }],
  })) };

  beforeAll(async () => {
    db = await createTestDatabase("searchpdf187188");
    process.env.DATABASE_URL = db.url;
    const { requireMember } = await import("../../middleware/memberAuth");
    const { memberLibraryRouter } = await import("./library");
    const { memberToolStateRouter } = await import("./toolState");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const { signMemberAccessToken } = await import("../../auth/memberSession");
    async function member(name: string) {
      const email = `${name}@test.invalid`;
      const id = await insertMember(db.client, email);
      return { id, token: signMemberAccessToken({ sub: id, email }) };
    }
    owner = await member("searchpdf-owner"); outsider = await member("searchpdf-outsider");
    const course = await insertCourseProduct(db.client, "searchpdf");
    productId = course.productId;
    await db.client.query("INSERT INTO access_grants(member_id,product_id,status,source) VALUES($1,$2,'active','manual')", [owner.id, productId]);
    const module = await db.client.query("INSERT INTO course_modules(course_id,title) VALUES($1,'Financial strategy') RETURNING id", [course.courseId]);
    async function lesson(slug: string, body: string, extra = "", published = true) {
      const result = await db.client.query(`INSERT INTO course_lessons(module_id,title,slug,body_md,transcript,content_type,published,sort,requires_previous_lesson ${extra ? ",drip_days" : ""}) VALUES($1,$2,$2,$3,$4,'text',$5,$6,false ${extra ? ",30" : ""}) RETURNING id`, [module.rows[0].id, slug, body, slug === "available" ? "Transcript-only keyword diversification" : "", published, slug === "available" ? 0 : 1]);
      return result.rows[0].id as number;
    }
    openId = await lesson("available", "A sustainable cash reserve");
    planId = await lesson("annual-plan", "Latest practice strategy");
    await db.client.query("UPDATE course_lessons SET tool_key='living-business-plan' WHERE id=$1", [planId]);
    await lesson("locked-future", "LOCKEDBODYSECRET", "drip");
    await lesson("unpublished", "DRAFTBODYSECRET", "", false);
    const sequential = await lesson("sequence-locked", "SEQUENCEBODYSECRET");
    await db.client.query("UPDATE course_lessons SET requires_previous_lesson=true,sort=4 WHERE id=$1", [sequential]);
    const scheduled = await lesson("scheduled", "SCHEDULEDBODYSECRET");
    await db.client.query("UPDATE course_lessons SET publish_at=now()+interval '30 days' WHERE id=$1", [scheduled]);
    const other = await insertCourseProduct(db.client, "other-searchpdf");
    const otherModule = await db.client.query("INSERT INTO course_modules(course_id,title) VALUES($1,'Other course') RETURNING id", [other.courseId]);
    await db.client.query("INSERT INTO course_lessons(module_id,title,slug,body_md,content_type,published) VALUES($1,'Other','other','CROSSCOURSESECRET','text',true)", [otherModule.rows[0].id]);
    const app = express(); app.use(express.json({ limit: "1mb" }));
    app.use("/api/member/library", requireMember, memberLibraryRouter);
    app.use("/api/member", requireMember, memberToolStateRouter);
    app.use(errorHandler); server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    const { pool } = await import("../../db/pool"); await pool.end(); await db?.drop();
  });

  const request = (path: string, token?: string, payload?: unknown) => fetch(`${base}${path}`, {
    method: payload === undefined ? "GET" : "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const searchBody = async (response: Response) => await response.json() as { results: CourseSearchResult[]; total: number };

  it("requires member auth and gives the same missing response to unowned and nonexistent products", async () => {
    expect((await request(`${searchPath}?q=cash`)).status).toBe(401);
    const hidden = await request(`${searchPath}?q=cash`, outsider.token);
    const absent = await request("/api/member/library/not-real/search?q=cash", outsider.token);
    expect(hidden.status).toBe(404); expect(absent.status).toBe(404);
    expect(await hidden.json()).toEqual(await absent.json());
  });
  it("searches all available text/transcripts without marking anything viewed", async () => {
    for (const q of ["sustainable", "diversification", "latest strategy"]) {
      const response = await request(`${searchPath}?q=${encodeURIComponent(q)}`, owner.token);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const result = await searchBody(response); expect(result.total).toBe(1);
      expect(result.results[0].id).toBe(q === "latest strategy" ? planId : openId);
    }
    expect((await db.client.query("SELECT count(*)::int n FROM lesson_progress WHERE member_id=$1", [owner.id])).rows[0].n).toBe(0);
  });
  it("excludes locked, draft, and other-course bodies while keeping visible locked titles", async () => {
    for (const q of ["LOCKEDBODYSECRET", "DRAFTBODYSECRET", "CROSSCOURSESECRET", "SEQUENCEBODYSECRET", "SCHEDULEDBODYSECRET"]) {
      expect((await searchBody(await request(`${searchPath}?q=${q}`, owner.token))).total).toBe(0);
    }
    const response = await searchBody(await request(`${searchPath}?q=locked-future`, owner.token));
    expect(response.results[0]).toMatchObject({ unlocked: false, snippet: "" });
    expect(JSON.stringify(response)).not.toContain("LOCKEDBODYSECRET");
  });
  it("bounds queries and treats whitespace as an empty result", async () => {
    expect((await request(`${searchPath}?q=${"x".repeat(161)}`, owner.token)).status).toBe(400);
    expect((await searchBody(await request(`${searchPath}?q=%20%20`, owner.token))).results).toEqual([]);
  });
  it("downloads PDF from current submitted data without creating or changing saved state", async () => {
    await db.client.query("INSERT INTO member_tool_state(member_id,tool_key,state,revision) VALUES($1,'living-business-plan',$2::jsonb,5)", [owner.id, JSON.stringify({ annual: { values: { legalName: "Previously saved synthetic plan" } }, reviews: [{ notes: "Keep review history" }], archives: [] })]);
    const before = (await db.client.query("SELECT state,revision,updated_at FROM member_tool_state WHERE member_id=$1 AND tool_key='living-business-plan'", [owner.id])).rows[0];
    const response = await request(pdfPath, owner.token, { expectedMemberId: owner.id, report });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("annual-business-plan-2026.pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const after = (await db.client.query("SELECT state,revision,updated_at FROM member_tool_state WHERE member_id=$1 AND tool_key='living-business-plan'", [owner.id])).rows[0];
    expect(after).toEqual(before);
  });
  it("rejects outsiders, identity swaps, and unbounded PDF payloads", async () => {
    const body = { expectedMemberId: owner.id, report };
    expect((await request(pdfPath, undefined, body)).status).toBe(401);
    expect((await request(pdfPath, outsider.token, { ...body, expectedMemberId: outsider.id })).status).toBe(404);
    expect((await request(pdfPath, owner.token, { ...body, expectedMemberId: outsider.id })).status).toBe(409);
    expect((await request(pdfPath, owner.token, { ...body, surplus: "x".repeat(270_000) })).status).toBe(400);
  });
  it("refuses both search and PDF after access expires or is revoked", async () => {
    await db.client.query("UPDATE access_grants SET expires_at=now()-interval '1 day' WHERE member_id=$1 AND product_id=$2", [owner.id, productId]);
    expect((await request(`${searchPath}?q=cash`, owner.token)).status).toBe(404);
    expect((await request(pdfPath, owner.token, { expectedMemberId: owner.id, report })).status).toBe(404);
    await db.client.query("UPDATE access_grants SET expires_at=NULL,status='revoked' WHERE member_id=$1 AND product_id=$2", [owner.id, productId]);
    expect((await request(`${searchPath}?q=cash`, owner.token)).status).toBe(404);
  });
});
