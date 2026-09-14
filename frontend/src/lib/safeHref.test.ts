import { describe, it, expect } from "vitest";
import { safeHref } from "@/lib/safeHref";

/**
 * The gate in front of every admin-typed address a LuxeButton renders. A real
 * address or a path on this site gets through unchanged; a scheme that runs
 * script does not, however it is dressed up.
 */
describe("safeHref", () => {
  it("passes ordinary addresses through unchanged", () => {
    expect(safeHref("https://cal.com/yvette/intro")).toBe("https://cal.com/yvette/intro");
    expect(safeHref("http://example.com/thanks")).toBe("http://example.com/thanks");
    expect(safeHref("mailto:hello@bossclinician.com")).toBe("mailto:hello@bossclinician.com");
    expect(safeHref("tel:+15555550123")).toBe("tel:+15555550123");
  });

  it("passes paths, anchors and queries through without making them absolute", () => {
    expect(safeHref("/courses/practice-reset")).toBe("/courses/practice-reset");
    expect(safeHref("#library")).toBe("#library");
    expect(safeHref("?from=home")).toBe("?from=home");
    expect(safeHref("resources")).toBe("resources");
  });

  it("refuses schemes that execute", () => {
    expect(safeHref("javascript:alert(document.cookie)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
  });

  it("refuses them however they are disguised, as a browser would read them", () => {
    // Browsers strip leading whitespace and tabs or newlines inside the scheme,
    // and schemes are case-insensitive; a prefix check would miss all three.
    expect(safeHref("  javascript:alert(1)")).toBeUndefined();
    expect(safeHref("java\tscript:alert(1)")).toBeUndefined();
    expect(safeHref("JavaScript:alert(1)")).toBeUndefined();
  });

  it("refuses what does not parse", () => {
    expect(safeHref("http://[not-an-address")).toBeUndefined();
  });
});
