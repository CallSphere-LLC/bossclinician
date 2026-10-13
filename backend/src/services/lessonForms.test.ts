import { describe, expect, it } from "vitest";
import { cleanFormSlug, formSlugFromToolKey, lessonFormToolKey } from "./lessonForms";

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
