import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Client } from "pg";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;

/** Boardroom's coaching product opens a workbook course; dashboard entries belong to a member. */
describeDb("Rate Raise Lab isolation (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;
  let signToken: typeof import("../../auth/memberSession").signMemberAccessToken;
  let owner: { id: number; token: string };
  let peer: { id: number; token: string };
  let outsider: { id: number; token: string };
  let productId: number;

  beforeAll(async () => {
    db = await createTestDatabase("ratelab");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const { requireMember } = await import("../../middleware/memberAuth");
    const { memberToolStateRouter } = await import("./toolState");
    const { memberLibraryRouter } = await import("./library");
    const { errorHandler } = await import("../../middleware/errorHandler");
    signToken = (await import("../../auth/memberSession")).signMemberAccessToken;

    const course = await client.query<{ id: number }>(
      `INSERT INTO courses (id, slug, title, published)
       VALUES (61, 'the-boss-boardroom-test', 'The Boss Boardroom', false) ON CONFLICT(id) DO UPDATE SET published=false RETURNING id`,
    );
    const courseId = course.rows[0].id;
    const module = await client.query<{ id: number }>(
      `INSERT INTO course_modules (course_id, title, sort)
       VALUES ($1, 'Boardroom CEO Dashboard', 0) RETURNING id`, [courseId],
    );
    await client.query(
      `INSERT INTO course_lessons (id, module_id, title, slug, content_type, published, sort, tool_key)
       VALUES (163, $1, 'Raise Your Rate Guide', 'raise-your-rate-guide', 'text', true, 0,
               'rate-raise-lab') ON CONFLICT(id) DO UPDATE SET module_id=EXCLUDED.module_id,published=true,tool_key='rate-raise-lab',sort=0`, [module.rows[0].id],
    );
    const coachingOffer = await client.query<{ id: number }>(
      `INSERT INTO coaching_offers (slug, title)
       VALUES ('the-boss-boardroom-test', 'The Boss Boardroom') RETURNING id`,
    );
    const product = await client.query<{ id: number }>(
      `INSERT INTO products (slug, title, kind, coaching_offer_id, legacy_course_id, status)
       VALUES ('the-boss-boardroom-test', 'The Boss Boardroom', 'coaching', $1, $2, 'published')
       RETURNING id`, [coachingOffer.rows[0].id, courseId],
    );
    productId = product.rows[0].id;

    async function member(label: string) {
      const email = `boardroom-${label}@test.invalid`;
      const id = await insertMember(client, email);
      return { id, token: signToken({ sub: id, email }) };
    }
    owner = await member("owner");
    peer = await member("peer");
    outsider = await member("outsider");
    await client.query(
      `INSERT INTO access_grants (member_id, product_id, status, source)
       VALUES ($1, $3, 'active', 'manual'), ($2, $3, 'active', 'manual')`,
      [owner.id, peer.id, productId],
    );

    const app = express();
    app.use(express.json());
    app.use("/api/member", requireMember, memberToolStateRouter);
    app.use("/api/member/library", requireMember, memberLibraryRouter);
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


  const statePath="/api/member/tool-state/rate-raise-lab";
  const docPath="/api/member/tool-document/rate-raise-lab";
  const sample=(rate:number)=>({version:1,fields:{rate,payerCpt90837Current:120,payerCpt90837Proposed:132,noticeDate:"2026-11-15",readiness0:true}});
  async function req(path:string, token?:string, body?:unknown, extraHeaders:Record<string,string>={}) {
    const id=token===owner?.token?owner.id:token===peer?.token?peer.id:token===outsider?.token?outsider.id:null;
    const bound=body===undefined && id && !path.includes("expectedMemberId=") ? path+(path.includes("?")?"&":"?")+"expectedMemberId="+id : path;
    const response=await fetch(baseUrl+bound,{
      method:body===undefined?"GET":"PUT",
      headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"}),...extraHeaders},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    return {status:response.status,body:await response.json() as Record<string,unknown>,headers:response.headers};
  }
  const put=(who:typeof owner,state:unknown,revision=0)=>req(statePath,who.token,{state,revision,expectedMemberId:who.id});
  it("protects the document and progress from unauthenticated, forged, cookie-only and nonmembers",async()=>{
    for(const path of [statePath,docPath]){
      expect((await req(path)).status).toBe(401);
      expect((await req(path,"invalid")).status).toBe(401);
      expect((await req(path,undefined,undefined,{Cookie:"member_access_token="+owner.token,Origin:"https://evil.invalid"})).status).toBe(401);
      expect((await req(path,outsider.token)).status).toBe(404);
    }
    expect((await put(outsider,sample(1))).status).toBe(404);
    expect((await req(statePath,undefined,{state:sample(1),revision:0,expectedMemberId:owner.id},{Origin:"https://evil.invalid"})).status).toBe(401);
  });
  it("returns only protected no-store HTML with sandbox bridge and no prototype save adapter",async()=>{
    const doc=await req(docPath,owner.token);
    expect(doc.status).toBe(200);
    expect(doc.headers.get("cache-control")).toBe("private, no-store");
    expect(doc.headers.get("vary")).toContain("Authorization");
    expect(doc.body.html).toContain("__RATE_LAB_RUNTIME_URL__");
    expect(doc.body.html).not.toContain("<script>");
    expect(doc.body.html).not.toContain("/api/loungemembers");
    expect(doc.body.html).not.toContain("localStorage");
    expect(doc.body.html).toContain("connect-src 'none'");
  });
  it("keeps two members separate with revision checks and no cache",async()=>{
    expect((await req(statePath,owner.token)).body.state).toBeNull();
    expect((await put(owner,sample(120))).status).toBe(200);
    expect((await req(statePath,peer.token)).body.state).toBeNull();
    expect((await put(peer,sample(250))).status).toBe(200);
    const a=await req(statePath,owner.token),b=await req(statePath,peer.token);
    expect(a.body.state).toEqual(sample(120));expect(b.body.state).toEqual(sample(250));
    expect(a.headers.get("cache-control")).toBe("private, no-store");
    expect((await put(owner,sample(999),0)).status).toBe(409);
    expect((await req(statePath,owner.token,{state:sample(999),revision:1,expectedMemberId:peer.id})).status).toBe(409);
    expect((await req(statePath,owner.token)).body.state).toEqual(sample(120));
    expect((await req(statePath+"?memberId="+owner.id,peer.token)).body.state).toEqual(sample(250));
    expect((await req(statePath+"?expectedMemberId="+owner.id,peer.token)).status).toBe(409);
    expect((await req(docPath+"?expectedMemberId="+owner.id,peer.token)).status).toBe(409);
  });
  it("rejects untrusted or sensitive fields, overflows, invalid dates, arrays and missing revision",async()=>{
    expect((await req(statePath,owner.token,{state:sample(2)})).status).toBe(409);
    for(const state of [
      {version:1,fields:{tplOutput:"private generated text"}},
      {version:1,fields:{payerTax:"123456789"}},
      {version:1,fields:{tplClient:"Client"}}, {version:1,fields:{rate:"120"}},
      {version:1,fields:{rate:-1}}, {version:1,fields:{rate:10001}},
      {version:1,fields:{noticeDate:"2026-02-30"}},
      {version:1,fields:{noticeDate:"2026-99-01"}},
      {version:1,fields:{payerStatus:"hacked"}},
      {version:1,fields:{readiness0:"true"}}, {version:1,fields:[]},
      {...sample(2),memberId:peer.id}, {version:1,fields:{"__proto__":{polluted:true}},other:true}
    ])expect((await put(owner,state,1)).status).toBe(400);
    expect((await req(statePath,owner.token,{state:sample(2),revision:1,expectedMemberId:owner.id,memberId:peer.id})).status).toBe(400);
    expect((await req(statePath,owner.token)).body.state).toEqual(sample(120));
  });
  it("permits explicit empty optional values without inventing rates",async()=>{
    const empty={version:1,fields:{payerCpt90837Current:null,payerCpt90837Compare:null,payerCpt90837Proposed:null,fairDate:"",quiz:""}};
    expect((await put(owner,empty,1)).status).toBe(200);
    expect((await req(statePath,owner.token)).body.state).toEqual(empty);
  });
  it("denies impersonation writes",async()=>{
    const token=signToken({sub:owner.id,email:"admin@test.invalid",impersonatedBy:1});
    expect((await req(statePath,token,{state:sample(22),revision:2,expectedMemberId:owner.id})).status).toBe(403);
  });
  it("cannot broaden access by attaching this tool to a different lesson",async()=>{
    await client.query("INSERT INTO course_lessons(module_id,title,slug,content_type,published,sort,tool_key) SELECT module_id,'Other lab','other-lab','text',true,99,'rate-raise-lab' FROM course_lessons WHERE id=163");
    await client.query("UPDATE course_lessons SET published=false WHERE id=163");
    for(const path of [statePath,docPath])expect((await req(path,owner.token)).status).toBe(404);
    await client.query("UPDATE course_lessons SET published=true WHERE id=163");
    expect((await req(docPath,owner.token)).status).toBe(200);
  });
  it("rejects a session-bound token after logout",async()=>{
    const session=await client.query("INSERT INTO member_sessions(member_id,token_hash,expires_at) VALUES($1,'synthetic-lab-session',now()+interval '1 hour') RETURNING id",[owner.id]);
    const sessionId=String(session.rows[0].id);
    const token=signToken({sub:owner.id,email:"owner@test.invalid",sessionId});
    expect((await req(statePath+"?expectedMemberId="+owner.id,token)).status).toBe(200);
    await client.query("UPDATE member_sessions SET revoked_at=now(),revoked_reason='logout' WHERE id=$1",[sessionId]);
    for(const path of [statePath,docPath])expect((await req(path+"?expectedMemberId="+owner.id,token)).status).toBe(401);
  });
  it("denies expired access and revoked entitlement without deleting saved work",async()=>{
    await client.query("UPDATE access_grants SET expires_at=now()-interval '1 day' WHERE member_id=$1 AND product_id=$2",[peer.id,productId]);
    for(const path of [statePath,docPath])expect((await req(path,peer.token)).status).toBe(404);
    expect((await put(peer,sample(55),1)).status).toBe(404);
    await client.query("UPDATE access_grants SET status='revoked',revoked_at=now() WHERE member_id=$1 AND product_id=$2",[owner.id,productId]);
    for(const path of [statePath,docPath])expect((await req(path,owner.token)).status).toBe(404);
    const saved=await client.query("SELECT state FROM member_tool_state WHERE member_id=$1 AND tool_key='rate-raise-lab'",[peer.id]);
    expect(saved.rows[0].state).toEqual(sample(250));
  });
});
