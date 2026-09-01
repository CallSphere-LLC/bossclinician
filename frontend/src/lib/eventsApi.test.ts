import { describe, it, expect } from "vitest";
import { describeStart } from "./eventsApi";

/**
 * P0-4 regression: the events list rendered every start time in the viewer's
 * own timezone.
 *
 * The stored data was always right — an 18:00 Eastern event is stored as
 * 22:00Z. The bug was in this formatter: it asked `Intl.DateTimeFormat` for
 * `dateStyle` and `timeStyle` *and* `timeZoneName`, a combination ECMA-402
 * forbids. TypeScript accepts it, because `Intl.DateTimeFormatOptions` allows
 * every key independently, so the defect was invisible to the typechecker and
 * threw only at runtime — on every render, for every event. The `catch` behind
 * it reformatted with no `timeZone`, so the column silently tracked whoever was
 * looking: "3:00 PM" in California, "10:00 PM" on the UTC server.
 *
 * These would have caught it, because a throw into that catch loses the zone
 * abbreviation, and the abbreviation is what they assert on.
 */

// 2026-09-15 18:00 America/New_York — the exact value from the bug report.
const SEPTEMBER_EVENING = "2026-09-15T22:00:00.000Z";

describe("describeStart", () => {
  it("renders in the event's zone, not the machine's", () => {
    const label = describeStart(SEPTEMBER_EVENING, "America/New_York");
    expect(label).toContain("6:00");
    expect(label).toContain("PM");
    expect(label).toContain("Sep 15");
    // The reported symptom: 3:00 PM is this instant in Pacific time, which is
    // what the broken catch produced on a Pacific machine.
    expect(label).not.toContain("3:00");
  });

  it("names the zone, so the reader can tell which clock it is", () => {
    // The assertion that fails the moment the Intl options go back to an
    // illegal combination: the catch branch cannot produce an abbreviation.
    expect(describeStart(SEPTEMBER_EVENING, "America/New_York")).toContain("EDT");
  });

  it("tracks daylight saving, printing EST for a winter date", () => {
    // Same wall-clock hour, other side of the DST boundary: 18:00 EST is 23:00Z
    // rather than 22:00Z, and the abbreviation has to move with it.
    const label = describeStart("2026-01-15T23:00:00.000Z", "America/New_York");
    expect(label).toContain("6:00");
    expect(label).toContain("EST");
  });

  it("handles a half-hour offset zone", () => {
    // Kolkata is UTC+5:30, and the date rolls over. A formatter that fell back
    // to the machine zone would not land on 3:30 AM on the 16th.
    const label = describeStart(SEPTEMBER_EVENING, "Asia/Kolkata");
    expect(label).toContain("3:30");
    expect(label).toContain("AM");
    expect(label).toContain("Sep 16");
  });

  it("falls back to a labelled UTC time when the zone is not a real zone", () => {
    // A garbage zone must not blank the column, and must not quietly render in
    // the viewer's zone either — which is what the old catch did.
    const label = describeStart(SEPTEMBER_EVENING, "Not/AZone");
    expect(label).toContain("UTC");
    expect(label).toContain("10:00");
  });

  it("falls back to Eastern when the event carries no zone at all", () => {
    expect(describeStart(SEPTEMBER_EVENING, "")).toContain("EDT");
  });

  it("says so plainly when there is no date, rather than printing an epoch", () => {
    expect(describeStart(null, "America/New_York")).toBe("No date yet");
    expect(describeStart("not a date", "America/New_York")).toBe("No date yet");
  });
});
