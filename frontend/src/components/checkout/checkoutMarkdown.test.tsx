import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckoutMarkdown } from "./CheckoutMarkdown";
import {
  applyCheckoutStyle,
  checkoutPlainText,
  insertCheckoutImage,
  prepareCheckoutMarkdown,
  styleLineClasses,
} from "./checkoutMarkdown";
import { withPreselectedOption } from "./checkoutPreview";

const render = (text: string) => renderToStaticMarkup(<CheckoutMarkdown text={text} />);

describe("CheckoutMarkdown", () => {
  it("draws headings, bold, italic, links, rules, bullets and numbers", () => {
    const html = render(
      [
        "# Audit-Proof Your Practice",
        "## Two ways to join",
        "### What you get",
        "",
        "Join **Yvette** for a _90-minute_ workshop. [Read the terms](/terms).",
        "",
        "- Live Q&A",
        "- Replay access",
        "",
        "1. Register",
        "2. Attend",
        "",
        "---",
      ].join("\n"),
    );
    expect(html).toContain("<h1>Audit-Proof Your Practice</h1>");
    expect(html).toContain("<h2>Two ways to join</h2>");
    expect(html).toContain("<h3>What you get</h3>");
    expect(html).toContain("<strong>Yvette</strong>");
    expect(html).toContain("<em>90-minute</em>");
    expect(html).toContain('<a href="/terms" target="_blank" rel="noopener noreferrer">Read the terms</a>');
    expect(html).toMatch(/<ul>\s*<li>Live Q&amp;A<\/li>/);
    expect(html).toMatch(/<ol>\s*<li>Register<\/li>/);
    expect(html).toContain("<hr/>");
  });

  it("draws photos as safe, lazy, rounded images", () => {
    const html = render("Look:\n\n![Yvette teaching](/images/abc.webp)\n\n![x](https://cdn.example.com/a.png)");
    expect(html).toContain('src="/images/abc.webp"');
    expect(html).toContain('alt="Yvette teaching"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('class="cm-photo"');
    expect(html).toContain('src="https://cdn.example.com/a.png"');
  });

  it("refuses script addresses in links and images and never renders raw HTML", () => {
    const html = render(
      [
        "[click](javascript:alert(1))",
        "",
        "![pic](javascript:alert(1))",
        "",
        "![pic2](data:image/svg+xml;base64,PHN2Zz4=)",
        "",
        "<script>alert(1)</script>",
        "",
        '<img src="x" onerror="alert(1)">',
      ].join("\n"),
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:image");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=\"x\"");
    expect(html).not.toMatch(/<a[^>]*>click<\/a>/);
    expect(html).toContain("click");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps the single line breaks of a plain-text description", () => {
    const html = render("Protect Your Practice.\nProtect Your Peace.");
    expect(html).toMatch(/Protect Your Practice\.<br\/>\s*Protect Your Peace\./);
  });

  it("turns a style line into classes on the next block and drops the line", () => {
    const html = render("You'll learn how to:\n{checks}\n- Spot audit triggers\n- Fix billing errors");
    expect(html).toContain('<ul class="cm-checks">');
    expect(html).not.toContain("{checks}");
    // The sentence above stays its own paragraph.
    expect(html).toContain("<p>You&#x27;ll learn how to:</p>");
  });

  it("styles numbered lists, headings and paragraphs, and stacks style lines", () => {
    const html = render(
      ["{steps}", "1. Register", "2. Attend", "", "{sans gold}", "## Two ways to join", "{center}", "{large}", "Pick one below."].join("\n"),
    );
    expect(html).toContain('<ol class="cm-steps">');
    expect(html).toContain('<h2 class="cm-sans cm-gold">Two ways to join</h2>');
    expect(html).toContain('<p class="cm-center cm-large">Pick one below.</p>');
  });

  it("accepts {.checks} and {: .checks} and leaves unknown words as text", () => {
    expect(styleLineClasses("{.checks}")).toEqual(["cm-checks"]);
    expect(styleLineClasses("{: .checks}")).toEqual(["cm-checks"]);
    expect(styleLineClasses("{ Stars  serif }")).toEqual(["cm-stars", "cm-serif"]);
    expect(styleLineClasses("{name}")).toBeNull();
    expect(styleLineClasses("{checks onclick}")).toBeNull();
    expect(styleLineClasses("Hello {checks}")).toBeNull();
    const html = render("{first name}\nHi there");
    expect(html).toContain("{first name}");
  });

  it("continues numbering from the list's start", () => {
    const html = render("3. Third\n4. Fourth");
    expect(html).toContain('<ol start="3" style="counter-reset:cm-n 2">');
  });

  it("leaves style lines inside code fences alone", () => {
    expect(prepareCheckoutMarkdown("```\n{checks}\n```")).toContain("```\n{checks}\n```");
  });
});

describe("checkoutPlainText", () => {
  it("strips Markdown, photos and style lines for the meta description", () => {
    expect(checkoutPlainText("{serif}\n## Protect **Your** Practice\n---\n![p](/a.png)\n{checks}\n- One")).toBe(
      "Protect Your Practice p One",
    );
  });
});

describe("insertCheckoutImage", () => {
  it("puts the photo on its own paragraph at the cursor", () => {
    const edit = insertCheckoutImage("Before.After.", 7, 7, "/images/a b.png", "My [photo]");
    expect(edit.value).toBe("Before.\n\n![My photo](</images/a b.png>)\n\nAfter.");
    expect(edit.value.slice(0, edit.selectionStart)).toBe("Before.\n\n![My photo](</images/a b.png>)");
  });

  it("appends to an empty description", () => {
    expect(insertCheckoutImage("", 0, 0, "/images/a.png", "").value).toBe("![](/images/a.png)\n");
  });
});

describe("applyCheckoutStyle", () => {
  const text = "You'll learn how to:\n- One\n- Two\n\nClosing words.";

  it("writes a style line above the list the cursor is in, not above the sentence", () => {
    const cursor = text.indexOf("Two");
    const edit = applyCheckoutStyle(text, cursor, "bullets", "checks");
    expect(edit.value).toBe("You'll learn how to:\n{checks}\n- One\n- Two\n\nClosing words.");
  });

  it("replaces a style of the same group and keeps the others", () => {
    const styled = "{checks serif}\n- One\n- Two";
    const edit = applyCheckoutStyle(styled, styled.indexOf("Two"), "bullets", "stars");
    expect(edit.value).toBe("{serif stars}\n- One\n- Two");
  });

  it("takes a style off and removes an empty style line", () => {
    const styled = "{checks}\n- One";
    expect(applyCheckoutStyle(styled, styled.indexOf("One"), "bullets", "").value).toBe("- One");
  });

  it("styles a heading on its own", () => {
    const doc = "Intro line\n## Heading\nBody";
    const edit = applyCheckoutStyle(doc, doc.indexOf("Heading"), "font", "sans");
    expect(edit.value).toBe("Intro line\n{sans}\n## Heading\nBody");
  });

  it("styles a paragraph from its first line", () => {
    const doc = "First para\n\nSecond line one\nSecond line two";
    const edit = applyCheckoutStyle(doc, doc.indexOf("two"), "look", "center");
    expect(edit.value).toBe("First para\n\n{center}\nSecond line one\nSecond line two");
  });
});

describe("withPreselectedOption", () => {
  const offer = {
    selectedPricingOptionId: null,
    pricingOptions: [{ id: 11 }, { id: 12 }],
  } as unknown as Parameters<typeof withPreselectedOption>[0];

  it("selects ?option= when it is one of the offer's options", () => {
    expect(withPreselectedOption(offer, "12").selectedPricingOptionId).toBe(12);
  });

  it("ignores unknown or malformed ids", () => {
    expect(withPreselectedOption(offer, "99")).toBe(offer);
    expect(withPreselectedOption(offer, "12abc")).toBe(offer);
    expect(withPreselectedOption(offer, null)).toBe(offer);
  });
});
