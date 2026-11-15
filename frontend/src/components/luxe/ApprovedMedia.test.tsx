import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { ApprovedTestimonials } from "./ApprovedTestimonials";
import { ProgramFounderVideo } from "./ProgramFounderVideo";

const render = (node: React.ReactNode) => renderToString(<StaticRouter location="/">{node}</StaticRouter>);
describe("approved row 234 media", () => {
  it("places Joanne's exact quote with a local expandable original", () => {
    const html = render(<ApprovedTestimonials program="club" />);
    expect(html).toContain("Joanne Tran");
    expect(html).toContain("Yvette has been such a vital part of my journey in taking the leap to start my private practice.");
    expect(html).toContain("<details");
    expect(html).toContain("/images/testimonials/joanne-approved-v1.png");
    expect(html).not.toContain("drive.google");
  });
  it("orders Rosa then Jenna, using only the cropped approved Jenna bubble", () => {
    const html = render(<ApprovedTestimonials program="boardroom" />);
    expect(html.indexOf("Rosa Montez")).toBeLessThan(html.indexOf("Jenna"));
    expect(html).toContain("I feel extremely prepared for the next step of growth in my business!");
    expect(html).not.toContain("jenna.png");
    expect(html).not.toContain("I appreciate your thoughtful");
    expect(html).toContain("/images/testimonials/jenna-approved-v1.png");
    expect(html.match(/<img /g)).toHaveLength(2);
  });
  for (const program of ["club", "lounge"] as const) {
    it(`${program} is click-to-play, same-origin, and preserves its action`, () => {
      const html = render(<ProgramFounderVideo program={program} />);
      expect(html).toContain(`poster="/videos/${program}-vsl-approved-v1-poster.jpg"`);
      expect(html).toContain('preload="none"');
      expect(html).toContain("Play Yvette");
      expect(html).not.toMatch(/autoplay|drive.google|<iframe|<video[^>]* src=/i);
      expect(html).toContain(program === "club" ? 'href="/club/checkout"' : 'href="#join"');
      if (program === "club") expect(html).toContain('href="/practicepreptraining"');
    });
  }
});
