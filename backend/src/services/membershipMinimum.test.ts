import { describe, expect, it } from "vitest";
import { cancellationDate, minimumMonthsFrom, minimumTermEnd } from "./membershipMinimum";

describe("membership minimum term", () => {
  it("reads the term only from a valid metadata value", () => {
    expect(minimumMonthsFrom({ minimumMonths: "6" })).toBe(6);
    for (const bad of [{}, { minimumMonths: "" }, { minimumMonths: "0" }, { minimumMonths: "x" }, null, undefined]) {
      expect(minimumMonthsFrom(bad as Record<string, string> | null | undefined)).toBe(0);
    }
  });

  it("ends a month-two cancellation at the end of the minimum, not the current period", () => {
    const anchor = new Date("2027-01-15T12:00:00Z");
    const minimum = minimumTermEnd(anchor, 6);
    expect(minimum.toISOString()).toBe("2027-07-15T12:00:00.000Z");
    const periodEnd = new Date("2027-03-15T12:00:00Z");
    expect(cancellationDate(minimum, periodEnd, new Date("2027-02-20T00:00:00Z"))).toEqual(minimum);
  });

  it("uses the paid period once the minimum has passed", () => {
    const minimum = new Date("2027-07-15T12:00:00Z");
    const periodEnd = new Date("2027-09-15T12:00:00Z");
    expect(cancellationDate(minimum, periodEnd, new Date("2027-08-20T00:00:00Z"))).toEqual(periodEnd);
  });
});
