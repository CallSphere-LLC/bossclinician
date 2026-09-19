import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionFetch = vi.fn();
vi.mock("@/lib/adminTransport", () => ({ sessionFetch: (...args: unknown[]) => sessionFetch(...args) }));

const { contactsApi } = await import("@/lib/contactsApi");

/**
 * The People list and the spreadsheet it offers are two different routes, and
 * the file is only honest while both apply the same filters. The CSV route
 * parses with `exportQuerySchema`, and zod strips what it was not told about —
 * so a filter missing from that pick is not a refused request, it is a
 * spreadsheet of everybody handed over while the screen shows a shortlist.
 * These pin the query the download actually asks for.
 */
describe("contactsApi.exportCsv", () => {
  beforeEach(() => {
    sessionFetch.mockReset();
    sessionFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(["email\n"]) });
  });

  function queryOf(): URLSearchParams {
    const url = String(sessionFetch.mock.calls[0]?.[0] ?? "");
    return new URLSearchParams(url.slice(url.indexOf("?")));
  }

  it("carries every filter the list understands, not just the four the route once picked", async () => {
    await contactsApi.exportCsv({
      q: "sam",
      tag: "vip",
      status: "subscribed",
      untagged: true,
      community: true,
      audience: "customer",
      optOut: "manual",
      engagement: "healthy",
    });
    const qs = queryOf();
    expect(Object.fromEntries(qs)).toMatchObject({
      q: "sam",
      tag: "vip",
      status: "subscribed",
      untagged: "true",
      community: "true",
      audience: "customer",
      optOut: "manual",
      engagement: "healthy",
    });
  });

  it("narrows to community members rather than downloading everyone", async () => {
    await contactsApi.exportCsv({ community: true });
    expect(queryOf().get("community")).toBe("true");
  });

  it("asks for no filter at all when the screen has none on", async () => {
    await contactsApi.exportCsv({});
    expect(String(sessionFetch.mock.calls[0]?.[0])).not.toContain("?");
  });

  it("refuses the download rather than returning a half file", async () => {
    sessionFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(contactsApi.exportCsv({ community: true })).rejects.toThrow(/didn't finish/);
  });
});
