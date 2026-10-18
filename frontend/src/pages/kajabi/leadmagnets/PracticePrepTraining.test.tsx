import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import PracticePrepTraining from "./PracticePrepTraining";
import PracticePrepVideo from "./PracticePrepVideo";
import { leadMagnetPublicRoutes } from "./routes";
import ResourceHub from "@/pages/ResourceHub";
import CookiePolicy from "@/pages/legal/CookiePolicy";
import AccessibilityStatement from "@/pages/legal/AccessibilityStatement";
import { practicePrepTraining, practicePrepVideo } from "@/content/practicePrepTraining";
import { avatarSections } from "@/content/resourceHub";
import { exploreMenu, footer, isNavMenu, nav } from "@/content/site";
import { readConsent } from "@/lib/consent";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";

/**
 * QA sheet rows 93, 96, 97 and 98 (15 Oct 2026), rendered in Node with no
 * `window`: rendering at all proves none of these pages reaches for the browser
 * before hydration.
 */
function render(location: string, page: ReactElement): { html: string; head: HeadDescriptor[] } {
  const head: HeadDescriptor[] = [];
  const html = renderToString(
    <SsrProvider
      runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: head }}
    >
      <StaticRouter location={location}>{page}</StaticRouter>
    </SsrProvider>,
  );
  return { html, head };
}

/** React escapes apostrophes and quotes in text; compare against the same. */
function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
}

describe("/practicepreptraining", () => {
  const { html, head } = render("/practicepreptraining", <PracticePrepTraining />);

  it("is routed at her Kajabi address, with its video page", () => {
    const paths = leadMagnetPublicRoutes.map((r) => r.path);
    expect(paths).toContain("/practicepreptraining");
    expect(paths).toContain("/preparing-for-pp-video");
  });

  it("is indexable and says her promise", () => {
    expect(head.at(-1)?.title).toBe(practicePrepTraining.seo.title);
    expect(head.at(-1)?.noindex).toBeFalsy();
    expect(html).toContain(escaped(practicePrepTraining.hero.lede));
    expect(html).toContain(escaped(practicePrepTraining.learn.moves[2]));
  });

  it("asks what her Kajabi form asked, and every button jumps to it", () => {
    expect(html).toContain('id="register"');
    expect(html).toContain('href="#register"');
    expect(html).toMatch(/name="first_name"/);
    expect(html).toMatch(/name="last_name"/);
    expect(html).toMatch(/type="email"/);
    expect(html).toMatch(/name="biggest_concern"/);
    for (const option of practicePrepTraining.signup.concern.options) {
      expect(html).toContain(escaped(option));
    }
  });
});

describe("/preparing-for-pp-video", () => {
  const { html, head } = render("/preparing-for-pp-video", <PracticePrepVideo />);

  it("is noindex and does not carry Kajabi's placeholder", () => {
    expect(head.at(-1)?.noindex).toBe(true);
    expect(html).not.toContain("Replace this box");
    expect(html).toContain(escaped(practicePrepVideo.closing.cta));
  });
});

describe("Resource Hub (row 97)", () => {
  const { html } = render("/resource-hub", <ResourceHub />);

  it("leads section 1 with the free training card", () => {
    const first = avatarSections[0];
    expect(first.cards.map((c) => c.href)).toContain("/practicepreptraining");
    expect(html).toContain("Resources for every stage");
    expect(html).toContain('href="/practicepreptraining"');
  });
});

describe("header and footer (rows 93, 96, 98)", () => {
  it("puts Retreats in the bar, not in Explore", () => {
    expect(nav.some((entry) => !isNavMenu(entry) && entry.to === "/retreats")).toBe(true);
    expect(exploreMenu.items.some((item) => item.to === "/retreats")).toBe(false);
  });

  it("links the free training and the new legal pages from the footer", () => {
    expect(footer.resourceLinks.some((l) => l.to === "/practicepreptraining")).toBe(true);
    expect(footer.legalLinks.map((l) => l.to)).toEqual(expect.arrayContaining(["/cookie-policy", "/accessibility"]));
  });
});

describe("cookie policy and accessibility statement (row 96)", () => {
  it("render on the server", () => {
    expect(render("/cookie-policy", <CookiePolicy />).html).toContain("Essential cookies");
    expect(render("/accessibility", <AccessibilityStatement />).html).toContain("Our commitment");
  });

  it("has no stored choice without a browser", () => {
    expect(readConsent()).toBeNull();
  });
});
