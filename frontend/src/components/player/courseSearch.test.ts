import { describe, expect, it } from "vitest";
import type { OutlineModule } from "@/lib/libraryApi";
import { courseSearchAccessKey, searchPreviewOutline } from "./courseSearch";

const modules = [{ id: 1, title: "Financial planning", unlocked: true, unlockLabel: "", lessons: [
  { id: 7, slug: "reserve", title: "Réserve strategy", unlocked: true, unlockLabel: "" },
  { id: 8, slug: "reserve--lesson-8", title: "Reserve strategy", unlocked: false, unlockLabel: "Complete Intro" },
] }] as OutlineModule[];

describe("preview course search", () => {
  it("combines module/title terms, ignores accents and preserves qualified slugs", () => {
    const response = searchPreviewOutline(modules, " RESERVE   planning ");
    expect(response.total).toBe(2);
    expect(response.results[1]).toMatchObject({ slug: "reserve--lesson-8", unlocked: false, snippet: "", unlockLabel: "Complete Intro" });
  });
  it("does not turn an empty query or punctuation into a match-all expression", () => {
    expect(searchPreviewOutline(modules, "  ").results).toEqual([]);
    expect(searchPreviewOutline(modules, ".*").results).toEqual([]);
  });
  it("invalidates an unchanged query after completion or an exemption, but not playback heartbeats", () => {
    const initial = courseSearchAccessKey(modules);
    const progress = structuredClone(modules);
    progress[0].lessons[0].lastPositionSeconds = 30;
    progress[0].lessons[0].watchedPercent = 40;
    expect(courseSearchAccessKey(progress)).toBe(initial);
    progress[0].lessons[0].completed = true;
    expect(courseSearchAccessKey(progress)).not.toBe(initial);
    const exemption = structuredClone(modules);
    exemption[0].lessons[1].unlocked = true;
    expect(courseSearchAccessKey(exemption)).not.toBe(initial);
  });
});
