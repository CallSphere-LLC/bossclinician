import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/adminTransport", () => ({ sessionFetch: vi.fn() }));

const {
  formatSiteDate,
  formatSiteDateTime,
  formatSiteDateTimeLong,
  formatSiteDeadline,
  isoToSiteWallTime,
  parseStamp,
  siteWallTimeToIso,
} = await import("./siteTime");

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

/**
 * Sale deadlines are typed and read on the SITE's clock. Every case passes the
 * zone explicitly, so the answers are the same whatever zone the machine (or
 * the admin's browser) is in. In 2026 Los Angeles moves its clocks on Sunday
 * March 8 (forward) and Sunday November 1 (back).
 */
describe("typing a time on the site clock", () => {
  const LA = "America/Los_Angeles";

  it("reads winter as UTC-8 and summer as UTC-7", () => {
    expect(siteWallTimeToIso("2026-12-04", "23:59", LA)).toBe("2026-12-05T07:59:00.000Z");
    expect(siteWallTimeToIso("2026-07-04", "09:00", LA)).toBe("2026-07-04T16:00:00.000Z");
  });

  it("is right on both sides of the spring change", () => {
    expect(siteWallTimeToIso("2026-03-07", "23:59", LA)).toBe("2026-03-08T07:59:00.000Z");
    expect(siteWallTimeToIso("2026-03-08", "01:59", LA)).toBe("2026-03-08T09:59:00.000Z");
    expect(siteWallTimeToIso("2026-03-08", "03:00", LA)).toBe("2026-03-08T10:00:00.000Z");
    expect(siteWallTimeToIso("2026-03-08", "23:59", LA)).toBe("2026-03-09T06:59:00.000Z");
  });

  it("moves an hour that never happens forward, as a phone's clock does", () => {
    // 2:30 AM does not exist on March 8; it becomes 3:30 AM.
    const iso = siteWallTimeToIso("2026-03-08", "02:30", LA);
    expect(iso).toBe("2026-03-08T10:30:00.000Z");
    expect(isoToSiteWallTime(iso, LA)).toEqual({ date: "2026-03-08", time: "03:30" });
  });

  it("is right on both sides of the autumn change", () => {
    expect(siteWallTimeToIso("2026-10-31", "23:59", LA)).toBe("2026-11-01T06:59:00.000Z");
    expect(siteWallTimeToIso("2026-11-01", "00:30", LA)).toBe("2026-11-01T07:30:00.000Z");
    expect(siteWallTimeToIso("2026-11-01", "02:00", LA)).toBe("2026-11-01T10:00:00.000Z");
    expect(siteWallTimeToIso("2026-11-01", "23:59", LA)).toBe("2026-11-02T07:59:00.000Z");
  });

  it("takes the first of an hour that happens twice", () => {
    // 1:30 AM comes round twice on November 1; the earlier one is 08:30 UTC.
    expect(siteWallTimeToIso("2026-11-01", "01:30", LA)).toBe("2026-11-01T08:30:00.000Z");
  });

  it("follows whichever zone the site is in, east or west of Greenwich", () => {
    expect(siteWallTimeToIso("2026-12-04", "23:59", "America/New_York")).toBe("2026-12-05T04:59:00.000Z");
    expect(siteWallTimeToIso("2026-12-04", "23:59", "Asia/Kolkata")).toBe("2026-12-04T18:29:00.000Z");
    expect(siteWallTimeToIso("2026-12-04", "23:59", "Pacific/Auckland")).toBe("2026-12-04T10:59:00.000Z");
    expect(siteWallTimeToIso("2026-12-04", "23:59", "UTC")).toBe("2026-12-04T23:59:00.000Z");
  });

  it("reads a stored instant back as the site's date and time", () => {
    expect(isoToSiteWallTime("2026-12-05T07:59:00.000Z", LA)).toEqual({ date: "2026-12-04", time: "23:59" });
    expect(isoToSiteWallTime("2026-07-04T16:00:00.000Z", LA)).toEqual({ date: "2026-07-04", time: "09:00" });
    // Midnight is 00:00, never 24:00.
    expect(isoToSiteWallTime("2026-12-04T08:00:00.000Z", LA)).toEqual({ date: "2026-12-04", time: "00:00" });
    // The same instant is a different day and hour for a site in New York.
    expect(isoToSiteWallTime("2026-12-05T07:59:00.000Z", "America/New_York")).toEqual({
      date: "2026-12-05",
      time: "02:59",
    });
  });

  it("round-trips every hour of both clock-change days", () => {
    for (const date of ["2026-03-08", "2026-11-01", "2026-06-15", "2026-12-31"]) {
      for (let hour = 0; hour < 24; hour += 1) {
        const time = `${String(hour).padStart(2, "0")}:15`;
        const iso = siteWallTimeToIso(date, time, LA);
        // The one hour that never happens reads back an hour later.
        const expected = date === "2026-03-08" && hour === 2 ? "03:15" : time;
        expect(isoToSiteWallTime(iso, LA), `${date} ${time}`).toEqual({ date, time: expected });
      }
    }
  });

  it("refuses what is not a real date or time", () => {
    expect(siteWallTimeToIso("", "10:00", LA)).toBeNull();
    expect(siteWallTimeToIso("2026-12-04", "", LA)).toBeNull();
    expect(siteWallTimeToIso("2026-02-31", "10:00", LA)).toBeNull();
    expect(siteWallTimeToIso("2026-13-01", "10:00", LA)).toBeNull();
    expect(siteWallTimeToIso("2026-12-04", "25:00", LA)).toBeNull();
    expect(siteWallTimeToIso("2026-12-04", "10:00", "Not/AZone")).toBeNull();
    expect(isoToSiteWallTime(null, LA)).toBeNull();
    expect(isoToSiteWallTime("not a date", LA)).toBeNull();
  });

  it("says a deadline the way customers are told it", () => {
    expect(formatSiteDeadline("2026-12-05T07:59:00.000Z", LA)).toBe("Friday, December 4 at 11:59 PM PST");
    expect(formatSiteDeadline("2026-07-04T16:00:00.000Z", LA)).toBe("Saturday, July 4 at 9:00 AM PDT");
    expect(formatSiteDeadline(null, LA)).toBe("");
    expect(formatSiteDeadline("not a date", LA)).toBe("");
  });
});
