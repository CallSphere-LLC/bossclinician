import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import CourseSalesPage from "./CourseSalesPage";
import type { CourseDetailResponse } from "./CoursePriceLabel";
import { parseInline, parseSalesPage, salesButtons, type SalesOffer, type SalesPricingOption } from "./salesPage";

/** Offer 121 as the course API sends it: $77 one-time, no extra prices yet. */
const offer = (over: Partial<SalesOffer> = {}): SalesOffer => ({
  available: true,
  unavailableReason: "",
  slug: "audit-proof-your-practice-on-demand-free",
  title: "Audit Proof Your Practice (On-Demand Training)",
  pricingType: "one_time",
  amountCents: 7700,
  currency: "usd",
  interval: null,
  intervalCount: 1,
  installmentCount: null,
  checkoutHeadline: "",
  ...over,
});

const option = (over: Partial<SalesPricingOption>): SalesPricingOption => ({
  id: 1,
  label: "",
  recommended: false,
  pricingType: "one_time",
  amountCents: 7700,
  currency: "usd",
  interval: null,
  intervalCount: 1,
  installmentCount: null,
  ...over,
});

describe("salesButtons", () => {
  it("falls back to the offer's own price when it has no extra options", () => {
    expect(salesButtons([offer()])).toEqual([
      {
        key: "audit-proof-your-practice-on-demand-free",
        label: "Register — $77",
        to: "/checkout/audit-proof-your-practice-on-demand-free",
        primary: true,
      },
    ]);
  });

  it("prints one button per option and drops the base price an option restates", () => {
    const buttons = salesButtons([
      offer({
        pricingOptions: [
          option({ id: 41, label: "Training + CE Credit — $77", recommended: true }),
          option({ id: 42, label: "Educational Access — $57 | No CE Credit", amountCents: 5700 }),
        ],
      }),
    ]);
    expect(buttons.map((b) => [b.label, b.to, b.primary])).toEqual([
      ["Training + CE Credit — $77", "/checkout/audit-proof-your-practice-on-demand-free?option=41", true],
      ["Educational Access — $57 | No CE Credit", "/checkout/audit-proof-your-practice-on-demand-free?option=42", false],
    ]);
  });

  it("keeps the base price when no option charges the same", () => {
    const buttons = salesButtons([
      offer({ pricingOptions: [option({ id: 42, label: "Educational Access", amountCents: 5700 })] }),
    ]);
    expect(buttons.map((b) => [b.label, b.to, b.primary])).toEqual([
      ["Register — $77", "/checkout/audit-proof-your-practice-on-demand-free", true],
      // A label without its price gets the charged amount appended.
      ["Educational Access — $57", "/checkout/audit-proof-your-practice-on-demand-free?option=42", false],
    ]);
  });

  it("offers nothing to buy on an offer that cannot be delivered", () => {
    expect(salesButtons([offer({ available: false, unavailableReason: "Not ready" })])).toEqual([]);
  });

  const deadline = (over: Partial<NonNullable<SalesOffer["deadline"]>> = {}): NonNullable<SalesOffer["deadline"]> => ({
    endsAt: "2026-12-05T07:59:00.000Z",
    endsLabel: "Friday, December 4 at 11:59 PM PST",
    serverNow: "2026-12-01T20:00:00.000Z",
    showCountdown: true,
    closed: false,
    afterCloseUrl: "",
    ...over,
  });

  it("keeps the checkout buttons of an offer whose sale is still on", () => {
    expect(salesButtons([offer({ deadline: deadline({ afterCloseUrl: "/checkout/full-price" }) })]).map((b) => b.to)).toEqual([
      "/checkout/audit-proof-your-practice-on-demand-free",
    ]);
  });

  it("sends an ended sale's button to where the owner points latecomers, with no price and no option", () => {
    const buttons = salesButtons([
      offer({
        deadline: deadline({ closed: true, afterCloseUrl: "/checkout/full-price" }),
        pricingOptions: [option({ id: 41, label: "Training + CE Credit — $77", recommended: true })],
      }),
    ]);
    expect(buttons).toEqual([
      {
        key: "audit-proof-your-practice-on-demand-free:closed",
        label: "See the current offer",
        to: "/checkout/full-price",
        primary: true,
      },
    ]);
  });

  it("offers no button for an ended sale with nowhere to go, or with a destination off this site", () => {
    expect(salesButtons([offer({ deadline: deadline({ closed: true }) })])).toEqual([]);
    expect(salesButtons([offer({ deadline: deadline({ closed: true, afterCloseUrl: "//evil.example" }) })])).toEqual([]);
  });

  it("does not repeat a button when the ended sale points at an offer already listed", () => {
    const buttons = salesButtons([
      offer({ slug: "early-bird", amountCents: 4700, deadline: deadline({ closed: true, afterCloseUrl: "/checkout/full-price" }) }),
      offer({ slug: "full-price" }),
    ]);
    expect(buttons.map((b) => [b.label, b.to])).toEqual([["Register — $77", "/checkout/full-price"]]);
    // The same when the regular offer's only buttons are its labelled options.
    const optionsOnly = salesButtons([
      offer({ slug: "early-bird", amountCents: 4700, deadline: deadline({ closed: true, afterCloseUrl: "/checkout/full-price" }) }),
      offer({ slug: "full-price", pricingOptions: [option({ id: 41, label: "Training + CE Credit — $77", recommended: true })] }),
    ]);
    expect(optionsOnly.map((b) => b.to)).toEqual(["/checkout/full-price?option=41"]);
  });
});

