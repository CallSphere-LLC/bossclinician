import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BoardroomReport } from "../../services/boardroomAssessment";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, hasTestDatabase, insertMember, insertCourseProduct } from "../../testing/db";

const migration = fs.readFileSync(path.join(__dirname, "../../db/migrations/160_boardroom_ceo_assessment.sql"), "utf8");

describe.skipIf(!hasTestDatabase)("CEO assessment API, history, draft and migration (scratch Postgres)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server | undefined;
  let base: string;
  let a: number, b: number, stranger: number, courseId: number, productId: number, moduleId: number, dashboardId: number, planId: number;
  let tokenA: string, tokenB: string, tokenStranger: string, tokenImpersonated: string;
  let service: typeof import("../../services/boardroomAssessment");
  let stateService: typeof import("../../services/toolState");
  let ownerId: number;
  let ownerToken: string;
  let originalLessons: Record<string, unknown>[];
  let originalGrants: Record<string, unknown>[];

  async function call(method: string, url: string, token?: string, body?: unknown) {
    const response = await fetch(base + url, {
      method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as { report: BoardroomReport; reports: BoardroomReport[]; revision: number; state: unknown; accessToken: string; error?: string }, cache: response.headers.get("cache-control") };
  }
  const post = (token: string, memberId: number, answers = Array(12).fill(1), requestId = randomUUID()) =>
    call("POST", "/boardroom-assessment", token, { responses: answers, requestId, expectedMemberId: memberId });

  async function createAdminSession(role: "owner" | "admin" | "support" | "coach") {
    const { signToken } = await import("../../utils/jwt");
    const { hashToken } = await import("../../auth/tokens");
    const email = "ceo-"+role+"@test.invalid";
    const id = (await db.client.query(
      "INSERT INTO admin_users (email,password_hash,name,role) VALUES ($1,'unused','Assessment test',$2) RETURNING id",
      [email,role],
    )).rows[0].id as number;
    const token = signToken({sub:id,email,role});
    await db.client.query("INSERT INTO admin_sessions (admin_user_id,token_hash,expires_at,last_used_at) VALUES ($1,$2,now()+interval '1 hour',now())",[id,hashToken(token)]);
    return {id,token};
  }

  beforeAll(async () => {
    db = await createTestDatabase("ceo_assessment");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "ceo-scratch-test-secret";
    // All historical migrations run on a fresh database. No course fixture may
    // be injected before that replay, since older content migrations own it.
    a = await insertMember(db.client, "ceo-a@test.invalid");
    b = await insertMember(db.client, "ceo-b@test.invalid");
    stranger = await insertMember(db.client, "ceo-stranger@test.invalid");
    await db.client.query("UPDATE members SET timezone = 'America/Los_Angeles' WHERE id = $1", [a]);
    const course = await insertCourseProduct(db.client, "the-board-room");
    courseId = course.courseId; productId = course.productId;
    moduleId = (await db.client.query("INSERT INTO course_modules (course_id,title,sort) VALUES ($1,'Boardroom CEO Dashboard',0) RETURNING id", [courseId])).rows[0].id;
    dashboardId = (await db.client.query(`INSERT INTO course_lessons (module_id,title,slug,body_md,content_type,published,sort,tool_key)
      VALUES ($1,'Original CEO Dashboard','custom-dashboard-slug','nine sections preserved','text',true,0,'boardroom-ceo-dashboard') RETURNING id`, [moduleId])).rows[0].id;
    planId = (await db.client.query(`INSERT INTO course_lessons (module_id,title,slug,body_md,content_type,published,sort,tool_key)
      VALUES ($1,'My Living Plan','custom-plan-slug','existing plan preserved','text',true,1,'living-business-plan') RETURNING id`, [moduleId])).rows[0].id;
    for (const member of [a, b]) await db.client.query(`INSERT INTO access_grants (member_id,product_id,source,status)
      VALUES ($1,$2,'manual','active')`, [member, productId]);
    await db.client.query(`INSERT INTO lesson_progress (member_id, lesson_id, completed_at) VALUES ($1,$2,now())`, [a,dashboardId]);
    originalLessons = (await db.client.query("SELECT * FROM course_lessons WHERE module_id = $1 ORDER BY sort,id", [moduleId])).rows;
    originalGrants = (await db.client.query("SELECT * FROM access_grants ORDER BY id")).rows;
    await db.client.query(migration);
    service = await import("../../services/boardroomAssessment");
    stateService = await import("../../services/toolState");
    const { signMemberAccessToken } = await import("../../auth/memberSession");
    tokenA = signMemberAccessToken({ sub:a, email:"ceo-a@test.invalid" });
    tokenB = signMemberAccessToken({ sub:b, email:"ceo-b@test.invalid" });
    tokenStranger = signMemberAccessToken({ sub:stranger, email:"ceo-stranger@test.invalid" });
    const { default: express } = await import("express");
    const { requireMember } = await import("../../middleware/memberAuth");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const { memberBoardroomAssessmentRouter } = await import("./boardroomAssessment");
    const { memberToolStateRouter } = await import("./toolState");
    const { requireAuth } = await import("../../middleware/auth");
    const { requirePermission } = await import("../../services/permissions");
    const { adminMembersRouter } = await import("../admin/members");
    const app = express();
    app.use(express.json());
    // Same auth and permission mount as routes/admin/index.ts; use the real
    // role gate and strict audit writer when issuing the scoped read token.
    app.use("/admin/members", requireAuth, requirePermission("contacts.view"), adminMembersRouter);
    app.use(requireMember, memberBoardroomAssessmentRouter, memberToolStateRouter, errorHandler);
    server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const owner = await createAdminSession("owner");
    ownerId = owner.id;
    ownerToken = owner.token;
    const issued = await call("POST", "/admin/members/"+a+"/impersonate", ownerToken);
    expect(issued.status).toBe(200);
    tokenImpersonated = issued.body.accessToken;
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (server) await new Promise<void>((resolve, reject) => server!.close(err => err ? reject(err) : resolve()));
    if (service) await (await import("../../db/pool")).pool.end();
    await db?.drop();
  });

  it("adds a single published lesson before the unchanged dashboard without grants or lost progress", async () => {
    const lessons = (await db.client.query("SELECT * FROM course_lessons WHERE module_id = $1 ORDER BY sort,id", [moduleId])).rows;
    expect(lessons[0]).toMatchObject({ title:"Your CEO Assessment", slug:"boardroom-ceo-assessment", tool_key:"boardroom-ceo-assessment", published:true, requires_previous_lesson:false });
    expect(lessons.slice(1).map(({sort, ...rest}) => rest)).toEqual(originalLessons.map(({sort, ...rest}) => rest));
    expect((await db.client.query("SELECT * FROM access_grants ORDER BY id")).rows).toEqual(originalGrants);
    expect((await db.client.query("SELECT completed_at FROM lesson_progress WHERE member_id=$1 AND lesson_id=$2", [a,dashboardId])).rows[0].completed_at).toBeTruthy();
    await db.client.query(migration);
    expect((await db.client.query("SELECT * FROM course_lessons WHERE module_id = $1 ORDER BY sort,id", [moduleId])).rows).toEqual(lessons);
    const view = await (await import("../../services/curriculum")).loadCourseForMember(a,courseId);
    expect(view?.modules.flatMap(m=>m.lessons).find(l=>l.id===dashboardId)).toMatchObject({unlocked:true,completed:true});
  });

  it.each(["previous", "quiz", "video"])("refuses placement that changes a custom %s prerequisite", async (gate) => {
    await db.client.query("BEGIN");
    try {
      await db.client.query("DELETE FROM course_lessons WHERE tool_key='boardroom-ceo-assessment'");
      if (gate === "previous") {
        await db.client.query("UPDATE course_lessons SET requires_previous_lesson=true WHERE id=$1",[dashboardId]);
      } else {
        const previousId = (await db.client.query(
          "INSERT INTO course_lessons (module_id,title,slug,published,sort,content_type,video_url) VALUES ($1,'Before dashboard','before-dashboard',true,-1,$2,$3) RETURNING id",
          [moduleId, gate === "video" ? "video" : "text", gate === "video" ? "https://example.invalid/test.mp4" : ""],
        )).rows[0].id;
        if (gate === "quiz") {
          await db.client.query("INSERT INTO assessments (slug,title,kind,lesson_id,published,require_pass,pass_mark) VALUES ('ceo-prereq','Prerequisite','graded',$1,true,true,80)",[previousId]);
        } else {
          await db.client.query("UPDATE courses SET require_full_video=true WHERE id=$1",[courseId]);
        }
      }
      await expect(db.client.query(migration)).rejects.toThrow("prerequisite");
    } finally { await db.client.query("ROLLBACK"); }
  });

  it("preserves existing lesson ordering when sort values tie", async () => {
    await db.client.query("BEGIN");
    try {
      const mod = (await db.client.query("INSERT INTO course_modules (course_id,title,sort) VALUES ($1,'Tied sorts',10) RETURNING id",[courseId])).rows[0].id;
      const ids: number[] = [];
      for (const [slug,key] of [["before-tied",""],["tied-dashboard","boardroom-ceo-dashboard"],["after-tied",""]]) {
        ids.push((await db.client.query("INSERT INTO course_lessons (module_id,title,slug,published,sort,tool_key) VALUES ($1,$2,$2,true,0,$3) RETURNING id",[mod,slug,key || null])).rows[0].id);
      }
      await db.client.query(migration);
      const lessons = (await db.client.query("SELECT id,tool_key FROM course_lessons WHERE module_id=$1 ORDER BY sort,id",[mod])).rows;
      expect(lessons.filter(l=>l.tool_key!=="boardroom-ceo-assessment").map(l=>l.id)).toEqual(ids);
      expect(lessons[1].tool_key).toBe("boardroom-ceo-assessment");
      expect(lessons[2].id).toBe(ids[1]);
    } finally { await db.client.query("ROLLBACK"); }
  });

  it("does not create course data when the target is absent", async () => {
    await db.client.query("BEGIN");
    try {
      await db.client.query("UPDATE courses SET slug='temporarily-no-boardroom' WHERE id=$1",[courseId]);
      const before = (await db.client.query("SELECT * FROM course_lessons ORDER BY id")).rows;
      await db.client.query(migration);
      expect((await db.client.query("SELECT * FROM course_lessons ORDER BY id")).rows).toEqual(before);
      expect((await db.client.query("SELECT * FROM access_grants ORDER BY id")).rows).toEqual(originalGrants);
    } finally { await db.client.query("ROLLBACK"); }
  });

  it("rejects unauthenticated requests, impersonated writes and missing entitlements", async () => {
    expect((await call("GET","/boardroom-assessment")).status).toBe(401);
    expect((await call("POST","/boardroom-assessment")).status).toBe(401);
    expect((await call("GET","/boardroom-assessment",tokenImpersonated)).status).toBe(200);
    expect((await post(tokenImpersonated,a)).status).toBe(403);
    expect((await call("GET","/boardroom-assessment",tokenStranger)).status).toBe(404);
    expect((await post(tokenStranger,stranger)).status).toBe(404);
    expect((await call("GET","/tool-state/boardroom-ceo-assessment",tokenStranger)).status).toBe(404);
    expect((await call("PUT","/tool-state/boardroom-ceo-assessment",tokenStranger,{state:{},revision:0,expectedMemberId:stranger})).status).toBe(404);
  });

  it("returns only stored reports, validated timezone and actual entitled lesson URLs", async () => {
    const result = await call("GET","/boardroom-assessment",tokenA);
    expect(result.status).toBe(200);
    expect(result.cache).toBe("private, no-store");
    expect(result.body).toEqual({ reports:[],timezone:"America/Los_Angeles",links:{
      dashboard:{title:"Original CEO Dashboard",href:"/library/p-the-board-room/lessons/custom-dashboard-slug"},
      plan:{title:"My Living Plan",href:"/library/p-the-board-room/lessons/custom-plan-slug"},
    }});
  });

  it("rejects incomplete, wrong, forged and unknown inputs plus account switches", async () => {
    const valid = {responses:Array(12).fill(1),requestId:randomUUID(),expectedMemberId:a};
    for (const body of [
      {...valid,responses:Array(11).fill(1)}, {...valid,responses:Array(12).fill("1")},
      {...valid,responses:Array(12).fill(4.1)}, {...valid,responses:Array(12).fill(0)},
      {...valid,responses:Array(13).fill(4)}, {...valid,responses:Array(12).fill(null)},
      {...valid,requestId:"invalid"}, {...valid,memberId:b}, {...valid,overallScore:100},
      {...valid,expectedMemberId:undefined},
    ]) expect((await call("POST","/boardroom-assessment",tokenA,body)).status).toBe(400);
    expect((await post(tokenB,a)).status).toBe(409);
    expect((await call("GET","/boardroom-assessment?memberId="+b,tokenA)).status).toBe(400);
    expect((await call("POST","/boardroom-assessment?memberId="+b,tokenA,valid)).status).toBe(400);
  });

  it("scores on the server, preserves retry timestamps, and isolates each member's UUID", async () => {
    const requestId = randomUUID();
    const before = Date.now();
    const first = await post(tokenA,a,Array(12).fill(1),requestId);
    expect(first.status).toBe(200);
    const report = first.body.report;
    expect(report.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(report).toMatchObject({assessmentVersion:"boardroom-ceo-v1",overallScore:25,responses:Array(12).fill(1)});
    expect(Date.parse(report.completedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(report.completedAt)).toBeLessThanOrEqual(Date.now());
    expect(report.quarter).toBe(service.boardroomQuarter(new Date(report.completedAt),"America/Los_Angeles"));
    expect((await post(tokenA,a,Array(12).fill(1),requestId)).body.report).toEqual(report);
    expect((await post(tokenA,a,Array(12).fill(4),requestId)).status).toBe(409);
    const other = await post(tokenB,b,Array(12).fill(4),requestId);
    expect(other.body.report.overallScore).toBe(100);
    expect(other.body.report.id).not.toBe(report.id);
    expect((await call("GET","/boardroom-assessment",tokenA)).body.reports).toEqual([report]);
    expect((await call("GET","/boardroom-assessment",tokenB)).body.reports).toEqual([other.body.report]);
    await expect(db.client.query("UPDATE member_boardroom_assessments SET overall_score=100 WHERE id=$1",[report.id])).rejects.toThrow("immutable");
  });

  it("allows audited owner/admin view-as reads only for the token's member and blocks writes and selectors", async () => {
    const memberA = await call("GET","/boardroom-assessment",tokenA);
    const memberB = await call("GET","/boardroom-assessment",tokenB);
    expect(memberA.body.reports).toHaveLength(1);
    expect(memberB.body.reports).toHaveLength(1);
    const viewed = await call("GET","/boardroom-assessment",tokenImpersonated);
    expect(viewed.status).toBe(200);
    expect(viewed.cache).toBe("private, no-store");
    expect(viewed.body).toEqual(memberA.body);
    expect(viewed.body.reports.map(r=>r.id)).not.toContain(memberB.body.reports[0].id);
    expect((await post(tokenImpersonated,a)).status).toBe(403);
    expect((await call("GET","/boardroom-assessment?memberId="+b,tokenImpersonated)).status).toBe(400);
    expect((await call("GET","/boardroom-assessment?expectedMemberId="+b,tokenImpersonated)).status).toBe(400);
    expect((await call("PUT","/tool-state/boardroom-ceo-assessment",tokenImpersonated,{state:{},revision:0,expectedMemberId:a})).status).toBe(403);
    const audit = (await db.client.query(
      "SELECT admin_user_id,action,entity_type,entity_id,after_state FROM admin_audit_log WHERE action='member.impersonate' AND admin_user_id=$1",
      [ownerId],
    )).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      admin_user_id:ownerId,action:"member.impersonate",entity_type:"member",entity_id:String(a),
      after_state:{memberEmail:"ceo-a@test.invalid",expiresInSeconds:900},
    });
    const { verifyMemberAccessToken } = await import("../../auth/memberSession");
    expect(verifyMemberAccessToken(tokenImpersonated)).toMatchObject({sub:a,impersonatedBy:ownerId});
    expect((await db.client.query("SELECT id FROM member_sessions WHERE member_id=$1",[a])).rows).toHaveLength(0);

    for (const role of ["support","coach"] as const) {
      const denied = await createAdminSession(role);
      expect((await call("POST","/admin/members/"+a+"/impersonate",denied.token)).status).toBe(403);
      expect((await db.client.query("SELECT id FROM admin_audit_log WHERE action='member.impersonate' AND admin_user_id=$1",[denied.id])).rows).toHaveLength(0);
    }
    const manager = await createAdminSession("admin");
    const issued = await call("POST","/admin/members/"+b+"/impersonate",manager.token);
    expect(issued.status).toBe(200);
    expect((await call("GET","/boardroom-assessment",issued.body.accessToken)).body).toEqual(memberB.body);
    expect((await post(issued.body.accessToken,b)).status).toBe(403);
    const unentitled = await call("POST","/admin/members/"+stranger+"/impersonate",ownerToken);
    expect(unentitled.status).toBe(200);
    expect((await call("GET","/boardroom-assessment",unentitled.body.accessToken)).status).toBe(404);
    expect((await call("GET","/boardroom-assessment",tokenImpersonated)).body).toEqual(memberA.body);
  });

  it("handles concurrent duplicate requests atomically and conflicting UUID reuse", async () => {
    const requestId = randomUUID();
    const results = await Promise.all(Array.from({length:4},()=>post(tokenA,a,Array(12).fill(2),requestId)));
    expect(results.every(r=>r.status===200)).toBe(true);
    expect(new Set(results.map(r=>r.body.report.id)).size).toBe(1);
    const id2 = randomUUID();
    const mixed = await Promise.all([post(tokenA,a,Array(12).fill(1),id2),post(tokenA,a,Array(12).fill(4),id2)]);
    expect(mixed.map(r=>r.status).sort()).toEqual([200,409]);
  });

  it("stores quarter at completion, retains gaps and orders latest first without recomputation", async () => {
    vi.useFakeTimers({toFake:["Date"]});
    vi.setSystemTime(new Date("2026-04-01T00:30:00Z"));
    let report;
    try { report = await service.submitBoardroomAssessment(a,Array(12).fill(3),randomUUID()); }
    finally { vi.useRealTimers(); }
    expect(report).toMatchObject({quarter:"2026-Q1",completedAt:"2026-04-01T00:30:00.000Z"});
    await db.client.query("UPDATE members SET timezone='UTC' WHERE id=$1",[a]);
    const history = await service.listBoardroomReports(a);
    expect(history.find(r=>r.id===report.id)).toEqual(report);
    expect(history.map(r=>r.completedAt)).toEqual(history.map(r=>r.completedAt).sort().reverse());
    expect(history.length).toBe(4);
    await db.client.query("UPDATE members SET timezone='America/Los_Angeles' WHERE id=$1",[a]);
  });

  it("requires revision and account identity, rejects stale drafts, and preserves dashboard/plan data", async () => {
    for (const key of ["boardroom-ceo-dashboard","living-business-plan"])
      await stateService.saveToolState(a,key,{manual:"keep",goals:["existing"]},0);
    const url="/tool-state/boardroom-ceo-assessment";
    expect((await call("GET",url,tokenA)).body).toEqual({state:null,updatedAt:null,revision:0});
    expect((await call("PUT",url,tokenA,{state:{answers:[1]},expectedMemberId:a})).status).toBe(409);
    expect((await call("PUT",url,tokenA,{state:{answers:[1]},revision:0})).status).toBe(409);
    expect((await call("PUT",url,tokenB,{state:{answers:[1]},revision:0,expectedMemberId:a})).status).toBe(409);
    expect((await call("PUT",url,tokenImpersonated,{state:{},revision:0,expectedMemberId:a})).status).toBe(403);
    expect((await call("PUT",url,tokenA,{state:{answers:[1]},revision:0,expectedMemberId:a,memberId:b})).status).toBe(400);
    expect((await call("PUT",url,tokenA,{state:{answers:[1,2]},revision:0,expectedMemberId:a})).body.revision).toBe(1);
    expect((await call("PUT",url,tokenA,{state:{answers:[4]},revision:0,expectedMemberId:a})).status).toBe(409);
    expect((await call("PUT",url,tokenA,{state:{answers:[1,2,3]},revision:1,expectedMemberId:a})).body.revision).toBe(2);
    expect((await call("GET",url,tokenA)).body).toMatchObject({state:{answers:[1,2,3]},revision:2});
    expect((await call("GET",url,tokenB)).body).toEqual({state:null,updatedAt:null,revision:0});
    expect((await call("PUT",url,tokenB,{state:{answers:[4]},revision:0,expectedMemberId:b})).body.revision).toBe(1);
    await post(tokenA,a);
    for (const key of ["boardroom-ceo-dashboard","living-business-plan"])
      expect((await stateService.loadToolState(a,key)).state).toEqual({manual:"keep",goals:["existing"]});
    expect((await call("GET",url,tokenA)).body.state).toEqual({answers:[1,2,3]});
    expect((await call("GET",url,tokenB)).body.state).toEqual({answers:[4]});
    expect((await call("GET",url+"?memberId="+b,tokenA)).body.state).toEqual({answers:[1,2,3]});
  });

  it("omits unpublished, locked and unentitled links and honors assessment locks", async () => {
    await db.client.query("UPDATE course_lessons SET published=false WHERE id=$1",[planId]);
    expect((await service.loadBoardroomLinks(a)).plan).toBeNull();
    await db.client.query("UPDATE course_lessons SET published=true,publish_at=now()+interval '1 day' WHERE id=$1",[planId]);
    expect((await service.loadBoardroomLinks(a)).plan).toBeNull();
    await db.client.query("UPDATE course_lessons SET publish_at=NULL WHERE id=$1",[planId]);
    await db.client.query("UPDATE course_lessons SET requires_previous_lesson=true WHERE id=$1",[planId]);
    expect((await service.loadBoardroomLinks(b)).plan).toBeNull();
    await db.client.query("UPDATE course_lessons SET requires_previous_lesson=false WHERE id=$1",[planId]);
    expect(await service.loadBoardroomLinks(stranger)).toEqual({dashboard:null,plan:null});
    await db.client.query("UPDATE course_lessons SET publish_at=now()+interval '1 day' WHERE tool_key='boardroom-ceo-assessment'");
    expect((await call("GET","/boardroom-assessment",tokenA)).status).toBe(404);
    expect((await post(tokenA,a)).status).toBe(404);
    await db.client.query("UPDATE course_lessons SET publish_at=NULL WHERE tool_key='boardroom-ceo-assessment'");
  });

  it("returns 100 real saved reports when history is bounded", async () => {
    for (let i=0;i<101;i++) await service.submitBoardroomAssessment(b,Array(12).fill(i%4+1),randomUUID());
    const reports = await service.listBoardroomReports(b);
    expect(reports).toHaveLength(100);
    expect(new Set(reports.map(r=>r.id)).size).toBe(100);
    expect(reports.map(r=>r.completedAt)).toEqual(reports.map(r=>r.completedAt).sort().reverse());
  });

  it("retains prior-quarter and older-version baselines beyond 100 retakes without rescoring or leaking members", async () => {
    const member = await insertMember(db.client, "ceo-version-history@test.invalid");
    await db.client.query("UPDATE members SET timezone='UTC' WHERE id=$1", [member]);
    await db.client.query("INSERT INTO access_grants (member_id,product_id,source,status) VALUES ($1,$2,'manual','active')", [member,productId]);
    const { signMemberAccessToken } = await import("../../auth/memberSession");
    const token = signMemberAccessToken({sub:member,email:"ceo-version-history@test.invalid"});
    const now = new Date();
    const quarterMonth = Math.floor(now.getUTCMonth()/3)*3;
    const previousAt = new Date(Date.UTC(now.getUTCFullYear(),quarterMonth-3,15,12));
    const currentAnchorAt = new Date(Date.UTC(now.getUTCFullYear(),quarterMonth,1));
    const previousQuarter = service.boardroomQuarter(previousAt,"UTC");
    const currentQuarter = service.boardroomQuarter(now,"UTC");

    async function fixture(version: string, at: Date, owner = member) {
      const id = randomUUID();
      const score = service.scoreBoardroomAssessment(Array(12).fill(1));
      await db.client.query(
        `INSERT INTO member_boardroom_assessments
          (id,member_id,request_id,assessment_version,completed_at,timezone,quarter,
           responses,overall_score,domains,priorities,first_action)
         VALUES ($1,$2,$3,$4,$5,'UTC',$6,$7,37,$8::jsonb,$9::jsonb,'Archived scoring recommendation')`,
        [id,owner,randomUUID(),version,at,service.boardroomQuarter(at,"UTC"),score.responses,
          JSON.stringify(score.domains),JSON.stringify(score.priorities)],
      );
      return id;
    }
    const superseded = await fixture("boardroom-ceo-v0", new Date(previousAt.getTime()-1000));
    const oldVersionPrior = await fixture("boardroom-ceo-v0", previousAt);
    const currentVersionPrior = await fixture("boardroom-ceo-v1", previousAt);
    const oldVersionCurrent = await fixture("boardroom-ceo-v0", currentAnchorAt);
    const otherMember = await fixture("boardroom-ceo-v0", previousAt, a);
    await expect(fixture("not-a-boardroom-version",previousAt)).rejects.toThrow("check constraint");

    const current: BoardroomReport[] = [];
    vi.useFakeTimers({toFake:["Date"]});
    vi.setSystemTime(now);
    try {
      // A fixed timestamp also exercises deterministic UUID tie ordering.
      for (let i=0;i<105;i++) current.push(await service.submitBoardroomAssessment(member,Array(12).fill(i%4+1),randomUUID()));
    } finally { vi.useRealTimers(); }
    const submitted = await post(token,member,Array(12).fill(4));
    expect(submitted.status).toBe(200);
    expect(submitted.body.report.assessmentVersion).toBe("boardroom-ceo-v1");
    current.push(submitted.body.report);
    expect((await call("POST","/boardroom-assessment",token,{
      responses:Array(12).fill(4),requestId:randomUUID(),expectedMemberId:member,assessmentVersion:"boardroom-ceo-v0",
    })).status).toBe(400);

    const result = await call("GET","/boardroom-assessment",token);
    expect(result.status).toBe(200);
    const reports = result.body.reports;
    const newest = [...current].sort((x,y)=>y.completedAt.localeCompare(x.completedAt)||y.id.localeCompare(x.id)).slice(0,100);
    expect(reports).toHaveLength(103);
    expect(new Set(reports.map(r=>r.id)).size).toBe(103);
    expect(new Set(reports.map(r=>r.id))).toEqual(new Set([
      ...newest.map(r=>r.id),oldVersionPrior,currentVersionPrior,oldVersionCurrent,
    ]));
    expect(reports.map(r=>r.id)).not.toContain(superseded);
    expect(reports.map(r=>r.id)).not.toContain(otherMember);
    expect(reports.find(r=>r.id===oldVersionPrior)).toMatchObject({
      assessmentVersion:"boardroom-ceo-v0",quarter:previousQuarter,
      overallScore:37,firstAction:"Archived scoring recommendation",responses:Array(12).fill(1),
    });
    expect(reports.find(r=>r.id===currentVersionPrior)?.quarter).toBe(previousQuarter);
    expect(reports.find(r=>r.id===oldVersionCurrent)?.quarter).toBe(currentQuarter);
    expect(new Set(reports.map(r=>r.quarter))).toEqual(new Set([previousQuarter,currentQuarter]));
    expect(reports).toEqual([...reports].sort((x,y)=>y.completedAt.localeCompare(x.completedAt)||y.id.localeCompare(x.id)));
    expect((await call("GET","/boardroom-assessment?memberId="+a,token)).status).toBe(400);
  });

  it("enforces the member submission rate limit", async () => {
    let status=200;
    for(let i=0;i<61 && status!==429;i++) status=(await post(tokenA,a)).status;
    expect(status).toBe(429);
  });
});
