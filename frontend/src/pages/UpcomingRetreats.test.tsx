import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { matchPath, StaticRouter } from "react-router";
import UpcomingRetreats from "./UpcomingRetreats";
import RetreatInterest from "./RetreatInterest";
import { PUBLIC_ROUTES } from "@/App";
import { SsrProvider } from "@/ssr/context";
import { ssrKeys } from "@/ssr/keys";
import type { HeadDescriptor } from "@/seo/types";
import type { PublicRetreat } from "@/lib/retreatsPublicApi";
import { formatRetreatDates, RETREAT_INTEREST_CONSENT } from "@/content/retreatInterest";

function render(element: ReactElement, location: string, data: Record<string, unknown> = {}) {
  const head: HeadDescriptor[] = [];
  const html = renderToString(
    <SsrProvider runtime={{ payload: { origin: "https://example.com", indexable: true, data }, headSink: head }}>
      <StaticRouter location={location}>{element}</StaticRouter>
    </SsrProvider>,
  );
  return { html, head };
}

const BALI: PublicRetreat = {
  slug: "bali-2027",
  title: "FlourisHealer Bali 2027",
  location: "Ubud, Bali",
  startDate: "2027-06-15",
  endDate: "2027-06-20",
  summary: "A six-day, five-night Bali retreat for women in mental health and wellness who want room to rest, enjoy themselves, and connect beyond the provider role.",
  image: "/images/retreat-villa-aerial.webp",
  href: "/retreats",
  upcoming: true,
};

describe("formatRetreatDates", () => {
  it("formats stored calendar dates without shifting a day", () => {
    expect(formatRetreatDates("2027-06-15", "2027-06-20")).toBe("June 15–20, 2027");
    expect(formatRetreatDates("2027-06-28", "2027-07-03")).toBe("June 28 – July 3, 2027");
    expect(formatRetreatDates("2027-12-30", "2028-01-03")).toBe("December 30, 2027 – January 3, 2028");
    expect(formatRetreatDates("2027-06-15", "2027-06-15")).toBe("June 15, 2027");
    expect(formatRetreatDates("nope", "2027-06-15")).toBe("");
  });
});

describe("/upcoming-retreats (owner reply 22 Nov 2026, item 6)", () => {
  it("lists a published upcoming retreat with its dates and link", () => {
    const { html } = render(<UpcomingRetreats />, "/upcoming-retreats", { [ssrKeys.upcomingRetreats()]: [BALI] });
    expect(html).toContain("<h1>Upcoming Retreats</h1>");
    expect(html).toContain("FlourisHealer Bali 2027");
    expect(html).toContain('<p class="retreat-dates">June 15–20, 2027</p>');
    expect(html).toContain('href="/retreats"');
    expect(html).toContain("Explore the Retreat");
    // With a retreat listed, the sign-up is a link, not the inline form.
    expect(html).toContain('href="/retreat-interest"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("first access");
  });

  it("offers the announcement sign-up when nothing is published and upcoming", () => {
    const { html } = render(<UpcomingRetreats />, "/upcoming-retreats", { [ssrKeys.upcomingRetreats()]: [] });
    expect(html).toContain("There are no upcoming retreats published right now.");
    expect(html).toContain("<form");
    expect(html).toContain(RETREAT_INTEREST_CONSENT);
    expect(html).toContain('type="email"');
    expect(html).not.toContain("FlourisHealer Bali 2027");
  });

  it("opens with her Email 4 paragraph", () => {
    const { html } = render(<UpcomingRetreats />, "/upcoming-retreats", { [ssrKeys.upcomingRetreats()]: [] });
    expect(html).toContain(
      "If an upcoming retreat catches your eye, you can explore the details and decide whether it fits your next chapter. If nothing is announced yet, you can sign up to hear when new retreats are available.",
    );
  });
});

describe("/retreat-interest", () => {
  const { html, head } = render(<RetreatInterest />, "/retreat-interest");

  it("explains what subscribers receive, and that they can unsubscribe", () => {
    expect(html).toContain("What you’ll receive");
    expect(html).toContain("Emails announcing new FlourisHealer retreats, sent when a retreat is announced.");
    expect(html).toContain("You can unsubscribe at any time with the link in any email.");
    expect(head[0]?.title).toBe("Retreat Announcements | FlourisHealer");
  });

  it("asks for explicit consent, with a hidden bot trap and no pre-ticked box", () => {
    expect(html).toContain(RETREAT_INTEREST_CONSENT);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*required/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).toContain('name="company_website"');
    expect(html).toContain('href="/privacy-policy"');
  });
});

describe("public routes", () => {
  const resolve = (path: string) => PUBLIC_ROUTES.find((r) => matchPath(r.path, path))?.path;

  it("keeps /retreats and gives Bali its destination-and-year address", () => {
    expect(resolve("/retreats")).toBe("/retreats");
    expect(resolve("/retreats/bali-2027")).toBe("/retreats/bali-2027");
    expect(PUBLIC_ROUTES.find((r) => r.path === "/retreats")?.Component).toBe(
      PUBLIC_ROUTES.find((r) => r.path === "/retreats/bali-2027")?.Component,
    );
    expect(resolve("/retreats/costa-rica-2028")).toBe("/retreats/:slug");
    expect(resolve("/upcoming-retreats")).toBe("/upcoming-retreats");
    expect(resolve("/retreat-interest")).toBe("/retreat-interest");
  });
});
