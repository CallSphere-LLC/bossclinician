import { describe, expect, it } from "vitest";
import { emptyRateState, normaliseRateState, validRateState } from "./rateRaiseState";

const withFields = (fields: unknown) => ({version: 1, fields});

describe("Rate Raise Lab persistence allowlist", () => {
 it.each(["notes", "memberId", "patientName", "tplClient", "payerTax", "payerNpi", "payerFullContact", "constructor"])(
  "rejects unapproved property %s", (key) => {
   const input = withFields({rate: 120, [key]: "should never persist"});
   expect(validRateState(input)).toBe(false);
   expect(normaliseRateState(input)).toEqual(emptyRateState());
  });
 it("rejects unknown envelope fields and wrong versions", () => {
  expect(validRateState({...emptyRateState(), memberId: "member-a"})).toBe(false);
  expect(validRateState({...emptyRateState(), version: 2})).toBe(false);
  expect(validRateState(withFields([]))).toBe(false);
 });
 it("preserves blank values without converting to zero and accepts valid boundaries", () => {
  const input = withFields({rate: 0, weeks: 52, payerClinicians: 1000, payerCpt90791Current: null, payerCpt90791Proposed: 10000, selectedPct: "10", readiness0: false});
  expect(validRateState(input)).toBe(true);
  expect(normaliseRateState(input)).toEqual(input);
 });
 it.each([["rate", "120"], ["rate", -0.01], ["rate", Infinity], ["rate", NaN], ["weeks", 0], ["weeks", 53], ["payerClinicians", 5.5], ["sessions", 101], ["payerCpt90837Current", 10000.01], ["selectedPct", 10], ["selectedPct", "20"], ["payerStatus", "sent"], ["noticeDate", "2025-02-29"], ["effectiveDate", "2026-04-31"], ["fairDate", "2026-8-01"], ["tplDate", "2201-01-01"], ["readiness0", 1]])(
  "rejects invalid %s value %s", (key, value) => {
   expect(validRateState(withFields({[key]: value}))).toBe(false);
  });
 it("accepts leap dates, cleared dates, and permitted enums", () => {
  expect(validRateState(withFields({noticeDate: "2028-02-29", effectiveDate: "", payerStatus: "pending"}))).toBe(true);
 });
});
