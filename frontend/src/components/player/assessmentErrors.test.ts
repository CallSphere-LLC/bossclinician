import { describe, expect, it } from "vitest";
import { MemberApiError } from "@/lib/memberApi";
import { missingQuestionIdsOf } from "./assessmentErrors";

describe("missingQuestionIdsOf", () => {
  it("reads the questions the server says are blank", () => {
    const error = new MemberApiError("Some questions still need an answer", 400, {
      missingQuestionIds: [12, 15],
    });
    expect(missingQuestionIdsOf(error)).toEqual([12, 15]);
  });

  it("ignores anything in the list that is not a question id", () => {
    const error = new MemberApiError("x", 400, { missingQuestionIds: [3, "4", null, 2.5, 7] });
    expect(missingQuestionIdsOf(error)).toEqual([3, 7]);
  });

  it("says nothing for a session, access or server error", () => {
    expect(missingQuestionIdsOf(new MemberApiError("Please sign in again", 401))).toEqual([]);
    expect(missingQuestionIdsOf(new MemberApiError("Read-only", 403, { missingQuestionIds: [1] }))).toEqual([]);
    expect(missingQuestionIdsOf(new MemberApiError("Invalid submission", 400, { fields: ["responses"] }))).toEqual([]);
    expect(missingQuestionIdsOf(new Error("Failed to fetch"))).toEqual([]);
    expect(missingQuestionIdsOf(undefined)).toEqual([]);
  });
});
