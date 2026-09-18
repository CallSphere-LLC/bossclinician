import { describe, expect, it } from "vitest";
import { brandEmailHtml, isAlreadyLaidOut, preheaderFrom, promoteLoneLinks, styleBody } from "./brandShell";

const SITE = "https://bossclinician.callsphere.site";

describe("brandEmailHtml", () => {
  const plain = [
    "<p>Hi Sagar,</p>",
    "<p>Please confirm this is your email address so I know where to reach you:</p>",
    '<p><a href="https://bossclinician.callsphere.site/verify-email?token=abc">Confirm my email address</a></p>',
    "<p>The link works for 24 hours.</p>",
    "<p>— Yvette</p>",
  ].join("\n");

  it("frames plain paragraphs in the brand, keeping every word and the link", () => {
    const html = brandEmailHtml({ html: plain, subject: "Confirm your email address", text: "Hi Sagar,\n\nPlease confirm this is your email address.", siteUrl: SITE });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Lead. Heal. Elevate.");
    expect(html).toContain("Hi Sagar,");
    expect(html).toContain('href="https://bossclinician.callsphere.site/verify-email?token=abc"');
    expect(html).toContain("Confirm my email address");
    expect(html).toContain("<title>Confirm your email address</title>");
    // The preview line is the first real sentence, not the greeting.
    expect(html).toContain("Please confirm this is your email address.</div>");
  });

  it("turns a paragraph that is only a link into a button, and leaves inline links as links", () => {
    const promoted = promoteLoneLinks('<p><a href="https://x.test/a">Open my account</a></p><p>See <a href="https://x.test/b">this</a> too.</p>');
    expect(promoted).toContain('role="presentation"');
    expect(promoted).toContain("text-transform:uppercase");
    expect(promoted).toContain('<p>See <a href="https://x.test/b">this</a> too.</p>');
  });

  it("sets the sign-off apart", () => {
    expect(styleBody("<p>— Yvette</p>")).toContain("font-style:italic");
    expect(styleBody("<p>An ordinary sentence — with a dash in it that runs on for quite a while longer than a name would.</p>")).not.toContain("font-style:italic");
  });

  it("leaves a message that already has its own layout alone", () => {
    const receipt = '<table role="presentation"><tr><td>Receipt</td></tr></table>';
    expect(isAlreadyLaidOut(receipt)).toBe(true);
    expect(brandEmailHtml({ html: receipt, subject: "Receipt", siteUrl: SITE })).toBe(receipt);
    const once = brandEmailHtml({ html: "<p>Hi</p>", subject: "S", siteUrl: SITE });
    expect(brandEmailHtml({ html: once, subject: "S", siteUrl: SITE })).toBe(once);
  });

  it("escapes the subject and the preview line", () => {
    const html = brandEmailHtml({ html: "<p>Hi</p>", subject: "<script>x</script>", text: "A <b>bold</b> claim", siteUrl: SITE });
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("A &lt;b&gt;bold&lt;/b&gt; claim");
  });
});

describe("preheaderFrom", () => {
  it("skips the greeting and bare links", () => {
    expect(preheaderFrom("Hi Sagar,\n\nhttps://x.test/verify\n\nYou're all set.")).toBe("You're all set.");
    expect(preheaderFrom("")).toBe("");
  });
});
