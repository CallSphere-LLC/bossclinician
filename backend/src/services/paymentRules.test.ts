import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_DAYS,
  cleanStatementDescriptor,
  parseRetrySchedule,
  retryScheduleProblem,
  statementDescriptorProblem,
} from "./paymentRules";

describe("statement descriptor", () => {
  it.each(["BOSSCLINICIAN", "Boss Clinician", "BOSS-CLIN.COM", ""])("accepts %j", (value) => {
    expect(statementDescriptorProblem(value)).toBeNull();
  });

  it.each([
    ["BOSS", "5 to 22 characters"],
    ["BOSS CLINICIAN MEMBERSHIPS", "5 to 22 characters"],
    ["BOSS*CLINIC", "only use letters"],
    ["Boss's Clinic", "only use letters"],
    ["12345", "at least one letter"],
  ])("refuses %j and says why", (value, message) => {
    expect(statementDescriptorProblem(value)).toContain(message);
  });

  it("is sent to Stripe upper-cased, and not at all when unusable", () => {
    expect(cleanStatementDescriptor("Boss Clinician")).toBe("BOSS CLINICIAN");
    expect(cleanStatementDescriptor("")).toBeUndefined();
    expect(cleanStatementDescriptor("1234 5")).toBeUndefined();
    expect(cleanStatementDescriptor("A very long statement descriptor")).toBe("A VERY LONG STATEMENT");
  });
});

describe("retry schedule", () => {
  it("reads a comma-separated list of day gaps", () => {
    expect(parseRetrySchedule("3, 5, 7")).toEqual([3, 5, 7]);
    expect(parseRetrySchedule("1,1")).toEqual([1, 1]);
    expect(retryScheduleProblem("2")).toBeNull();
  });

  it.each([
    ["", "for example 3, 5, 7"],
    ["3; 5", "separated by commas"],
    ["3, five", "separated by commas"],
    ["1,1,1,1,1,1,1", "6 or fewer"],
    ["0, 3", "between 1 and 30"],
    ["3, 45", "between 1 and 30"],
  ])("refuses %j and says why", (value, message) => {
    expect(retryScheduleProblem(value)).toContain(message);
    expect(parseRetrySchedule(value)).toEqual(DEFAULT_RETRY_DAYS);
  });
});
