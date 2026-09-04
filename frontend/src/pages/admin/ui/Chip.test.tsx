import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Chip, chipStyles } from "./primitives";

/**
 * The regression this guards is a physical one: chips were
 * `rounded-full px-3.5 py-1.5 text-xs`, which renders a ~28px-tall target.
 * Four rounds of manual testing produced repeated false "it's broken" reports,
 * every one of them a click that landed a few pixels outside a chip.
 */
describe("Chip", () => {
  it("is at least a 40px tall target in both states", () => {
    for (const selected of [true, false]) {
      expect(chipStyles(selected)).toContain("min-h-10");
      // The padding grows to meet the floor rather than fighting it.
      expect(chipStyles(selected)).toContain("py-2");
    }
  });

  it("shows a press, not just a hover", () => {
    expect(chipStyles(false)).toContain("active:");
    expect(chipStyles(true)).toContain("active:");
  });

  it("carries its state for assistive tech, not by colour alone", () => {
    const on = renderToStaticMarkup(<Chip selected onClick={() => undefined}>Healthy</Chip>);
    const off = renderToStaticMarkup(<Chip selected={false} onClick={() => undefined}>Healthy</Chip>);

    expect(on).toContain('aria-pressed="true"');
    expect(off).toContain('aria-pressed="false"');
  });

  it("defaults to type=button so a chip inside a form cannot submit it", () => {
    const html = renderToStaticMarkup(<Chip selected={false} onClick={() => undefined}>Any</Chip>);

    expect(html).toContain('type="button"');
  });

  it("keeps a visible keyboard focus ring", () => {
    expect(chipStyles(false)).toContain("focus-visible:ring-2");
  });
});
