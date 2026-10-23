import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToMarkdown, pasteEdit } from "./htmlToMarkdown";

/** Trimmed copies of what Chrome puts on the clipboard from each source. */
const GOOGLE_DOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc"><h2 dir="ltr" style="line-height:1.38"><span style="font-size:16pt;font-weight:400;">Session one</span></h2><p dir="ltr"><span style="font-weight:400;">Welcome to the </span><span style="font-weight:700;">Boss</span><span style="font-weight:700;"> Clinician</span><span style="font-weight:400;"> course, </span><span style="font-style:italic;font-weight:400">really</span><span>.</span></p><br><ul style="margin-top:0"><li dir="ltr" aria-level="1"><p dir="ltr" role="presentation"><span>First</span></p></li><ul><li aria-level="2"><p><span>Nested</span></p></li></ul><li><p><span>Second with </span><a href="https://www.google.com/url?q=https://example.com/a%3Fb%3D1&amp;sa=D&amp;source=editors"><span style="text-decoration:underline">a link</span></a></p></li></ul><ol><li><p>One</p></li><li><p>Two</p></li></ol></b><br>`;

const WORD = `<html><head><style>p{}</style></head><body><!--StartFragment--><p class=MsoNormal><b>Bold intro</b> and <i>italic</i><o:p></o:p></p><p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Apple<o:p></o:p></p><p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><!--[if !supportLists]--><span style='mso-list:Ignore'>·<span>&nbsp; </span></span><!--[endif]-->Banana</p><!--EndFragment--></body></html>`;

const WORD_NUMBERED = `<p class=MsoListParagraphCxSpFirst style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span>&nbsp;</span></span><![endif]>Book the call</p><p class=MsoListParagraphCxSpLast style='mso-list:l1 level2 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>a.<span>&nbsp;</span></span><![endif]>Bring notes</p>`;

