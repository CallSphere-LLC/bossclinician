import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;
describeDb("community participant preview (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: ReturnType<express.Express["listen"]>;
  let base: string;
  let id: number;
  let group: number;
  let otherGroup: number;
  beforeAll(async () => {
    db = await createTestDatabase("communitypreview");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    const { adminCommunityRouter } = await import("./community");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const app = express(); app.use(express.json());
    // Authentication/module gating remains on the parent admin router.
    app.use("/community", adminCommunityRouter); app.use(errorHandler);
    server = app.listen(0); await new Promise(resolve=>server.once("listening",resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/community`;
    id=(await db.client.query("INSERT INTO communities(slug,name,published,description) VALUES('preview-room','Preview room',false,'Welcome\nSecond paragraph') RETURNING id")).rows[0].id;
    const other=(await db.client.query("INSERT INTO communities(slug,name) VALUES('other-room','Other') RETURNING id")).rows[0].id;
    group=(await db.client.query("INSERT INTO community_access_groups(community_id,name) VALUES($1,'Lounge tier') RETURNING id",[id])).rows[0].id;
    otherGroup=(await db.client.query("INSERT INTO community_access_groups(community_id,name) VALUES($1,'Other tier') RETURNING id",[other])).rows[0].id;
    await db.client.query(`INSERT INTO community_channels(community_id,slug,name,visibility,access_group_id,sort)
      VALUES($1,'general','General','public',NULL,0),($1,'tier','Tier channel','public',$2,1),($1,'private','Private channel','private',NULL,2)`,[id,group]);
    const channel=(await db.client.query("SELECT id FROM community_channels WHERE community_id=$1 AND slug='general'",[id])).rows[0].id;
    await db.client.query("INSERT INTO community_posts(channel_id,title,body,status) VALUES($1,'Visible post','Read this','visible'),($1,'Hidden post','Hidden','hidden')",[channel]);
  },60000);
  afterAll(async()=>{
    await new Promise<void>(resolve=>server?.close(()=>resolve()));
    const { pool }=await import("../../db/pool");await pool.end();await db?.drop();
  });
  async function read(query=""): Promise<{status:number;body:any}> { const r=await fetch(`${base}/${id}/preview${query}`);return {status:r.status,body:await r.json()}; }
  it("previews a draft with real text and only visible posts, without creating membership",async()=>{
    const before=await db.client.query("SELECT * FROM community_memberships WHERE community_id=$1",[id]);
    const r=await read(); expect(r.status).toBe(200);expect(r.body.published).toBe(false);
    expect(r.body.overview.community.description).toBe("Welcome\nSecond paragraph");
    expect(r.body.feed.posts.map((p:any)=>p.title)).toEqual(["Visible post"]);
    expect(r.body.overview.channels.map((c:any)=>c.slug)).toEqual(["general","tier"]);
    expect((await db.client.query("SELECT * FROM community_memberships WHERE community_id=$1",[id])).rows).toEqual(before.rows);
  });
  it("filters channels by the selected tier and refuses channels outside it",async()=>{
    expect((await read("?group=none")).body.overview.channels.map((c:any)=>c.slug)).toEqual(["general"]);
    expect((await read(`?group=${group}&channel=tier`)).body.feed.channel.slug).toBe("tier");
    expect((await read("?group=none&channel=tier")).status).toBe(404);
    expect((await read("?channel=private")).status).toBe(404);
    expect((await read(`?group=${otherGroup}`)).status).toBe(404);
  });
  it("rejects malformed identifiers and never exposes a write endpoint",async()=>{
    expect((await fetch(`${base}/invalid/preview`)).status).toBe(404);
    expect((await read("?page=0")).status).toBe(400);
    expect((await fetch(`${base}/${id}/preview`,{method:"POST",headers:{"Content-Type":"application/json"},body:'{}'})).status).toBe(404);
  });
  it("saves and rereads a multiline description without changing publication or access",async()=>{
    const r=await fetch(`${base}/${id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"Updated community",description:"First paragraph\n\nSecond paragraph"})});
    expect(r.status).toBe(200);
    const next=await read();expect(next.body.overview.community.name).toBe("Updated community");
    expect(next.body.overview.community.description).toBe("First paragraph\n\nSecond paragraph");
    expect(next.body.published).toBe(false);
  });
});
