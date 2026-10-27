import { describe, expect, it } from "vitest";
import { cleanFormSlug, formSlugFromToolKey, lessonFormToolKey, lessonFormIdentityFields, lessonFormAnswerProblem } from "./lessonForms";

describe("lesson form tool keys", () => {
  it("round-trips a form slug through the lesson's tool_key", () => {
    const key = lessonFormToolKey("lounge-vip-voice-note-question");
    expect(key).toBe("form-lounge-vip-voice-note-question");
    // The shape course_lessons_tool_key_check enforces (migration 104).
    expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(formSlugFromToolKey(key)).toBe("lounge-vip-voice-note-question");
  });

  it("ignores calculator keys and anything that is not a form", () => {
    expect(formSlugFromToolKey("ramp-up-rate-calculator")).toBeNull();
    expect(formSlugFromToolKey("form-")).toBeNull();
    expect(formSlugFromToolKey(null)).toBeNull();
  });

  it("refuses a URL slug that could not be a form's", () => {
    expect(cleanFormSlug("lounge-vip-hot-seat-request")).toBe("lounge-vip-hot-seat-request");
    expect(cleanFormSlug("../etc")).toBeNull();
    expect(cleanFormSlug("Upper")).toBeNull();
    expect(cleanFormSlug("x".repeat(121))).toBeNull();
  });
});

describe("native lesson identity and answer validation", () => {
  const fields = [
    { key:"email",label:"Email",type:"email",required:true },
    { key:"name",label:"First and Last Name",type:"text",required:true },
    { key:"support",label:"Support",type:"checkboxes",options:["A","B"] },
    { key:"confidence",label:"Confidence",type:"radio",options:["High","Low"] },
    { key:"reason",label:"Reason",type:"textarea" },
  ];
  const visible = new Set(fields.map(f => f.key));
  it("returns only account identity labels in source order", () => {
    expect(lessonFormIdentityFields(fields)).toEqual([
      {key:"email",label:"Email",required:true}, {key:"name",label:"First and Last Name",required:true},
    ]);
    expect(lessonFormIdentityFields(null)).toEqual([]);
  });
  it("accepts multiple listed choices and optional blanks", () => {
    expect(lessonFormAnswerProblem(fields,{support:["A","B"],confidence:"High",reason:"text"},visible)).toBeNull();
    expect(lessonFormAnswerProblem(fields,{},visible)).toBeNull();
  });
  it.each([
    {support:"A"}, {support:["A","A"]}, {support:["A","forged"]},
    {confidence:["High"]}, {confidence:"forged"}, {reason:true}, {reason:["text"]},
  ])("rejects forged choices and wrong value types %#", data => {
    expect(lessonFormAnswerProblem(fields,data,visible)).toBeTruthy();
  });
  it("leaves hidden questions and server-bound identity to their existing policies", () => {
    expect(lessonFormAnswerProblem(fields,{support:"forged",name:{}},new Set(["name"]))).toBeNull();
  });
});
