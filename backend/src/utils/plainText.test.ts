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

  it("keeps ordinary prose, attributes of removed tags gone", () => {
    expect(plainText('Hello <a href="x">there</a>, see <b>this</b>')).toBe("Hello there, see this");
    expect(plainText("a<b")).toBe("ab");
    expect(plainText("x << y")).toBe("x << y");
  });

  /*
   * The old chain of replaces could build markup out of what it removed: the
   * whole-tag pass took `<b>` out of `<<b>script` and left `<script`, and a
   * control character between `<` and `script` was only removed after the
   * pass that would have caught the `<`.
   */
  it("cannot be made to assemble a tag out of the pieces it removes", () => {
    const bel = String.fromCharCode(7);
    const nul = String.fromCharCode(0);
    for (const attack of [
      "<<b>script>alert(1)",
      "<<ascript",
      "<</b>/script>",
      `<${bel}script>alert(1)</script>`,
      `<${nul}img src=x onerror=alert(1)>`,
      "<<<<b>>>script",
      "<!<b>--x-->",
      "<?<i>xml",
    ]) {
      expect(plainText(attack), JSON.stringify(attack)).not.toMatch(/<[a-zA-Z/!?]/);
    }
  });

  it("stays linear on a body of unclosed tags", () => {
    // Quadratic before: every `<A` scanned to the end of the string for a `>`.
    // At this size that was minutes of CPU on a single request.
    const hostile = "<A".repeat(200_000);
    const started = performance.now();
    expect(plainText(hostile)).toBe("A".repeat(200_000));
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
