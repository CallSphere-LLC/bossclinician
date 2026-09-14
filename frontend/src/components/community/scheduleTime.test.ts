import { describe, expect, it } from "vitest";
import {
  defaultScheduleWallClock,
  formatScheduled,
  readScheduleWallClock,
  scheduleTimeZone,
} from "./scheduleTime";

/**
 * The member-side "post at a time" control (C4) converts in the member's own
 * timezone, not the browser's. These pin the conversion both ways and every
 * refusal the composer shows next to the box.
 */
describe("scheduleTime", () => {
  const now = new Date("2026-09-11T20:00:00Z"); // 1:00 PM in Los Angeles (PDT)

  it("reads a wall clock in the member's timezone, not the browser's", () => {
    const la = readScheduleWallClock("2026-09-12T09:00", "America/Los_Angeles", now);
    const ny = readScheduleWallClock("2026-09-12T09:00", "America/New_York", now);
    expect(la).toEqual({ ok: true, iso: "2026-09-12T16:00:00.000Z" });
    expect(ny).toEqual({ ok: true, iso: "2026-09-12T13:00:00.000Z" });
  });

  it("refuses a past time with a sentence, rather than posting immediately", () => {
    const past = readScheduleWallClock("2026-09-11T12:00", "America/Los_Angeles", now);
    expect(past).toEqual({ ok: false, error: "Choose a time in the future, or post it now." });
  });

  it("refuses an empty box", () => {
    expect(readScheduleWallClock("", "UTC", now).ok).toBe(false);
  });

  it("refuses a wall clock the spring-forward gap skips", () => {
    const gap = readScheduleWallClock("2027-03-14T02:30", "America/New_York", now);
    expect(gap.ok).toBe(false);
  });

  it("starts the box an hour out, rounded to five minutes, in the member's zone", () => {
    const start = new Date("2026-09-11T20:02:10Z");
    // 21:02:10Z → rounded up to 21:05Z → 2:05 PM in Los Angeles.
    expect(defaultScheduleWallClock("America/Los_Angeles", start)).toBe("2026-09-11T14:05");
  });

  it("falls back from an unknown timezone instead of throwing", () => {
    const zone = scheduleTimeZone("Not/AZone");
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: zone })).not.toThrow();
    expect(scheduleTimeZone("America/Chicago")).toBe("America/Chicago");
  });

  it("formats the confirmation in the member's zone, with the zone named", () => {
    const text = formatScheduled("2026-09-12T16:00:00.000Z", "America/Los_Angeles");
    expect(text).toContain("9:00");
    expect(text).toContain("PDT");
  });
});
