import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CommunityCover, CommunityDescription } from "./CommunityDescription";
import { applyDescriptionFormat, stripMarkdown, withHardBreaks } from "./descriptionFormat";

describe("community description", () => {
  it("keeps the line breaks of a plain description written before formatting existed", () => {
    const lounge =
      "Welcome to The Lounge\n\nYour Lounge Includes:\n\nThe Practice Elevation:\nYour complete four-module curriculum.";
    const html = renderToStaticMarkup(<CommunityDescription text={lounge} />);
    expect(html).toContain("The Practice Elevation:<br/>");
    expect(html).toContain("Your complete four-module curriculum.");
    expect((html.match(/<p>/g) ?? []).length).toBe(3);
  });

  it("renders bold, headings, lists and links", () => {
    const html = renderToStaticMarkup(
      <CommunityDescription text={"## What's inside\n\nThis is **bold**.\n\n- one\n- two\n\n[Guidelines](https://example.com/g)"} />,
    );
    expect(html).toContain("<h2>What&#x27;s inside</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toMatch(/<li>one<\/li>\s*<li>two<\/li>/);
    expect(html).toContain('href="https://example.com/g"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("<br/>\n<li");
  });

  it("escapes HTML and refuses javascript links", () => {
    const html = renderToStaticMarkup(
      <CommunityDescription text={'<img src=x onerror="alert(1)"><script>alert(1)</script>\n\n[run](javascript:alert(1))'} />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('href="javascript:');
  });

  it("does not add breaks inside code blocks or before blank lines", () => {
    expect(withHardBreaks("a\nb\n\nc")).toBe("a  \nb\n\nc");
    expect(withHardBreaks("```\nx\ny\n```")).toBe("```\nx\ny\n```");
  });

  it("strips the markup for one-line card excerpts", () => {
    expect(stripMarkdown("## Welcome\n\nThis is **bold** and _soft_.\n- [Rules](https://x.y)")).toBe(
      "Welcome This is bold and soft. Rules",
    );
    expect(stripMarkdown("Plain $5K month, snake_case stays")).toBe("Plain $5K month, snake_case stays");
  });

  it("toolbar wraps the selection and toggles line formats", () => {
    expect(applyDescriptionFormat("bold", "make me bold", 8, 12).value).toBe("make me **bold**");
    const heading = applyDescriptionFormat("heading", "Title\nbody", 0, 0);
    expect(heading.value).toBe("## Title\nbody");
    expect(applyDescriptionFormat("heading", heading.value, 0, 0).value).toBe("Title\nbody");
    expect(applyDescriptionFormat("bullets", "a\nb", 0, 3).value).toBe("- a\n- b");
  });

  it("shows a cover only when there is a safe one", () => {
    expect(renderToStaticMarkup(<CommunityCover src="" />)).toBe("");
    expect(renderToStaticMarkup(<CommunityCover src="javascript:alert(1)" />)).toBe("");
    expect(renderToStaticMarkup(<CommunityCover src="/uploads/cover.png" />)).toContain('src="/uploads/cover.png"');
  });
});
