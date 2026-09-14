import type { Server } from "http";
import type { AddressInfo } from "net";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase, insertMember } from "../testing/db";

const describeDb = hasTestDatabase ? describe : describe.skip;
describeDb("HttpOnly admin sessions (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server; let base: string; let ownerId: number; let member: string;
  const email = "sagar+zz-cookie-admin@callsphere.ai";
  const password = "ZZ-cookie-password-2026!";
  beforeAll(async () => {
    db = await createTestDatabase("admin_cookie");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "zz-cookie-test-secret";
    process.env.FRONTEND_ORIGIN = "*";
    const bcrypt = await import("bcrypt");
    ownerId = (await db.client.query(`INSERT INTO admin_users(email,password_hash,name,role) VALUES($1,$2,'ZZ Cookie Admin','owner') RETURNING id`, [email, await bcrypt.hash(password, 4)])).rows[0].id;
    const { signMemberAccessToken } = await import("./memberSession");
    const memberId = await insertMember(db.client, "sagar+zz-cookie-member@callsphere.ai", { name: "ZZ Cookie Member" });
    member = signMemberAccessToken({ sub: memberId, email: "sagar+zz-cookie-member@callsphere.ai" });
    const { createApp } = await import("../app");
    server = createApp().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);
  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const { pool } = await import("../db/pool"); await pool.end(); await db?.drop();
  });
  function cookies(response: Response) { return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "); }
  async function login() {
    const response = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    expect(response.status).toBe(200); return response;
  }
  function call(path: string, cookie = "", method = "GET", origin: string | null = base, body?: unknown) {
    return fetch(`${base}/api/admin${path}`, { method, headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  it("issues no JSON credential, short secure cookies; reload and parallel reads use the same permissions", async () => {
    const response = await login();
    const body = await response.json();
    expect(body).toMatchObject({ user: { id: ownerId, role: "owner" } });
    expect(body).not.toHaveProperty("token");
    for (const value of response.headers.getSetCookie()) {
      expect(value).toContain("HttpOnly"); expect(value).toContain("Secure"); expect(value).toContain("SameSite=Lax"); expect(value).toContain("Path=/");
    }
    const cookie = cookies(response);
    const token = cookie.match(/__Host-bc_admin_session=([^;]+)/)![1];
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(payload.exp - payload.iat).toBe(300);
    expect(response.headers.getSetCookie().find((v) => v.startsWith("__Host-bc_admin_session="))).toContain("Max-Age=300");
    expect((await Promise.all([call("/me", cookie), call("/contacts", cookie), call("/offers", cookie), call("/settings", cookie)])).map((r) => r.status)).toEqual([200,200,200,200]);
    await db.client.query(`UPDATE admin_users SET role='coach' WHERE id=$1`, [ownerId]);
    expect((await call("/contacts", cookie)).status).toBe(403);
    await db.client.query(`UPDATE admin_users SET role='owner' WHERE id=$1`, [ownerId]);
  });
  it("blocks missing/cross origin writes and cross-site login/refresh; same-origin writes persist", async () => {
    const cookie = cookies(await login());
    expect((await call("/settings", cookie, "PUT", "https://attacker.invalid", {})).status).toBe(403);
    expect((await call("/settings", cookie, "PUT", null, {})).status).toBe(403);
    expect((await call("/refresh", cookie, "POST", "https://attacker.invalid")).status).toBe(403);
    expect((await call("/login", "", "POST", "https://attacker.invalid", { email, password })).status).toBe(403);
    const blocked = await fetch(`${base}/api/admin/settings`, { method: "PUT", headers: { Cookie: cookie, Origin: base, "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }, body: "{}" });
    expect(blocked.status).toBe(403);
    expect((await call("/settings", cookie, "PUT", base, { zz_cookie_check: "ZZ saved" })).status).toBe(200);
    expect(await (await call("/settings", cookie)).json()).toMatchObject({ zz_cookie_check: "ZZ saved" });
  });
  it("refreshes expired access; refresh and every access credential stop at logout or suspension", async () => {
    const response = await login(); const cookie = cookies(response);
    const jwt = await import("jsonwebtoken"); const { adminTokenSecret } = await import("./secrets");
    const token = cookie.match(/__Host-bc_admin_session=([^;]+)/)![1];
    const original = jwt.decode(token) as Record<string, unknown>;
    const expired = jwt.sign({ sub: original.sub, email: original.email, role: original.role, sessionId: original.sessionId, iat: Math.floor(Date.now()/1000)-400, exp: Math.floor(Date.now()/1000)-100 }, adminTokenSecret());
    const expiredCookie = cookie.replace(token, expired);
    expect((await call("/me", expiredCookie)).status).toBe(401);
    const refreshed = await call("/refresh", expiredCookie, "POST"); expect(refreshed.status).toBe(204);
    const refreshedCookie = cookies(refreshed);
    expect((await call("/me", refreshedCookie)).status).toBe(200);
    const logout = await call("/logout", refreshedCookie, "POST"); expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie().every((v) => v.includes("Expires=Thu, 01 Jan 1970"))).toBe(true);
    expect((await call("/me", cookie)).status).toBe(401);
    expect((await call("/me", refreshedCookie)).status).toBe(401);
    expect((await call("/refresh", cookie, "POST")).status).toBe(401);
    const next = cookies(await login());
    await db.client.query(`UPDATE admin_users SET status='suspended' WHERE id=$1`, [ownerId]);
    expect((await call("/me", next)).status).toBe(401);
    expect((await call("/refresh", next, "POST")).status).toBe(401);
    await db.client.query(`UPDATE admin_users SET status='active' WHERE id=$1`, [ownerId]);
  });
  it("member and anonymous requests still receive 401 on contacts/offers/settings", async () => {
    for (const path of ["/contacts", "/offers", "/settings"]) {
      expect((await call(path)).status).toBe(401);
      expect((await fetch(`${base}/api/admin${path}`, { headers: { Authorization: `Bearer ${member}` } })).status).toBe(401);
    }
  });

  it("suspends and restores a teammate through the API without deleting history or reviving sessions", async () => {
    const bcrypt = await import("bcrypt");
    const teammateEmail = "sagar+zz-suspended-teammate@callsphere.ai";
    const teammateId = (await db.client.query(
      `INSERT INTO admin_users(email,password_hash,name,role) VALUES($1,$2,'ZZ Teammate','support') RETURNING id`,
      [teammateEmail, await bcrypt.hash(password, 4)],
    )).rows[0].id;
    const ownerCookie = cookies(await login());
    const teammateLogin = () => call("/login", "", "POST", base, { email: teammateEmail, password });
    const before = await teammateLogin();
    expect(before.status).toBe(200);
    const oldCookie = cookies(before);
    expect((await call(`/admins/${ownerId}/suspend`, ownerCookie, "POST")).status).toBe(400);
    expect((await call(`/admins/${teammateId}/suspend`, oldCookie, "POST")).status).toBe(403);
    expect((await call(`/admins/${teammateId}/suspend`, ownerCookie, "POST")).status).toBe(200);
    expect((await call("/me", oldCookie)).status).toBe(401);
    expect((await call("/refresh", oldCookie, "POST")).status).toBe(401);
    expect((await teammateLogin()).status).toBe(401);
    expect((await db.client.query("SELECT status,name FROM admin_users WHERE id=$1", [teammateId])).rows[0])
      .toEqual({ status: "suspended", name: "ZZ Teammate" });
    expect((await db.client.query("SELECT count(*)::int AS n FROM admin_sessions WHERE admin_user_id=$1", [teammateId])).rows[0].n).toBeGreaterThan(0);
    expect((await call(`/admins/${teammateId}/restore`, ownerCookie, "POST")).status).toBe(200);
    expect((await call("/me", oldCookie)).status).toBe(401);
    expect((await call("/refresh", oldCookie, "POST")).status).toBe(401);
    expect((await teammateLogin()).status).toBe(200);
    const invitedId = (await db.client.query(
      `INSERT INTO admin_users(email,password_hash,name,role,status) VALUES($1,'unusable','ZZ Pending','support','invited') RETURNING id`,
      ["sagar+zz-pending-teammate@callsphere.ai"],
    )).rows[0].id;
    expect((await call(`/admins/${invitedId}/suspend`, ownerCookie, "POST")).status).toBe(400);
    expect((await call(`/admins/${invitedId}/restore`, ownerCookie, "POST")).status).toBe(400);
    expect((await db.client.query("SELECT status FROM admin_users WHERE id=$1", [invitedId])).rows[0].status).toBe("invited");
  });

  it("keeps pending invitations inactive, preserves an edited role on acceptance, and invalidates withdrawn links", async () => {
    const { hashToken } = await import("./tokens");
    const ownerCookie = cookies(await login());
    async function invitation(suffix: string) {
      const inviteEmail = `sagar+zz-invite-${suffix}@callsphere.ai`;
      const token = `zz-invite-${suffix}-verification-token`;
      const id = (await db.client.query(`INSERT INTO admin_users(email,password_hash,name,role,status) VALUES($1,'unusable','ZZ Invitation','support','invited') RETURNING id`, [inviteEmail])).rows[0].id;
      await db.client.query(`INSERT INTO admin_invites(email,role,token_hash,invited_by,expires_at) VALUES($1,'support',$2,$3,now()+interval '1 day')`,[inviteEmail,hashToken(token),ownerId]);
      return {id,token,inviteEmail};
    }
    const pending = await invitation('accept');
    expect((await call(`/admins/${pending.id}/suspend`,ownerCookie,'POST')).status).toBe(400);
    expect((await call(`/admins/${pending.id}`,ownerCookie,'PATCH',base,{role:'marketing'})).status).toBe(200);
    expect((await call(`/invite/${pending.token}`,'','POST',base,{name:'ZZ Accepted',password})).status).toBe(201);
    expect((await db.client.query('SELECT role,status FROM admin_users WHERE id=$1',[pending.id])).rows[0]).toEqual({role:'marketing',status:'active'});
    const withdrawn = await invitation('withdraw');
    expect((await call(`/admins/${withdrawn.id}`,ownerCookie,'DELETE')).status).toBe(204);
    expect((await call(`/invite/${withdrawn.token}`)).status).toBe(404);
    expect((await call(`/invite/${withdrawn.token}`,'','POST',base,{name:'ZZ Withdrawn',password})).status).toBe(404);
  });
});
