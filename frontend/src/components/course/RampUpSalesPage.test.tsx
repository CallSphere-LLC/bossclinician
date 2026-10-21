import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import RampUpSalesPage from "./RampUpSalesPage";
import type { CourseDetailResponse } from "./CoursePriceLabel";
import html from "@/content/ramp-up/source.html?raw";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../../content/ramp-up/source.css", import.meta.url), "utf8");

const fixture = (available = true, amountCents = 9700, owned = false) => ({
  slug: "ramp-up-rate-formula", owned, priceText: "$97",
  offers: [{ slug: "ramp-up-rate-formula", available, amountCents, currency: "usd", pricingType: "one_time" }],
}) as CourseDetailResponse;
const render = (course: CourseDetailResponse) => renderToStaticMarkup(<MemoryRouter><RampUpSalesPage course={course} /></MemoryRouter>);

describe("Ramp-Up source reproduction", () => {
  it("preserves source sections, backgrounds, local artwork and working native FAQs without third-party executable markup", () => {
    for (const section of ["Confident Pricing Strategies", "Your Skills Deserve", "Average Rate", "Rate Comparison Calculator", "Revenue Workbook", "Meet Your Instructor"]) expect(html).toContain(section);
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).not.toMatch(/<script|<iframe|<form|\son[a-z]+=/i);
    expect(html).not.toContain("resource_redirect/offers");
    expect(html).not.toMatch(/src=["']https?:/);
    expect(css).not.toMatch(/url\(["']?https?:/);
    expect(css).toContain(".ramp-up-page #section-1729539895996");
  });
  it("uses the current price and new checkout, including changed offers", () => {
    expect(render(fixture())).toContain('href="/checkout/ramp-up-rate-formula"');
    const changed = render(fixture(true, 12700));
    expect(changed).toContain("$127");
    expect(changed).not.toContain("$97");
    expect(changed).not.toContain("Original Price: $197");
  });
  it("opens owned training and disables unavailable checkout", () => {
    expect(render(fixture(true, 9700, true))).toContain('href="/library/ramp-up-rate-formula"');
    expect(render(fixture(true, 9700, true))).toContain("Open your training");
    const unavailable = render(fixture(false));
    expect(unavailable).toContain('aria-disabled="true"');
    expect(unavailable).not.toContain('href="/checkout/');
  });
});
