import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { Footer } from "./Footer";

const render = (location: string) =>
  renderToString(
    <StaticRouter location={location}>
      <Footer />
    </StaticRouter>,
  );

// Sheet row 245 (21 Nov 2026): no generic newsletter signup anywhere; the
// footer points to a next step instead of asking for an email address.
describe("footer next step (row 245)", () => {
  it("asks for no email address and makes no newsletter promise", () => {
    for (const path of ["/", "/club", "/lounge", "/retreats", "/about"]) {
      const html = render(path);
      expect(html, path).not.toMatch(/type="email"|Get Access|newsletter/i);
    }
  });

  it("sends the general footer to the practice quiz", () => {
    const html = render("/");
    expect(html).toContain("Not sure where to start?");
    expect(html).toContain("Find the next step for your practice.");
    expect(html).toMatch(/href="\/practice-quiz"[^>]*>.*Find My Next Step/s);
  });

  it("gives the Club, Lounge and retreat pages their own button", () => {
    expect(render("/club")).toContain("Watch the Free Practice Prep Training");
    expect(render("/club")).toContain('href="/practicepreptraining"');
    expect(render("/lounge")).toContain("Watch the Free Freedom Masterclass");
    expect(render("/lounge")).toContain('href="/freedom-masterclass"');
    const retreat = render("/retreats/");
    expect(retreat).toContain('href="#reserve"');
    expect(retreat).toContain("Explore Room Options");
    expect(retreat).toContain('href="https://tidycal.com/profitwithyvette/retreat"');
    expect(retreat).toContain("Talk With Yvette About the Retreat");
    expect(retreat).not.toContain("Find My Next Step");
  });

  it("lists FlourisHealer Retreats in the footer", () => {
    expect(render("/")).toMatch(/href="\/retreats"[^>]*>FlourisHealer Retreats/);
  });
});