describe("parseInline", () => {
  it("reads bold, links and email addresses, including an address inside bold", () => {
    expect(parseInline("email **support@bossclinician.com**.")).toEqual([
      { kind: "text", text: "email " },
      { kind: "strong", children: [{ kind: "email", address: "support@bossclinician.com" }] },
      { kind: "text", text: "." },
    ]);
    expect(parseInline("[View policies](/ceu-terms-boss-clinician), including")).toEqual([
      { kind: "link", text: "View policies", href: "/ceu-terms-boss-clinician" },
      { kind: "text", text: ", including" },
    ]);
  });
});

describe("parseSalesPage", () => {
  it("rejects a value with no hero title, and drops unsafe images", () => {
    expect(parseSalesPage(null)).toBeNull();
    expect(parseSalesPage({ hero: {} })).toBeNull();
    const page = parseSalesPage({
      hero: { title: "T", image: { src: "javascript:alert(1)", alt: "" } },
      sections: [{ title: "S", image: { src: "//evil.example/x.png" } }, { nope: true }],
    });
    expect(page?.hero.image).toBeUndefined();
    expect(page?.sections).toHaveLength(1);
    expect(page?.sections[0].image).toBeUndefined();
  });
});

describe("CourseSalesPage", () => {
  const page = parseSalesPage({
    hero: {
      title: "Protect Your Practice.",
      titleAccent: "Protect Your Peace.",
      paragraphs: ["Join **Yvette Howard, LCSW**, for a recorded training."],
      highlights: ["1.5 CE Hours"],
    },
    sections: [
      {
        id: "policies",
        title: "Questions and Program Policies",
        paragraphs: ["[View Continuing Education Program Policies](/ceu-terms-boss-clinician), including refunds."],
      },
    ],
    footer: "Boss Clinician, LLC · support@bossclinician.com",
  })!;

  const course = (offers: SalesOffer[], owned = false) =>
    ({
      id: "62",
      slug: "audit-proof-your-practice-on-demand",
      title: "Audit Proof Your Practice (On-Demand Training)",
      subtitle: "",
      description: "",
      priceText: "From $57",
      image: "",
      url: "#",
      features: [],
      sort: 0,
      published: true,
      modules: [],
      offers,
      owned,
    }) as CourseDetailResponse;

  const render = (c: CourseDetailResponse) =>
    renderToStaticMarkup(
      <StaticRouter location="/courses/audit-proof-your-practice-on-demand">
        <CourseSalesPage course={c} page={page} />
      </StaticRouter>,
    );

  it("renders the copy and a checkout button per price, top and bottom", () => {
    const html = render(
      course([
        offer({
          pricingOptions: [
            option({ id: 41, label: "Training + CE Credit — $77", recommended: true }),
            option({ id: 42, label: "Educational Access — $57 | No CE Credit", amountCents: 5700 }),
          ],
        }),
      ]),
    );
    expect(html).toContain("Protect Your Peace.");
    expect(html).toContain("Yvette Howard, LCSW</strong>");
    expect(html).toContain('href="/ceu-terms-boss-clinician"');
    expect(html).toContain('href="mailto:support@bossclinician.com"');
    expect(html.match(/href="\/checkout\/audit-proof-your-practice-on-demand-free\?option=41"/g)).toHaveLength(2);
    expect(html.match(/href="\/checkout\/audit-proof-your-practice-on-demand-free\?option=42"/g)).toHaveLength(2);
  });

  it("shows the catalogue price and a contact button before any offer is published", () => {
    const html = render(course([]));
    expect(html).toContain("From $57");
    expect(html).toContain('href="/contact"');
    expect(html).not.toContain("/checkout/");
  });

  it("sends an owner to their library instead of checkout", () => {
    const html = render(course([offer()], true));
    expect(html).toContain('href="/library"');
    expect(html).not.toContain("/checkout/");
  });

  const saleDeadline = (over: Partial<NonNullable<SalesOffer["deadline"]>> = {}): NonNullable<SalesOffer["deadline"]> => ({
    endsAt: "2026-12-05T07:59:00.000Z",
    endsLabel: "Friday, December 4 at 11:59 PM PST",
    serverNow: "2026-12-01T20:00:00.000Z",
    showCountdown: true,
    closed: false,
    afterCloseUrl: "/checkout/full-price",
    ...over,
  });

  it("shows the sale deadline above the buttons while the sale is on", () => {
    const html = render(course([offer({ deadline: saleDeadline() })]));
    expect(html).toContain("Friday, December 4 at 11:59 PM PST");
    expect(html).toContain('href="/checkout/audit-proof-your-practice-on-demand-free"');
  });

  it("drops the timer and reroutes the buttons once the sale has ended", () => {
    const html = render(course([offer({ deadline: saleDeadline({ closed: true }) })]));
    expect(html).not.toContain("Friday, December 4 at 11:59 PM PST");
    expect(html).not.toContain("/checkout/audit-proof-your-practice-on-demand-free");
    expect(html.match(/href="\/checkout\/full-price"/g)).toHaveLength(2);
    expect(html).toContain("See the current offer");
  });
});
