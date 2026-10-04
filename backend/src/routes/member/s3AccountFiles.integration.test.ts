import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";
import { syntheticS3 } from "../../testing/s3";
const describeDb = hasTestDatabase ? describe : describe.skip;
describeDb("S3 avatars and certificate delivery", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>; let remote: ReturnType<typeof syntheticS3>;
  let server: Server; let base: string; let token: string; let other: string; let member: number; let root: string; let certificate: number;
  beforeAll(async () => {
    remote = syntheticS3(); db = await createTestDatabase("s3accountfiles");
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bc-s3-account-"));
    process.env.DATABASE_URL = db.url; process.env.UPLOAD_DIR = path.join(root, "public"); process.env.PROTECTED_UPLOAD_DIR = path.join(root, "protected");
    const { createApp } = await import("../../app"); const { signMemberAccessToken } = await import("../../auth/memberSession");
    member = await insertMember(db.client, "member@example.test"); const stranger = await insertMember(db.client, "stranger@example.test");
    token = signMemberAccessToken({ sub: member, email: "member@example.test" }); other = signMemberAccessToken({ sub: stranger, email: "stranger@example.test" });
    certificate = (await db.client.query(`INSERT INTO certificates(member_id,verification_code,recipient_name,course_title) VALUES($1,'BC-TEST-TEST-TEST-TEST','Synthetic Member','Synthetic Course') RETURNING id`,[member])).rows[0].id;
    server = createApp().listen(0); await new Promise<void>(r => server.once("listening", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { if (server) await new Promise<void>(r => server.close(() => r())); const { pool } = await import("../../db/pool"); await pool.end(); if (db) await db.drop(); if(root)await fs.rm(root,{recursive:true,force:true}); remote?.transport.mockRestore(); });
  it("generates a certificate in protected S3, allows its owner, denies other members and revocation", async () => {
    const endpoint = `${base}/api/member/certificates/${certificate}/download`;
    const success = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } }); expect(success.status).toBe(200);
    const bytes = Buffer.from(await success.arrayBuffer()); expect(bytes.subarray(0,4).toString()).toBe("%PDF");
    const key = "media/protected/certificates/BC-TEST-TEST-TEST-TEST.pdf";
    expect(remote.objects.get(key)?.equals(bytes)).toBe(true);
    expect((await fs.readdir(process.env.PROTECTED_UPLOAD_DIR!)).filter(n => n !== ".parts")).toEqual([]);
    const denied = await fetch(endpoint, { headers: { Authorization: `Bearer ${other}` } }); expect(denied.status).toBe(404);
    await db.client.query("UPDATE certificates SET revoked_at=now() WHERE id=$1",[certificate]);
    const revoked = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } }); expect(revoked.status).toBe(403);
  });
  it("stores and replaces avatar objects while preserving the public URL contract", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    let previous: string | undefined;
    for (let i=0;i<2;i++) {
      const form = new FormData(); form.append("file", new Blob([png], { type: "image/png" }), "avatar.png");
      const response = await fetch(`${base}/api/auth/me/avatar`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      expect(response.status).toBe(200); const body = await response.json() as { avatarUrl: string };
      expect(body.avatarUrl).toMatch(/^\/uploads\/[a-f0-9]+\.png$/);
      const key = `media/public/${body.avatarUrl.slice(9)}`;
      expect(remote.objects.get(key)?.equals(png)).toBe(true);
      if(previous)expect(remote.objects.has(previous)).toBe(false); previous=key;
      const publicRead = await fetch(base+body.avatarUrl);expect(publicRead.status).toBe(200);expect(Buffer.from(await publicRead.arrayBuffer()).equals(png)).toBe(true);
    }
  });
});
