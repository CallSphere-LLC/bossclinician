import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Request } from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import { createTestDatabase, hasTestDatabase, insertMember } from "../../testing/db";

// Identity verification has its own middleware tests. Exercise the real route,
// owner lookup and SQL here, with a controlled already-authenticated caller.
vi.mock("./session", () => ({ identityFromRequest: async (req: Request) =>
  req.headers["x-test-member"]
    ? { audience: "member", memberId: Number(req.headers["x-test-member"]) }
    : { audience: "anonymous" },
}));

(hasTestDatabase ? describe : describe.skip)("voice ending ownership and persistence (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: ReturnType<express.Express["listen"]>;
  let base: string;
  let memberId: number;
  let otherId: number;
  let store: typeof import("../../services/voice/sessionStore");
  beforeAll(async () => {
    db = await createTestDatabase("voiceend");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";
    store = await import("../../services/voice/sessionStore");
    const { voiceEndRouter } = await import("./end");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const app = express();
    app.use(express.json(), cookieParser(), voiceEndRouter, errorHandler);
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    memberId = await insertMember(db.client, "voice-end-owner@example.test");
    otherId = await insertMember(db.client, "voice-end-other@example.test");
  }, 60_000);
  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await (await import("../../db/pool")).pool.end();
    await db?.drop();
  });
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/end`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  const open = () => store.openSession({ identity: { audience: "member", memberId }, surface: "member", path: "/account", ip: "127.0.0.1", userAgent: "test" });

  it("rejects another member and an anonymous caller without ending the row", async () => {
    const { sessionId } = await open();
    expect((await post({ sessionId }, { "x-test-member": String(otherId) })).status).toBe(404);
    expect((await post({ sessionId })).status).toBe(404);
    expect((await db.client.query("SELECT ended_at FROM voice_sessions WHERE id=$1", [sessionId])).rows[0].ended_at).toBeNull();
  });
  it("ends once, retaining the first timestamp, duration and reason on repeat", async () => {
    const { sessionId } = await open();
    await db.client.query("UPDATE voice_sessions SET started_at=now()-interval '12 seconds' WHERE id=$1", [sessionId]);
    const headers = { "x-test-member": String(memberId) };
    const first = await post({ sessionId }, headers);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ ended: true });
    const read = async () => (await db.client.query("SELECT ended_at,seconds,end_reason FROM voice_sessions WHERE id=$1", [sessionId])).rows[0];
    const saved = await read();
    expect(saved.ended_at).toBeInstanceOf(Date);
    expect(saved.seconds).toBeGreaterThanOrEqual(12);
    expect(saved.end_reason).toBe("hung up");
    expect((await post({ sessionId, reason: "connection ended" }, headers)).status).toBe(200);
    expect(await read()).toEqual(saved);
  });
  it("requires the public conversation's visitor cookie", async () => {
    const visitorId = "a".repeat(32);
    const { sessionId } = await store.openSession({ identity: { audience: "anonymous" }, visitorId, surface: "public", path: "/", ip: "127.0.0.1", userAgent: "test" });
    expect((await post({ sessionId }, { Cookie: `${store.VOICE_VISITOR_COOKIE}=${"b".repeat(32)}` })).status).toBe(404);
    expect((await post({ sessionId, reason: "connection ended" }, { Cookie: `${store.VOICE_VISITOR_COOKIE}=${visitorId}` })).status).toBe(200);
    expect((await db.client.query("SELECT end_reason FROM voice_sessions WHERE id=$1", [sessionId])).rows[0].end_reason).toBe("connection ended");
  });
  it("rejects invalid ids and arbitrary close reasons", async () => {
    for (const body of [{}, { sessionId: " " }, { sessionId: "x".repeat(65) }, { sessionId: "valid", reason: "delete everything" }, { sessionId: "valid", reason: null }]) {
      expect((await post(body)).status).toBe(400);
    }
  });
});
