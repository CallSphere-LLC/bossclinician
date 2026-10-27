import { describe, expect, it } from "vitest";
import { planTextRuns } from "./livingPlanFonts";

describe("plan PDF font coverage", () => {
  it.each(["Δημήτρης Παπαδόπουλος", "Елена Иванова", "José’s practice • €300", "Care 😀 ❤️ 👩🏽‍⚕️", "Team 👨‍👩‍👧‍👦", "Cafe\u0301"])('preserves every character in %s', (text) => {
    expect(planTextRuns(text).map((run) => run.text).join("")).toBe(text);
  });
  it("selects bundled fonts for Greek/Cyrillic and emoji without breaking emoji clusters", () => {
    expect(planTextRuns("Δημήτρης")[0].font).toBe("NotoSans");
    expect(planTextRuns("👩🏽‍⚕️")).toEqual([{ text: "👩🏽‍⚕️", font: "NotoEmoji" }]);
  });
  it("offers a complete browser-print fallback for a script outside the bundled coverage", () => {
    expect(() => planTextRuns("東京")).toThrow("Print / Save as PDF");
  });
});
