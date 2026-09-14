import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLegacyAdminToken, sessionFetch } from "./adminTransport";

afterEach(() => vi.unstubAllGlobals());
describe("admin cookie transport", () => {
  it("removes legacy localStorage credentials", () => {
    const removeItem = vi.fn(); vi.stubGlobal("window", { localStorage: { removeItem } });
    clearLegacyAdminToken(); expect(removeItem).toHaveBeenCalledWith("bc_admin_token");
  });
  it("shares a refresh across concurrent expired admin requests and retries each once", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    let reads = 0;
    const fetcher = vi.fn((url: string) => {
      if (url.endsWith("/refresh")) return pending;
      reads += 1; return Promise.resolve(new Response("{}", { status: reads <= 2 ? 401 : 200 }));
    });
    vi.stubGlobal("fetch", fetcher);
    const first = sessionFetch("/api/admin/contacts"); const second = sessionFetch("/api/admin/offers");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/refresh"))).toHaveLength(1);
    release(new Response(null, { status: 204 }));
    expect((await Promise.all([first, second])).map((response) => response.status)).toEqual([200,200]);
    for (const call of fetcher.mock.calls) expect((call as unknown as [string, RequestInit])[1].credentials).toBe("include");
  });
  it("does not refresh public requests, bad login, logout, forbidden writes or failed refresh", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 })); vi.stubGlobal("fetch", fetcher);
    for (const url of ["/api/assessments/zz", "/api/admin/login", "/api/admin/logout"]) {
      const before = fetcher.mock.calls.length;
      expect((await sessionFetch(url)).status).toBe(401); expect(fetcher.mock.calls.length - before).toBe(1);
    }
    const before = fetcher.mock.calls.length;
    expect((await sessionFetch("/api/admin/settings")).status).toBe(401); expect(fetcher.mock.calls.length - before).toBe(2);
    fetcher.mockImplementation(async () => new Response("{}", { status: 403 }));
    const forbiddenBefore = fetcher.mock.calls.length;
    expect((await sessionFetch("/api/admin/settings", { method: "PUT", body: "{}" })).status).toBe(403);
    expect(fetcher.mock.calls.length - forbiddenBefore).toBe(1);
  });
});
