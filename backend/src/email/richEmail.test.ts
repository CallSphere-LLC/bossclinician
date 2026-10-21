import { describe, expect, it } from "vitest";
import { RICH_EMAIL, sanitizeRichEmail, richEmailText } from "./richEmail";
describe("rich email delivery", () => {
  it("preserves bold, pasted formatting, links, and animated image URLs", () => {
    const html = sanitizeRichEmail(RICH_EMAIL + '<p style="color:#432345;font-weight:700">Hello <strong>reader</strong> <a href="https://example.com">Visit</a></p><img src="https://example.com/animation.gif" alt="Animated welcome">');
    expect(html).toContain('<strong>reader</strong>');
    expect(html).toContain('color:#432345');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('animation.gif');
    expect(richEmailText(RICH_EMAIL + '<p>Hello &amp; <b>welcome</b></p><p>Next line</p>')).toBe('Hello & welcome\nNext line');
  });
  it("removes scripts, unsafe URLs, event handlers, tracking CSS and overlays", () => {
    const html = sanitizeRichEmail('<script>alert(1)</script><iframe src="https://bad.example"></iframe><p onclick="bad()" style="position:fixed;background-image:url(https://bad.example);color:#333">Safe</p><a href="javascript:bad()">link</a><img src="data:image/svg+xml,bad" onerror="bad()">');
    expect(html).not.toMatch(/script|iframe|onclick|javascript|onerror|position|url\(|data:/);
    expect(html).toContain('color:#333');
  });
});
