import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import ClubThankYou from "./ClubThankYou";
import LoungeConfirmed from "./LoungeConfirmed";
import { kajabiPublicRoutes } from "./routes";

describe("membership onboarding", () => {
  it("keeps the supplied Club steps, conditional bonus, CE boundary and working portal link", () => {
    const html = renderToStaticMarkup(<ClubThankYou />);
    expect(html.match(/class="step"/g)).toHaveLength(5);
    expect(html).toContain('href="/login"');
    expect(html).toContain("two live coaching calls each month");
    expect(html).toContain("during the current bonus period");
    expect(html).toContain("coaching calls, community access, and bonus materials do not carry NBCC credit");
    expect(html).toContain("/images/kajabi-pages/the-club-ty/yesss.webp");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("already unlocked");
  });
  it("gives Lounge and conditional VIP next steps without claiming delivered emails or bypassing access", () => {
    const html = renderToStaticMarkup(<MemoryRouter><LoungeConfirmed /></MemoryRouter>);
    expect(html).toContain('href="/library/the-practice-elevation"');
    expect(html).toContain('href="/library/the-lounge-vip"');
    expect(html).toContain("If you joined as a VIP");
    expect(html).toContain("Practice Reset Snapshot");
    expect(html).toContain("Practice Health Assessment");
    expect(html).not.toContain("already unlocked");
    expect(html).not.toContain("just landed");
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });
  it("registers both welcome URLs for client and server rendering", () => {
    for (const path of ["/the-club-ty", "/lounge-confirmed"]) {
      expect(kajabiPublicRoutes.filter((route) => route.path === path)).toHaveLength(1);
    }
  });
});
