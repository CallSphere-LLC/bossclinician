import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request as httpRequest, type Server } from "node:http";
import express from "express";

import { rejectRetiredHosts } from "./retiredHosts";
const app = express();
app.use(rejectRetiredHosts);
app.use((_req, res) => { res.json({ live: true }); });
let server: Server;
let origin: string;
beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
function fetch(url: string, options: { method?: string; headers: Record<string, string> }) {
  return new Promise<{status: number | undefined; headers: {get: (key: string) => unknown}}>((resolve, reject) => {
    const req = httpRequest(url, options, res => {
      res.resume();
      res.on("end", () => resolve({status: res.statusCode, headers: {get: key => res.headers[key]}}));
    });
    req.on("error", reject); req.end();
  });
}
describe("retired hosts", () => {
  it.each(["bossclinician.callsphere.site", "BOSSCLINICIAN.CALLSPHERE.SITE:443", "bossclinician.callsphere.site."])("refuses all requests for %s", async host => {
    for (const path of ["/", "/admin/login", "/api/admin/login", "/api/member/library"]) {
      const res = await fetch(origin + path, {method: "POST", headers: { Host: host }});
      expect(res.status).toBe(410);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
  it.each(["www.bossclinician.com", "bossclinician.com", "localhost:4000", "admin.bossclinician.com", "admin.bossclinician.callsphere.site"])("preserves %s", async host => {
    expect((await fetch(origin + "/api/health", { headers: { Host: host } })).status).toBe(200);
  });
  it("retains only exact legacy POST callback paths", async () => {
    for (const path of ["/api/stripe/webhook", "/api/paypal/webhook", "/api/email/webhook/ses"]) {
      expect((await fetch(origin + path, { method: "POST", headers: { Host: "bossclinician.callsphere.site" } })).status).toBe(200);
      expect((await fetch(origin + path, { headers: { Host: "bossclinician.callsphere.site" } })).status).toBe(410);
      expect((await fetch(origin + path + "/extra", { method: "POST", headers: { Host: "bossclinician.callsphere.site" } })).status).toBe(410);
      expect((await fetch(origin + path, { method: "POST", headers: { Host: "admin.bossclinician.com" } })).status).toBe(200);
    }
  });
  it("does not let forwarded Host bypass retirement", async () => {
    expect((await fetch(origin + "/", { headers: { Host: "bossclinician.callsphere.site", "X-Forwarded-Host": "www.bossclinician.com" } })).status).toBe(410);
  });
  it.each(["GET", "HEAD"])("redirects only the verified receipt path for %s, preserving opaque query", async method => {
    const path = "/library/credential-with-confidence/lessons/credential-with-confidence-quiz";
    const query = "?next=https%3A%2F%2Fevil.test%2F&token=opaque%2B%2F%3D&x=1&x=2";
    const result = await fetch(origin + path + query, {method, headers:{Host:"bossclinician.callsphere.site", "X-Forwarded-Host":"evil.test"}});
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe("https://www.bossclinician.com" + path + query);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
  it("keeps other methods, UI, path aliases and suffixes retired", async () => {
    const path = "/library/credential-with-confidence/lessons/credential-with-confidence-quiz";
    for (const method of ["POST","PUT","PATCH","DELETE","OPTIONS"]) {
      expect((await fetch(origin + path, {method,headers:{Host:"bossclinician.callsphere.site"}})).status).toBe(410);
    }
    for (const other of ["/", "/login", "/account/certificates", path+"/", path+"/extra", path.replace("/library/", "/%6cibrary/"), path.replace("/library/", "//library/")]) {
      expect((await fetch(origin + other, {headers:{Host:"bossclinician.callsphere.site"}})).status).toBe(410);
    }
    expect((await fetch(origin + path, {headers:{Host:"www.bossclinician.com"}})).status).toBe(200);
  });
});
