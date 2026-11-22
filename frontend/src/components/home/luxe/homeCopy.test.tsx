import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { LuxeHero } from "./LuxeHero";
import { LuxeOffers } from "./LuxeOffers";
import { HomeOpening, HomePictureThis, HomeRetreatFeature } from "./HomeEditorial";

const render = (node: React.ReactNode) =>
  renderToString(<StaticRouter location="/">{node}</StaticRouter>);

// Website handoff of 21 Nov 2026 (sheet row 245), section 4.
describe("home page copy (row 245)", () => {
  it("keeps the headline, uses the new subhead and two distinct buttons", () => {
    const html = render(<LuxeHero />);
    expect(html).toContain("Make your practice pay you consistently and fit the life you actually have");
    expect(html).toMatch(/href="\/practice-quiz"[^>]*>.*Find My Next Step/s);
    expect(html).toMatch(/href="#offers"[^>]*>.*Find the Support You Need/s);
    expect(html).not.toContain("Find Your Path");
  });

  it("opens with the approved introduction and its aside", () => {
    const html = render(<HomeOpening />);
    expect(html).toContain("who taught you how to build a practice that takes care of you, too?");
    expect(html).toContain("(And I don’t wanna hear you blaming grad school. 😂)");
    expect(html).toContain("owner of Brighter Tomorrow and founder of Boss Clinician");
    expect(html).not.toContain("Counseling Services");
  });

  it("introduces each stage, then its I-help line, with program buttons", () => {
    const html = render(<LuxeOffers />);
    expect(html).toContain("there’s support for your next step.");
    expect(html).toContain("You want a practice of your own.");
    expect(html).toContain("You already own the practice.");
    expect(html).toContain("You’re preparing to hire, or you already have a team.");
    expect(html).toContain("Start your private practice while still covering your bills");
    expect(html).toContain("Build a plan to pay yourself consistently and make room for time away from sessions.");
    expect(html).toContain("Build a team that can handle daily operations so you can step away.");
    for (const cta of ["Explore The Club", "Explore The Lounge", "Explore The Boardroom"]) {
      expect(html).toContain(cta);
    }
  });

  it("adds the Picture this block and a separate retreat feature", () => {
    expect(render(<HomePictureThis />)).toContain("What It Looks Like When the Practice Fits Your Life.");
    const retreat = render(<HomeRetreatFeature />);
    expect(retreat).toContain("For the woman behind the provider role.");
    expect(retreat).toMatch(/href="\/retreats"[^>]*>.*Explore FlourisHealer Retreats/s);
  });
});
