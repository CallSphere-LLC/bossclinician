import { describe, expect, it } from "vitest";
import { previewEmailTokens } from "@/components/admin/EmailComposer";
import { validateSequenceEmailDraft } from "@/components/admin/emailDraftValidation";
import { describeWait, splitWait } from "@/lib/marketingApi";

describe("QA 176 email editor", () => {
  it("shows a representative first name for both token spellings in browser preview", () => {
    expect(previewEmailTokens("Hi {{firstname}}, {{firstName}}")) .toBe("Hi Yvette, Yvette");
  });

  it("round trips mixed delays without dropping the minute remainder", () => {
    expect(splitWait(10080 + 2880 + 180 + 4)).toEqual({ weeks: 1, days: 2, hours: 3, minutes: 4 });
    expect(describeWait(10080 + 4)).toBe("1 week 4 minutes");
    expect(validateSequenceEmailDraft({ subject: "Update", waitWeeks: 1, waitDays: 2, waitHours: 3, waitMinutes: 4 })).toEqual({});
    expect(validateSequenceEmailDraft({ subject: "Update", waitWeeks: 0, waitDays: 0, waitHours: 0, waitMinutes: 60 }).waitMinutes).toMatch(/59/);
  });
});
