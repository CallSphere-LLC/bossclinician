import { request as httpRequest, type Server } from "http";
import type { AddressInfo } from "net";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase } from "../testing/db";
const describeDb = hasTestDatabase ? describe : describe.skip;
const adminOrigin = "https://admin.bossclinician.callsphere.site";
const publicOrigin = "https://bossclinician.callsphere.site";
describeDb("Dedicated admin origin (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server; let base: string; let cookie: string;
  beforeAll(async () => {
    db = await createTestDatabase("admin_origin");
    process.env.DATABASE_URL = db.url;
    process.env.ADMIN_ORIGIN = adminOrigin;
    process.env.FRONTEND_ORIGIN = publicOrigin;
    process.env.JWT_SECRET = "zz-admin-origin-secret";
    const id = (await db.client.query(`INSERT INTO admin_users(email,password_hash,name,role) VALUES('sagar+zz-admin-origin@callsphere.ai','unused','ZZ Admin Origin','owner') RETURNING id`)).rows[0].id;
    const { issueAdminCookieSession } = await import("./adminSession");
    const session = await issueAdminCookieSession({ adminUserId: id, email: "sagar+zz-admin-origin@callsphere.ai", role: "owner", userAgent: "ZZ origin", ip: "127.0.0.1" });
    cookie = `__Host-bc_admin_session=${session.accessToken}; __Host-bc_admin_refresh=${session.refreshToken}; bc_admin_session=${session.accessToken}; bc_admin_refresh=${session.refreshToken}`;
    const { createApp } = await import("../app");
    server = createApp().listen(0); await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60000);
  afterAll(async () => { await new Promise<void>((resolve) => server?.close(() => resolve())); const { pool } = await import("../db/pool"); await pool.end(); await db?.drop(); });
  function call(host: string, path: string, method = "GET", extra: Record<string,string> = {}) {
    return new Promise<Response>((resolve, reject) => {
      const request = httpRequest(`${base}/api/admin${path}`, { method, headers: { Host: new URL(host).host, Origin: host, Cookie: cookie, ...extra } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const headers: [string,string][] = Object.entries(response.headers).flatMap(([name,value]) =>
            value === undefined ? [] : Array.isArray(value) ? value.map((item) => [name,item] as [string,string]) : [[name,value] as [string,string]]);
          resolve(new Response(response.statusCode === 204 ? null : Buffer.concat(chunks), { status: response.statusCode, headers }));
        });
      });
      request.on("error", reject); request.end();
    });
  }
  it("refuses all public-host admin reads/login/refresh despite valid current and legacy cookies", async () => {
    for (const path of ["/contacts", "/settings", "/offers", "/me"]) expect((await call(publicOrigin, path)).status).toBe(401);
    for (const path of ["/login", "/refresh", "/logout"]) expect((await call(publicOrigin, path, "POST")).status).toBe(401);
    expect((await call(publicOrigin, "/contacts", "GET", { "X-Forwarded-Host": new URL(adminOrigin).host })).status).toBe(401);
  });
  it("admin origin preserves authenticated reads and refresh, with exact admin-only CORS/CSRF", async () => {
    for (const path of ["/contacts", "/settings", "/offers", "/me"]) expect((await call(adminOrigin, path)).status).toBe(200);
    const refresh = await call(adminOrigin, "/refresh", "POST"); expect(refresh.status).toBe(204);
    for (const value of refresh.headers.getSetCookie()) { expect(value).toContain("__Host-bc_admin_"); expect(value).toContain("Path=/"); expect(value).not.toContain("Domain="); expect(value).toContain("HttpOnly"); expect(value).toContain("Secure"); }
    expect((await call(adminOrigin, "/refresh", "POST", { Origin: publicOrigin })).status).toBe(403);
    const crossOriginRead = await call(adminOrigin, "/contacts", "GET", { Origin: publicOrigin });
    expect(crossOriginRead.headers.get("Access-Control-Allow-Origin")).toBe(adminOrigin);
    expect(crossOriginRead.headers.get("Access-Control-Allow-Origin")).not.toBe(publicOrigin);
  });
});
