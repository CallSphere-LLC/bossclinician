import { describe, expect, it } from "vitest";
import { communityEventLocation } from "./communityEventLocation";

describe("community event meeting location", () => {
  it("defaults new events to the native room and leaves unrelated edits alone", () => {
    expect(communityEventLocation({}, true)).toEqual({
      locationUrl: "",
      native: true,
    });
    expect(communityEventLocation({ title: "Edited" })).toBeNull();
    expect(
      communityEventLocation({
        joinMode: "native",
        locationUrl: "https://old.example",
      }),
    ).toEqual({ locationUrl: "", native: true });
  });
  it("preserves explicit existing external meetings", () => {
    expect(
      communityEventLocation(
        { locationUrl: "https://meet.example/room" },
        true,
      ),
    ).toEqual({ locationUrl: "https://meet.example/room", native: false });
  });
  it("rejects unsafe or missing external links and unknown modes", () => {
    for (const locationUrl of [
      "",
      "javascript:alert(1)",
      "/relative",
      "https://user:password@example.com",
    ]) {
      expect(() =>
        communityEventLocation({ joinMode: "external", locationUrl }),
      ).toThrow();
    }
    expect(() => communityEventLocation({ joinMode: "other" })).toThrow();
  });
});
