import { describe, expect, it } from "vitest";
import { plainText } from "./plainText";

/**
 * The one sanitiser every member-authored field is stored through. A lesson
 * comment is read by other paying members on a course page and there is no
 * moderation screen for those rows, so what this lets past is what the next
 * renderer has to survive.
 */

describe("plainText", () => {
  it("removes a script tag along with its brackets", () => {
    expect(plainText("<script>alert(1)</script>hello")).toBe("alert(1)hello");
  });

  it("removes a tag whose author left the closing bracket off", () => {
    // The trick that beats a pattern looking only for complete tags.
    expect(plainText('<img src=x onerror="alert(1)"')).toBe('img src=x onerror="alert(1)"');
  });

  it("leaves text that only looks like markup alone", () => {
    expect(plainText("I read that chapter 3 < 5 times <3")).toBe(
      "I read that chapter 3 < 5 times <3"
    );
  });

  it("strips invisible control characters", () => {
    const smuggled = `dele${String.fromCharCode(7)}ted${String.fromCharCode(127)}`;
    expect(plainText(smuggled)).toBe("deleted");
  });

  it("trims, so an all-whitespace body is empty rather than blank", () => {
    expect(plainText("   \n  ")).toBe("");
  });
});