describe("htmlToMarkdown", () => {
  it("keeps Google Docs headings, bold, italic, nested lists and links — and ignores its not-bold wrapper", () => {
    expect(htmlToMarkdown(GOOGLE_DOCS)).toEqual({
      formatted: true,
      markdown: [
        "## Session one",
        "",
        "Welcome to the **Boss Clinician** course, _really_.",
        "",
        "- First",
        "  - Nested",
        "- Second with [a link](https://example.com/a?b=1)",
        "",
        "1. One",
        "2. Two",
      ].join("\n"),
    });
  });

  it("turns Word's list paragraphs into a list without doubling the bullet", () => {
    expect(htmlToMarkdown(WORD).markdown).toBe("**Bold intro** and _italic_\n\n- Apple\n- Banana");
    expect(htmlToMarkdown(WORD_NUMBERED).markdown).toBe("1. Book the call\n  - Bring notes");
  });

  it("handles ordinary web markup: headings, quotes, code, rules, tables", () => {
    const { markdown } = htmlToMarkdown(
      `<div><h1>Title</h1><blockquote><p>Quote line</p></blockquote><pre>code  here</pre><hr><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x|y</td></tr></table></div>`,
    );
    expect(markdown).toBe(
      ["# Title", "", "> Quote line", "", "```", "code  here", "```", "", "---", "", "| A | B |", "| --- | --- |", "| 1 | x\\|y |"].join("\n"),
    );
  });

  it("keeps only safe links and web images", () => {
    expect(htmlToMarkdown(`<p><a href="javascript:alert(1)">bad</a> <img src="data:image/png;base64,AAA"><img src="https://x.test/i.png" alt="pic"></p>`).markdown).toBe(
      "bad ![pic](https://x.test/i.png)",
    );
    expect(htmlToMarkdown(`<p>Read <a href="/blog/x">this post</a> or <a href="mailto:a@b.c">email</a></p>`).markdown).toBe(
      "Read [this post](/blog/x) or [email](mailto:a@b.c)",
    );
    expect(htmlToMarkdown(`<a href="https://x.test/a b(1)">x [y]</a>`).markdown).toBe("[x \\[y\\]](https://x.test/a%20b%281%29)");
  });

  it("escapes pasted characters Markdown would read as formatting", () => {
    expect(htmlToMarkdown(`<p>Use 5 * 3 and snake_case and _under_ <b>ok</b></p>`).markdown).toBe("Use 5 \\* 3 and snake_case and \\_under\\_ **ok**");
    expect(htmlToMarkdown(`<p># not heading<br>- not list<br>1. not numbered</p><p><b>x</b></p>`).markdown).toBe(
      "\\# not heading\n\\- not list\n1\\. not numbered\n\n**x**",
    );
  });

  it("applies a wrapper's emphasis paragraph by paragraph and keeps headings free of markers", () => {
    expect(htmlToMarkdown(`<strong><p>One</p><p>Two</p></strong>`).markdown).toBe("**One**\n\n**Two**");
    expect(htmlToMarkdown(`<h3><strong>Bold heading</strong></h3>`).markdown).toBe("### Bold heading");
  });

  it("keeps ordered-list numbering and nesting, and separates two lists", () => {
    expect(htmlToMarkdown(`<ol start="3"><li>Three</li><li>Four<ul><li>sub</li></ul></li></ol><ul><li>a</li></ul>`).markdown).toBe(
      "3. Three\n4. Four\n   - sub\n\n- a",
    );
  });

  it("reports unformatted HTML as such, so the browser's plain paste is used", () => {
    expect(htmlToMarkdown(`<span style="color:#333">Just some words</span>`)).toEqual({ markdown: "Just some words", formatted: false });
    expect(htmlToMarkdown(`<p>Line one<br>Line two<br></p>`)).toEqual({ markdown: "Line one\nLine two", formatted: false });
    expect(htmlToMarkdown(`<img src="data:image/png;base64,AAAA">`)).toEqual({ markdown: "", formatted: false });
    expect(htmlToMarkdown("")).toEqual({ markdown: "", formatted: false });
  });

  it("keeps paragraph breaks from plain multi-paragraph copy (Docs' plain text runs them together)", () => {
    expect(htmlToMarkdown(`<p>First paragraph.</p><p>Second paragraph.</p>`)).toEqual({
      markdown: "First paragraph.\n\nSecond paragraph.",
      formatted: true,
    });
  });

  it("drops scripts, styles and fragment markers", () => {
    expect(htmlToMarkdown(`<style>p{color:red}</style><script>alert(1)</script><p>Safe</p>`).markdown).toBe("Safe");
    expect(htmlToMarkdown(`<html><body><!--StartFragment--><p>Hi <b>there</b></p><!--EndFragment--></body></html>`).markdown).toBe("Hi **there**");
  });

  it("marks styled spans, inline code and strike-through", () => {
    expect(htmlToMarkdown(`<p><span style="font-weight:700">Bold</span> <code>npm i</code> <s>gone</s></p>`).markdown).toBe("**Bold** `npm i` ~~gone~~");
  });
});

describe("decodeEntities", () => {
  it("decodes named and numeric entities and leaves unknown ones alone", () => {
    expect(decodeEntities("Tom &amp; Jerry &mdash; &#8220;hi&#x201D; &bogus;")).toBe("Tom & Jerry — “hi” &bogus;");
    expect(decodeEntities("&lt;b&gt; &#39; &#xZZ;")).toBe("<b> ' &#xZZ;");
  });
});

describe("pasteEdit", () => {
  it("puts several blocks on their own lines and leaves an inline paste inline", () => {
    expect(pasteEdit("Hello world", 6, 6, "## H\n\npara")).toEqual({
      value: "Hello \n\n## H\n\npara\n\nworld",
      selectionStart: 20,
      selectionEnd: 20,
      inserted: "\n\n## H\n\npara\n\n",
    });
    expect(pasteEdit("Hello world", 6, 6, "**b**")).toEqual({ value: "Hello **b**world", selectionStart: 11, selectionEnd: 11, inserted: "**b**" });
    expect(pasteEdit("", 0, 0, "- a\n- b").value).toBe("- a\n- b");
  });

  it("replaces the selection", () => {
    expect(pasteEdit("Hello world", 0, 5, "_Hi_").value).toBe("_Hi_ world");
  });
});
