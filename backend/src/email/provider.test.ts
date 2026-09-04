import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./provider";

describe("renderMarkdown", () => {
  it("renders the content blocks produced by the email composer", () => {
    const html = renderMarkdown(
      '## Hello\n\n![A friendly face](https://images.example/photo.jpg)\n\n[Join now](https://example.com/join "button")\n\n---\n\n1. First\n2. Second'
    );

    expect(html).toContain("<h2>Hello</h2>");
    expect(html).toContain('<img src="https://images.example/photo.jpg" alt="A friendly face"');
    expect(html).toContain('href="https://example.com/join"');
    expect(html).toContain("background:#5b214e");
    expect(html).toContain("<hr");
    expect(html).toContain("<ol><li>First</li><li>Second</li></ol>");
  });

  it("escapes unsafe HTML and refuses non-http block URLs", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n![bad](javascript:alert(1))\n\n[bad](javascript:alert(1) "button")'
    );

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('<img src="javascript:');
    expect(html).not.toContain('<a href="javascript:');
  });
});
