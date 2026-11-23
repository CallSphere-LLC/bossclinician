import { describe, expect, it } from "vitest";
import { COUNTDOWN_IMAGE, countdownEmailHtml, httpsOrigin } from "./EmailComposer";

describe("the email countdown block", () => {
  const LABEL = "Friday, December 4 at 11:59 PM PST";

  it("is exactly the linked timer picture and a line of plain words", () => {
    expect(countdownEmailHtml("https://www.bossclinician.com", "early-bird", LABEL)).toBe(
      '<p><a href="https://www.bossclinician.com/api/countdown/early-bird/go">' +
        '<img src="https://www.bossclinician.com/api/countdown/early-bird.gif" width="600" height="120" ' +
        'alt="Offer ends Friday, December 4 at 11:59 PM PST"></a></p>' +
        "<p>Offer ends Friday, December 4 at 11:59 PM PST.</p>",
    );
    expect(COUNTDOWN_IMAGE).toEqual({ width: 600, height: 120 });
  });

  it("writes real addresses, never a token the sender would hold the email for", () => {
    const html = countdownEmailHtml("https://www.bossclinician.com", "early-bird", LABEL);
    expect(html).not.toContain("{{");
    // The picture's address must be absolute https, or the editor drops it.
    expect(html).toMatch(/<img src="https:\/\//);
    expect(html).toMatch(/<a href="https:\/\//);
  });

  it("does not double the slash when the site address ends in one", () => {
    const html = countdownEmailHtml("https://www.bossclinician.com/", "early-bird", LABEL);
    expect(html).toContain('href="https://www.bossclinician.com/api/countdown/early-bird/go"');
  });

  it("keeps an odd slug or label from breaking out of the markup", () => {
    const html = countdownEmailHtml("https://x.test", 'a b"/c', 'Fri <b> & "soon"');
    expect(html).toContain("/api/countdown/a%20b%22%2Fc.gif");
    expect(html).toContain('alt="Offer ends Fri &lt;b&gt; &amp; &quot;soon&quot;"');
    expect(html).toContain("<p>Offer ends Fri &lt;b&gt; &amp; &quot;soon&quot;.</p>");
  });

  it("only accepts a secure site address", () => {
    expect(httpsOrigin("https://www.bossclinician.com")).toBe("https://www.bossclinician.com");
    expect(httpsOrigin("https://www.bossclinician.com/")).toBe("https://www.bossclinician.com");
    expect(httpsOrigin("http://localhost:5173")).toBeNull();
    expect(httpsOrigin("")).toBeNull();
    expect(httpsOrigin("https://www.bossclinician.com/some/page")).toBeNull();
  });
});
