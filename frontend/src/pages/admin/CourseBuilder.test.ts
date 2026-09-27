import { describe, expect, it } from "vitest";
import { dripError } from "./CourseBuilder";

/**
 * A blank or zero day count used to save as "open as soon as they buy", so a
 * section she meant to hold back for a week went out on day one.
 */
describe("dripError", () => {
  it("refuses a day-count schedule with no usable number", () => {
    expect(dripError({ mode: "days", days: "", date: "" })).not.toBeNull();
    expect(dripError({ mode: "days", days: "0", date: "" })).not.toBeNull();
    expect(dripError({ mode: "days", days: "2.5", date: "" })).not.toBeNull();
    expect(dripError({ mode: "days", days: "-3", date: "" })).not.toBeNull();
  });

  it("refuses a date schedule with no date", () => {
    expect(dripError({ mode: "date", days: "", date: "" })).not.toBeNull();
  });

  it("accepts every schedule the engine can honour", () => {
    expect(dripError({ mode: "immediately", days: "", date: "" })).toBeNull();
    expect(dripError({ mode: "days", days: "7", date: "" })).toBeNull();
    expect(dripError({ mode: "date", days: "", date: "2026-03-01" })).toBeNull();
  });
});
