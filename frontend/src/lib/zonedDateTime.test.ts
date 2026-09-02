import { describe, expect, it } from "vitest";
import { isoToWallClock, wallClockToIso } from "./zonedDateTime";

describe("zoned datetime inputs", () => {
  it("stores an Eastern summer wall clock as the right UTC instant", () => {
    expect(wallClockToIso("2026-09-15T18:00", "America/New_York")).toBe(
      "2026-09-15T22:00:00.000Z",
    );
  });

  it("tracks the winter offset", () => {
    expect(wallClockToIso("2026-01-15T18:00", "America/New_York")).toBe(
      "2026-01-15T23:00:00.000Z",
    );
  });

  it("round trips a campaign scheduled outside the viewer's timezone", () => {
    const iso = wallClockToIso("2026-10-20T09:30", "Australia/Sydney");
    expect(isoToWallClock(iso, "Australia/Sydney")).toBe("2026-10-20T09:30");
  });

  it("rejects a wall-clock time skipped by spring daylight saving", () => {
    expect(wallClockToIso("2026-03-08T02:30", "America/New_York")).toBeNull();
  });
});
