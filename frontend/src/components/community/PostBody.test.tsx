import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { PostBody } from "./PostBody";

describe("user supplied text rendering", () => {
  it("community posts/comments render markup as escaped text and link only http(s)", () => {
    const html = renderToStaticMarkup(<PostBody text={'<img src=x onerror="alert(1)"><script>alert(1)</script> javascript:alert(1) https://callsphere.ai/safe'} />);
    expect(html).not.toContain("<img"); expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img"); expect(html).not.toContain('href="javascript:'); expect(html).toContain('href="https://callsphere.ai/safe"');
  });
  it("the shared Markdown configuration escapes HTML and refuses javascript links", () => {
    const html = renderToStaticMarkup(<ReactMarkdown>{'<script>alert(1)</script>\n\n[run](javascript:alert(1))'}</ReactMarkdown>);
    expect(html).not.toContain("<script"); expect(html).not.toContain('href="javascript:');
  });
});
