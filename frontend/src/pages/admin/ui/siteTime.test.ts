import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/adminTransport", () => ({ sessionFetch: vi.fn() }));

const { formatSiteDate, formatSiteDateTime, formatSiteDateTimeLong, parseStamp } = await import("./siteTime");

/**
 * QA sheet row 24: Kajabi said "August 10, 2026 09:47 AM" and the admin said
 * "Aug 10, 12:47 PM" for the same payment, because one showed the site's zone
 * and the other the tester's browser. These pin the site's reading.
 */
describe("site time", () => {
  const LA = "America/Los_Angeles";
  // 09:47 in Los Angeles in August is 16:47 UTC (PDT, -07:00).
  const payment = "2026-08-10T16:47:00.000Z";

  it("reads a payment the way Kajabi printed it, whatever the viewer's zone", () => {
    expect(formatSiteDateTimeLong(payment, LA)).toBe("August 10, 2026 09:47 AM");
    expect(formatSiteDateTime(payment, LA)).toBe("Aug 10, 2026 9:47 AM");
    expect(formatSiteDate(payment, LA)).toBe("Aug 10, 2026");
  });

  it("moves the calendar day with the zone, late in the evening", () => {
    // 11:30 PM in Los Angeles is already the next day in New York.
    expect(formatSiteDate("2026-08-11T06:30:00Z", LA)).toBe("Aug 10, 2026");
    expect(formatSiteDate("2026-08-11T06:30:00Z", "America/New_York")).toBe("Aug 11, 2026");
  });

  it("leaves a bare calendar day on its day", () => {
    expect(formatSiteDate("2026-08-18", LA)).toBe("Aug 18, 2026");
    expect(formatSiteDate("2026-08-18", "Pacific/Kiritimati")).toBe("Aug 18, 2026");
  });

  it("reads Kajabi's own timestamp shape, which Safari can't", () => {
    expect(parseStamp("2026-09-18 08:20:23 -0700")?.toISOString()).toBe("2026-09-18T15:20:23.000Z");
    expect(formatSiteDateTime("2026-09-18 08:20:23 -0700", LA)).toBe("Sep 18, 2026 8:20 AM");
  });

  it("says nothing rather than something wrong", () => {
    expect(formatSiteDateTime(null, LA)).toBe("—");
    expect(formatSiteDateTime("not a date", LA)).toBe("—");
    expect(formatSiteDate(undefined, LA)).toBe("—");
  });
});
