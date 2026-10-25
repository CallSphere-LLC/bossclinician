import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Route, Routes, StaticRouter } from "react-router";
import { SsrProvider } from "@/ssr/context";
import { ssrKeys } from "@/ssr/keys";
import NonCourseProduct from "./NonCourseProduct";

function render(slug: string, route: string) {
  const product = {
    slug,
    title: slug === "directory-makeover-audit" ? "Directory Makeover Audit" : "Rate Negotiation Letter Template",
    subtitle: "Personalized help",
    description: "A useful product.",
    image: "",
    features: ["Profile review"],
    published: true,
    modules: [],
    owned: false,
    offers: [{
      slug, title: "Offer", pricingType: "one_time", amountCents: 6700,
      currency: "usd", interval: null, intervalCount: 1, installmentCount: null,
      checkoutHeadline: "", available: true, unavailableReason: "",
      pricingOptions: slug === "directory-makeover-audit" ? [
        { id: 17, label: "Two-Profile Bundle", recommended: false, pricingType: "one_time", amountCents: 9700, currency: "usd", interval: null, intervalCount: 1, installmentCount: null },
        { id: 18, label: "Full Visibility Audit (3 Profiles)", recommended: false, pricingType: "one_time", amountCents: 14700, currency: "usd", interval: null, intervalCount: 1, installmentCount: null },
      ] : [],
    }],
  };
  return renderToStaticMarkup(
    <SsrProvider runtime={{ payload: {
      origin: "https://www.bossclinician.com", indexable: true,
      data: { [ssrKeys.courseDetail(slug)]: product },
    }, headSink: [] }}>
      <StaticRouter location={route}><Routes>
        <Route path="/services/:slug" element={<NonCourseProduct />} />
        <Route path="/downloads/:slug" element={<NonCourseProduct />} />
      </Routes></StaticRouter>
    </SsrProvider>,
  );
}

describe("non-course product pages", () => {
  it("presents the audit as a service with a real checkout offer", () => {
    const html = render("directory-makeover-audit", "/services/directory-makeover-audit");
    expect(html).toContain("Service");
    expect(html).toContain("/checkout/directory-makeover-audit");
    expect(html).toContain("/checkout/directory-makeover-audit?option=17");
    expect(html).toContain("/checkout/directory-makeover-audit?option=18");
    expect(html).not.toContain("/checkout/rate-negotiation-letter-template");
    expect(html).toContain("intake form");
  });
  it("presents the letter as a download", () => {
    const html = render("rate-negotiation-letter-template", "/downloads/rate-negotiation-letter-template");
    expect(html).toContain("Download");
    expect(html).toContain("/checkout/rate-negotiation-letter-template");
    expect(html).not.toContain("/checkout/directory-makeover-audit");
  });
});
