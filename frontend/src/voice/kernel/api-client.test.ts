import { afterEach, describe, expect, it, vi } from "vitest";
import { voiceFetch } from "./api-client";
import { setAccessToken } from "@/lib/memberApi";

afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });
describe("concierge credential refresh", () => {
  it("refreshes an admin cookie on voice URLs and retries exactly once", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: "expired" }, { status: 401 })).mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ surface: "admin" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await voiceFetch("/voice/chat", { method: "POST", body: "{}" }, "admin");
    expect((await result.json()).surface).toBe("admin");
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(["/api/voice/chat", "/api/admin/refresh", "/api/voice/chat"]);
  });
  it("refreshes an expired member bearer without calling admin refresh", async () => {
    setAccessToken("expired-member-token");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: "expired" }, { status: 401 })).mockResolvedValueOnce(Response.json({ accessToken: "renewed-member-token" })).mockResolvedValueOnce(Response.json({ surface: "member" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await voiceFetch("/voice/session", { method: "POST", body: "{}" }, "member");
    expect((await result.json()).surface).toBe("member");
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(["/api/voice/session", "/api/auth/refresh", "/api/voice/session"]);
    expect(new Headers(fetcher.mock.calls[2][1].headers).get("Authorization")).toBe("Bearer renewed-member-token");
  });
  it("leaves successful public calls anonymous and performs no refresh", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ surface: "public" }));
    vi.stubGlobal("fetch", fetcher);
    await voiceFetch("/voice/session", { method: "POST", body: "{}" }, "public");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves binary recording content type through an admin refresh", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 })).mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ saved: true }));
    vi.stubGlobal("fetch", fetcher);
    const body = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    await voiceFetch("/voice/recording", { method: "POST", headers: { "Content-Type": "audio/webm" }, body }, "admin");
    for (const index of [0, 2]) {
      expect(new Headers(fetcher.mock.calls[index][1].headers).get("Content-Type")).toBe("audio/webm");
      expect(fetcher.mock.calls[index][1].body).toBe(body);
    }
  });
});
