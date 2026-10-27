import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createTestDatabase, hasTestDatabase, insertMember } from "../testing/db";

// No SMTP, provider or recipient lookup is ever imported by this suite.
const mail = vi.hoisted(() => vi.fn().mockResolvedValue({ sent: true }));
vi.mock("../email/mailer", () => ({ sendMail: mail }));

const describeDb = hasTestDatabase ? describe : describe.skip;
describeDb("password recovery HTTP + Postgres (synthetic accounts only)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server;
  let base: string;
  let sequence = 0;
  let service: typeof import("./passwordRecovery");
  let passwords: typeof import("../auth/password");
  let tokens: typeof import("../auth/tokens");
  let oldHash: string;
  const oldPassword = "Old synthetic phrase 47!";
  const newPassword = "New synthetic phrase 92!";

  beforeAll(async () => {
    db = await createTestDatabase("passwordrecovery");
    process.env.DATABASE_URL = db.url;
    process.env.PUBLIC_SITE_URL = "https://bossclinician.callsphere.site"; // stale config must still emit canonical member links
    const app = express();
    app.set("trust proxy", "loopback"); // Only this loopback test app trusts the test IP header.
    app.use(express.json());
    app.use(cookieParser());
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.ADMIN_ORIGIN = base;
    const { adminCsrf, requireAdminHost } = await import("../auth/adminSession");
    const { adminPasswordRecoveryRouter } = await import("../routes/admin/passwordRecovery");
    const { authRouter } = await import("../routes/admin/auth");
    const { memberAuthRoutes } = await import("../routes/auth/memberAuth");
    const { memberAuthCsrf } = await import("../auth/memberCsrf");
    const { requireAuth } = await import("../middleware/auth");
    const { requireMember } = await import("../middleware/memberAuth");
    app.use("/api/admin", requireAdminHost, adminCsrf, adminPasswordRecoveryRouter, authRouter);
    app.use("/api/auth", memberAuthCsrf, memberAuthRoutes);
    app.get("/admin-probe", requireAuth, (_req, res) => res.json({ ok: true }));
    app.get("/member-probe", requireMember, (_req, res) => res.json({ ok: true }));
    app.use((error: { status?: number; message: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(error.status ?? 500).json({ error: error.message });
    });
    service = await import("./passwordRecovery");
    passwords = await import("../auth/password");
    tokens = await import("../auth/tokens");
    oldHash = await passwords.hashPassword(oldPassword);
  });

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (db) {
      const { pool } = await import("../db/pool");
      await pool.end();
      await db.drop();
    }
  });

  async function account(kind: "member" | "admin", status = "active") {
    const email = `recovery-${++sequence}@example.invalid`;
    if (kind === "member") {
      const id = await insertMember(db.client, email, { status });
      await db.client.query("UPDATE members SET password_hash = $2, first_name = 'Synthetic' WHERE id = $1", [id, oldHash]);
      return { id, email };
    }
    const result = await db.client.query("INSERT INTO admin_users (email,password_hash,name,status,role) VALUES ($1,$2,'Synthetic',$3,'coach') RETURNING id", [email, oldHash, status]);
    return { id: result.rows[0].id as number, email };
  }
  function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, "X-Forwarded-For": `198.51.${Math.floor(++sequence / 250)}.${sequence % 250 + 1}`, ...headers }, body: JSON.stringify(body) });
  }
  const prefix = (kind: string) => kind === "admin" ? "/api/admin" : "/api/auth";
  function emailedToken(email: string) {
    const sent = [...mail.mock.calls].reverse().find(([input]) => input.to === email && /password_reset$/.test(input.topic));
    expect(sent).toBeDefined();
    const url = String(sent![0].text).match(/https?:\/\/[^\s]+\/reset-password\/([^\s]+)/);
    expect(url).not.toBeNull();
    return { token: url![1], url: url![0] };
  }

  it.each(["member", "admin"] as const)("%s: identical responses for known, unknown and blocked addresses", async kind => {
    const active = await account(kind);
    const blocked = await account(kind, "suspended");
    for (const email of [active.email.toUpperCase(), `absent-${++sequence}@example.invalid`, blocked.email]) {
      const response = await post(`${prefix(kind)}/forgot-password`, { email, next: "https://attacker.invalid" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
    const sent = emailedToken(active.email);
    expect(sent.url).toBe(`${kind === "admin" ? base + "/admin" : "https://www.bossclinician.com"}/reset-password/${sent.token}`);
    expect(mail.mock.calls.some(([input]) => input.to === blocked.email)).toBe(false);
    const table = kind === "admin" ? "admin_password_resets" : "member_password_resets";
    const row = (await db.client.query(`SELECT token_hash, expires_at FROM ${table} WHERE token_hash = $1`, [tokens.hashToken(sent.token)])).rows[0];
    expect(row.token_hash).not.toBe(sent.token);
    expect(new Date(row.expires_at).getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
  });

  it.each(["member", "admin"] as const)("%s: full reset rejects old password, revokes sessions and accepts the new password", async kind => {
    const user = await account(kind);
    const initialLogin = await post(`${prefix(kind)}/login`, { email: user.email, password: oldPassword });
    expect(initialLogin.status).toBe(200);
    const loginBody = await initialLogin.json() as { accessToken?: string };
    const cookies = initialLogin.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const authHeaders: Record<string, string> = kind === "admin" ? { Cookie: cookies } : { Authorization: `Bearer ${loginBody.accessToken}` };
    expect((await fetch(`${base}/${kind}-probe`, { headers: authHeaders })).status).toBe(200);
    const sibling = await service.issuePasswordReset(kind, user.email);
    expect((await post(`${prefix(kind)}/forgot-password`, { email: user.email })).status).toBe(200);
    const { token } = emailedToken(user.email);
    const reset = await post(`${prefix(kind)}/reset-password`, { token, password: newPassword });
    expect(reset.status).toBe(200);
    expect((await fetch(`${base}/${kind}-probe`, { headers: authHeaders })).status).toBe(401);
    expect((await post(`${prefix(kind)}/refresh`, {}, { Cookie: cookies })).status).toBe(401);
    expect((await post(`${prefix(kind)}/login`, { email: user.email, password: oldPassword })).status).toBe(401);
    expect((await post(`${prefix(kind)}/login`, { email: user.email, password: newPassword })).status).toBe(200);
    for (const used of [token, sibling!.token]) {
      expect((await post(`${prefix(kind)}/reset-password`, { token: used, password: oldPassword })).status).toBe(400);
    }
  });

  it.each(["member", "admin"] as const)("%s: expired, malformed, cross-realm and weak-password attempts leave the password unchanged", async kind => {
    const user = await account(kind);
    const reset = (await service.issuePasswordReset(kind, user.email))!;
    const table = kind === "admin" ? "admin_password_resets" : "member_password_resets";
    const weak = await post(`${prefix(kind)}/reset-password`, { token: reset.token, password: "password123" });
    expect(weak.status).toBe(400);
    expect((await post(`${prefix(kind === "admin" ? "member" : "admin")}/reset-password`, { token: reset.token, password: newPassword })).status).toBe(400);
    await db.client.query(`UPDATE ${table} SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [tokens.hashToken(reset.token)]);
    const expired = await post(`${prefix(kind)}/reset-password`, { token: reset.token, password: newPassword });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ error: service.INVALID_RESET_LINK });
    expect((await post(`${prefix(kind)}/reset-password`, { token: "bad", password: newPassword })).status).toBe(400);
    const userTable = kind === "admin" ? "admin_users" : "members";
    expect((await db.client.query(`SELECT password_hash FROM ${userTable} WHERE id = $1`, [user.id])).rows[0].password_hash).toBe(oldHash);
  });

  it.each(["member", "admin"] as const)("%s: durable cap survives parallel requests from different IPs", async kind => {
    const user = await account(kind);
    const results = await Promise.all(Array.from({ length: 8 }, () => post(`${prefix(kind)}/forgot-password`, { email: user.email })));
    expect(results.map(r => r.status)).toEqual(Array(8).fill(200));
    expect(mail.mock.calls.filter(([input]) => input.to === user.email)).toHaveLength(5);
  });

  it.each(["member", "admin"] as const)("%s: one winner for simultaneous submissions of same or sibling tokens", async kind => {
    for (const same of [true, false]) {
      const user = await account(kind);
      const first = (await service.issuePasswordReset(kind, user.email))!;
      const second = same ? first : (await service.issuePasswordReset(kind, user.email))!;
      const results = await Promise.allSettled([first, second].map(link => service.consumePasswordReset(kind, link.token, oldHash)));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    }
  });

  it("member: invited guest can set a first password; suspended/deleted cannot reset", async () => {
    const guest = await account("member", "invited");
    expect((await post("/api/auth/forgot-password", { email: guest.email })).status).toBe(200);
    expect((await post("/api/auth/reset-password", { token: emailedToken(guest.email).token, password: newPassword })).status).toBe(200);
    const row = (await db.client.query("SELECT status,email_verified_at FROM members WHERE id = $1", [guest.id])).rows[0];
    expect(row.status).toBe("active");
    expect(row.email_verified_at).not.toBeNull();
    for (const status of ["suspended", "deleted"]) {
      const user = await account("member");
      const link = (await service.issuePasswordReset("member", user.email))!;
      await db.client.query("UPDATE members SET status=$2 WHERE id=$1", [user.id, status]);
      expect((await post("/api/auth/reset-password", { token: link.token, password: newPassword })).status).toBe(400);
    }
  });

  it("admin: keeps role and MFA; invited admins require the separate invitation flow", async () => {
    const user = await account("admin");
    await db.client.query("UPDATE admin_users SET mfa_enabled=true,mfa_secret='SYNTHETIC' WHERE id=$1", [user.id]);
    const link = (await service.issuePasswordReset("admin", user.email))!;
    expect((await post("/api/admin/reset-password", { token: link.token, password: newPassword })).status).toBe(200);
    const row = (await db.client.query("SELECT role,mfa_enabled,mfa_secret FROM admin_users WHERE id=$1", [user.id])).rows[0];
    expect(row).toEqual({ role: "coach", mfa_enabled: true, mfa_secret: "SYNTHETIC" });
    const response = await post("/api/admin/login", { email: user.email, password: newPassword });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ mfaRequired: true });
    const invited = await account("admin", "invited");
    expect(await service.issuePasswordReset("admin", invited.email)).toBeNull();
    const disabled = (await service.issuePasswordReset("admin", user.email))!;
    await db.client.query("UPDATE admin_users SET status='suspended' WHERE id=$1", [user.id]);
    expect((await post("/api/admin/reset-password", { token: disabled.token, password: oldPassword })).status).toBe(400);
  });


  it.each(["member", "admin"] as const)("%s: email preserves a safe return path across devices", async kind => {
    const user = await account(kind);
    const next = kind === "admin" ? "/admin/offers/42?tab=pricing#form" : "/checkout/synthetic-offer?plan=annual#details";
    expect((await post(`${prefix(kind)}/forgot-password`, { email: user.email, next })).status).toBe(200);
    const url = new URL(emailedToken(user.email).url);
    expect(url.searchParams.get("next")).toBe(next);
    const token = url.pathname.split("/").pop();
    expect((await post(`${prefix(kind)}/reset-password`, { token, password: newPassword })).status).toBe(200);
  });

  it("rolls back token consumption and password changes if session revocation fails", async () => {
    const user = await account("member");
    await db.client.query("INSERT INTO member_sessions (member_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 hour')", [user.id, tokens.hashToken("rollback-synthetic")]);
    const link = (await service.issuePasswordReset("member", user.email))!;
    await db.client.query(`CREATE FUNCTION reject_test_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
      CREATE TRIGGER reject_test_revoke BEFORE UPDATE ON member_sessions FOR EACH ROW EXECUTE FUNCTION reject_test_revoke()`);
    try {
      await expect(service.consumePasswordReset("member", link.token, "changed-hash")).rejects.toThrow("synthetic failure");
      expect((await db.client.query("SELECT password_hash,password_reset_at FROM members WHERE id=$1", [user.id])).rows[0]).toEqual({ password_hash: oldHash, password_reset_at: null });
      expect((await db.client.query("SELECT used_at FROM member_password_resets WHERE token_hash=$1", [tokens.hashToken(link.token)])).rows[0].used_at).toBeNull();
    } finally {
      await db.client.query("DROP TRIGGER reject_test_revoke ON member_sessions; DROP FUNCTION reject_test_revoke()");
    }
  });

  it("admin recovery audits requests anonymously and completion without secrets", async () => {
    const user = await account("admin");
    await post("/api/admin/forgot-password", { email: user.email });
    const { token } = emailedToken(user.email);
    expect((await post("/api/admin/reset-password", { token, password: newPassword })).status).toBe(200);
    const audit = (await db.client.query("SELECT * FROM admin_audit_log WHERE entity_type='admin_user' AND entity_id=$1 ORDER BY id", [String(user.id)])).rows;
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ action: "admin.password_reset_requested", admin_user_id: null });
    expect(audit[1]).toMatchObject({ action: "admin.password_reset_completed", admin_user_id: user.id, after_state: { sessionsRevoked: true, mfaPreserved: true } });
    for (const secret of [token, tokens.hashToken(token), oldPassword, newPassword, oldHash]) expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("unexpected deferred mail rejection cannot crash or reveal secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (const kind of ["member", "admin"] as const) {
        const user = await account(kind);
        mail.mockRejectedValueOnce(new Error("synthetic secret must not be logged"));
        const response = await post(`${prefix(kind)}/forgot-password`, { email: user.email });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
      }
      const user = await account("member");
      const link = (await service.issuePasswordReset("member", user.email))!;
      mail.mockRejectedValueOnce(new Error("synthetic secret must not be logged"));
      expect((await post("/api/auth/reset-password", { token: link.token, password: newPassword })).status).toBe(200);
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(log).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic secret");
    } finally { log.mockRestore(); }
  });

  it("does not permit cross-origin recovery writes or host-header poisoning", async () => {
    expect((await post("/api/admin/forgot-password", { email: "test@example.invalid" }, { Origin: "https://attacker.invalid" })).status).toBe(403);
    // Node fetch can replace Host with the URL authority; raw HTTP tests the header boundary.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${base}/api/admin/forgot-password`, { method: "POST", headers: { Host: "attacker.invalid", Origin: base, "Content-Type": "application/json" } }, res => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.end(JSON.stringify({ email: "test@example.invalid" }));
    });
    expect(status).toBe(401);
    expect((await post("/api/auth/forgot-password", { email: "test@example.invalid" }, { Origin: "https://attacker.invalid" })).status).toBe(403);
  });

  it.each(["member", "admin"] as const)("%s: IP limit cannot be bypassed with changing email payloads", async kind => {
    const limit = kind === "admin" ? 20 : 30;
    const headers = { "X-Forwarded-For": kind === "admin" ? "203.0.113.10" : "203.0.113.20" };
    for (let n = 0; n < limit; n++) {
      expect((await post(`${prefix(kind)}/reset-password`, { token: "malformed", email: `rotate${n}@example.invalid` }, headers)).status).toBe(400);
    }
    expect((await post(`${prefix(kind)}/reset-password`, { token: "malformed", email: "another@example.invalid" }, headers)).status).toBe(429);
    // Recovery requests have a separate IP budget from consuming tokens/login.
    const requests = await Promise.all(Array.from({ length: limit + 1 }, (_, n) => post(`${prefix(kind)}/forgot-password`, { email: `ipcap${n}@example.invalid` }, headers)));
    expect(requests.filter(r => r.status === 429)).toHaveLength(1);
  });
});
