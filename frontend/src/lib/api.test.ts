import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi, isMfaRequiredError } from "./api";

describe("admin MFA login transport", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it("preserves the server's second-factor challenge on a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Enter the code from your app.", mfaRequired: true }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const error = await adminApi.login("success+owner@simulator.amazonses.com", "right-password").catch((err) => err);
    expect(isMfaRequiredError(error)).toBe(true);
  });

  it("sends the authenticator code with the second request", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          token: "session-token",
          user: { id: 1, email: "success+owner@simulator.amazonses.com", name: "Owner", role: "owner" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.login("success+owner@simulator.amazonses.com", "right-password", "123456");

    const options = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(options?.body))).toEqual({
      email: "success+owner@simulator.amazonses.com",
      password: "right-password",
      code: "123456",
    });
  });
});

describe("campaign audience transport", () => {
  it("sends segment, tag and exclusion rules to the count endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ audience: "all_subscribers", count: 3 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.audienceCount({
      audience: "all_subscribers",
      segmentId: 4,
      includeTagIds: [7],
      excludeSegmentIds: [8, 9],
      excludeTagIds: [10],
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "https://example.test");
    expect(url.searchParams.get("segmentId")).toBe("4");
    expect(url.searchParams.get("includeTagIds")).toBe("7");
    expect(url.searchParams.get("excludeSegmentIds")).toBe("8,9");
    expect(url.searchParams.get("excludeTagIds")).toBe("10");
  });
});
