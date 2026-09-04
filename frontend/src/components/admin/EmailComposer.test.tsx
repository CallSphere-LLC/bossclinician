import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EmailComposer, { EMAIL_STARTERS, applyEmailFormat } from "./EmailComposer";

describe("EmailComposer", () => {
  it("offers reusable starters and content blocks", () => {
    const html = renderToStaticMarkup(<EmailComposer value="" onChange={() => undefined} />);

    expect(html).toContain("Start from a template");
    expect(html).toContain("Welcome");
    expect(html).toContain("Add a content block");
    expect(html).toContain("Button");
    expect(EMAIL_STARTERS[0].body).toContain("{{firstName}}");
  });

  it("formats selected text while preserving the caret range", () => {
    const edit = applyEmailFormat("bold", "Hello world", 6, 11);

    expect(edit).toEqual({ value: "Hello **world**", selectionStart: 8, selectionEnd: 13 });
  });
});
