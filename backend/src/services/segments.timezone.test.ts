import { describe, expect, it } from "vitest";
import { compileSegment } from "./segments";
import { HttpError } from "../utils/httpError";

/**
 * The date box on the segment screen writes a bare "YYYY-MM-DD". Read as UTC,
 * "before March 1" would end at 7pm on February 28 in New York and quietly drop
 * that evening's signups.
 */
describe("compileSegment date values", () => {
  it("reads a bare date as midnight on the business calendar, not in UTC", () => {
    const winter = compileSegment({
      rules: [{ field: "created_at", op: "before", value: "2026-03-01" }],
    });
    expect(winter.params[0]).toEqual(new Date("2026-03-01T05:00:00.000Z"));

    // Across DST the offset moves, so this is not a fixed five hours.
    const summer = compileSegment({
      rules: [{ field: "created_at", op: "after", value: "2026-07-01" }],
    });
    expect(summer.params[0]).toEqual(new Date("2026-07-01T04:00:00.000Z"));
  });

  it("leaves a full timestamp as the instant it names", () => {
    const compiled = compileSegment({
      rules: [{ field: "last_activity_at", op: "before", value: "2026-03-01T12:34:56.000Z" }],
    });
    expect(compiled.params[0]).toEqual(new Date("2026-03-01T12:34:56.000Z"));
  });

  it("refuses a calendar day that does not exist", () => {
    let thrown: unknown;
    try {
      compileSegment({ rules: [{ field: "created_at", op: "before", value: "2026-02-30" }] });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpError);
    expect((thrown as HttpError).status).toBe(400);
  });
});
